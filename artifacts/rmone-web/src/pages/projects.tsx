import { compactUsd } from "../lib/money";
import { isClosedishStatus } from "../lib/closedish";
import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Search,
  X,
  RefreshCw,
  Map as MapIcon,
  Layers,
  TrendingUp,
  Star,
  Briefcase,
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Check,
  MapPin,
  Info,
  Users,
  Loader2,
  CloudOff,
  UserPlus,
  Mail,
  MessageCircle,
  Edit2,
  Plus,
  Filter,
  Building2,
  MoreVertical,
  Pause,
  Play,
  FileText,
  GitCompare,
  Zap,
  ArrowRight,
  Scale,
  Hash,
  DollarSign,
  Clock,
  Target,
  CheckCircle2,
  AlertCircle,
  Minus,
  TrendingDown,
  BarChart2,
  AlertTriangle,
  User,
  Sparkles,
  LayoutGrid,
  Table2,
  Archive,
  ArrowLeft,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import { RecordDataGrid, IdPill, GridChip, AllocBadge, ViewModeToggle, CountPill, ValueBar, AiAnalyzeButton, fmtGridDate, type GridColumn } from "@/components/RecordDataGrid";
import { CompanyCreateModal } from "@/components/CompanyCreateModal";
import { OrgCell } from "@/components/OrgPopup";
import { AiInsightPanel } from "@/components/AiInsightPanel";
import { inForecastWindow } from "@/lib/homeIntelligence";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import {
  getModuleRecords,
  getResourceDemands,
  getProjectList,
  getProjectTeam,
  getResourceAllocations,
  getProjectAllocations,
  getProjectDetails,
  updateFields,
  bustCache,
  activeImportKey,
  chatStream,
  hoverPrefetchProject,
  cancelHoverPrefetch,
  getFieldOptions,
  ensureCompanyIds,
  type ModuleRecord,
  type ProjectTeamMember,
  type LiveResource,
} from "@/lib/api";
import { warmAddMemberRoster } from "@/lib/addMemberRoster";
import { sameJobFields } from "@/lib/sameJob";
import { getStageRules, loadStageRules, useStageRulesVersion, FALLBACK_STAGE_ORDER, workflowStagesFor, readRawField, type StageRuleModule } from "@/lib/stageRules";
import { setChatPrompt } from "@/lib/chatBridge";
import { useAuth } from "@/lib/useAuth";
import { getMyCapabilities, usePermissionsVersion } from "@/lib/permissions";
import ArchivedUsersPanel from "@/components/ArchivedUsersPanel";
import { CardInsight } from "@/components/CardInsight";
import { AddTeamMemberModal, type ExistingAllocationRef } from "@/components/AddTeamMemberModal";
import { AddOpenPositionModal } from "@/components/AddOpenPositionModal";
import { EditOppScheduleModal, type OppScheduleTarget, type OppScheduleResult } from "@/components/EditOppScheduleModal";
import { EditAllocationModal, type EditAllocPerson } from "@/components/EditAllocationModal";
import { useQueryClient } from "@tanstack/react-query";
import { InfoTicker, type InfoTickerItem } from "@/components/InfoTicker";
import CreateChoiceModal from "@/components/CreateChoiceModal";
import { InlineDataGrid } from "@/components/InlineDataGrid";
import PreflightIssuesDialog, { type PreflightIssue } from "@/components/PreflightIssuesDialog";
import { UploadSuccessOverlay } from "@/components/UploadSuccessOverlay";
import ManualEntryModal from "@/components/ManualEntryModal";
import { getStoredUser, authHeaders, tenantScopedKey, deleteRecord as apiDeleteRecord, getStageCfg, getTaskData, saveStageCfg, markProjectDetailRefetchFresh } from "@/lib/api";
import { isRootAccount } from "@/lib/roleResolver";
import { applyGridColumnDefaults, adminExtraFieldDefs, adminNonCatalogColumnDefs, companyDefaultViewMode, loadDisplayDefaults, useDisplayDefaultsVersion, type DisplayView, type ExtraFieldKind } from "@/lib/displayDefaults";
import { uploadFileSmart } from "@/lib/chunkedUpload";
import { buildTabTypeOverrides } from "@/lib/importServerFields";
import { memSeed } from "@/lib/memSeed";
import { applyProjectMemberHours, refreshProjectTeamCache } from "@/lib/teamCache";
import { quickExistingAllocations, KP_LEAD_ROLES } from "@/lib/quickActions";
import { listCustomLeads } from "@/lib/customLeads";
import { synthesizeTeamLeads } from "@/lib/leadSynthesis";
import DateField from "@/components/DateField";
import { useToast } from "@/hooks/use-toast";
import { Z } from "@/lib/zLayers";
import { currentPhaseOf, loadProjectPhaseMap } from "@/lib/projectPhases";
import { resolvePhaseColor } from "@/lib/phaseColors";
import { applyStageCfgToOptions, ensureCustomStatusInStageCfg, futureSchedulePhase, parseStageCfg, schedulePhaseNames } from "@/lib/stageStatus";
import { useEditFinancialsCap } from "@/lib/permissions";

// ── Hold-info persistence (localStorage) ─────────────────────────────────────
// Tenant-scoped BY CONSTRUCTION: hold notes are keyed by project id, and ids
// collide across tenants — an un-scoped key surfaced one company's hold
// reasons on another company's projects on a shared browser. The legacy bare
// key ("rmone:holdInfo") is purged in bustCache() so pre-fix values can't
// resurface.
const holdInfoKey = () => tenantScopedKey("rmone:holdInfo");
type HoldInfo = { reason: string; tillDate: string; comments: string; setAt: string };
function _holdMap(): Record<string, HoldInfo> {
  try { return JSON.parse(localStorage.getItem(holdInfoKey()) ?? "{}"); }
  catch { return {}; }
}
function getHoldInfo(id: string): HoldInfo | null { return _holdMap()[id] ?? null; }
function setHoldInfoLS(id: string, info: HoldInfo) {
  try { const m = _holdMap(); m[id] = info; localStorage.setItem(holdInfoKey(), JSON.stringify(m)); }
  catch {}
}
function clearHoldInfoLS(id: string) {
  try { const m = _holdMap(); delete m[id]; localStorage.setItem(holdInfoKey(), JSON.stringify(m)); }
  catch {}
}

const BRAND = {
  bg: "var(--rm-bg)",
  bgDeep: "var(--rm-bg)",
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  cardBorderStrong: "var(--rm-panel-border)",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  greenLight: "#A9C23F",
  orange: "#E87722",
  orangeWarm: "#FF9425",
  red: "#F87171",
  white: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  textMuted: "var(--rm-text-faint)",
  cardWhite: "var(--rm-panel)",
  cardText: "var(--rm-text)",
  cardMuted: "var(--rm-text-muted)",
  // Higher-contrast label for 9 px uppercase card section headers
  // (SCHEDULE, CONTRACT VALUE, etc.) — readable in both light and dark mode.
  cardLabel: "var(--rm-card-label, var(--rm-text-muted))",
};

type PipelineView = "Projects" | "Opportunities" | "Leads" | "Companies";
type ProjectFilter = "All" | "All Open" | "Staffing Needs" | "Closed";
type OppStatusFilter = "All Opps" | "Open" | "Closed";
type LemFilter = "All Leads" | "Open" | "Closed";

const PROJECT_FILTERS: ProjectFilter[] = ["All", "All Open", "Staffing Needs", "Closed"];
const OPP_STATUS_FILTERS: OppStatusFilter[] = ["All Opps", "Open", "Closed"];
const LEM_FILTERS: LemFilter[] = ["All Leads", "Open", "Closed"];

const PMM_ACTIVE = new Set([
  "Under Construction", "Awarded in PreCon", "Pre-Construction", "Awarded Final Pricing Approved",
  "In Design", "In Progress", "Change Order", "Pre-Schematic", "Schematic Design",
  "Design Development", "Construction Documents", "Construction Administration",
  "Bidding & Negotiation", "Post-Construction",
]);
const PMM_BIDDING = new Set([
  "Bidding Competitive", "Bidding Negotiated", "Budgeting Negotiated", "Awaiting Drawings",
  "Awaiting Client Response", "ROM", "Assign", "Identify Opportunity",
]);
const PMM_CLOSEOUT = new Set(["Close-Out"]);
const PMM_PRECON = new Set([
  "Awarded in PreCon", "Pre-Construction", "Awarded Final Pricing Approved",
  "In Design", "Pre-Schematic", "Schematic Design",
]);
const OPM_CLOSED = new Set(["Cancelled", "Lost", "Declined", "Dead"]);
// Companies lifecycle grid: open opportunities in an active-bid stage count as
// "Pipeline"; everything open that's earlier (Prospecting, Qualifying, etc.)
// counts as "Opportunities". Each opp lands in exactly ONE column — no double
// counting. "Awarded" opps are treated as closed (won → work moved to a
// project), mirroring how LEM_CLOSED already treats awarded leads.
const OPM_PIPELINE_STAGES = new Set([
  "In Progress", "Proposal", "Proposal Development", "Shortlisted",
  "Interview", "Negotiation", "Precon", "On Hold",
]);
type CompanyLifecycle = "Lead" | "Opportunity" | "Pipeline" | "Project" | "Closed";
function oppLifecycle(stage: string, closed: boolean): CompanyLifecycle {
  if (closed || stage === "Awarded") return "Closed";
  return OPM_PIPELINE_STAGES.has(stage) ? "Pipeline" : "Opportunity";
}
const LEM_CLOSED = new Set(["Lost", "Cancelled", "Declined", "Dead", "Closed", "Awarded", "Converted", "Archived"]);

// A lead that has been converted into an opportunity is stamped with this
// exact status on the core2 record (mirror of CONVERTED_STAGE for opps → 
// projects below). Write + compare must stay byte-identical. The Leads grid
// treats it as closed, tints the row blue, and intercepts clicks with an
// "already converted" popup that links to the new opportunity.
const LEM_CONVERTED = "Converted";

// An opportunity that has been converted into a project is stamped with this
// exact status on the core2 record. It is NOT a manually-selectable stage — its
// presence means the opp is done (won → the work now lives on a project). The
// Opps grid therefore treats it as closed, tints the row a distinct colour, and
// intercepts clicks with an "already converted" popup that links to the project.
const CONVERTED_STAGE = "Closed – Won";

// All status chips use a single neutral white style — colour differentiation
// lives in the stage-flow dots below the chip, not in the chip itself.
// Use CSS-variable-based colours so the chip reads in BOTH dark and light mode.
// Dark mode: near-white text on a semi-transparent dark panel.
// Light mode: muted dark text on a soft-gray panel (avoids the near-invisible
//             white-on-white that the old hardcoded rgba values produced).
const NEUTRAL_CHIP = {
  bg: "var(--rm-panel-soft)",
  fg: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
};
// Keep the palette for any consumers that need it, but all entries now return neutral.
const OPP_STAGE_PALETTE: Record<string, { bg: string; fg: string; border: string }> = {};
function getOppStagePalette(_stage: string, _closed: boolean): { bg: string; fg: string; border: string } {
  return NEUTRAL_CHIP;
}

/* ── Stage-flow indicator (grid Status cells) ────────────────────────────
 * Tiny progress dots under the status pill showing WHERE the record sits in
 * the company workflow (Settings → Stage Rules → Workflow stages): green =
 * passed, colored = current (admin-picked stage color), grey = upcoming.
 * Renders nothing for closed records or statuses outside the workflow
 * (terminals like Lost/Converted) — there the pill alone tells the story.
 */
function StageFlowDots({ mod, stage, closed, raw }: { mod: StageRuleModule; stage: string; closed?: boolean; raw?: ModuleRecord }) {
  useStageRulesVersion();
  if (closed || !stage) return null;
  const { rules, stageOrder } = getStageRules();
  // #131: records on a workflow type with its OWN stage list follow THAT
  // list — same resolution as the record page and the server's lock check.
  const wfOwn = raw ? workflowStagesFor(rules, mod, readRawField(raw as unknown as Record<string, unknown>, "WorkflowTypeName")) : null;
  const order = wfOwn ?? rules.stageOrder?.[mod] ?? stageOrder[mod] ?? FALLBACK_STAGE_ORDER[mod];
  if (order.length < 2 || order.length > 10) return null;
  const k = stage.trim().toLowerCase();
  const idx = order.findIndex(s => s.trim().toLowerCase() === k);
  if (idx < 0) {
    // A single orphan dot for an unrecognised/legacy stage adds noise without
    // enough context (rule: 1 dot = hide, 2+ = show). Return nothing — the
    // status chip already names the stage; the record page has the full story.
    return null;
  }
  const color = rules.stageColors?.[mod]?.[k] ?? "#8B5CF6";
  return (
    <span title={`Workflow step ${idx + 1} of ${order.length}: ${stage}`}
      style={{ display: "flex", gap: 3, marginTop: 3, justifyContent: "center", maxWidth: 136 }}>
      {order.map((s, i) => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: i < idx ? "#10B981" : i === idx ? color : "rgba(128,128,128,0.30)",
          outline: i === idx ? `1.5px solid ${color}55` : undefined,
        }} />
      ))}
    </span>
  );
}

// Tiny "Converted" marker rendered under the RM ONE ID pill in the Leads and
// Opps grids so an already-converted record is obvious without clicking into
// it. Uses the same blue "converted" palette as the row tint / converted pill.
function ConvertedTag() {
  return (
    <span style={{
      marginTop: 3, padding: "1px 7px", borderRadius: 999,
      fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
      backgroundColor: "rgba(75,156,211,0.14)", color: "#2f7fb5",
      border: "1px solid rgba(75,156,211,0.5)", whiteSpace: "nowrap",
    }}>Converted</span>
  );
}

interface Project {
  id: string;
  name: string;
  status: string;
  phase: string;
  city: string;
  office: string;
  value: number;
  closed: boolean;
  hasSchedule: boolean;
  assignedUserGuids: string;
  rawTargetStart: string;
  rawTargetEnd: string;
  rawActualStart: string;
  rawActualEnd: string;
  /** True when rawTargetStart/End came from the phase schedule (first phase
   *  start / last phase end) rather than the Target-date fallback. */
  datesFromSchedule: boolean;
  forecastCost: number;
  laborContract: number;
  sector: string;
  division: string;
  bu: string;
  dept: string;
  daysInPhase: number | null;
  client: string;
  /** Key Client Contact — PMM/Opp store the person's name in OwnerName. */
  clientContact: string;
  /** Owner's Representative (OwnersRepresentative column). */
  ownersRep: string;
  projectId: string;
  rawStatus?: string;
  /** Status shown to the user; lifecycle schedule phase wins when present. */
  displayStatus?: string;
  requestCategory?: string;
  note?: string;
  /** Full raw record from the list API — read by admin-added extra columns. */
  raw?: ModuleRecord;
}

interface Opportunity {
  id: string;
  name: string;
  value: number;
  stage: string;
  city: string;
  office: string;
  bu: string;
  sector: string;
  division: string;
  dept: string;
  daysLeft: number;
  probability: number;
  weightedValue: number;
  closed: boolean;
  assignedUserGuids: string;
  bidDate: string;
  actualStart: string;
  actualEnd: string;
  rawBidDate: string;
  rawTargetStart: string;
  rawTargetEnd: string;
  rawActualStart: string;
  rawActualEnd: string;
  /** True when rawTargetStart/End came from the phase schedule. */
  datesFromSchedule: boolean;
  client: string;
  /** Key Client Contact — stored in OwnerName on Opportunity. */
  clientContact: string;
  /** Owner's Representative (OwnersRepresentative column). */
  ownersRep: string;
  projectId: string;
  rawStatus?: string;
  /** Status shown to the user; lifecycle schedule phase wins when present. */
  displayStatus?: string;
  requestCategory?: string;
  note?: string;
  /** Full raw record from the list API — read by admin-added extra columns. */
  raw?: ModuleRecord;
}

// sameJobFields lives in @/lib/sameJob (shared with project-detail's verify
// notice and mirrored server-side) — imported above, never fork the rules.

interface Lead {
  id: string;
  name: string;
  value: number;
  status: string;
  city: string;
  office: string;
  bu: string;
  division: string;
  dept: string;
  sector: string;
  closed: boolean;
  assignedUserGuids: string;
  rawDueDate: string;
  rawTargetStart: string;
  rawTargetEnd: string;
  rawCreated: string;
  rawClose: string;
  client: string;
  /** Key Client Contact — leads store the person's name in ContactName. */
  clientContact: string;
  projectId: string;
  note?: string;
  requestCategory?: string;
  /** Full raw record from the list API — read by admin-added extra columns. */
  raw?: ModuleRecord;
}

interface Company {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string;
  status: string;
  phone: string;
  email: string;
  website?: string;
  fax?: string;
  address?: string;
  zip?: string;
  country?: string;
  contractorLicense?: string;
  unionAffiliation?: string;
  certifications?: string;
  ownershipType?: string;
  annualRevenues?: string;
  derived?: boolean;
  projectCount?: number;
  oppCount?: number;
  totalValue?: number;
}

function fmtShort(d: string): string {
  if (!d || d.length < 10) return "";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  if (isNaN(dt.getTime()) || dt.getFullYear() < 1900) return "";
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

function rawIso(d: unknown): string {
  if (!d) return "";
  const dt = new Date(String(d));
  if (isNaN(dt.getTime()) || dt.getFullYear() < 1900) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

function fmtM(v: number): string {
  if (v == null || isNaN(v)) return "—";
  if (v === 0) return "$0";
  if (v >= 1_000_000_000) return compactUsd(v);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/* ── Admin-added extra Data Grid columns (Display Defaults) ─────────────────
   Renders the DB fields an admin added in Settings → Display Defaults → List
   columns. Values come from the MAPPED row first (fallback chains already
   applied: City, Division, …) via each grid's override map, else straight off
   the raw record the list API returned. Unknown/absent fields render "—". */
const FULL_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extraCellDisplay(v: unknown, kind: ExtraFieldKind): string {
  if (v == null || v === "") return "";
  if (kind === "date") { const iso = rawIso(v); return iso ? fmtGridDate(iso) : ""; }
  if (kind === "money") { const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n !== 0 ? fmtM(n) : ""; }
  if (kind === "number") {
    const n = Number(String(v).replace(/[%,\s]/g, ""));
    return Number.isFinite(n) && String(v).trim() !== "" ? String(Math.round(n * 100) / 100) : "";
  }
  const s = String(v).trim();
  if (!s || FULL_GUID_RE.test(s)) return ""; // bare FK GUIDs are meaningless to users
  return s.length > 60 ? s.slice(0, 59).trimEnd() + "…" : s;
}

function extraSortVal(v: unknown, kind: ExtraFieldKind): string | number | null {
  if (isGridPeopleValue(v)) return v.people[0]?.name ?? null;
  if (v == null || v === "") return null;
  if (kind === "money" || kind === "number") {
    const n = Number(String(v).replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "date") return rawIso(v) || null;
  const s = String(v).trim();
  return s && !FULL_GUID_RE.test(s) ? s : null;
}

interface GridPersonValue {
  name: string;
  role: string;
}

interface GridPeopleValue {
  __kind: "people";
  people: GridPersonValue[];
}

function isGridPeopleValue(v: unknown): v is GridPeopleValue {
  return !!v && typeof v === "object" && (v as GridPeopleValue).__kind === "people"
    && Array.isArray((v as GridPeopleValue).people);
}

const EXTRA_FIELD_LABELS: Record<string, string> = {
  ContractValue: "Contract Value",
  ApproxContractValue: "Approx. Contract Value",
  ForecastedProjectCost: "Forecasted Project Cost",
  LaborContractAmount: "Labor Contract Amount",
  ERPJobID: "ERP Job ID",
  CRMBusinessUnitChoice: "Business Unit",
  SectorChoice: "Sector",
  OwnerName: "Key Client Contact",
  OwnersRepresentative: "Owner's Representative",
  CloseDate: "Close Date",
  TargetStartDate: "Target Start",
  TargetCompletionDate: "Target Completion",
};

/** Convert database field names into plain, customer-facing grid headers.
 *  Key-personnel columns use the canonical role catalogue; other unknown
 *  fields get a safe camel/Pascal-case fallback instead of exposing raw keys
 *  such as ProjectLeadUser or ApproxContractValue. */
function extraColumnLabel(key: string, fallback: string): string {
  const leadRole = KP_LEAD_ROLES.find((r) => r.field === key)?.role;
  if (leadRole) return leadRole;
  if (EXTRA_FIELD_LABELS[key]) return EXTRA_FIELD_LABELS[key];
  const source = fallback && fallback !== key ? fallback : key;
  return source
    .replace(/User(Name|Email)?$/i, (_, suffix: string | undefined) => suffix ? ` ${suffix}` : "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/\bId\b/g, "ID")
    .replace(/\bCrm\b/g, "CRM")
    .replace(/\bErp\b/g, "ERP")
    .replace(/\bMep\b/g, "MEP")
    .replace(/\s+/g, " ")
    .trim();
}

function extraColumnsFor<T extends { raw?: ModuleRecord }>(
  view: DisplayView,
  mappedOf: (t: T) => Record<string, unknown>,
  onOpenPeople?: (title: string, people: GridPersonValue[], trigger: HTMLButtonElement) => void,
): GridColumn<T>[] {
  // Merge admin-added "From database" extra defs (extraColumns) with
  // detail-only fields the admin toggled onto the list grid (non-catalog keys
  // in columns[view]). Deduplicate by field key so a field that appears in
  // both sources only renders once.
  const extraDefs = adminExtraFieldDefs(view);
  const nonCatDefs = adminNonCatalogColumnDefs(view);
  const seenKeys = new Set(extraDefs.map(d => d.key));
  const defs = [...extraDefs, ...nonCatDefs.filter(d => !seenKeys.has(d.key))];

  return defs.map((def): GridColumn<T> => {
    const val = (t: T): unknown => {
      const m = mappedOf(t)[def.key];
      if (m !== undefined && m !== null && m !== "") return m;
      return (t.raw as Record<string, unknown> | undefined)?.[def.key];
    };
    const numeric = def.kind === "money" || def.kind === "number";
    return {
      key: `xf:${def.key}`,
      label: extraColumnLabel(def.key, def.label),
      ...(def.kind === "text" ? { minWidth: 110, maxAuto: 180 } : { width: 116 }),
      ...(numeric ? { align: "right" as const } : {}),
      hoverTitle: (t: T) => {
        const v = val(t);
        if (isGridPeopleValue(v)) {
          const first = v.people[0]?.name;
          return first ? `${first}${v.people.length > 1 ? ` and ${v.people.length - 1} more` : ""}` : undefined;
        }
        // Text cells: tooltip carries the FULL value — the cell itself both
        // trims (60 chars) and CSS-ellipsizes, so the hover is the only place
        // a long value is readable in the grid.
        if (def.kind === "text") {
          const s = String(v ?? "").trim();
          return s && !FULL_GUID_RE.test(s) ? s : undefined;
        }
        return extraCellDisplay(v, def.kind) || undefined;
      },
      sortValue: (t: T) => extraSortVal(val(t), def.kind),
      render: (t: T) => {
        const v = val(t);
        if (isGridPeopleValue(v)) {
          const [first, ...rest] = v.people;
          if (!first) return <span style={{ color: BRAND.textMuted }}>—</span>;
          return (
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {first.name}
              </span>
              {rest.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPeople?.(extraColumnLabel(def.key, def.label), v.people, e.currentTarget);
                  }}
                  aria-label={`View ${rest.length} more ${extraColumnLabel(def.key, def.label).toLowerCase()}`}
                  style={{
                    flexShrink: 0, border: 0, padding: 0, background: "transparent",
                    color: BRAND.green, fontSize: 11, fontWeight: 800,
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  +{rest.length} more
                </button>
              )}
            </div>
          );
        }
        const s = extraCellDisplay(v, def.kind);
        // Block span with its own ellipsis: bare text nodes would wrap to
        // multiple lines inside the td (single-line row policy — full value
        // stays reachable via hoverTitle above).
        return s
          ? <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
          : <span style={{ color: BRAND.textMuted }}>—</span>;
      },
    };
  });
}

/* ── Effective key-personnel values for the grid's lead columns ─────────────
   The record page's "Project Leads" card shows explicit *User tokens, custom
   JSON-column roles AND an additive team-title synthesis — while the raw DB
   columns are often empty. These overrides make the Data Grid's admin-added
   lead columns mirror that card:
     • per-role columns (ProjectManagerUser, EstimatorUser, …) list the people
       the card shows under that label;
     • the ProjectLeadUser column mirrors the WHOLE card because users compare
       the "Project Lead" grid column against that card, not one DB column.
   People stay structured so the grid can show one clean name plus a "+N more"
   action instead of wrapping a long comma/role string through several lines.
   Values the card would hide stay hidden here too (unresolved GUID tokens are
   dropped, never rendered). Returns {} when there is nothing to show so the
   caller's raw-field fallback stays in charge. */
function kpGridOverrides(
  raw: Record<string, unknown> | undefined,
  team: readonly ProjectTeamMember[] | undefined,
): Record<string, unknown> {
  const entries: { name: string; role: string }[] = [];
  const teamNameById = new Map(
    (team ?? [])
      .filter((member) => member.resourceId && member.name)
      .map((member) => [String(member.resourceId).toLowerCase(), member.name]),
  );
  for (const { field, role } of KP_LEAD_ROLES) {
    const val = raw?.[field];
    if (typeof val !== "string" || !val.trim()) continue;
    const seenTok = new Set<string>();
    for (const rawTok of val.split(/[,;]+/)) {
      const tok = rawTok.replace(/^#/, "").trim();
      if (!tok) continue;
      // Imports can store GUIDs in *User columns. Resolve through the existing
      // page-scoped team response; unresolved identifiers stay suppressed.
      const name = FULL_GUID_RE.test(tok) ? teamNameById.get(tok.toLowerCase()) : tok;
      if (!name) continue;
      const nameKey = name.toLowerCase();
      if (seenTok.has(nameKey)) continue;
      seenTok.add(nameKey);
      entries.push({ name, role });
    }
  }
  for (const { role, name } of listCustomLeads(raw?.CustomLeadsJson)) entries.push({ name, role });
  const synthesized = team && team.length > 0 ? synthesizeTeamLeads(team, entries) : [];
  const all = [...entries, ...synthesized];
  // Every known personnel field gets a structured value, including empty.
  // This intentionally prevents extraColumnsFor from falling back to a raw
  // comma-separated GUID list when none of its tokens can be resolved.
  const out: Record<string, unknown> = Object.fromEntries(
    KP_LEAD_ROLES.map(({ field }) => [field, { __kind: "people", people: [] } satisfies GridPeopleValue]),
  );
  for (const { field, role } of KP_LEAD_ROLES) {
    if (field === "ProjectLeadUser") continue; // aggregate column, built below
    const people = [...new Map(
      all.filter(e => e.role === role).map(e => [e.name.toLowerCase(), { name: e.name, role: e.role }])
    ).values()];
    if (people.length) out[field] = { __kind: "people", people } satisfies GridPeopleValue;
  }
  const projectLeads = [...new Map(
    all.map(e => [e.name.toLowerCase(), { name: e.name, role: e.role }])
  ).values()];
  out.ProjectLeadUser = { __kind: "people", people: projectLeads } satisfies GridPeopleValue;
  return out;
}

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const KEY_PERSONNEL_FIELDS = new Set([
  "OwnerUser", "ProjectManagerUser", "SeniorProjectManagerUser",
  "ProgramManagerUser", "SeniorMEPManagerUser", "SeniorEstimatorUser",
  "EstimatorUser", "LeadEstimatorUser",
  "SuperintendentUser", "SeniorSuperintendentUser",
  "ProjectLeadUser", "BusinessLeadUser", "PreconLeadUser",
  "PrincipalUser", "ProjectExecutiveUser", "PhaseOwnerUser",
  "SponsorsUser", "StakeHoldersUser", "ClientRep",
  "OwnerUserName", "OwnerUserEmail",
  "ProjectManagerUserName", "ProjectManagerUserEmail",
  "SeniorProjectManagerUserName", "SeniorProjectManagerUserEmail",
]);
/** Legend shown above Data Grids when any visible row is tinted orange —
 *  explains that highlighted rows have open (unfilled) positions. */
function OpenRowsLegend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "0 16px 8px", fontSize: 11.5, fontWeight: 600, color: BRAND.textSecondary }}>
      <span style={{
        width: 13, height: 13, borderRadius: 3, flexShrink: 0,
        backgroundColor: "rgba(232,119,34,0.22)", border: "1px solid rgba(232,119,34,0.7)",
      }} />
      <span><span style={{ color: BRAND.orange, fontWeight: 800 }}>Highlighted rows</span> have open positions to fill</span>
    </div>
  );
}

function collectAssignedUserGuids(r: unknown): string {
  const obj = r as Record<string, unknown>;
  const tokens: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string" || !v) continue;
    if (!KEY_PERSONNEL_FIELDS.has(k)) continue;
    const found = v.match(GUID_RE);
    if (found) {
      for (const g of found) {
        if (g === "00000000-0000-0000-0000-000000000000") continue;
        tokens.push(g.toLowerCase());
      }
    }
    tokens.push(v.toLowerCase());
  }
  return tokens.join("|");
}

function normalizeId(id: string): string {
  const m = id.match(/^([a-z]{2,4})-(\d{2})-0*(\d+)$/i);
  return m ? `${m[1].toLowerCase()}-${m[2]}-${m[3]}` : id.toLowerCase();
}

function getCity(r: any): string {
  const candidates = [
    r?.City, r?.JobCity, r?.SiteCity, r?.LocationCity, r?.ProjectCity,
    r?.OfficeCity, r?.MailingCity, r?.AddressCity, r?.BillingCity,
    r?.CityState, r?.CityName, r?.SiteCityState,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function pmmPhase(status: string, closed: boolean): string {
  if (closed) return "Closeout";
  if (PMM_PRECON.has(status)) return "PreCon";
  if (PMM_CLOSEOUT.has(status)) return "Closeout";
  if (PMM_BIDDING.has(status)) return "Bidding";
  if (PMM_ACTIVE.has(status)) return "Construction";
  return status || "Open";
}

// Long raw statuses ("Construction Documentation") get hard-truncated with an
// ellipsis so the STATUS column never widens; hoverTitle shows the full text.
function truncChip(s: string): string {
  return s.length > 16 ? s.slice(0, 15).trimEnd() + "…" : s;
}

/** Schedule phases use their canonical high-contrast palette in every theme. */
function ScheduleStatusChip({ label }: { label: string }) {
  const color = resolvePhaseColor(label);
  return (
    <span title={label} style={{
      display: "inline-flex", justifyContent: "center", alignItems: "center",
      minWidth: 92, maxWidth: "min(136px, 100%)", boxSizing: "border-box",
      verticalAlign: "middle", padding: "3px 9px",
      borderRadius: 999, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap",
      backgroundColor: color.bg, color: color.text,
      border: `1px solid ${color.outline ?? color.bg}`,
    }}>{truncChip(label)}</span>
  );
}

function WorkflowStatusChip({ label }: { label: string }) {
  const key = label.trim().toLowerCase();
  const color = /lost|cancel|closed|declined|archived/.test(key)
    ? { bg: "#7F1D1D", text: "#FFFFFF" }
    : /hold/.test(key)
      ? { bg: "#9A3412", text: "#FFFFFF" }
      : /award|proposal/.test(key)
        ? { bg: "#1D4ED8", text: "#FFFFFF" }
        : { bg: "#3A7D6E", text: "#FFFFFF" };
  return (
    <span title={label} style={{
      display: "inline-flex", justifyContent: "center", alignItems: "center",
      minWidth: 92, maxWidth: "min(136px, 100%)", boxSizing: "border-box",
      verticalAlign: "middle", padding: "3px 9px",
      borderRadius: 999, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap",
      backgroundColor: color.bg, color: color.text, border: `1px solid ${color.bg}`,
    }}>{truncChip(label)}</span>
  );
}

function phaseColor(phase: string): string {
  if (phase === "Closed" || phase === "Closeout") return BRAND.cardMuted;
  if (phase === "PreCon" || phase === "Pre-Schematic") return BRAND.orange;
  if (phase === "Bidding" || phase === "Returned") return BRAND.greenLight;
  return BRAND.green;
}

function mapPMM(r: ModuleRecord): Project {
  const a = r as any;
  const status = a.CRMProjectStatusChoice || a.Status || a.ModuleStepLookup || "";
  const rawClosed = a.Closed === true;
  // Schedule-ended override — mirrors the server's auto-close rule (the API
  // flips Status→Closed the next time anyone opens the project). Applying the
  // same rule here means the LIST shows "Closed" immediately, in lockstep with
  // the detail page, instead of waiting for that write + caches to catch up.
  // Same comparison as the server: phase dates are midnight UTC, so take the
  // UTC day straight off the raw ISO string — rawIso() would convert to the
  // browser's LOCAL day and flip a day early in US timezones.
  const schedEndDay = String(a._ScheduleEnd ?? "").slice(0, 10);
  const schedEnded = /^\d{4}-\d{2}-\d{2}/.test(schedEndDay) && !schedEndDay.startsWith("0001")
    && schedEndDay < new Date().toISOString().slice(0, 10);
  // A closed-ish raw STATUS ("Closed", "Closeout", "Project Complete",
  // "Cancelled") counts as closed even when the boolean Closed flag is false
  // — the server's auto-close writes only the status text, so without this
  // the row would flip back to the "Open" bucket the moment that write lands.
  const closedishStatus = isClosedishStatus(status);
  // Manual-reactivation latch — StatusManualDate is stamped by the server
  // whenever a HUMAN sets the status (never by the auto-close). A manual
  // status write ON/AFTER the schedule-end day means the user deliberately
  // reopened an ended project (Archive → Change Status → Active), so the
  // schedule-ended override must not flip it back to Closed.
  const manualDay = String(a.StatusManualDate ?? "").slice(0, 10);
  const manualReopen = /^\d{4}-\d{2}-\d{2}/.test(manualDay) && !manualDay.startsWith("0001")
    && !!schedEndDay && manualDay >= schedEndDay;
  const autoClosed = schedEnded && !rawClosed && !closedishStatus && !manualReopen;
  const isClosed = rawClosed || autoClosed || closedishStatus;
  const lc = a.ProjectLifeCycleLookup ?? a.ProjectLifecycleID ?? a.ProjectLifeCycleID
          ?? a.ScrumLifeCycle ?? a.LifecycleID ?? a.LifeCycleID;
  const lcs = String(lc ?? "").trim();
  const stageStartRaw = rawIso(a.CurrentStageStartDate);
  let daysInPhase: number | null = null;
  if (stageStartRaw && !stageStartRaw.startsWith("0001")) {
    const ms = Date.now() - new Date(stageStartRaw).getTime();
    if (ms > 0) daysInPhase = Math.round(ms / 86400000);
  }
  // Schedule-derived current phase (attached by the list API as _CurrentPhase:
  // the latest schedule phase whose start date has passed). Preferred over the
  // status-derived pmmPhase so the Phase column tracks the schedule dates.
  // Phase stays fully independent of Status (Pipeline/Active = contract state).
  const schedPhase = typeof a._CurrentPhase === "string" ? a._CurrentPhase.trim() : "";
  return {
    id: a.TicketId ?? "",
    name: a.Title ?? a.ShortName ?? a.TicketId ?? "",
    // "Pipeline" = committed but not yet contracted (set at opportunity
    // conversion); literal "Active" comes from the create form / status
    // editor and must count as Active alongside the PMM_ACTIVE stage set.
    status: isClosed ? "Closed"
      : status === "Pipeline" ? "Pipeline"
      : (PMM_ACTIVE.has(status) || status === "Active" ? "Active" : "Open"),
    // Phase forced to "Closeout" only for flag-closed / schedule-auto-closed
    // rows — a closed-ish STATUS text alone keeps its schedule-derived phase
    // (e.g. status "Closeout" + phase "Project Complete"), same as before.
    phase: (rawClosed || autoClosed) ? "Closeout" : (schedPhase || pmmPhase(status, false)),
    city: getCity(a),
    // ContractValue/ContractedAmount fallbacks: some client imports populate
    // ONLY ContractedAmount — without the fallback every project shows $0.
    value:
      Number(a.ApproxContractValue ?? 0) ||
      Number(a.ContractValue ?? 0) ||
      Number(a.ContractedAmount ?? 0) ||
      0,
    closed: isClosed,
    hasSchedule: lcs !== "" && lcs !== "0" && lcs !== "false",
    assignedUserGuids: collectAssignedUserGuids(a),
    // Effective dates (client rule): the phase schedule wins — first phase
    // start (_ScheduleStart) / last phase end (_ScheduleEnd) attached by the
    // list API. Target dates are only the no-schedule fallback; a closed
    // project's recorded actual completion beats both for the end date.
    rawTargetStart: rawIso(a._ScheduleStart) || rawIso(a.TargetStartDate),
    rawTargetEnd: (isClosed ? rawIso(a.ActualCompletionDate) : "") || rawIso(a._ScheduleEnd) || rawIso(a.TargetCompletionDate),
    rawActualStart: rawIso(a.ActualStartDate),
    rawActualEnd: rawIso(a.ActualCompletionDate),
    datesFromSchedule: !!(rawIso(a._ScheduleStart) || rawIso(a._ScheduleEnd)),
    forecastCost: Number(a.ForecastedProjectCost ?? 0),
    laborContract: Number(a.LaborContractAmount ?? 0),
    sector: a.SectorChoice ?? a.MarketSector ?? "",
    division: a.DivisionName || a.DivisionLookup || "",
    bu: a.CRMBusinessUnitChoice || a.BusinessUnitName || "",
    dept: a.DepartmentName || a.Department || "",
    daysInPhase,
    office: String(a.Office ?? "").trim(),
    client: cleanClient(String(a.CRMCompanyLookupName ?? a.CompanyName ?? a.CRMCompanyNameChoice ?? a.ClientName ?? a.Company ?? a.Client ?? "")),
    // Client Contact person lives in OwnerName on PMM (same as the detail
    // card's "Client Contact" field); Owner's Rep in OwnersRepresentative.
    clientContact: String(a.OwnerName ?? "").trim(),
    ownersRep: String(a.OwnersRepresentative ?? "").trim(),
    // `||` not `??` — upstream stores empty strings (not null) in unused ID
    // columns, and "" ?? x keeps the "" and hides the real ID in the other column.
    projectId: (String(a.ERPJobID ?? "").trim()) || (String(a.ProjectId ?? "").trim()),
    // Auto-closed rows show "Closed" (the value the server writes), so the
    // STATUS chip matches what the detail page will show for this project.
    rawStatus: autoClosed ? "Closed" : String(a.CRMProjectStatusChoice ?? a.Status ?? "").trim(),
    requestCategory: String(a.RequestCategory ?? "").trim(),
    note: String(a.Comment ?? a.Description ?? a.ProjectSummaryNote ?? "").trim() || undefined,
    raw: r,
  };
}

function mapOPM(r: ModuleRecord): Opportunity {
  const a = r as any;
  // For construction OPM opportunities, the upstream RM ONE rarely has
  // ApproxContractValue (revenue) populated this early in the pursuit —
  // the project team enters ForecastedProjectCost (internal cost estimate)
  // and/or LaborContractAmount instead. Per user direction (May 2026),
  // surface ForecastedProjectCost as the primary OPM "Value" so the cards
  // and pipeline roll-up reflect real numbers, falling back to
  // ApproxContractValue then LaborContractAmount if a row happens to
  // have the revenue side filled in.
  const forecast = Number(a.ForecastedProjectCost ?? 0);
  const apx = Number(a.ApproxContractValue ?? 0);
  const cv = Number(a.ContractValue ?? 0);
  const ca = Number(a.ContractedAmount ?? 0);
  const labor = Number(a.LaborContractAmount ?? 0);
  const value = forecast > 0 ? forecast : (apx || cv || ca || labor);
  // ChanceOfSuccessChoice is the DB column on dbo.Opportunity (nvarchar).
  // SuccessChance is an alias some upstream exports use. Values may be stored
  // as "50%" strings, so strip the % sign before parsing.
  const rawProb = a.ChanceOfSuccessChoice ?? a.SuccessChance ?? 0;
  const prob = parseFloat(String(rawProb).replace(/%/g, "")) || 0;
  const bidDate = a.BidDueDate ? new Date(a.BidDueDate) : null;
  const daysLeft = bidDate && !isNaN(bidDate.getTime())
    ? Math.ceil((bidDate.getTime() - Date.now()) / 86_400_000) : 999;
  const stage = a.CRMOpportunityStatusChoice || a.Status || a.ModuleStepLookup || "Unknown";
  const oppClosed = a.Closed === true || OPM_CLOSED.has(stage) || stage === CONVERTED_STAGE;
  return {
    id: a.TicketId ?? "",
    name: a.Title ?? a.ShortName ?? a.TicketId ?? "",
    value,
    stage,
    city: getCity(a),
    bu: a.CRMBusinessUnitChoice || a.BusinessUnitName || "",
    sector: a.SectorChoice ?? a.MarketSector ?? "",
    division: a.DivisionName || a.DivisionLookup || "",
    dept: a.DepartmentName || a.Department || "",
    daysLeft,
    probability: prob,
    weightedValue: value * (prob / 100),
    closed: oppClosed,
    assignedUserGuids: collectAssignedUserGuids(a),
    bidDate: a.BidDueDate ? fmtShort(rawIso(a.BidDueDate)) : "",
    actualStart: a.ActualStartDate ? fmtShort(rawIso(a.ActualStartDate)) : "",
    actualEnd: a.ActualCompletionDate ? fmtShort(rawIso(a.ActualCompletionDate)) : "",
    rawBidDate: rawIso(a.BidDueDate),
    // Effective dates (client rule): phase schedule wins; Target dates are the
    // no-schedule fallback. Opportunities get _ScheduleStart/_ScheduleEnd from
    // the list API too; a closed opp's recorded actual completion beats both
    // for the end date (same rule as mapPMM).
    rawTargetStart: rawIso(a._ScheduleStart) || rawIso(a.TargetStartDate),
    rawTargetEnd: (oppClosed ? rawIso(a.ActualCompletionDate) : "") || rawIso(a._ScheduleEnd) || rawIso(a.TargetCompletionDate),
    rawActualStart: rawIso(a.ActualStartDate),
    rawActualEnd: rawIso(a.ActualCompletionDate),
    datesFromSchedule: !!(rawIso(a._ScheduleStart) || rawIso(a._ScheduleEnd)),
    office: String(a.Office ?? "").trim(),
    client: cleanClient(String(a.CRMCompanyLookupName ?? a.CompanyName ?? a.CRMCompanyNameChoice ?? a.ClientName ?? a.Company ?? a.Client ?? "")),
    // Key Client Contact lives in OwnerName on Opportunity (same as the
    // detail card); Owner's Rep in OwnersRepresentative.
    clientContact: String(a.OwnerName ?? "").trim(),
    ownersRep: String(a.OwnersRepresentative ?? "").trim(),
    // `||` not `??` — see mapPMM: empty-string columns must not mask the real ID.
    projectId: (String(a.ERPJobID ?? "").trim()) || (String(a.ProjectId ?? "").trim()),
    rawStatus: stage,
    requestCategory: String(a.RequestCategory ?? "").trim(),
    note: String(a.Note ?? a.Comment ?? "").trim() || undefined,
    raw: r,
  };
}

function mapLEM(r: ModuleRecord): Lead {
  const a = r as any;
  const status = a.LeadStatus ?? "—";
  return {
    id: a.TicketId ?? "",
    name: a.Title ?? a.ShortName ?? a.TicketId ?? "",
    value:
      Number(a.ApproxContractValue ?? 0) ||
      Number(a.ContractValue ?? 0) ||
      Number(a.ContractedAmount ?? 0) ||
      0,
    status,
    city: getCity(a),
    bu: a.CRMBusinessUnitChoice || a.BusinessUnitName || "",
    division: a.DivisionName || a.DivisionLookup || "",
    dept: a.DepartmentName || a.Department || "",
    sector: a.SectorChoice ?? "—",
    closed: a.Closed === true || LEM_CLOSED.has(status),
    assignedUserGuids: collectAssignedUserGuids(a),
    rawDueDate: rawIso(a.DueDate),
    // Leads store their expected window on the Target date columns (the
    // create form / import both write TargetStartDate / TargetCompletionDate);
    // DueDate is usually empty — the grid's DUE column falls back to Target End.
    rawTargetStart: rawIso(a.TargetStartDate),
    rawTargetEnd: rawIso(a.TargetCompletionDate),
    rawCreated: rawIso(a.Created ?? a.CreationDate),
    rawClose: rawIso(a.CloseDate),
    client: cleanClient(String(a.CRMCompanyLookupName ?? a.CompanyName ?? a.CRMCompanyNameChoice ?? a.ClientName ?? a.Company ?? a.Client ?? "")),
    // Leads store the Key Client Contact in ContactName; fall back through the
    // same lookup aliases the detail card uses (ContactLookup/CRMContactLookup)
    // so the grid never shows blank where the detail page shows a contact.
    clientContact: String(a.ContactName ?? "").trim() || String(a.ContactLookup ?? "").trim() || String(a.CRMContactLookup ?? "").trim() || String(a.Contact ?? "").trim(),
    office: String(a.Office ?? "").trim(),
    // Client-supplied lead ID (when present) — shown on the card instead of a
    // generated LEM- ticket. `||` not `??`: empty strings must fall through.
    projectId: (String(a.ERPJobID ?? "").trim()) || (String(a.ProjectId ?? "").trim()),
    note: (a.Note ?? a.Comment ?? "").trim() || undefined,
    requestCategory: String(a.RequestCategory ?? "").trim() || undefined,
    raw: r,
  };
}

// Session-once guard for the Companies-tab COM-… ID backfill — one POST
// /companies/ensure-ids per browser session is plenty (imports run the same
// core after every companies-sheet upload).
let ensuredCompanyIdsOnce = false;

function mapCOM(r: ModuleRecord): Company {
  const a = r as any;
  return {
    id: a.TicketId ?? "",
    name: a.Title ?? a.ShortName ?? a.TicketId ?? "",
    city: getCity(a),
    state: a.State ?? "",
    type: a.PrimaryRelationshipTypeChoice ?? a.CRMCompanyTypeChoice ?? a.CompanyType ?? "—",
    status: a.Status ?? "",
    phone: a.PhoneNumber ?? a.Phone ?? a.OfficePhone ?? "—",
    email: a.Email ?? a.EmailAddress ?? "—",
    website: a.WebsiteUrl ?? "",
    fax: a.Fax ?? "",
    address: a.Address ?? "",
    zip: a.Zip ?? "",
    country: a.Country ?? "",
    contractorLicense: a.ContractorLicense ?? "",
    unionAffiliation: a.UnionAffiliation ?? "",
    certifications: a.CertificationsChoice ?? "",
    ownershipType: a.OwnershipTypeChoice ?? "",
    annualRevenues: a.AnnualRevenues ?? "",
  };
}

function dateRangeFor(filter: string): { start: Date; end: Date } | null {
  if (filter === "All Time" || !filter) return null;
  const qm = filter.match(/^Q([1-4]) (\d{4})$/);
  if (qm) {
    const qi = parseInt(qm[1]) - 1;
    const yi = parseInt(qm[2]);
    return { start: new Date(yi, qi * 3, 1), end: new Date(yi, qi * 3 + 3, 0, 23, 59, 59) };
  }
  const ym = filter.match(/^(\d{4})$/);
  if (ym) {
    const yi = parseInt(ym[1]);
    return { start: new Date(yi, 0, 1), end: new Date(yi, 11, 31, 23, 59, 59) };
  }
  return null;
}

function overlapsRange(dates: string[], range: { start: Date; end: Date }): boolean {
  const ps = range.start.getTime();
  const pe = range.end.getTime();
  const ts = dates
    .filter(d => d && d.length >= 10)
    .map(d => new Date(d + (d.length === 10 ? "T12:00:00" : "")).getTime())
    .filter(t => !isNaN(t));
  if (ts.length === 0) return false;
  return Math.min(...ts) <= pe && Math.max(...ts) >= ps;
}

function buildDateOptions(): { key: string; label: string; section?: "year" | "quarter" }[] {
  const _now = new Date();
  const _y = _now.getFullYear();
  const _q = Math.floor(_now.getMonth() / 3);
  const opts: { key: string; label: string; section?: "year" | "quarter" }[] = [
    { key: "All Time", label: "All Time" },
  ];
  for (let y = _y; y >= _y - 10; y--) {
    opts.push({ key: `${y}`, label: `${y}`, section: "year" });
  }
  for (let y = _y; y >= _y - 10; y--) {
    const maxQ = y === _y ? _q : 3;
    for (let q = maxQ; q >= 0; q--) {
      opts.push({ key: `Q${q + 1} ${y}`, label: `Q${q + 1} ${y}`, section: "quarter" });
    }
  }
  return opts;
}

/**
 * Company → BU → Division → Dept hierarchy filter options.
 * Division options are cascaded to the selected BU, and Department options
 * are cascaded to the selected BU + Division. When the same department name
 * legitimately exists under more than one division (e.g. "Design" under both
 * Structural and Interior), we surface a `sub` label listing every division
 * it appears under so it's never ambiguous which one a given row belongs to.
 */
type OrgRow = { bu: string; division: string; dept: string };
type OrgFilterOption = { value: string; label: string; sub: string };
function buildOrgFilterOptions(rows: OrgRow[], buFilter: string, divFilter: string): {
  bus: string[]; divs: string[]; depts: OrgFilterOption[];
} {
  const norm = (s: string) => (s && s !== "—" ? s.trim() : "");
  const buSet = new Set<string>();
  const divSet = new Set<string>();
  const deptAllDivs = new Map<string, Set<string>>();
  const deptScoped = new Set<string>();
  for (const r of rows) {
    const bu = norm(r.bu), div = norm(r.division), dept = norm(r.dept);
    if (bu) buSet.add(bu);
    if (div && (buFilter === "All" || bu === buFilter)) divSet.add(div);
    if (dept) {
      if (!deptAllDivs.has(dept)) deptAllDivs.set(dept, new Set());
      if (div) deptAllDivs.get(dept)!.add(div);
    }
    if (dept && (buFilter === "All" || bu === buFilter) && (divFilter === "All" || div === divFilter)) {
      deptScoped.add(dept);
    }
  }
  const depts = Array.from(deptScoped).sort().map((dept) => {
    const divs = deptAllDivs.get(dept) ?? new Set<string>();
    const sub = divs.size > 1 ? `Under: ${Array.from(divs).sort().join(", ")}` : "";
    return { value: dept, label: dept, sub };
  });
  return { bus: Array.from(buSet).sort(), divs: Array.from(divSet).sort(), depts };
}

export default function Projects() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const permissionsVersion = usePermissionsVersion();
  const capabilitiesQuery = useQuery({
    queryKey: ["my-capabilities", "projects", user?.username ?? "", permissionsVersion],
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => getMyCapabilities({ fresh: true }),
  });
  const canEditData = capabilitiesQuery.data?.caps.editData === true;
  const canManageStaff = capabilitiesQuery.data?.caps.manageStaff === true;
  const rulesVersion = useBusinessRulesVersion();
  const [view, setView] = useState<PipelineView>(() => {
    if (typeof window === "undefined") return "Projects";
    const v = new URLSearchParams(window.location.search).get("view");
    const alias = v === "Opps" ? "Opportunities" : v;
    const allowed: PipelineView[] = ["Projects", "Opportunities", "Leads", "Companies"];
    return (allowed.includes(alias as PipelineView) ? alias : "Projects") as PipelineView;
  });
  const { toast } = useToast();
  const [showCreateChoice, setShowCreateChoice] = useState(false);
  const [showInlineGrid, setShowInlineGrid]   = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [peoplePopup, setPeoplePopup] = useState<{
    title: string;
    people: GridPersonValue[];
    returnFocus: HTMLButtonElement;
  } | null>(null);
  const peoplePopupCloseRef = useRef<HTMLButtonElement>(null);
  const closePeoplePopup = useCallback(() => {
    setPeoplePopup((current) => {
      if (current?.returnFocus) {
        requestAnimationFrame(() => current.returnFocus.focus());
      }
      return null;
    });
  }, []);
  useEffect(() => {
    if (!peoplePopup) return;
    const raf = requestAnimationFrame(() => peoplePopupCloseRef.current?.focus());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePeoplePopup();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [peoplePopup, closePeoplePopup]);
  const [bulkSubmitting, setBulkSubmitting]   = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<{ label: string; path: string } | null>(null);
  // Preflight issues found in an uploaded file, held while the user decides
  // whether to fix the file or import anyway. uploadId + mode let "Import
  // anyway" resume exactly where handleBulkSubmit stopped.
  const [bulkPreflight, setBulkPreflight] = useState<{ issues: PreflightIssue[]; uploadId: string; mode: string } | null>(null);
  // Per-view tab filter persistence: survive back-navigation from record detail.
  // Each filter is saved to sessionStorage so remounting the page (which happens
  // when the user opens a record and presses Back) restores the last chosen tab
  // instead of always snapping back to the default.
  const PROJ_FILTER_KEY = tenantScopedKey("rmone:projectFilter");
  const OPP_FILTER_KEY  = tenantScopedKey("rmone:oppStatusFilter");
  const LEM_FILTER_KEY  = tenantScopedKey("rmone:lemFilter");
  const readTabFilter = <T extends string>(key: string, valid: T[], dflt: T): T => {
    try {
      const s = sessionStorage.getItem(key);
      if (s && (valid as string[]).includes(s)) return s as T;
    } catch { /* ignore */ }
    return dflt;
  };
  const [filter, setFilter] = useState<ProjectFilter>(() =>
    // "Closed" is intentionally excluded from restorable values so every fresh
    // navigation defaults to "All Open" — the user can still click Closed in-session.
    readTabFilter(PROJ_FILTER_KEY, ["All", "All Open", "Staffing Needs"], "All Open")
  );
  const [oppStatusFilter, setOppStatusFilter] = useState<OppStatusFilter>(() =>
    readTabFilter(OPP_FILTER_KEY, ["All Opps", "Open"], "Open")
  );
  const [lemFilter, setLemFilter] = useState<LemFilter>(() =>
    readTabFilter(LEM_FILTER_KEY, ["All Leads", "Open"], "Open")
  );
  // Which sidebar section opened this page: drives which tabs are shown.
  type NavContext = "crm" | "leads-opps" | "projects" | "library";
  const [navContext, setNavContext] = useState<NavContext>(() => {
    if (typeof window === "undefined") return "projects";
    const p = new URLSearchParams(window.location.search);
    const v = p.get("view") ?? "";
    if (p.get("filter") === "Closed") return "library";
    if (v === "Companies") return "crm";
    if (v === "Opportunities" || v === "Leads" || v === "Opps") return "leads-opps";
    return "projects";
  });
  type CrmSubTab = "companies" | "contacts";
  const [crmSubTab, setCrmSubTab] = useState<CrmSubTab>("companies");
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);
  // Archive → Users tab: deleted staff accounts (restorable). Only meaningful
  // inside the Archive (library) section — leaving that section resets it.
  const [archUsersTab, setArchUsersTab] = useState(false);
  useEffect(() => {
    if (navContext !== "library") setArchUsersTab(false);
  }, [navContext]);
  // Sidebar items (CRM, Leads & Opportunities, Projects, Project Library) all
  // point at /projects with different ?view/?filter params. The page stays
  // mounted across those clicks, so re-sync state whenever the query changes.
  const urlSearch = useSearch();
  useEffect(() => {
    const p = new URLSearchParams(urlSearch);
    const raw = p.get("view");
    const alias = raw === "Opps" ? "Opportunities" : raw;
    const allowed: PipelineView[] = ["Projects", "Opportunities", "Leads", "Companies"];
    const resolved = allowed.includes(alias as PipelineView) ? (alias as PipelineView) : "Projects";
    setView(resolved);
    const closed = p.get("filter") === "Closed";
    // When entering Closed/Archive mode, force all tabs to "Closed".
    // Otherwise restore from sessionStorage so back-navigation (and
    // sidebar re-navigation to the same view) keeps the last chosen tab.
    setFilter(closed ? "Closed" : readTabFilter<ProjectFilter>(PROJ_FILTER_KEY, ["All", "All Open", "Staffing Needs"], "All Open"));
    setOppStatusFilter(closed ? "Closed" : readTabFilter<OppStatusFilter>(OPP_FILTER_KEY, ["All Opps", "Open"], "Open"));
    setLemFilter(closed ? "Closed" : readTabFilter<LemFilter>(LEM_FILTER_KEY, ["All Leads", "Open"], "Open"));
    // Reset any status pin a previous section left behind so it never leaks
    // into the normal Leads view on the next sidebar click.
    setLeadStatusFilter("All");
    if (closed) setNavContext("library");
    else if (resolved === "Companies") setNavContext("crm");
    else if (resolved === "Opportunities" || resolved === "Leads") setNavContext("leads-opps");
    else setNavContext("projects");
    setCrmSubTab("companies");
  }, [urlSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist tab selections so back-navigation from a record detail restores them.
  useEffect(() => { try { sessionStorage.setItem(PROJ_FILTER_KEY, filter); } catch { /* ignore */ } }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { sessionStorage.setItem(OPP_FILTER_KEY, oppStatusFilter); } catch { /* ignore */ } }, [oppStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { sessionStorage.setItem(LEM_FILTER_KEY, lemFilter); } catch { /* ignore */ } }, [lemFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const [byClient, setByClient] = useState(false);
  // Cards vs dense Data Grid rendering for the record lists. Resolution order:
  // the user's EXPLICIT toggle (chosen-marker + stored value) → the admin-set
  // company default (Settings → Display Defaults) → built-in "cards". The old
  // code persisted on every mount, so a stored "cards" WITHOUT the marker is
  // indistinguishable from "never chose a mode" — only a stored "grid"
  // (non-default) counts as a real legacy preference. Choice + marker are
  // tenant-scoped so one tenant's toggle on a shared browser can never
  // override another tenant's company default; the pre-scoping global key is
  // read-only legacy fallback (it can't tell tenants apart, never written).
  const VIEWMODE_LEGACY_KEY = "rmone:pipelineViewMode";
  const VIEWMODE_KEY = tenantScopedKey("rmone:pipelineViewMode");
  const VIEWMODE_CHOSEN_KEY = tenantScopedKey("rmone:pipelineViewModeChosen");
  const displayDefaultsVersion = useDisplayDefaultsVersion();
  useEffect(() => { void loadDisplayDefaults(); }, []);
  // Company workflow (stage order + colors) for the grid stage-flow dots —
  // throttled singleton, shared with the record pages.
  useEffect(() => { void loadStageRules(); }, []);
  const [viewMode, setViewMode] = useState<"cards" | "grid">(() => {
    if (typeof window === "undefined") return "cards";
    try {
      const stored = localStorage.getItem(VIEWMODE_KEY);
      if (localStorage.getItem(VIEWMODE_CHOSEN_KEY) === "1" && (stored === "grid" || stored === "cards")) return stored;
      if ((stored ?? localStorage.getItem(VIEWMODE_LEGACY_KEY)) === "grid") return "grid"; // legacy explicit-looking preference
    } catch { /* ignore */ }
    return companyDefaultViewMode() ?? "cards";
  });
  // Persist ONLY explicit toggles — that's what lets the company default keep
  // applying to users who never picked a mode themselves.
  const userSetViewMode = useCallback((m: "cards" | "grid") => {
    try {
      localStorage.setItem(VIEWMODE_KEY, m);
      localStorage.setItem(VIEWMODE_CHOSEN_KEY, "1");
    } catch { /* ignore */ }
    setViewMode(m);
  }, [VIEWMODE_KEY, VIEWMODE_CHOSEN_KEY]);
  // Adopt the company default once its async fetch lands (or an admin saves a
  // new one this session) — never overriding an explicit user choice.
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEWMODE_CHOSEN_KEY) === "1") return;
      if ((localStorage.getItem(VIEWMODE_KEY) ?? localStorage.getItem(VIEWMODE_LEGACY_KEY)) === "grid") return;
    } catch { /* ignore */ }
    const dflt = companyDefaultViewMode();
    if (dflt) setViewMode(dflt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayDefaultsVersion, VIEWMODE_KEY, VIEWMODE_CHOSEN_KEY]);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("All Time");
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [buFilter, setBuFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState("All Stages");
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  const [oppSectorFilter, setOppSectorFilter] = useState("All");
  const [showOppSectorDropdown, setShowOppSectorDropdown] = useState(false);
  const [projectDivFilter, setProjectDivFilter] = useState("All");
  const [projectBuFilter, setProjectBuFilter] = useState("All");
  const [projectDeptFilter, setProjectDeptFilter] = useState("All");
  const [oppDivFilter, setOppDivFilter] = useState("All");
  const [oppDeptFilter, setOppDeptFilter] = useState("All");
  const [leadBuFilter, setLeadBuFilter] = useState("All");
  const [leadDivFilter, setLeadDivFilter] = useState("All");
  const [leadDeptFilter, setLeadDeptFilter] = useState("All");
  const [leadStatusFilter, setLeadStatusFilter] = useState("All");
  // Which single BU/Division/Dept dropdown popup is open, e.g. "proj-bu",
  // "opp-div", "lead-dept". Only one can be open at a time; picking a value
  // in one does NOT clear the other two — all three combine (AND) so a user
  // can pin down an exact BU + Division + Dept combination unambiguously.
  const [openOrgMenu, setOpenOrgMenu] = useState<string | null>(null);
  const [showFiltersPopup, setShowFiltersPopup] = useState(false);
  const anyFilterActive =
    (view === "Opportunities" && (stageFilter !== "All Stages" || oppSectorFilter !== "All" || buFilter !== "All" || oppDivFilter !== "All" || oppDeptFilter !== "All")) ||
    (view === "Projects" && (projectBuFilter !== "All" || projectDivFilter !== "All" || projectDeptFilter !== "All")) ||
    (view === "Leads" && (leadBuFilter !== "All" || leadDivFilter !== "All" || leadDeptFilter !== "All" || leadStatusFilter !== "All")) ||
    (view !== "Companies" && dateFilter !== "All Time");
  const [refreshing, setRefreshing] = useState(false);
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);
  const [teamProject, setTeamProject] = useState<Project | null>(null);
  // Team modal can also be opened from an Opportunity card (Opps tab).
  // We reuse the same TeamModal — its underlying queries (project-team,
  // allocations, project-details) are keyed by record id, which is the
  // same id space for OPM and PMM, so the modal works identically.
  const [teamOpp, setTeamOpp] = useState<Opportunity | null>(null);
  const [companyDetail, setCompanyDetail] = useState<{ company: Company; tab: "projects" | "contacts" } | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [importStatus, setImportStatus] = useState<"running" | "done" | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const importAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [compareList, setCompareList] = useState<Array<{ id: string; type: "pmm" | "opm" | "lem"; data: Project | Opportunity | Lead }>>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [conflictAnalysis, setConflictAnalysis] = useState<{
    memberName: string; role: string;
    projectName: string; projectId: string;
    thisPct: number; thisHrs: number;
    otherProjects: { id: string; name: string; pct: number; hrs: number }[];
  } | null>(null);
  const [holdPending, setHoldPending] = useState<{ record: Project | Opportunity | Lead; type: "pmm" | "opm" | "lem" } | null>(null);
  const [statusPending, setStatusPending] = useState<{ record: Project | Opportunity | Lead; type: "pmm" | "opm" | "lem" } | null>(null);
  const [notesPending, setNotesPending] = useState<{ record: Project | Opportunity | Lead; type: "pmm" | "opm" | "lem" } | null>(null);
  const [sourceTypePending, setSourceTypePending] = useState<{ record: Opportunity | Lead; type: "opm" | "lem" } | null>(null);
  const [openPosPending, setOpenPosPending] = useState<{ record: Project | Opportunity; type: "pmm" | "opm" } | null>(null);
  const [teamPending, setTeamPending] = useState<{
    record: Project | Opportunity | Lead;
    type: "pmm" | "opm" | "lem";
    existingAllocations: ExistingAllocationRef[];
  } | null>(null);
  const [holdInfoMap, setHoldInfoMap] = useState<Record<string, HoldInfo>>(() => _holdMap());
  // Popup shown when a user clicks an opportunity that has already been
  // converted into a project (instead of opening the opp detail page).
  const [convertedPopup, setConvertedPopup] = useState<{ opp: Opportunity; project: Project | null } | null>(null);
  // Popup shown when a user clicks a lead that has already been converted
  // into an opportunity (instead of opening the lead detail page).
  const [convertedLeadPopup, setConvertedLeadPopup] = useState<{ lead: Lead; opp: Opportunity | null } | null>(null);

  // CRM Contacts (fetched when on the CRM/Companies page)
  const _tok = getStoredUser()?.token ?? "";
  const _conCacheKey = `rm_con_cache_${_tok}`;
  const _conPlaceholder = (() => {
    try {
      const r = sessionStorage.getItem(_conCacheKey);
      if (!r) return undefined;
      const parsed = JSON.parse(r);
      // Never seed from an empty payload — a transient backend failure must
      // not flash (or pin) an empty contacts list.
      const rows = (parsed as { data?: unknown[] } | null)?.data;
      return Array.isArray(rows) && rows.length > 0 ? parsed : undefined;
    } catch { return undefined; }
  })();
  const conQ = useQuery({
    queryKey: ["con"],
    queryFn: () => getModuleRecords("CON"),
    staleTime: 5 * 60 * 1000,
    placeholderData: _conPlaceholder,
    enabled: navContext === "crm",
  });
  useEffect(() => {
    // Persist only non-empty payloads — same guard as the Resources page.
    const rows = (conQ.data as { data?: unknown[] } | undefined)?.data;
    if (Array.isArray(rows) && rows.length > 0) {
      try { sessionStorage.setItem(_conCacheKey, JSON.stringify(conQ.data)); } catch { /* full */ }
    }
  }, [conQ.data, _conCacheKey]);
  const crmContacts = useMemo(() => {
    const rows = (conQ.data as any)?.data ?? [];
    return rows.map((r: any) => {
      const a = r as any;
      const first = a.FirstName ?? a.First_Name ?? "";
      const last = a.LastName ?? a.Last_Name ?? a.Surname ?? "";
      const firstLast = first && last ? `${first} ${last}` : (first || last);
      return {
        id: a.TicketId ?? "",
        name: a.FullName ?? a.ContactName ?? a.ContactDisplayName ?? a.DisplayName ?? a.Name ?? firstLast ?? a.ShortName ?? "",
        title: a.JobTitle ?? a.Title2 ?? a.ContactTitle ?? a.Position ?? a.Title ?? "",
        company: a.CompanyName ?? a.AccountName ?? a.Company ?? a.Organization ?? a.CRMCompanyLookupName ?? "",
        email: a.Email ?? a.EmailAddress ?? a.WorkEmail ?? "",
        phone: a.PhoneNumber ?? a.Phone ?? a.MobilePhone ?? a.CellPhone ?? "",
      };
    });
  }, [conQ.data]);
  const filteredCrmContacts = useMemo(() => {
    if (!search.trim()) return crmContacts;
    const q = search.toLowerCase();
    return crmContacts.filter((c: any) =>
      c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [crmContacts, search]);

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const uploadId = (() => { try { return localStorage.getItem(activeImportKey()); } catch { return null; } })();
    if (!uploadId) return;
    setImportStatus("running");
    setImportProgress(5);
    // Animate progress bar up to ~85% while running
    importAnimRef.current = setInterval(() => {
      setImportProgress(p => p < 82 ? p + 1.2 : p);
    }, 400);
    const poll = async () => {
      try {
        const res = await fetch(`/api/onboarding/status/${uploadId}`);
        if (!res.ok) return;
        const d = await res.json() as { status: string; progress?: number };
        if (d.progress != null) setImportProgress(Math.min(d.progress, 90));
        if (d.status !== "pending" && d.status !== "running") {
          if (pollTimer) clearInterval(pollTimer);
          if (importAnimRef.current) clearInterval(importAnimRef.current);
          try { localStorage.removeItem(activeImportKey()); } catch {}
          setImportProgress(100);
          setTimeout(() => setImportStatus("done"), 1200);
        }
      } catch { /* ignore */ }
    };
    poll();
    pollTimer = setInterval(poll, 2500);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (importAnimRef.current) clearInterval(importAnimRef.current);
    };
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [view, filter, oppStatusFilter, stageFilter, search, dateFilter, buFilter, oppSectorFilter, projectDivFilter, projectBuFilter, projectDeptFilter, oppDivFilter, oppDeptFilter, leadBuFilter, leadDivFilter, leadDeptFilter]);
  const [editingOpp, setEditingOpp] = useState<OppScheduleTarget | null>(null);
  const qcMain = useQueryClient();

  const pmmQ = useQuery({
    queryKey: ["pmm"],
    queryFn: () => getModuleRecords("PMM"),
    // Auto-poll when there are no projects yet (e.g. during a fresh tenant
    // onboarding import). Stops polling as soon as data arrives. Only polls
    // when the tab is focused so it doesn't hammer in the background.
    refetchInterval: (query) =>
      (query.state.data?.data?.length ?? 0) === 0 ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
  const opmQ = useQuery({ queryKey: ["opm"], queryFn: () => getModuleRecords("OPM") });
  const lemQ = useQuery({ queryKey: ["lem"], queryFn: () => getModuleRecords("LEM") });

  // When a field is saved from the project/lead/opp detail page, that page
  // busts the api.ts module cache and fires this event. Invalidating the RQ
  // query here ensures the grid row reflects the new value immediately
  // (without waiting for the 5-min stale time to expire).
  useEffect(() => {
    const handler = (e: Event) => {
      const mod = (e as CustomEvent<{ mod: string }>).detail?.mod?.toUpperCase();
      if (mod === "LEM") { bustCache("module:LEM"); void lemQ.refetch(); }
      else if (mod === "OPM") { bustCache("module:OPM"); void opmQ.refetch(); }
      else if (mod === "PMM") { bustCache("module:PMM"); void pmmQ.refetch(); }
    };
    window.addEventListener("rmone:moduleFieldSaved", handler);
    return () => window.removeEventListener("rmone:moduleFieldSaved", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const comQ = useQuery({ queryKey: ["com"], queryFn: () => getModuleRecords("COM") });
  // Companies-tab visit → one-shot COM-… ID backfill for legacy rows missing
  // one (mandatory-ID policy, Aug 2026). The server enforces the editor gate,
  // so viewers silently no-op; the grid refreshes only when IDs were actually
  // minted. Session-once — repeat visits skip the round-trip.
  useEffect(() => {
    if (navContext !== "crm" || crmSubTab !== "companies" || ensuredCompanyIdsOnce) return;
    ensuredCompanyIdsOnce = true;
    void ensureCompanyIds().then(r => {
      if (r && r.minted > 0) { bustCache("module:COM"); void comQ.refetch(); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navContext, crmSubTab]);
  // Resource demands feed the per-project staffing summary on each card
  // (demand-record count, top role, average % per request, FTE estimate).
  const demandsQ = useQuery({ queryKey: ["resource-demands"], queryFn: () => getResourceDemands() });
  // One tenant-wide schedule fetch lets every list row use the same current
  // phase calculation as the record detail schedule, without N detail calls.
  const schedulePhaseMapQ = useQuery({
    queryKey: ["bulk-schedule", "status-display"],
    queryFn: loadProjectPhaseMap,
    staleTime: 300_000,
  });

  const projects: Project[] = useMemo(() => {
    const phaseMap = schedulePhaseMapQ.data;
    return (pmmQ.data?.data ?? []).map(mapPMM).filter(p => p.id).map((project) => ({
      ...project,
      displayStatus: currentPhaseOf(phaseMap?.get(project.id))?.name || project.rawStatus || project.status,
    }));
  }, [pmmQ.data, schedulePhaseMapQ.data]);
  // Resolve a converted opp back to its project by title. Conversion copies the
  // opp Title verbatim onto the new project, and titles are unique per module
  // (createRecordRds rejects duplicates), so a case-insensitive title match is a
  // reliable link with no extra backend storage. Falls back to null if the
  // project was later renamed or removed.
  // Title → ALL same-named projects (names legitimately repeat across
  // different jobs — "Holiday", "Renovation" — so consumers must qualify a
  // title hit with sameJobFields before treating it as the SAME job).
  const projectsByTitle = useMemo(() => {
    const m = new Map<string, Project[]>();
    for (const p of projects) {
      const k = (p.name || "").trim().toLowerCase();
      if (!k) continue;
      const arr = m.get(k);
      if (arr) arr.push(p); else m.set(k, [p]);
    }
    return m;
  }, [projects]);
  // ONE conversion predicate shared by every converted signal on the Opps
  // grid (ID-pill tag, blue row tint, row-click popup): explicit converted
  // stage OR a same-job project sharing the title (title alone is weak —
  // sameJobFields must agree on client / BU / division).
  const isConvertedOpp = (o: Opportunity): boolean =>
    o.stage === CONVERTED_STAGE
    || (projectsByTitle.get((o.name || "").trim().toLowerCase()) ?? []).some(p => sameJobFields(o, p));
  // Use the same forecast-window the home page uses so the same project
  // shows the same staffing numbers in both places. Defaults to 30d.
  const windowDays = useMemo(() => {
    try {
      const raw = window.sessionStorage.getItem("home.forecastWindowDays");
      const n = raw ? Number(raw) : 30;
      return [30, 60, 90, 180].includes(n) ? n : 30;
    } catch { return 30; }
  }, []);
  // Build a per-project staffing summary keyed by TicketId, using the
  // same `inForecastWindow` predicate as the home dashboard. The card
  // shows count, average % per request, FTE estimate, and dominant role.
  const projectStaffing = useMemo(() => {
    const out: Record<string, { count: number; avgPct: number; fte: number; topRole: string | null; roles: string[] }> = {};
    const rows = (demandsQ.data?.data ?? []) as Array<Record<string, any>>;
    const byTid: Record<string, Array<Record<string, any>>> = {};
    for (const d of rows) {
      if (!inForecastWindow(d, windowDays)) continue;
      const tid = String(d?.TicketId ?? "").trim();
      if (!tid) continue;
      (byTid[tid] ??= []).push(d);
    }
    for (const [tid, arr] of Object.entries(byTid)) {
      const sumPct = arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0);
      const roleSums: Record<string, number> = {};
      for (const d of arr) {
        const role = String(d?.Role ?? "").trim() || getBusinessRules().unassignedLabel;
        roleSums[role] = (roleSums[role] || 0) + (Number(d?.PctAllocation) || 0);
      }
      const sortedRoles = Object.entries(roleSums).sort((a, b) => b[1] - a[1]);
      const topRole = sortedRoles[0]?.[0] || null;
      const uniqueRoles = sortedRoles.map(([r]) => r);
      out[tid] = {
        count: arr.length,
        avgPct: Math.round(arr.length ? sumPct / arr.length : 0),
        fte: Math.round((sumPct / 100) * 10) / 10,
        topRole,
        roles: uniqueRoles,
      };
    }
    return out;
  }, [demandsQ.data, windowDays, rulesVersion]);
  const opps: Opportunity[] = useMemo(() => {
    const phaseMap = schedulePhaseMapQ.data;
    const seen = new Set<string>();
    return (opmQ.data?.data ?? []).map(mapOPM).filter(o => {
      if (!o.id || seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    }).sort((a, b) => {
      if (a.daysLeft === 999 && b.daysLeft === 999) return b.value - a.value;
      if (a.daysLeft === 999) return 1;
      if (b.daysLeft === 999) return -1;
      return a.daysLeft - b.daysLeft;
    }).map((opportunity) => ({
      ...opportunity,
      displayStatus: currentPhaseOf(phaseMap?.get(opportunity.id))?.name || opportunity.stage,
    }));
  }, [opmQ.data, schedulePhaseMapQ.data]);
  const leads: Lead[] = useMemo(() => {
    return (lemQ.data?.data ?? []).map(mapLEM).filter(l => l.id)
      .sort((a, b) => b.value - a.value);
  }, [lemQ.data]);
  // Resolve a converted lead to its opportunity by title — same pattern as
  // projectsByTitle above: conversion copies the lead Title verbatim onto the
  // new opp, but names repeat across different jobs, so consumers must
  // qualify a title hit with sameJobFields before treating it as the SAME
  // job. Falls back to null if the opp was renamed or removed.
  const oppsByTitle = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const o of opps) {
      const k = (o.name || "").trim().toLowerCase();
      if (!k) continue;
      const arr = m.get(k);
      if (arr) arr.push(o); else m.set(k, [o]);
    }
    return m;
  }, [opps]);

  const allCompanies: Company[] = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[(),"']/g, " ").replace(/\s+/g, " ").trim();
    const map = new Map<string, { name: string; city: string; projects: number; opps: number; leads: number; value: number }>();
    const upsert = (client: string, city: string, kind: "p" | "o" | "l", val: number) => {
      const name = client.trim();
      if (!name || name.length < 2) return;
      const key = norm(name);
      const e = map.get(key) ?? { name, city, projects: 0, opps: 0, leads: 0, value: 0 };
      if (kind === "p") e.projects++; else if (kind === "o") e.opps++; else e.leads++;
      e.value += val;
      if (!e.city && city) e.city = city;
      map.set(key, e);
    };
    for (const r of projects) if (r.client) upsert(r.client, r.city, "p", r.value);
    for (const r of opps)     if (r.client) upsert(r.client, r.city, "o", r.value);
    for (const r of leads)    if (r.client) upsert(r.client, r.city, "l", r.value);
    return Array.from(map.values())
      .map(e => ({
        id: "", name: e.name, city: e.city, state: "", type: "", status: "", phone: "", email: "",
        derived: true, projectCount: e.projects, oppCount: e.opps, totalValue: e.value,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, opps, leads]);

  const allStages = useMemo(() => {
    // Always show the full standard OPM pipeline so users can filter by
    // Awarded/Lost even when no such opps exist yet in this tenant.
    const STANDARD_OPM_STAGES = [
      "Prospecting", "Qualifying", "Proposal", "Negotiation",
      "Awarded", "Pending Assignment", "Lost", "Cancelled", "Declined", "Dead",
    ];
    const s = new Set<string>(STANDARD_OPM_STAGES);
    for (const o of opps) if (o.stage && o.stage !== "Unknown") s.add(o.stage);
    // Return in standard order, with any extra tenant-specific stages appended.
    const standard = STANDARD_OPM_STAGES.filter(st => s.has(st));
    const extra = Array.from(s).filter(st => !STANDARD_OPM_STAGES.includes(st)).sort();
    return [...standard, ...extra];
  }, [opps]);

  const allOppSectors = useMemo(() => {
    const s = new Set<string>();
    for (const o of opps) if (o.sector && o.sector !== "—") s.add(o.sector);
    return Array.from(s).sort();
  }, [opps]);

  // BU / Division / Dept filter options — cascaded (Division scoped to the
  // selected BU, Dept scoped to the selected BU + Division) and, for Dept,
  // annotated with which Division(s) it actually belongs to so the same
  // department name under two different divisions is never ambiguous.
  const projectOrgOptions = useMemo(
    () => buildOrgFilterOptions(projects.map(p => ({ bu: p.bu, division: p.division, dept: p.dept })), projectBuFilter, projectDivFilter),
    [projects, projectBuFilter, projectDivFilter],
  );
  const oppOrgOptions = useMemo(
    () => buildOrgFilterOptions(opps.map(o => ({ bu: o.bu, division: o.division, dept: o.dept })), buFilter, oppDivFilter),
    [opps, buFilter, oppDivFilter],
  );
  const leadOrgOptions = useMemo(
    () => buildOrgFilterOptions(leads.map(l => ({ bu: l.bu, division: l.division, dept: l.dept })), leadBuFilter, leadDivFilter),
    [leads, leadBuFilter, leadDivFilter],
  );
  const leadStatusOptions = useMemo(
    () => Array.from(new Set(leads.map(l => l.status).filter(Boolean))).sort() as string[],
    [leads],
  );

  const dateRange = dateRangeFor(dateFilter);
  const dateLabel = dateFilter === "All Time" ? "" : dateFilter;

  const [myRecordCodes, setMyRecordCodes] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.username) return;
    let cancelled = false;
    getProjectList(user.username)
      .then(codes => {
        if (cancelled) return;
        setMyRecordCodes(new Set(codes.map(c => c.toUpperCase())));
      })
      .catch(e => console.warn("[projects] getProjectList failed:", String(e)));
    return () => { cancelled = true; };
  }, [user?.username]);

  const userGuid = (user?.userId ?? "").toLowerCase();
  const userName = (user?.username ?? "").toLowerCase();
  const isMine = (assignedUserGuids: string, recordId?: string) => {
    if (recordId && myRecordCodes.has(recordId.toUpperCase())) return true;
    if (!assignedUserGuids) return false;
    const hay = assignedUserGuids.toLowerCase();
    if (userGuid && hay.includes(userGuid)) return true;
    if (userName && hay.includes(userName)) return true;
    return false;
  };

  const sq = search.toLowerCase().trim();
  const sqNorm = normalizeId(sq);
  const idMatch = (id: string) => {
    const lo = id.toLowerCase();
    return lo.includes(sq) || normalizeId(lo) === sqNorm;
  };

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (filter === "Closed" && !p.closed) return false;
      if (filter === "All Open" && p.closed) return false;
      if (filter === "Staffing Needs") {
        if (p.closed) return false;
        const s = projectStaffing[p.id];
        if (!s || s.count === 0) return false;
      }
      if (projectDivFilter !== "All" && p.division !== projectDivFilter) return false;
      if (projectBuFilter !== "All" && (p.bu || "").trim() !== projectBuFilter) return false;
      if (projectDeptFilter !== "All" && p.dept !== projectDeptFilter) return false;
      if (sq) {
        if (!p.name.toLowerCase().includes(sq) && !idMatch(p.id)
          && !(p.projectId && idMatch(p.projectId))
          && !p.city.toLowerCase().includes(sq)
          && !p.office.toLowerCase().includes(sq)) return false;
      }
      if (dateRange) {
        if (!overlapsRange([p.rawTargetStart, p.rawTargetEnd, p.rawActualStart, p.rawActualEnd], dateRange))
          return false;
      }
      return true;
    });
  }, [projects, filter, sq, dateRange, myRecordCodes, userGuid, userName, projectStaffing, projectDivFilter, projectBuFilter, projectDeptFilter]);

  // Lazy team-count queries for the visible project slice — stale 5 min so
  // navigating back doesn't re-fetch, but counts are real (not guessed from
  // named-personnel fields which are often unpopulated).
  const visibleProjectSlice = filteredProjects.slice(0, visibleCount);
  const projectTeamCountQueries = useQueries({
    queries: visibleProjectSlice.map(p => ({
      queryKey: ["project-team", p.id],
      // lowPriority (bulk=1): count fan-out — one call per visible row. The
      // server queues these cache-miss DB queries behind a small concurrency
      // gate so they can't starve interactive detail-page loads.
      // NO .catch() → a failed fetch must stay an error (retried), never be
      // cached as an empty team, or the grid shows misleading red 0s for 5 min.
      queryFn: () => getProjectTeam(p.id, false, true),
      retry: 2,
      retryDelay: 1500,
      staleTime: 5 * 60 * 1000,
      enabled: view === "Projects",
    })),
  });

  const projectTeamCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    visibleProjectSlice.forEach((p, i) => {
      const data = projectTeamCountQueries[i]?.data as any;
      if (data?.team) m[p.id] = data.team.length;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTeamCountQueries]);

  // Open-position counts (unfilled ResourceUser-null demand slots) — drives
  // the orange "N open" chips on the cards and Data Grid Team column.
  const projectOpenCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    visibleProjectSlice.forEach((p, i) => {
      const data = projectTeamCountQueries[i]?.data as any;
      if (Array.isArray(data?.openRoles)) m[p.id] = data.openRoles.length;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTeamCountQueries]);

  // Conflict map: for each project, which members are also on another visible project?
  const projectConflictMap = useMemo(() => {
    const teamsByProject: Array<{ pid: string; pname: string; members: ProjectTeamMember[] }> =
      visibleProjectSlice.map((p, i) => ({
        pid: p.id,
        pname: p.name,
        members: ((projectTeamCountQueries[i]?.data as any)?.team ?? []) as ProjectTeamMember[],
      }));

    // key → per-project allocation info
    const memberMap = new Map<string, { pid: string; pname: string; pct: number; hrs: number }[]>();
    for (const { pid, pname, members } of teamsByProject) {
      for (const m of members) {
        const key = m.resourceId || m.name;
        if (!key) continue;
        if (!memberMap.has(key)) memberMap.set(key, []);
        memberMap.get(key)!.push({ pid, pname, pct: m.pctAllocation ?? 0, hrs: m.eacHrs ?? 0 });
      }
    }

    const result: Record<string, Array<{
      name: string; role: string; thisPct: number; thisHrs: number;
      otherProjects: { id: string; name: string; pct: number; hrs: number }[];
    }>> = {};

    for (const { pid, members } of teamsByProject) {
      const conflicts: typeof result[string] = [];
      const seen = new Set<string>();
      for (const m of members) {
        const key = m.resourceId || m.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const all = memberMap.get(key) ?? [];
        const others = all.filter(pp => pp.pid !== pid);
        if (others.length > 0) {
          conflicts.push({
            name: m.name,
            role: m.role || m.title || "",
            thisPct: m.pctAllocation ?? 0,
            thisHrs: m.eacHrs ?? 0,
            otherProjects: others.map(o => ({ id: o.pid, name: o.pname, pct: o.pct, hrs: o.hrs })),
          });
        }
      }
      if (conflicts.length > 0) result[pid] = conflicts;
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTeamCountQueries]);

  const filteredOpps = useMemo(() => {
    return opps.filter(o => {
      // "All Opps" shows everything; "Open" = not closed; "Closed" = closed only.
      if (oppStatusFilter === "Closed" && !o.closed) return false;
      if (oppStatusFilter === "Open" && o.closed) return false;
      // "All Opps" falls through — no open/closed gating.
      if (stageFilter !== "All Stages" && o.stage !== stageFilter) return false;
      if (buFilter !== "All" && (o.bu || "").trim() !== buFilter) return false;
      if (oppSectorFilter !== "All" && o.sector !== oppSectorFilter) return false;
      if (oppDivFilter !== "All" && o.division !== oppDivFilter) return false;
      if (oppDeptFilter !== "All" && o.dept !== oppDeptFilter) return false;
      if (dateRange) {
        if (!overlapsRange([o.rawBidDate, o.rawTargetStart, o.rawTargetEnd], dateRange))
          return false;
      }
      if (sq) {
        if (!o.name.toLowerCase().includes(sq) && !idMatch(o.id)
          && !(o.projectId && idMatch(o.projectId))
          && !o.city.toLowerCase().includes(sq)
          && !o.office.toLowerCase().includes(sq)
          && !(o.stage && o.stage.toLowerCase().includes(sq))) return false;
      }
      return true;
    });
  }, [opps, oppStatusFilter, stageFilter, buFilter, oppSectorFilter, oppDivFilter, oppDeptFilter, sq, dateRange, myRecordCodes, userGuid, userName]);

  // Same background prefetch for visible opps — seeds the React Query cache and
  // the in-memory seed store so the Team modal opens instantly (matches
  // TeamModal's query key).
  const visibleOppSlice = filteredOpps.slice(0, visibleCount);
  const oppTeamCountQueries = useQueries({
    queries: visibleOppSlice.map(o => ({
      queryKey: ["project-team", o.id],
      // NO .catch() → errors must not be cached (or seeded) as empty teams.
      queryFn: async () => {
        const res = await getProjectTeam(o.id, false, true);
        try { memSeed.setItem(`rmone:v1:teamraw:${o.id}`, JSON.stringify({ data: res, ts: Date.now() })); } catch { /* non-serializable */ }
        return res;
      },
      retry: 2,
      retryDelay: 1500,
      staleTime: 5 * 60 * 1000,
    })),
  });
  const oppTeamCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    visibleOppSlice.forEach((o, i) => {
      const data = oppTeamCountQueries[i]?.data as any;
      if (data?.team) m[o.id] = data.team.length;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppTeamCountQueries]);

  const oppOpenCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    visibleOppSlice.forEach((o, i) => {
      const data = oppTeamCountQueries[i]?.data as any;
      if (Array.isArray(data?.openRoles)) m[o.id] = data.openRoles.length;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppTeamCountQueries]);

  // ---- Data Grid team counts ----
  // The Data Grid paginates over the FULL filtered list with its own page/sort
  // state, so the card prefetch slices above don't cover its rows. The grid
  // reports which rows are on its current page; we fetch the same /project-team
  // data (same query keys, shared cache) for exactly those rows so the grid's
  // Team column matches the Cards view.
  const [gridProjectPageRows, setGridProjectPageRows] = useState<typeof filteredProjects>([]);
  const gridProjectTeamQueries = useQueries({
    queries: (viewMode === "grid" && view === "Projects" ? gridProjectPageRows : []).map(p => ({
      queryKey: ["project-team", p.id],
      // NO .catch() → a failed fetch stays an error (null in the map → "—"),
      // never a cached empty team rendered as a misleading red 0.
      queryFn: () => getProjectTeam(p.id, false, true),
      retry: 2,
      retryDelay: 1500,
      staleTime: 5 * 60 * 1000,
    })),
  });
  // Value semantics: number = known count, null = still loading OR failed
  // (render a muted placeholder instead of a misleading red 0), absent = not
  // on the current grid page (fall back to the card map / GUID string).
  const gridProjectTeamCountMap = useMemo(() => {
    const m: Record<string, number | null> = {};
    (viewMode === "grid" && view === "Projects" ? gridProjectPageRows : []).forEach((p, i) => {
      const q = gridProjectTeamQueries[i];
      const data = q?.data as any;
      if (data?.team) m[p.id] = data.team.length;
      else if (q?.isLoading || q?.isError) m[p.id] = null;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridProjectTeamQueries]);

  const gridProjectOpenCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    (viewMode === "grid" && view === "Projects" ? gridProjectPageRows : []).forEach((p, i) => {
      const data = gridProjectTeamQueries[i]?.data as any;
      if (Array.isArray(data?.openRoles)) m[p.id] = data.openRoles.length;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridProjectTeamQueries]);

  // Effective lead-column values (Project Leads card parity) for the rows on
  // the current Data Grid page — the same rows whose teams are already being
  // fetched for the Team column, so this adds no extra requests. While a
  // row's team is still loading the map holds its explicit-only values; the
  // cell fills in when the team query resolves (same as the Team count).
  const gridProjectKpMap = useMemo(() => {
    const m: Record<string, Record<string, unknown>> = {};
    (viewMode === "grid" && view === "Projects" ? gridProjectPageRows : []).forEach((p, i) => {
      const data = gridProjectTeamQueries[i]?.data as any;
      m[p.id] = kpGridOverrides(
        p.raw as Record<string, unknown> | undefined,
        Array.isArray(data?.team) ? (data.team as ProjectTeamMember[]) : undefined,
      );
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridProjectTeamQueries]);

  const [gridOppPageRows, setGridOppPageRows] = useState<typeof filteredOpps>([]);
  const gridOppTeamQueries = useQueries({
    queries: (viewMode === "grid" && view === "Opportunities" ? gridOppPageRows : []).map(o => ({
      queryKey: ["project-team", o.id],
      // NO .catch() → see gridProjectTeamQueries above.
      queryFn: () => getProjectTeam(o.id, false, true),
      retry: 2,
      retryDelay: 1500,
      staleTime: 5 * 60 * 1000,
    })),
  });
  const gridOppTeamCountMap = useMemo(() => {
    const m: Record<string, number | null> = {};
    (viewMode === "grid" && view === "Opportunities" ? gridOppPageRows : []).forEach((o, i) => {
      const q = gridOppTeamQueries[i];
      const data = q?.data as any;
      if (data?.team) m[o.id] = data.team.length;
      else if (q?.isLoading || q?.isError) m[o.id] = null;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridOppTeamQueries]);

  const gridOppOpenCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    (viewMode === "grid" && view === "Opportunities" ? gridOppPageRows : []).forEach((o, i) => {
      const data = gridOppTeamQueries[i]?.data as any;
      if (Array.isArray(data?.openRoles)) m[o.id] = data.openRoles.length;
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridOppTeamQueries]);

  // Lead-column parity map for the Opportunities grid (see gridProjectKpMap).
  const gridOppKpMap = useMemo(() => {
    const m: Record<string, Record<string, unknown>> = {};
    (viewMode === "grid" && view === "Opportunities" ? gridOppPageRows : []).forEach((o, i) => {
      const data = gridOppTeamQueries[i]?.data as any;
      m[o.id] = kpGridOverrides(
        o.raw as Record<string, unknown> | undefined,
        Array.isArray(data?.team) ? (data.team as ProjectTeamMember[]) : undefined,
      );
    });
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridOppTeamQueries]);

  const oppConflictMap = useMemo(() => {
    const teamsByOpp: Array<{ pid: string; pname: string; members: ProjectTeamMember[] }> =
      visibleOppSlice.map((o, i) => ({
        pid: o.id,
        pname: o.name,
        members: ((oppTeamCountQueries[i]?.data as any)?.team ?? []) as ProjectTeamMember[],
      }));
    const memberMap = new Map<string, { pid: string; pname: string; pct: number; hrs: number }[]>();
    for (const { pid, pname, members } of teamsByOpp) {
      for (const m of members) {
        const key = m.resourceId || m.name;
        if (!key) continue;
        if (!memberMap.has(key)) memberMap.set(key, []);
        memberMap.get(key)!.push({ pid, pname, pct: m.pctAllocation ?? 0, hrs: m.eacHrs ?? 0 });
      }
    }
    const result: Record<string, ProjectConflict[]> = {};
    for (const { pid, members } of teamsByOpp) {
      const conflicts: ProjectConflict[] = [];
      const seen = new Set<string>();
      for (const m of members) {
        const key = m.resourceId || m.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const all = memberMap.get(key) ?? [];
        const others = all.filter(pp => pp.pid !== pid);
        if (others.length > 0) {
          conflicts.push({
            name: m.name,
            role: m.role || m.title || "",
            thisPct: m.pctAllocation ?? 0,
            thisHrs: m.eacHrs ?? 0,
            otherProjects: others.map(o => ({ id: o.pid, name: o.pname, pct: o.pct, hrs: o.hrs })),
          });
        }
      }
      if (conflicts.length > 0) result[pid] = conflicts;
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppTeamCountQueries]);

  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (lemFilter === "Closed" && !l.closed) return false;
      if (lemFilter === "Open" && l.closed) return false;
      // Archived leads are deliberately tucked away: they only surface in the
      // Closed filter (which the Archive sidebar section uses) — never in the
      // default All Leads / Open views.
      if (lemFilter !== "Closed" && String(l.status).trim().toLowerCase() === "archived") return false;
      if (leadBuFilter !== "All" && (l.bu || "").trim() !== leadBuFilter) return false;
      if (leadDivFilter !== "All" && l.division !== leadDivFilter) return false;
      if (leadDeptFilter !== "All" && l.dept !== leadDeptFilter) return false;
      if (leadStatusFilter !== "All" && l.status !== leadStatusFilter) return false;
      if (dateRange) {
        if (!overlapsRange([l.rawCreated, l.rawDueDate, l.rawTargetStart, l.rawTargetEnd, l.rawClose], dateRange))
          return false;
      }
      if (sq) {
        if (!l.name.toLowerCase().includes(sq) && !idMatch(l.id)
          && !l.city.toLowerCase().includes(sq)
          && !l.office.toLowerCase().includes(sq)
          && !l.sector.toLowerCase().includes(sq)) return false;
      }
      return true;
    });
  }, [leads, lemFilter, sq, dateRange, myRecordCodes, userGuid, userName, leadBuFilter, leadDivFilter, leadDeptFilter, leadStatusFilter]);

  const filteredCompanies = useMemo(() => {
    if (!sq) return allCompanies;
    return allCompanies.filter(c =>
      c.name.toLowerCase().includes(sq) || idMatch(c.id) ||
      c.city.toLowerCase().includes(sq) || c.type.toLowerCase().includes(sq)
    );
  }, [allCompanies, sq]);

  const activeListLength = view === "Projects" ? filteredProjects.length
    : view === "Opportunities" ? filteredOpps.length
    : view === "Leads" ? filteredLeads.length
    : filteredCompanies.length;

  // Search guidance: the default view is Open, but a searched record may be
  // hidden only because it lives in Closed (or because the user is in a
  // narrower Projects view such as Staffing Needs). Keep the search itself
  // intact and offer a one-click jump to the tab containing the record.
  const searchStatusNotice = useMemo(() => {
    if (!sq || navContext === "library") return null;

    type Destination = { label: string; count: number; onClick: () => void };

    const projectSearchMatch = (p: Project) => {
      if (projectDivFilter !== "All" && p.division !== projectDivFilter) return false;
      if (projectBuFilter !== "All" && (p.bu || "").trim() !== projectBuFilter) return false;
      if (projectDeptFilter !== "All" && p.dept !== projectDeptFilter) return false;
      if (dateRange && !overlapsRange([p.rawTargetStart, p.rawTargetEnd, p.rawActualStart, p.rawActualEnd], dateRange)) return false;
      return p.name.toLowerCase().includes(sq)
        || idMatch(p.id)
        || (p.projectId && idMatch(p.projectId))
        || p.city.toLowerCase().includes(sq)
        || p.office.toLowerCase().includes(sq);
    };

    const oppSearchMatch = (o: Opportunity) => {
      if (stageFilter !== "All Stages" && o.stage !== stageFilter) return false;
      if (buFilter !== "All" && (o.bu || "").trim() !== buFilter) return false;
      if (oppSectorFilter !== "All" && o.sector !== oppSectorFilter) return false;
      if (oppDivFilter !== "All" && o.division !== oppDivFilter) return false;
      if (oppDeptFilter !== "All" && o.dept !== oppDeptFilter) return false;
      if (dateRange && !overlapsRange([o.rawBidDate, o.rawTargetStart, o.rawTargetEnd], dateRange)) return false;
      return o.name.toLowerCase().includes(sq)
        || idMatch(o.id)
        || (o.projectId && idMatch(o.projectId))
        || o.city.toLowerCase().includes(sq)
        || o.office.toLowerCase().includes(sq)
        || (!!o.stage && o.stage.toLowerCase().includes(sq));
    };

    const leadSearchMatch = (l: Lead) => {
      if (leadBuFilter !== "All" && (l.bu || "").trim() !== leadBuFilter) return false;
      if (leadDivFilter !== "All" && l.division !== leadDivFilter) return false;
      if (leadDeptFilter !== "All" && l.dept !== leadDeptFilter) return false;
      if (dateRange && !overlapsRange([l.rawCreated, l.rawDueDate, l.rawTargetStart, l.rawTargetEnd, l.rawClose], dateRange)) return false;
      // Deliberately ignore the granular lead-status filter here. If a user
      // searched for a lead and the current status filter hides it, the
      // Closed/Open destination should still be offered.
      return l.name.toLowerCase().includes(sq)
        || idMatch(l.id)
        || l.city.toLowerCase().includes(sq)
        || l.office.toLowerCase().includes(sq)
        || l.sector.toLowerCase().includes(sq);
    };

    if (view === "Projects" && filteredProjects.length === 0) {
      const matches = projects.filter(projectSearchMatch);
      const closed = matches.filter(p => p.closed);
      const open = matches.filter(p => !p.closed);
      let destination: Destination | null = null;
      if (filter === "All Open" && closed.length > 0) {
        destination = { label: "Closed", count: closed.length, onClick: () => setFilter("Closed") };
      } else if (filter === "Staffing Needs") {
        if (closed.length > 0) {
          destination = { label: "Closed", count: closed.length, onClick: () => setFilter("Closed") };
        } else if (open.length > 0) {
          destination = { label: "All", count: open.length, onClick: () => setFilter("All") };
        }
      } else if (filter === "Closed" && open.length > 0) {
        destination = { label: "All Open", count: open.length, onClick: () => setFilter("All Open") };
      }
      return destination ? { noun: "project" as const, ...destination } : null;
    }

    if (view === "Opportunities" && filteredOpps.length === 0) {
      const matches = opps.filter(oppSearchMatch);
      const closed = matches.filter(o => o.closed);
      const open = matches.filter(o => !o.closed);
      let destination: Destination | null = null;
      if (oppStatusFilter === "Open" && closed.length > 0) {
        destination = { label: "Closed", count: closed.length, onClick: () => setOppStatusFilter("Closed") };
      } else if (oppStatusFilter === "Closed" && open.length > 0) {
        destination = { label: "Open", count: open.length, onClick: () => setOppStatusFilter("Open") };
      }
      return destination ? { noun: "opportunity" as const, ...destination } : null;
    }

    if (view === "Leads" && filteredLeads.length === 0) {
      const matches = leads.filter(leadSearchMatch);
      const closed = matches.filter(l => l.closed);
      const open = matches.filter(l => !l.closed);
      let destination: Destination | null = null;
      if (lemFilter === "Open" && closed.length > 0) {
        destination = { label: "Closed", count: closed.length, onClick: () => setLemFilter("Closed") };
      } else if (lemFilter === "Closed" && open.length > 0) {
        destination = { label: "Open", count: open.length, onClick: () => setLemFilter("Open") };
      }
      return destination ? { noun: "lead" as const, ...destination } : null;
    }

    return null;
  }, [
    sq, navContext, view, filteredProjects.length, filteredOpps.length, filteredLeads.length,
    projects, opps, leads, filter, oppStatusFilter, lemFilter, projectDivFilter, projectBuFilter,
    projectDeptFilter, stageFilter, buFilter, oppSectorFilter, oppDivFilter, oppDeptFilter,
    leadBuFilter, leadDivFilter, leadDeptFilter, dateFilter, dateRange,
  ]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= activeListLength) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount(prev => {
            const next = prev + PAGE_SIZE;
            return next >= activeListLength ? activeListLength : next;
          });
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleCount, activeListLength]);

  const totalOppValue = useMemo(() => filteredOpps.reduce((s, o) => s + o.value, 0), [filteredOpps]);
  const activeOppValue = useMemo(() => opps.reduce((s, o) => s + (o.closed ? 0 : o.value), 0), [opps]);
  const closedOppValue = useMemo(() => opps.reduce((s, o) => s + (o.closed ? o.value : 0), 0), [opps]);
  const totalProjectValue = useMemo(() => filteredProjects.reduce((s, p) => s + p.value, 0), [filteredProjects]);
  const totalProjectStaffing = useMemo(() => {
    let reqs = 0;
    let fte = 0;
    for (const p of filteredProjects) {
      const s = projectStaffing[p.id];
      if (!s) continue;
      reqs += s.count;
      fte += s.fte;
    }
    return { reqs, fte: Math.round(fte * 10) / 10 };
  }, [filteredProjects, projectStaffing]);

  const isLoading = pmmQ.isLoading || opmQ.isLoading || lemQ.isLoading;

  // Largest value in each filtered dataset — drives the proportional
  // value bars rendered under currency cells in the data grids.
  const maxProjectValue = useMemo(() => filteredProjects.reduce((m, p) => Math.max(m, p.value || 0), 0), [filteredProjects]);
  const maxOppValue = useMemo(() => filteredOpps.reduce((m, o) => Math.max(m, o.value || 0), 0), [filteredOpps]);
  const maxLeadValue = useMemo(() => filteredLeads.reduce((m, l) => Math.max(m, l.value || 0), 0), [filteredLeads]);

  // Row the AI Analysis side panel is currently open for (grid views).
  const [aiGridTarget, setAiGridTarget] = useState<AiGridTarget | null>(null);

  function handoffToChat(prompt: string) {
    setChatPrompt(prompt, { newSession: true, autoSend: true });
    navigate("/chat");
  }

  // Per-tab ticker. 3 bite-sized items: portfolio health, top concern,
  // next action. Each item navigates to the matching detail when clicked.
  const tickerItems: InfoTickerItem[] = useMemo(() => {
    const items: InfoTickerItem[] = [];
    const fmtMoney = (n: number) => fmtM(n);

    if (view === "Projects") {
      const open = filteredProjects.filter(p => !p.closed);
      const noSched = open.filter(p => !p.hasSchedule);
      items.push({
        label: "Portfolio",
        value: `${open.length} active · ${noSched.length} no schedule`,
        tone: noSched.length > 0 ? "warn" : "good",
        detail: {
          title: "Active portfolio snapshot",
          body: [
            `${open.length} open project${open.length === 1 ? "" : "s"} in PMM right now.`,
            `${noSched.length} project${noSched.length === 1 ? " is" : "s are"} missing a schedule and need attention first.`,
            `${open.length - noSched.length} project${open.length - noSched.length === 1 ? " has" : "s have"} a baselined schedule on file.`,
          ],
        },
      });
      const stuck = [...open]
        .filter(p => (p.daysInPhase ?? 0) > 0)
        .sort((a, b) => (b.daysInPhase ?? 0) - (a.daysInPhase ?? 0))[0];
      if (stuck) {
        items.push({
          label: "Most stuck",
          value: `${stuck.name} · ${stuck.daysInPhase}d in ${stuck.phase}`,
          tone: (stuck.daysInPhase ?? 0) > 60 ? "bad" : "warn",
          detail: {
            title: stuck.name,
            body: [
              `Sitting in "${stuck.phase}" for ${stuck.daysInPhase} day${stuck.daysInPhase === 1 ? "" : "s"}.`,
              `Status: ${stuck.status}${stuck.city ? ` · ${stuck.city}` : ""}.`,
              stuck.value > 0 ? `Contract value: ${fmtMoney(stuck.value)}.` : `No contract value on file.`,
            ],
            openLabel: "Open project",
            onOpen: () => navigate(`/project/${stuck.id}`),
          },
        });
      } else {
        const largest = [...open].sort((a, b) => b.value - a.value)[0];
        if (largest && largest.value > 0) {
          items.push({
            label: "Largest active",
            value: `${largest.name} · ${fmtMoney(largest.value)}`,
            tone: "info",
            detail: {
              title: largest.name,
              body: [
                `Contract value: ${fmtMoney(largest.value)}.`,
                `Phase: ${largest.phase}${largest.city ? ` · ${largest.city}` : ""}.`,
                `Status: ${largest.status}.`,
              ],
              openLabel: "Open project",
              onOpen: () => navigate(`/project/${largest.id}`),
            },
          });
        }
      }
      const firstNoSched = noSched[0];
      if (firstNoSched) {
        items.push({
          label: "Next action",
          value: `Set schedule on ${firstNoSched.name}`,
          tone: "warn",
          detail: {
            title: `Schedule needed: ${firstNoSched.name}`,
            body: [
              `Phase: ${firstNoSched.phase}${firstNoSched.city ? ` · ${firstNoSched.city}` : ""}.`,
              `Project has no baselined target dates yet.`,
              noSched.length > 1 ? `${noSched.length - 1} other project${noSched.length - 1 === 1 ? "" : "s"} also need a schedule.` : `This is the only project missing a schedule.`,
            ],
            openLabel: "Open project",
            onOpen: () => navigate(`/project/${firstNoSched.id}`),
          },
        });
      }
    } else if (view === "Opportunities") {
      const openOpps = filteredOpps.filter(o => !o.closed);
      const weighted = openOpps.reduce((s, o) => s + (o.weightedValue || 0), 0);
      const totalValue = openOpps.reduce((s, o) => s + (o.value || 0), 0);
      items.push({
        label: "Pipeline",
        value: `${fmtMoney(weighted)} weighted · ${openOpps.length} open`,
        tone: openOpps.length === 0 ? "info" : "good",
        detail: {
          title: "Open pipeline",
          body: [
            `${openOpps.length} active opportunit${openOpps.length === 1 ? "y" : "ies"} in OPM.`,
            `Total contract value: ${fmtMoney(totalValue)}.`,
            `Probability-weighted: ${fmtMoney(weighted)}.`,
          ],
        },
      });
      const closingSoon = [...openOpps]
        .filter(o => o.daysLeft >= 0 && o.daysLeft < 999)
        .sort((a, b) => a.daysLeft - b.daysLeft)[0];
      if (closingSoon) {
        items.push({
          label: "Closing soon",
          value: `${closingSoon.name} · ${closingSoon.daysLeft}d · ${Math.round(closingSoon.probability)}%`,
          tone: closingSoon.daysLeft <= 7 ? "bad" : closingSoon.daysLeft <= 21 ? "warn" : "info",
          detail: {
            title: closingSoon.name,
            body: [
              `Closes in ${closingSoon.daysLeft} day${closingSoon.daysLeft === 1 ? "" : "s"}.`,
              `Win probability: ${Math.round(closingSoon.probability)}% · stage: ${closingSoon.stage}.`,
              `Value: ${fmtMoney(closingSoon.value)} (weighted ${fmtMoney(closingSoon.weightedValue)})${closingSoon.city ? ` · ${closingSoon.city}` : ""}.`,
            ],
            openLabel: "Open opportunity",
            onOpen: () => navigate(`/project/${closingSoon.id}`),
          },
        });
      }
      const dueThisWeek = openOpps.filter(o => o.daysLeft >= 0 && o.daysLeft <= 7);
      if (dueThisWeek.length > 0) {
        items.push({
          label: "Next action",
          value: `${dueThisWeek.length} opp${dueThisWeek.length === 1 ? "" : "s"} closing this week`,
          tone: "warn",
          detail: {
            title: "Closing this week",
            body: [
              `${dueThisWeek.length} opportunit${dueThisWeek.length === 1 ? "y" : "ies"} due within 7 days.`,
              `Combined weighted value: ${fmtMoney(dueThisWeek.reduce((s, o) => s + (o.weightedValue || 0), 0))}.`,
              `Top one: ${dueThisWeek[0].name} (${dueThisWeek[0].daysLeft}d).`,
            ],
            openLabel: "Open top opp",
            onOpen: () => navigate(`/project/${dueThisWeek[0].id}`),
          },
        });
      }
    } else if (view === "Leads") {
      const open = filteredLeads.filter(l => !l.closed);
      items.push({
        label: "Leads",
        value: `${open.length} open · ${filteredLeads.length} total`,
        tone: open.length > 0 ? "good" : "info",
        detail: {
          title: "Lead pipeline",
          body: [
            `${open.length} open lead${open.length === 1 ? "" : "s"} in LEM.`,
            `${filteredLeads.length} total lead${filteredLeads.length === 1 ? "" : "s"} on file (open + closed).`,
          ],
        },
      });
      const top = open[0];
      if (top) {
        items.push({
          label: "Top by value",
          value: `${top.name} · ${fmtMoney(top.value)}`,
          tone: "info",
          detail: {
            title: top.name,
            body: [
              `Estimated value: ${fmtMoney(top.value)}.`,
              `Status: ${top.status}${top.city ? ` · ${top.city}` : ""}.`,
              top.sector && top.sector !== "—" ? `Sector: ${top.sector}.` : `Sector not classified yet.`,
            ],
            openLabel: "Open lead",
            onOpen: () => navigate(`/project/${top.id}`),
          },
        });
      }
      const unowned = open.filter(l => !l.assignedUserGuids);
      if (unowned.length > 0) {
        items.push({
          label: "Next action",
          value: `Qualify ${unowned.length} unowned lead${unowned.length === 1 ? "" : "s"}`,
          tone: "warn",
          detail: {
            title: "Unowned leads",
            body: [
              `${unowned.length} open lead${unowned.length === 1 ? " has" : "s have"} no assigned owner.`,
              `Top unowned: ${unowned[0].name}${unowned[0].value > 0 ? ` (${fmtMoney(unowned[0].value)})` : ""}.`,
            ],
            openLabel: "Open top unowned",
            onOpen: () => navigate(`/project/${unowned[0].id}`),
          },
        });
      }
    } else if (view === "Companies") {
      const src: { client: string; value: number }[] = [...filteredProjects, ...filteredOpps, ...filteredLeads];
      const clients = [...new Set(src.map(x => x.client).filter(Boolean))];
      items.push({
        label: "Clients",
        value: `${clients.length} client${clients.length !== 1 ? "s" : ""}`,
        tone: "info",
        detail: { title: "By Client view", body: [`${src.length} record${src.length !== 1 ? "s" : ""} across ${clients.length} client${clients.length !== 1 ? "s" : ""}.`] },
      });
      const totalVal = src.reduce((s, x) => s + (x.value || 0), 0);
      if (totalVal > 0) {
        items.push({
          label: "Dollar Volume",
          value: fmtM(totalVal),
          tone: "good",
          detail: { title: "Total dollar volume", body: [`Combined value across all clients: ${fmtM(totalVal)}.`] },
        });
      }
    }
    return items;
  }, [view, filteredProjects, filteredOpps, filteredLeads, filteredCompanies, navigate]);

  // Companies view: unified lifecycle dataset (memoized so items/groups keep a
  // stable identity across the frequent re-renders of this large component —
  // ClientGroupGrid's popup effect and CompanyDataGridSection's memos depend on it).
  const companyLifecycleItems = useMemo<ClientGroupItem[]>(() => [
    ...filteredLeads.map(l => ({
      id: l.id, name: l.name, value: l.value, status: l.status, closed: l.closed, client: l.client,
      lifecycle: (l.closed ? "Closed" : "Lead") as CompanyLifecycle,
    })),
    ...filteredOpps.map(o => ({
      id: o.id, name: o.name, value: o.value, status: o.stage, closed: o.closed, client: o.client,
      lifecycle: oppLifecycle(o.stage, o.closed),
    })),
    ...filteredProjects.map(p => ({
      id: p.id, name: p.name, value: p.value, status: p.status, closed: p.closed, client: p.client,
      // Pipeline-designated projects (committed, no contract yet) count in the
      // Pipeline column alongside active-bid opportunities — they only move to
      // the Projects column once contracted (status → Active).
      lifecycle: (p.closed ? "Closed" : p.status === "Pipeline" ? "Pipeline" : "Project") as CompanyLifecycle,
    })),
  ], [filteredLeads, filteredOpps, filteredProjects]);
  // Companies view: stamp each derived name-group with its REAL company row's
  // COM-… id (matched by normalized name), and append zero-record groups for
  // companies that exist in CRMCompany but have no linked records yet — a
  // company created via "New Company" must be visible immediately, not only
  // once a project references it.
  const companyGroups = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[(),"']/g, " ").replace(/\s+/g, " ").trim();
    const groups = buildClientGroups(companyLifecycleItems);
    const byName = new Map<string, { ticketId: string; title: string; fields: CompanyExtraFields }>();
    const s = (v: unknown) => { const t = String(v ?? "").trim(); return t || undefined; };
    for (const r of ((comQ.data?.data ?? []) as Record<string, unknown>[])) {
      const title = String(r.Title ?? "").trim();
      if (!title) continue;
      const k = norm(title);
      if (!byName.has(k)) byName.set(k, {
        ticketId: String(r.TicketId ?? "").trim(), title,
        fields: {
          shortName: s(r.ShortName), relationshipType: s(r.RelationshipType),
          businessType: s(r.BusinessType), secondaryBusinessType: s(r.SecondaryBusinessType),
          phone: s(r.Phone), fax: s(r.Fax), email: s(r.EmailAddress), website: s(r.WebsiteUrl),
          address: s(r.Address), city: s(r.City), state: s(r.State), zip: s(r.Zip),
          assignedTo: s(r.AssignedTo), description: s(r.Description),
        },
      });
    }
    const seen = new Set<string>();
    // In the Companies view the search is by company name / ID, not record
    // name — apply sq here so both record-bearing and zero-record groups are
    // filtered the same way. The sq filter on filteredProjects/Opps/Leads only
    // checks record name, so without this the Companies grid ignores the search
    // entirely for zero-record entries (and filters record groups by the wrong
    // field).
    const matchesSq = (title: string, ticketId?: string) => {
      if (!sq) return true;
      if (title.toLowerCase().includes(sq)) return true;
      if (ticketId && ticketId.toLowerCase().includes(sq)) return true;
      return false;
    };
    const out = groups
      .map(g => {
        const co = byName.get(norm(g.client));
        if (co) seen.add(norm(g.client));
        return co ? { ...g, ticketId: co.ticketId || undefined, co: co.fields } : g;
      })
      .filter(g => matchesSq(g.client, g.ticketId));
    for (const [k, co] of byName) {
      if (seen.has(k)) continue;
      if (!matchesSq(co.title, co.ticketId)) continue;
      out.push({
        client: co.title, color: clientColor(co.title), initials: clientInitials(co.title),
        count: 0, totalValue: 0, leads: 0, opps: 0, pipeline: 0, projects: 0, closed: 0,
        ticketId: co.ticketId || undefined,
        co: co.fields,
      });
    }
    return out;
  }, [companyLifecycleItems, comQ.data, sq]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    bustCache();
    await Promise.allSettled([pmmQ.refetch(), opmQ.refetch(), lemQ.refetch()]);
    setRefreshing(false);
  }

  async function handleCardMenu(type: "pmm" | "opm" | "lem", record: Project | Opportunity | Lead, action: string) {
    if (action === "notes") {
      setNotesPending({ record, type });
    } else if (action === "compare") {
      const already = compareList.find(c => c.id === record.id);
      if (already) {
        setCompareList(prev => prev.filter(c => c.id !== record.id));
        return;
      }
      if (compareList.length >= 2) {
        toast({ title: "Already comparing 2 items", description: "Clear the compare bar first." });
        return;
      }
      if (compareList.length === 1 && compareList[0].type !== type) {
        toast({ title: "Compare same type", description: "Mix projects with projects, opportunities with opportunities, or leads with leads.", variant: "destructive" });
        return;
      }
      const next = [...compareList, { id: record.id, type, data: record }];
      setCompareList(next);
      if (next.length === 2) setShowCompare(true);
      else toast({ title: "Pick one more to compare", description: `"${record.name}" selected. Choose another ${type === "pmm" ? "project" : type === "lem" ? "lead" : "opportunity"}.` });
    } else if (action === "change-status") {
      setStatusPending({ record, type });
      return;
    } else if (action === "hold") {
      setHoldPending({ record, type });
      return;
    } else if (action === "unhold") {
      try {
        const field = type === "pmm" ? "CRMProjectStatusChoice"
          : type === "opm" ? "CRMOpportunityStatusChoice" : "LeadStatus";
        await updateFields(record.id, [{ FieldName: field, Value: "Active" }]);
        // The record page must see this write on its next open — arm its
        // one-shot fresh read (list-page writes otherwise leave its detail
        // cache stale).
        markProjectDetailRefetchFresh(record.id);
        bustCache("module:");
        clearHoldInfoLS(record.id);
        setHoldInfoMap(prev => { const n = { ...prev }; delete n[record.id]; return n; });
        toast({ title: "Hold Removed", description: `"${record.name}" is now active.` });
        if (type === "pmm") void pmmQ.refetch();
        else if (type === "lem") void lemQ.refetch();
        else void opmQ.refetch();
      } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
    } else if (action === "delete-record") {
      const noun = type === "pmm" ? "project" : type === "lem" ? "lead" : "opportunity";
      if (!window.confirm(
        `Delete ${noun} "${record.name}" (${record.id})?\n\nThis removes the record plus its team assignments and schedule for this company. This cannot be undone.`
      )) return;
      try {
        await apiDeleteRecord(record.id, type === "pmm" ? "PMM" : type === "opm" ? "OPM" : "LEM");
        toast({ title: "Record Deleted", description: `"${record.name}" (${record.id}) was removed.` });
        if (type === "pmm") void pmmQ.refetch();
        else if (type === "lem") void lemQ.refetch();
        else void opmQ.refetch();
      } catch (e: any) {
        toast({ title: "Delete Failed", description: e?.message || "Could not delete the record.", variant: "destructive" });
      }
    } else if (action === "source-type") {
      setSourceTypePending({ record: record as Opportunity | Lead, type: type === "lem" ? "lem" : "opm" });
    } else if (action === "open-position" && type !== "lem") {
      setOpenPosPending({ record: record as Project | Opportunity, type });
    } else if (action === "team" && type !== "lem") {
      try {
        // The grid does not have a TeamModal's already-loaded snapshot. Read
        // the team fresh before opening the add flow so its duplicate guard
        // cannot be bypassed by a stale or empty list.
        const team = await getProjectTeam(record.id, true);
        setTeamPending({
          record: record as Project | Opportunity,
          type,
          existingAllocations: quickExistingAllocations(team.team),
        });
      } catch (e: any) {
        toast({
          title: "Couldn't load team",
          description: e?.message || "The team could not be verified. Please try again.",
          variant: "destructive",
        });
      }
    } else if (action === "leads") {
      setTeamPending({ record, type: "lem", existingAllocations: [] });
    }
  }

  // Grid header→server-field maps BOUND to the upload they were submitted
  // with (uploadId → mappings). runBulkImport — including the preflight
  // dialog's delayed "Import anyway" — must read the mappings of THAT
  // upload, never a mutable "latest submission" value that a second attempt
  // could overwrite while the dialog is open.
  const bulkGridMappingsByUpload = useRef(new Map<string, Record<string, Record<string, string>>>());

  async function handleBulkSubmit(file: File, mode: string, gridMappings?: Record<string, Record<string, string>>) {
    const gm = gridMappings && Object.keys(gridMappings).length > 0 ? gridMappings : null;
    const tenantId = getStoredUser()?.tenant;
    if (!tenantId) { toast({ title: "Not logged in", variant: "destructive" }); return; }
    setBulkSubmitting(true);
    try {
      const cardId = view === "Projects" ? "projects" : "opportunities";
      const recordType = view === "Projects" ? "Project" : "Opportunity";
      // Size-safe upload: files past the production edge's ~32MB per-request
      // cap are sent in pieces and reassembled server-side.
      const upRes = await uploadFileSmart({
        url: "/api/onboarding/upload",
        file,
        extra: { tenantId, forcedTabType: "clients", forcedRecordType: recordType },
        headers: authHeaders() as Record<string, string>,
      });
      const upData = await upRes.json() as any;
      if (!upRes.ok) throw new Error(upData.error ?? "Upload failed");
      // Bind this submission's mappings to its upload — resume paths look
      // them up by uploadId, never by "whatever was submitted last".
      if (upData?.uploadId && gm) bulkGridMappingsByUpload.current.set(String(upData.uploadId), gm);
      // Merge-only imports: an existing tenant always runs "update" (add new +
      // update matched, never remove); only a fresh tenant runs "create".
      const effectiveMode = upData.existingClient ? "update" : "create";
      // Preflight: match the file's values against the live schema BEFORE
      // starting the import, so type mismatches and missing end dates show
      // now instead of as after-import notices. A preflight infra failure
      // must never block the import.
      let pf: any = null;
      try {
        const pfRes = await fetch("/api/onboarding/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          // Preflight mirrors /run: send the grid's header→field map so its
          // checks see the same columns the import will actually use.
          body: JSON.stringify({
            uploadId: upData.uploadId,
            // Effective mode lets the server run its update-mode schedule
            // ID checks at review time (task #420).
            importMode: effectiveMode,
            ...(gm ? { columnMappings: gm } : {}),
          }),
        });
        if (pfRes.ok) pf = await pfRes.json();
      } catch { /* preflight is advisory only */ }
      if (pf && Array.isArray(pf.issues) && pf.issues.length > 0) {
        setBulkPreflight({ issues: pf.issues, uploadId: upData.uploadId, mode: effectiveMode });
        return; // the dialog's buttons decide what happens next
      }
      await runBulkImport(upData.uploadId, effectiveMode);
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkSubmitting(false);
    }
  }

  // Runs the import (run + poll to completion + cache refresh) for an
  // already-uploaded file. Split out of handleBulkSubmit so the preflight
  // dialog's "Import anyway" can resume from here. Throws on failure —
  // callers surface the error via toast.
  async function runBulkImport(uploadId: string, effectiveMode: string) {
    // The mappings bound to THIS upload at submit time (null for uploads
    // that didn't come with grid mappings).
    const gm = bulkGridMappingsByUpload.current.get(uploadId) ?? null;
    const runRes = await fetch("/api/onboarding/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        uploadId,
        // The grid's own header→server-field map (when this run came from the
        // grid). mappingsSource:"grid" = apply them, but never save them as
        // the client's recurring-upload template or learned synonyms.
        columnMappings: gm ?? {},
        ...(gm ? {
          mappingsSource: "grid",
          tabTypeOverrides: buildTabTypeOverrides(gm),
        } : {}),
        importMode: effectiveMode,
      }),
    });
    const runData = await runRes.json() as any;
    if (!runRes.ok) throw new Error(runData.error ?? "Import failed");
    // /run returns as soon as the import starts — the pipeline continues in
    // the background. Poll the job status until it reaches a terminal state
    // so the success message (and cache refresh) only appear once the rows
    // are actually in the database.
    const started = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      if (Date.now() - started > 10 * 60 * 1000) throw new Error("Import is taking longer than expected — check Upload History for the result.");
      let st: any = null;
      try {
        const stRes = await fetch(`/api/onboarding/status/${uploadId}`, { headers: authHeaders() });
        if (stRes.ok) st = await stRes.json();
      } catch { /* transient poll failure — keep waiting */ }
      if (!st) continue;
      if (st.status === "failed" || st.status === "cancelled") {
        throw new Error(st.fatalError ?? st.failureReason ?? "Import failed");
      }
      if (st.status === "success" || st.status === "partial") break;
    }
    // The list queries read through the module-level cache (getModuleRecords
    // → cached("module:…")), so invalidating React Query alone would refetch
    // the same stale 5-min cache entry. Bust the underlying cache first so
    // the refetch actually hits the server and shows the imported rows.
    bustCache("module:");
    bustCache("project:");
    bustCache("projects:");
    void qcMain.invalidateQueries({ queryKey: ["pmm"] });
    void qcMain.invalidateQueries({ queryKey: ["opm"] });
    void qcMain.invalidateQueries({ queryKey: ["lem"] });
    setShowInlineGrid(false);
    const sLabel = view === "Projects" ? "Projects" : view === "Opportunities" ? "Opportunities" : "Leads";
    const sPath  = view === "Projects" ? "/projects" : view === "Opportunities" ? "/projects?view=Opportunities" : "/projects?view=Leads";
    setUploadSuccess({ label: sLabel, path: sPath });
  }

  // Self-contained org filter button: button + dropdown anchored directly below it.
  const orgFilterButton = (
    key: string, dimLabel: string, allLabel: string,
    value: string, setValue: (v: string) => void,
    options: OrgFilterOption[] | string[],
  ) => {
    const opts: OrgFilterOption[] = options.map((o) => (typeof o === "string" ? { value: o, label: o, sub: "" } : o));
    const open = openOrgMenu === key;
    return (
      <div key={key} style={{ position: "relative" }}>
        <button
          onClick={() => { setOpenOrgMenu(m => (m === key ? null : key)); setShowStageDropdown(false); setShowOppSectorDropdown(false); setShowDateDropdown(false); }}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
            borderRadius: 10, backgroundColor: BRAND.card,
            border: `1px solid ${value !== "All" ? BRAND.green : BRAND.cardBorder}`,
            color: value !== "All" ? BRAND.green : BRAND.textSecondary,
            fontSize: 12, fontWeight: 600, cursor: "pointer", maxWidth: 130,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          <Briefcase size={12} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value !== "All" ? value : dimLabel}</span>
          <ChevronDown size={10} />
        </button>
        {open && (
          <>
            <div onClick={() => setOpenOrgMenu(null)} style={{ position: "fixed", inset: 0, backgroundColor: "transparent", zIndex: 25 }} />
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30,
              backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`, borderRadius: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)", maxHeight: 360, overflowY: "auto", minWidth: 240,
            }}>
              <button onClick={() => { setValue("All"); setOpenOrgMenu(null); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "9px 14px", background: "transparent", border: "none",
                  color: value === "All" ? BRAND.green : BRAND.textSecondary, fontSize: 13, cursor: "pointer", textAlign: "left",
                }}>
                <span>{allLabel}</span>
                {value === "All" && <Check size={14} />}
              </button>
              <div style={{ height: 1, background: BRAND.cardBorder, margin: "0 14px 4px" }} />
              {opts.map((opt) => (
                <button key={opt.value} onClick={() => { setValue(value === opt.value ? "All" : opt.value); setOpenOrgMenu(null); }}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start",
                    width: "100%", padding: "8px 14px", background: "transparent", border: "none",
                    color: value === opt.value ? BRAND.orange : BRAND.white, fontSize: 13, cursor: "pointer", textAlign: "left",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <span>{opt.label}</span>
                    {value === opt.value && <Check size={14} />}
                  </div>
                  {opt.sub && (
                    <span style={{ fontSize: 10, color: BRAND.textSecondary, marginTop: 1 }}>{opt.sub}</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  if (showInlineGrid) {
    // Strict identity keys (Aug 2026): bulk-create on a tenant that ALREADY
    // has data runs as merge ("update") server-side, where matching is by
    // ID/email only and ONE name-only row blocks the whole upload AFTER it's
    // sent. Flag those rows in the grid's review step first so the user
    // fixes or knowingly confirms them before submitting. Only a tenant
    // that PROVABLY has no records anywhere stays tolerant (nothing to
    // mis-match against); while the counts are still loading — or any query
    // failed — we can't prove that, so err toward the strict pre-check
    // (worst case: an unnecessary but honest review pass).
    const bulkCount = (q: { data?: any; isLoading: boolean; isError: boolean }): number | null =>
      q.isLoading || q.isError ? null : (q.data?.data?.length ?? 0);
    const bulkCounts = [pmmQ, opmQ, lemQ, comQ].map(bulkCount);
    const bulkTenantHasData = bulkCounts.some(c => c === null || c > 0);
    return (
      <>
        <InlineDataGrid
          cardId={view === "Projects" ? "projects" : "opportunities"}
          cardLabel={view === "Projects" ? "Projects" : "Opportunities"}
          multiTab={true}
          isSubmitting={bulkSubmitting}
          strictKeys={bulkTenantHasData}
          clientHasData={bulkTenantHasData}
          onClose={() => setShowInlineGrid(false)}
          onSubmit={handleBulkSubmit}
        />
        {bulkPreflight && (
          <PreflightIssuesDialog
            issues={bulkPreflight.issues}
            busy={bulkSubmitting}
            onCancel={() => {
              const p = bulkPreflight;
              setBulkPreflight(null);
              // The upload already created a pending job server-side — cancel
              // it so it never lingers as an "active import" (fire-and-forget).
              if (p?.uploadId) {
                fetch(`/api/onboarding/cancel/${p.uploadId}`, { method: "POST", headers: authHeaders() }).catch(() => {});
              }
            }}
            onContinue={async () => {
              const p = bulkPreflight;
              setBulkPreflight(null);
              setBulkSubmitting(true);
              try { await runBulkImport(p.uploadId, p.mode); }
              catch (e: any) { toast({ title: "Import failed", description: e.message, variant: "destructive" }); }
              finally { setBulkSubmitting(false); }
            }}
          />
        )}
      </>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: BRAND.bg, color: BRAND.white }}>
      {/* Header */}
      {/* AvatarMenu now lives only on Home, so the header can hug the right
          edge — no need to reserve space for a floating profile circle. */}
      <div style={{ backgroundColor: BRAND.bgDeep, padding: "12px 24px 10px 24px",
        position: "relative" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          {navContext === "library" && (
            <button
              onClick={() => {
                // The Archive is usually reached right after closing or
                // archiving a record from another list — Back returns there.
                // Direct visits (fresh tab, no history) fall back to Leads.
                if (window.history.length > 1) window.history.back();
                else navigate("/projects?view=Leads");
              }}
              title="Go back"
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
                alignSelf: "center", backgroundColor: BRAND.card, borderRadius: 10,
                border: `1px solid ${BRAND.cardBorder}`, color: BRAND.textSecondary,
                cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            {navContext === "projects" ? "Projects"
              : navContext === "crm" ? "CRM"
              : navContext === "library" ? "Archive"
              : "Leads & Opps"}
          </h1>
          <div style={{ fontSize: 12, color: BRAND.textSecondary }}>
            {navContext === "library" && archUsersTab ? "Archived users · deleted accounts — restore returns them to Manage Staff"
              : isLoading ? "Loading live data…"
              : view === "Projects" ? <><strong style={{ color: BRAND.white }}>{filteredProjects.length}</strong>{` projects · PMM${filter !== "All" ? ` · ${filter}` : ""}${projectBuFilter !== "All" ? ` · ${projectBuFilter}` : ""}${projectDivFilter !== "All" ? ` · ${projectDivFilter}` : ""}${projectDeptFilter !== "All" ? ` · ${projectDeptFilter}` : ""}${dateLabel ? ` · ${dateLabel}` : ""}`}</>
              : view === "Opportunities" ? <><strong style={{ color: BRAND.white }}>{filteredOpps.length}</strong>{` opportunities · OPM · ${oppStatusFilter}${stageFilter !== "All Stages" ? ` · ${stageFilter}` : ""}${buFilter !== "All" ? ` · ${buFilter}` : ""}${oppDivFilter !== "All" ? ` · ${oppDivFilter}` : ""}${oppSectorFilter !== "All" ? ` · ${oppSectorFilter}` : ""}${oppDeptFilter !== "All" ? ` · ${oppDeptFilter}` : ""}${dateLabel ? ` · ${dateLabel}` : ""}`}</>
              : view === "Leads" ? <><strong style={{ color: BRAND.white }}>{filteredLeads.length}</strong>{` leads · LEM${lemFilter !== "All Leads" ? ` · ${lemFilter}` : ""}${leadBuFilter !== "All" ? ` · ${leadBuFilter}` : ""}${leadDivFilter !== "All" ? ` · ${leadDivFilter}` : ""}${leadDeptFilter !== "All" ? ` · ${leadDeptFilter}` : ""}${leadStatusFilter !== "All" ? ` · ${leadStatusFilter}` : ""}${dateLabel ? ` · ${dateLabel}` : ""}`}</>
              : <><strong style={{ color: BRAND.white }}>{filteredProjects.length + filteredOpps.length + filteredLeads.length}</strong>{" records · by client"}</>}
          </div>
        </div>
        {/* Per-tab live ticker — inline second row, replaces extra
            standalone band so the header stays compact. */}
        <div style={{ marginTop: 6 }}>
          <InfoTicker items={tickerItems} compact />
        </div>
        <div style={{ position: "absolute", top: 8, right: 12, display: "flex", alignItems: "center", gap: 10 }}>
          {(view === "Projects" || view === "Opportunities" || view === "Leads") &&
           navContext !== "library" &&
           canEditData && (
            <button
              onClick={() => {
                if (view === "Projects") navigate("/project/create");
                else if (view === "Opportunities") navigate("/opportunity/create");
                else navigate("/lead/create");
              }}
              title={view === "Projects" ? "Create a new project" : view === "Opportunities" ? "Create a new opportunity" : "Add a new lead"}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                backgroundColor: BRAND.greenBg, borderRadius: 10, border: `1px solid ${BRAND.greenBg}`,
                color: BRAND.white, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}
            >
              <Plus size={14} />
              {view === "Projects" ? "New Project" : view === "Opportunities" ? "New Opportunity" : "New Lead"}
            </button>
          )}
          {navContext === "crm" && crmSubTab === "companies" && (
            <>
              <button onClick={() => setNewCompanyOpen(true)}
                title="Create a company with its own Company ID"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                  backgroundColor: BRAND.greenBg, borderRadius: 10, border: `1px solid ${BRAND.greenBg}`,
                  color: BRAND.white, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                <Plus size={14} /> New Company
              </button>
              <CompanyCreateModal
                open={newCompanyOpen}
                onOpenChange={setNewCompanyOpen}
                onCreated={() => { bustCache("module:COM"); void comQ.refetch(); }}
              />
            </>
          )}
          <button
            disabled
            title="Map view (coming soon)"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
              backgroundColor: BRAND.card, borderRadius: 10, border: `1px solid ${BRAND.cardBorder}`,
              color: BRAND.textMuted, cursor: "not-allowed" }}
          >
            <MapIcon size={14} />
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
              backgroundColor: BRAND.card, borderRadius: 10, border: `1px solid ${BRAND.cardBorder}`,
              color: BRAND.white, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.7 : 1 }}
          >
            <RefreshCw size={14} style={{ animation: refreshing ? "spin 0.8s linear infinite" : undefined }} />
          </button>
        </div>
      </div>
      <div style={{ height: 1, backgroundColor: BRAND.cardBorder, margin: "0 24px" }} />

      {/* Import processing banner */}
      {importStatus === "running" && (
        <div style={{
          margin: "10px 24px 0",
          borderRadius: 12,
          padding: "14px 18px",
          background: "linear-gradient(135deg, rgba(169,194,63,0.12) 0%, rgba(169,194,63,0.05) 100%)",
          border: "1px solid rgba(169,194,63,0.30)",
          display: "flex", flexDirection: "column", gap: 10,
          boxShadow: "0 2px 12px rgba(169,194,63,0.08)",
        }}>
          <style>{`
            @keyframes rm-pulse-dot {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.4; transform: scale(0.7); }
            }
            @keyframes rm-shimmer {
              0% { background-position: -200% center; }
              100% { background-position: 200% center; }
            }
          `}</style>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {/* Animated pulse dot */}
              <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                <div style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  backgroundColor: BRAND.greenBg, opacity: 0.3,
                  animation: "rm-pulse-dot 1.4s ease-in-out infinite",
                  transform: "scale(2)",
                }} />
                <div style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  backgroundColor: BRAND.greenBg,
                }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, color: BRAND.white, fontWeight: 700 }}>
                  Importing your data…
                </span>
                <span style={{ fontSize: 12, color: BRAND.textSecondary, marginLeft: 8 }}>
                  Projects and records will appear here once the import finishes
                </span>
              </div>
            </div>
            <span style={{
              fontSize: 13, fontWeight: 700, flexShrink: 0,
              color: BRAND.greenBg,
              minWidth: 42, textAlign: "right",
            }}>
              {isNaN(importProgress) ? "…" : `${Math.round(importProgress)}%`}
            </span>
          </div>
          {/* Shimmer progress bar */}
          <div style={{ height: 6, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              borderRadius: 6,
              width: `${isNaN(importProgress) ? 5 : importProgress}%`,
              transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
              background: `linear-gradient(90deg, ${BRAND.greenBg}aa, ${BRAND.greenBg}, #d4e84f, ${BRAND.greenBg}aa)`,
              backgroundSize: "200% 100%",
              animation: "rm-shimmer 1.8s linear infinite",
            }} />
          </div>
        </div>
      )}

      {/* Tab segments — shown tabs depend on which sidebar item opened this page.
          The projects context has no meaningful tabs (only one view), so the
          whole bar is hidden — the view-mode toggle moves into the filter row. */}
      <div style={{ display: navContext === "projects" ? "none" : "flex", gap: 6, padding: "10px 24px", alignItems: "center" }}>
        {navContext === "crm" && (
          [
            { v: "companies" as CrmSubTab, label: "Companies", Icon: Users },
            { v: "contacts" as CrmSubTab,  label: "Contacts",  Icon: User },
          ].map(({ v, label, Icon }) => {
            const active = crmSubTab === v;
            return (
              <button key={v} onClick={() => { setCrmSubTab(v); setSearch(""); }}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 999,
                  backgroundColor: active ? BRAND.greenBg : BRAND.card,
                  color: active ? BRAND.white : BRAND.textSecondary,
                  border: `1px solid ${active ? BRAND.greenBg : BRAND.cardBorder}`,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                <Icon size={12} />{label}
              </button>
            );
          })
        )}
        {navContext === "leads-opps" && (
          ([
            { v: "Leads" as const,         label: "Leads", Icon: Star },
            { v: "Opportunities" as const, label: "Opps",  Icon: TrendingUp },
          ] as const).map(({ v, label, Icon }) => {
            const active = view === v;
            return (
              <button key={v} onClick={() => { setView(v); setSearch(""); setBuFilter("All"); setByClient(false); }}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 999,
                  backgroundColor: active ? BRAND.greenBg : BRAND.card,
                  color: active ? BRAND.white : BRAND.textSecondary,
                  border: `1px solid ${active ? BRAND.greenBg : BRAND.cardBorder}`,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                <Icon size={12} />{label}
              </button>
            );
          })
        )}
        {navContext === "projects" && (
          ([{ v: "Projects" as const, label: "Projects", Icon: Layers }] as const).map(({ v, label, Icon }) => {
            const active = view === v;
            return (
              <button key={v} onClick={() => { setView(v); setSearch(""); setBuFilter("All"); setByClient(false); }}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 999,
                  backgroundColor: active ? BRAND.greenBg : BRAND.card,
                  color: active ? BRAND.white : BRAND.textSecondary,
                  border: `1px solid ${active ? BRAND.greenBg : BRAND.cardBorder}`,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                <Icon size={12} />{label}
              </button>
            );
          })
        )}
        {navContext === "library" && (
          ([
            { v: "Projects" as const,      label: "Closed Projects", Icon: Layers },
            { v: "Opportunities" as const, label: "Closed Opps",     Icon: TrendingUp },
            { v: "Leads" as const,         label: "Closed Leads",    Icon: Archive },
          ] as const).map(({ v, label, Icon }) => {
            const active = view === v && !archUsersTab;
            return (
              // leadStatusFilter stays "All" so the Closed Leads tab shows
              // EVERY closed lead (Lost / Cancelled / Archived / Converted…) —
              // the Archive's lemFilter="Closed" pin already scopes the list.
              <button key={v} onClick={() => { setArchUsersTab(false); setView(v); setSearch(""); setBuFilter("All"); setByClient(false); setLeadStatusFilter("All"); }}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 999,
                  backgroundColor: active ? BRAND.greenBg : BRAND.card,
                  color: active ? BRAND.white : BRAND.textSecondary,
                  border: `1px solid ${active ? BRAND.greenBg : BRAND.cardBorder}`,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                <Icon size={12} />{label}
              </button>
            );
          })
        )}
        {navContext === "library" && (
          <button key="archUsers" onClick={() => { setArchUsersTab(true); setSearch(""); }}
            title="Deleted staff accounts — restore them from here"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "7px 14px", borderRadius: 999,
              backgroundColor: archUsersTab ? BRAND.greenBg : BRAND.card,
              color: archUsersTab ? BRAND.white : BRAND.textSecondary,
              border: `1px solid ${archUsersTab ? BRAND.greenBg : BRAND.cardBorder}`,
              fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
            <Users size={12} />Users
          </button>
        )}
        {!(navContext === "crm" && crmSubTab === "contacts") && !(navContext === "library" && archUsersTab) && (
          <ViewModeToggle
            mode={viewMode}
            onChange={userSetViewMode}
            options={[
              { value: "grid", label: "Data Grid", icon: <Table2 size={12} /> },
              { value: "cards", label: "Cards", icon: <LayoutGrid size={12} /> },
            ]}
          />
        )}
      </div>

      {/* Search + filters */}
      <div style={{ padding: "0 24px 8px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            backgroundColor: BRAND.card, borderRadius: 10, padding: "0 12px",
            border: `1px solid ${BRAND.cardBorder}`,
          }}>
            <Search size={14} color={search ? BRAND.green : BRAND.textSecondary} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={
                navContext === "library" && archUsersTab ? "Search archived users…"
                : view === "Projects" ? "Search by name, ID or city…"
                : view === "Opportunities" ? "Search opportunities…"
                : view === "Leads" ? "Search leads…" : "Search companies…"
              }
              style={{
                flex: 1, padding: "10px 0", background: "transparent", border: "none",
                color: BRAND.white, fontSize: 13, outline: "none",
              }}
            />
            {search && (
              <button onClick={() => setSearch("")}
                style={{ background: "none", border: "none", color: BRAND.textSecondary, cursor: "pointer" }}>
                <X size={14} />
              </button>
            )}
          </div>
          {/* Single Filters button — opens popup with all filter dropdowns */}
          {view !== "Companies" && !(navContext === "library" && archUsersTab) && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => { setShowFiltersPopup(v => !v); setOpenOrgMenu(null); setShowStageDropdown(false); setShowOppSectorDropdown(false); setShowDateDropdown(false); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
                  borderRadius: 10, backgroundColor: BRAND.card, cursor: "pointer",
                  border: `1px solid ${anyFilterActive ? BRAND.green : BRAND.cardBorder}`,
                  color: anyFilterActive ? BRAND.green : BRAND.textSecondary,
                  fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                }}
              >
                <SlidersHorizontal size={13} />
                Filters{anyFilterActive ? " · Active" : ""}
              </button>
              {showFiltersPopup && (
                <>
                  <div onClick={() => { setShowFiltersPopup(false); setOpenOrgMenu(null); }}
                    style={{ position: "fixed", inset: 0, zIndex: 24, background: "transparent" }} />
                  <div style={{
                    position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 26,
                    display: "flex", flexWrap: "wrap", gap: 8, padding: 12, borderRadius: 12,
                    backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.4)", minWidth: 260, maxWidth: "calc(100vw - 48px)",
                  }}>
                    {/* Status — Opps only */}
                    {view === "Opportunities" && (
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => { setShowStageDropdown(v => !v); setOpenOrgMenu(null); setShowOppSectorDropdown(false); setShowDateDropdown(false); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                            borderRadius: 10, backgroundColor: BRAND.card,
                            border: `1px solid ${stageFilter !== "All Stages" ? BRAND.orange : BRAND.cardBorder}`,
                            color: stageFilter !== "All Stages" ? BRAND.orange : BRAND.textSecondary,
                            fontSize: 12, fontWeight: 600, cursor: "pointer", maxWidth: 140,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}
                        >
                          <Filter size={12} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {stageFilter === "All Stages" ? "Status" : stageFilter}
                          </span>
                          <ChevronDown size={10} />
                        </button>
                        {showStageDropdown && (
                          <>
                            <div onClick={() => setShowStageDropdown(false)}
                              style={{ position: "fixed", inset: 0, backgroundColor: "transparent", zIndex: 25 }} />
                            <div style={{
                              position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 30,
                              backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`, borderRadius: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.45)", maxHeight: 320, overflowY: "auto", minWidth: 200,
                            }}>
                              {["All Stages", ...allStages].map(st => {
                                const sel = st === stageFilter;
                                return (
                                  <button key={st} onClick={() => { setStageFilter(st); setShowStageDropdown(false); }}
                                    style={{
                                      display: "flex", alignItems: "center", justifyContent: "space-between",
                                      width: "100%", padding: "10px 14px", background: "transparent",
                                      border: "none", color: sel ? BRAND.orange : BRAND.white,
                                      fontSize: 13, cursor: "pointer", textAlign: "left",
                                    }}>
                                    <span>{st === "All Stages" ? "All Statuses" : st}</span>
                                    {sel && <Check size={14} />}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {/* Sector — Opps only */}
                    {view === "Opportunities" && allOppSectors.length > 0 && (
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => { setShowOppSectorDropdown(v => !v); setOpenOrgMenu(null); setShowStageDropdown(false); setShowDateDropdown(false); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                            borderRadius: 10, backgroundColor: BRAND.card,
                            border: `1px solid ${oppSectorFilter !== "All" ? BRAND.orangeWarm : BRAND.cardBorder}`,
                            color: oppSectorFilter !== "All" ? BRAND.orangeWarm : BRAND.textSecondary,
                            fontSize: 12, fontWeight: 600, cursor: "pointer", maxWidth: 140,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}
                        >
                          <Filter size={12} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {oppSectorFilter === "All" ? "Sector" : oppSectorFilter}
                          </span>
                          <ChevronDown size={10} />
                        </button>
                        {showOppSectorDropdown && (
                          <>
                            <div onClick={() => setShowOppSectorDropdown(false)}
                              style={{ position: "fixed", inset: 0, backgroundColor: "transparent", zIndex: 25 }} />
                            <div style={{
                              position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 30,
                              backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`, borderRadius: 12,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.45)", maxHeight: 320, overflowY: "auto", minWidth: 200,
                            }}>
                              {["All", ...allOppSectors].map(sec => {
                                const sel = sec === oppSectorFilter;
                                return (
                                  <button key={sec} onClick={() => { setOppSectorFilter(sec); setShowOppSectorDropdown(false); }}
                                    style={{
                                      display: "flex", alignItems: "center", justifyContent: "space-between",
                                      width: "100%", padding: "10px 14px", background: "transparent",
                                      border: "none", color: sel ? BRAND.orangeWarm : BRAND.white,
                                      fontSize: 13, cursor: "pointer", textAlign: "left",
                                    }}>
                                    <span>{sec === "All" ? "All Sectors" : sec}</span>
                                    {sel && <Check size={14} />}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {/* BU / Division / Dept — per view */}
                    {view === "Opportunities" && !archUsersTab && (
                      <>
                        {oppOrgOptions.bus.length > 0 && getBusinessRules().showBusinessUnit && orgFilterButton("opp-bu", "BU", "All Business Units", buFilter, setBuFilter, oppOrgOptions.bus)}
                        {oppOrgOptions.divs.length > 0 && getBusinessRules().showDivision && orgFilterButton("opp-div", "Division", "All Divisions", oppDivFilter, setOppDivFilter, oppOrgOptions.divs)}
                        {oppOrgOptions.depts.length > 0 && getBusinessRules().showDepartment && orgFilterButton("opp-dept", "Dept", "All Departments", oppDeptFilter, setOppDeptFilter, oppOrgOptions.depts)}
                      </>
                    )}
                    {view === "Projects" && !archUsersTab && (
                      <>
                        {projectOrgOptions.bus.length > 0 && getBusinessRules().showBusinessUnit && orgFilterButton("proj-bu", "BU", "All Business Units", projectBuFilter, setProjectBuFilter, projectOrgOptions.bus)}
                        {projectOrgOptions.divs.length > 0 && getBusinessRules().showDivision && orgFilterButton("proj-div", "Division", "All Divisions", projectDivFilter, setProjectDivFilter, projectOrgOptions.divs)}
                        {projectOrgOptions.depts.length > 0 && getBusinessRules().showDepartment && orgFilterButton("proj-dept", "Dept", "All Departments", projectDeptFilter, setProjectDeptFilter, projectOrgOptions.depts)}
                      </>
                    )}
                    {view === "Leads" && !archUsersTab && (
                      <>
                        {leadOrgOptions.bus.length > 0 && getBusinessRules().showBusinessUnit && orgFilterButton("lead-bu", "BU", "All Business Units", leadBuFilter, setLeadBuFilter, leadOrgOptions.bus)}
                        {leadOrgOptions.divs.length > 0 && getBusinessRules().showDivision && orgFilterButton("lead-div", "Division", "All Divisions", leadDivFilter, setLeadDivFilter, leadOrgOptions.divs)}
                        {leadOrgOptions.depts.length > 0 && getBusinessRules().showDepartment && orgFilterButton("lead-dept", "Dept", "All Departments", leadDeptFilter, setLeadDeptFilter, leadOrgOptions.depts)}
                        {leadStatusOptions.length > 0 && orgFilterButton("lead-status", "Status", "All Statuses", leadStatusFilter, setLeadStatusFilter, leadStatusOptions)}
                      </>
                    )}
                    {/* Date — all views */}
                    <div style={{ position: "relative" }}>
                      <button
                        onClick={() => { setShowDateDropdown(v => !v); setOpenOrgMenu(null); setShowStageDropdown(false); setShowOppSectorDropdown(false); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                          borderRadius: 10, backgroundColor: BRAND.card,
                          border: `1px solid ${dateFilter !== "All Time" ? BRAND.orange : BRAND.cardBorder}`,
                          color: dateFilter !== "All Time" ? BRAND.orange : BRAND.textSecondary,
                          fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        <Calendar size={13} />
                        {dateLabel || "All"}
                        <ChevronDown size={12} />
                      </button>
                      {showDateDropdown && (
                        <>
                          <div onClick={() => setShowDateDropdown(false)}
                            style={{ position: "fixed", inset: 0, backgroundColor: "transparent", zIndex: 25 }} />
                          <div style={{
                            position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 30,
                            backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`, borderRadius: 12,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.45)", maxHeight: 320, overflowY: "auto", minWidth: 180,
                          }}>
                            {(() => {
                              const opts = buildDateOptions();
                              let lastSection: string | undefined;
                              return opts.map(o => {
                                const sel = o.key === dateFilter;
                                const showHeader = o.section && o.section !== lastSection;
                                lastSection = o.section ?? lastSection;
                                return (
                                  <div key={o.key}>
                                    {showHeader && (
                                      <div style={{
                                        padding: "8px 14px 4px", fontSize: 10, color: BRAND.textMuted,
                                        fontWeight: 700, letterSpacing: 1, backgroundColor: BRAND.bg,
                                      }}>
                                        {o.section === "year" ? "BY YEAR" : "BY QUARTER"}
                                      </div>
                                    )}
                                    <button onClick={() => { setDateFilter(o.key); setShowDateDropdown(false); }}
                                      style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        width: "100%", padding: "10px 14px", background: "transparent",
                                        border: "none", color: sel ? BRAND.orange : BRAND.white,
                                        fontSize: 13, cursor: "pointer", textAlign: "left",
                                      }}>
                                      {sel && <Check size={13} />}
                                      <span>{o.label}</span>
                                    </button>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {/* Tab pills inline — grouped with dotted border */}
          {!(navContext === "library" && archUsersTab) && view === "Opportunities" && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              border: `1.5px dashed ${BRAND.cardBorder}`, borderRadius: 999, padding: 3,
            }}>
              {OPP_STATUS_FILTERS.map(f => {
                const sel = f === oppStatusFilter;
                return (
                  <button key={f} onClick={() => setOppStatusFilter(f as OppStatusFilter)} style={{
                    padding: "5px 13px", borderRadius: 999, whiteSpace: "nowrap",
                    backgroundColor: sel ? BRAND.greenBg : "transparent",
                    border: sel ? `1px solid ${BRAND.greenBg}` : "1px solid transparent",
                    color: sel ? BRAND.white : BRAND.textSecondary,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>{f === "Closed" ? "Closed / Converted" : f}</button>
                );
              })}
            </div>
          )}
          {!(navContext === "library" && archUsersTab) && view === "Leads" && navContext !== "library" && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              border: `1.5px dashed ${BRAND.cardBorder}`, borderRadius: 999, padding: 3,
            }}>
              {LEM_FILTERS.map(f => {
                const sel = f === lemFilter;
                return (
                  <button key={f} onClick={() => setLemFilter(f as LemFilter)} style={{
                    padding: "5px 13px", borderRadius: 999, whiteSpace: "nowrap",
                    backgroundColor: sel ? BRAND.greenBg : "transparent",
                    border: sel ? `1px solid ${BRAND.greenBg}` : "1px solid transparent",
                    color: sel ? BRAND.white : BRAND.textSecondary,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>{f === "Closed" ? "Closed / Converted" : f}</button>
                );
              })}
            </div>
          )}
          {!(navContext === "library" && archUsersTab) && view === "Projects" && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              border: `1.5px dashed ${BRAND.cardBorder}`, borderRadius: 999, padding: 3,
            }}>
              {(navContext === "library"
                ? PROJECT_FILTERS.filter(f => f !== "All Open" && f !== "Staffing Needs")
                : PROJECT_FILTERS
              ).map(f => {
                const sel = f === filter;
                return (
                  <button key={f} onClick={() => setFilter(f as ProjectFilter)} style={{
                    padding: "5px 13px", borderRadius: 999, whiteSpace: "nowrap",
                    backgroundColor: sel ? BRAND.greenBg : "transparent",
                    border: sel ? `1px solid ${BRAND.greenBg}` : "1px solid transparent",
                    color: sel ? BRAND.white : BRAND.textSecondary,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>{f}</button>
                );
              })}
            </div>
          )}
          {!(navContext === "library" && archUsersTab) && view === "Projects" && navContext === "projects" && (
            <div style={{ marginLeft: "auto" }}>
              <ViewModeToggle
                mode={viewMode}
                onChange={userSetViewMode}
                options={[
                  { value: "grid", label: "Data Grid", icon: <Table2 size={12} /> },
                  { value: "cards", label: "Cards", icon: <LayoutGrid size={12} /> },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {/* PROJECTS */}
      {navContext === "library" && archUsersTab && (
        <ArchivedUsersPanel tenantId={user?.tenant ?? ""} search={search} canManage={canManageStaff} />
      )}
      {!(navContext === "library" && archUsersTab) && view === "Projects" && (
        <div>
          <SearchStatusNotice notice={searchStatusNotice} />
          {viewMode === "grid" ? (
            pmmQ.isLoading && filteredProjects.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: BRAND.textSecondary, fontSize: 13 }}>Loading projects…</div>
            ) : pmmQ.isError ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#F87171", fontSize: 13 }}>Couldn't load projects. Please try again.</div>
            ) : (
            <>
            {filteredProjects.some(p => ((gridProjectOpenCountMap[p.id] ?? projectOpenCountMap[p.id] ?? 0) as number) > 0) && <OpenRowsLegend />}
            <RecordDataGrid
              columnPreferenceKey="projects"
              rows={filteredProjects}
              rowKey={(p, i) => `${p.id}-${i}`}
              onRowClick={p => {
                // If already selected for compare, clicking again deselects it.
                if (compareList.some(c => c.id === p.id)) {
                  handleCardMenu("pmm", p, "compare");
                  return;
                }
                // If one item is already picked, second click completes the pair
                // and opens the comparison immediately — no navigation.
                if (compareList.length === 1 && compareList[0].type === "pmm") {
                  handleCardMenu("pmm", p, "compare");
                  return;
                }
                navigate(`/project/${p.id}`);
              }}
              onRowHover={p => hoverPrefetchProject(p.id)}
              onRowHoverEnd={cancelHoverPrefetch}
              rowStyle={p => compareList.some(c => c.id === p.id) ? {} : undefined}
              rowClassName={p => ((gridProjectOpenCountMap[p.id] ?? projectOpenCountMap[p.id] ?? 0) as number) > 0 ? "rm-dg-row-open" : undefined}
              onPageRowsChange={setGridProjectPageRows}
              emptyText={search ? `No projects matching "${search}"` : "No projects found"}
              columns={applyGridColumnDefaults<GridColumn<Project>>("projects", [
                // Column keys here (and in the leads/opps/companies grids
                // below) are mirrored in lib/displayDefaults.ts
                // GRID_COLUMN_CATALOG (the admin "Display Defaults" picker) —
                // keep the two lists in sync when adding/removing columns.
                { key: "id", label: "RM ONE ID", width: 150, sortValue: p => p.id, render: p => <IdPill id={p.id} /> },
                { key: "name", label: "Title", minWidth: 180, maxAuto: 240, hoverTitle: p => p.name || undefined, sortValue: p => p.name, render: p => <span style={{ fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span> },
                { key: "client", label: "Client", minWidth: 120, maxAuto: 180, hoverTitle: p => p.client || undefined, sortValue: p => p.client || null },
                // A lifecycle's dated schedule owns the displayed status; raw
                // workflow text is only the no-schedule fallback.
                // width 160 = chip cap 136 + 24px cell padding — the column is
                // born wide enough for the longest (truncated) chip, so pills
                // can never be cut off by the column edge.
                { key: "status", label: "Status", width: 160, hoverTitle: p => p.displayStatus || undefined, sortValue: p => p.displayStatus || null, render: p => p.displayStatus
                  ? <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle" }}>
                      <ScheduleStatusChip label={p.displayStatus} />
                      <StageFlowDots mod="PMM" stage={p.rawStatus || p.status} closed={p.closed} raw={p.raw} />
                    </span>
                  : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "phase", label: "Phase", width: 112, sortValue: p => p.phase || null },
                { key: "value", label: "Value", width: 112, align: "right", sortValue: p => p.value, render: p => p.value > 0
                  ? <ValueBar text={fmtM(p.value)} frac={maxProjectValue > 0 ? p.value / maxProjectValue : 0} color="#6BA539" />
                  : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "team", label: "Team", width: 96, align: "center",
                  sortValue: p => gridProjectTeamCountMap[p.id] ?? projectTeamCountMap[p.id] ?? countAssignedUserGuids(p.assignedUserGuids),
                  render: p => gridProjectTeamCountMap[p.id] === null
                    ? <span style={{ color: BRAND.textMuted }}>—</span>
                    : (
                      <button
                        onClick={e => { e.stopPropagation(); setTeamProject(p); }}
                        title={`View team for ${p.name}${(gridProjectOpenCountMap[p.id] ?? projectOpenCountMap[p.id] ?? 0) > 0 ? ` — ${gridProjectOpenCountMap[p.id] ?? projectOpenCountMap[p.id]} open position(s)` : ""}`}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <AllocBadge
                          count={gridProjectTeamCountMap[p.id] ?? projectTeamCountMap[p.id] ?? countAssignedUserGuids(p.assignedUserGuids)}
                          openCount={(gridProjectOpenCountMap[p.id] ?? projectOpenCountMap[p.id] ?? 0) as number}
                        />
                      </button>
                    ) },
                { key: "start", label: "Start", width: 104, sortValue: p => p.rawTargetStart || null, render: p => fmtGridDate(p.rawTargetStart) || <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "end", label: "End", width: 104, sortValue: p => p.rawTargetEnd || null, render: p => fmtGridDate(p.rawTargetEnd) || <span style={{ color: BRAND.textMuted }}>—</span> },
                // Admin-added DB-field columns (Settings → Display Defaults).
                // Mapped overrides supply values whose fallback chains mapPMM
                // already resolved; everything else reads the raw record.
                ...extraColumnsFor<Project>("projects", p => ({
                  City: p.city, Office: p.office, SectorChoice: p.sector,
                  CRMBusinessUnitChoice: p.bu, Division: p.division, Department: p.dept,
                  ERPJobID: p.projectId, OwnerName: p.clientContact, OwnersRepresentative: p.ownersRep,
                  // Closed mirrors the STATUS chip / detail page (raw bit OR
                  // closed-ish status OR ended schedule) — the raw DB bit is
                  // stale on imported rows, which made closed projects read
                  // "false" until someone opened them.
                  Closed: p.closed,
                  // Lead columns mirror the record page's Project Leads card.
                  ...(gridProjectKpMap[p.id] ?? {}),
                }), (title, people, returnFocus) => setPeoplePopup({ title, people, returnFocus })),
                { key: "ai", label: "AI", width: 56, align: "center", noSort: true, stickyRight: true, render: p => (
                  <AiAnalyzeButton onClick={() => setAiGridTarget({ kind: "project", rec: p })} title={`AI analysis for ${p.name}`} />
                ) },
                { key: "menu", label: "", width: 44, align: "center", noSort: true, stickyRight: true, render: p => (
                  <GridRowMenu
                    items={projectMenuItems(p, compareList.some(c => c.id === p.id))}
                    inCompare={compareList.some(c => c.id === p.id)}
                    isOnHold={p.rawStatus === "On Hold"}
                    onAction={(action) => handleCardMenu("pmm", p, action)}
                  />
                ) },
              ])}
            />
            </>
            )
          ) : (
          <ListBody
            isLoading={pmmQ.isLoading}
            isError={pmmQ.isError}
            empty={filteredProjects.length === 0}
            emptyText={search ? `No projects matching "${search}"` : "No projects found"}
            emptyIcon="briefcase"
            totalCount={filteredProjects.length}
            layout="grid"
            gridMinPx={300}
            header={filteredProjects.length > 0 ? (
              <div style={{
                margin: "0 16px 12px", padding: 14, backgroundColor: BRAND.card,
                borderRadius: 12, border: `1px solid ${BRAND.cardBorder}`,
              }}>
                <div style={{ fontSize: 10, color: BRAND.textMuted, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
                  {filter.toUpperCase()} · TOTALS
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <RollupStat label="Total Value" value={fmtM(totalProjectValue)} color={BRAND.white} />
                  <div style={{ width: 1, alignSelf: "stretch", backgroundColor: BRAND.cardBorder }} />
                  <RollupStat label="Avg Value" value={fmtM(filteredProjects.length ? totalProjectValue / filteredProjects.length : 0)} color={BRAND.green} />
                  <div style={{ width: 1, alignSelf: "stretch", backgroundColor: BRAND.cardBorder }} />
                  <RollupStat label="Total Projects" value={String(filteredProjects.length)} color={BRAND.green} />
                  {totalProjectStaffing.reqs > 0 && (
                    <>
                      <div style={{ width: 1, alignSelf: "stretch", backgroundColor: BRAND.cardBorder }} />
                      <RollupStat label="Staffing Reqs" value={`${totalProjectStaffing.reqs} · ~${totalProjectStaffing.fte} FTE`} color={BRAND.greenLight} />
                    </>
                  )}
                </div>
              </div>
            ) : undefined}
          >
            {visibleProjectSlice.map((p, i) => (
              <ProjectCard
                key={`${p.id}-${i}`}
                p={p}
                staffing={projectStaffing[p.id]}
                staffingWindowDays={windowDays}
                inCompare={compareList.some(c => c.id === p.id)}
                compareMode={compareList.length > 0}
                holdInfo={holdInfoMap[p.id] ?? null}
                teamCount={projectTeamCountMap[p.id]}
                openCount={projectOpenCountMap[p.id]}
                conflicts={projectConflictMap[p.id]}
                onDetails={() => navigate(`/project/${p.id}`)}
                onReallocate={() => handoffToChat(`Reallocate and optimize staffing for project "${p.name}" (${p.id}). First fetch the project details to understand the project type, value, phase, and current team. Then analyze the team composition against what this specific type/size of project needs, identify gaps or issues, and give me 3-5 specific data-driven recommendations for staffing changes (add, remove, increase, reduce). Match candidates from the bench based on their job titles and experience. Be decisive.`)}
                onTeam={() => setTeamProject(p)}
                onMenu={(action) => handleCardMenu("pmm", p, action)}
                onMemberAnalysis={(c, pname, pid) => setConflictAnalysis({ ...c, memberName: c.name, projectName: pname, projectId: pid })}
                onConflictAI={() => {
                  const cs = projectConflictMap[p.id] ?? [];
                  const memberLines = cs.map(c =>
                    `• ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.thisPct}% on this project — also on ${c.otherProjects.map(o => `${o.name} at ${o.pct}%`).join(", ")}`
                  ).join("\n");
                  handoffToChat(`Analyze the team overlap on project "${p.name}" (${p.id}). There are ${cs.length} shared team member${cs.length === 1 ? "" : "s"} working across multiple projects simultaneously:\n\n${memberLines}\n\nFor each person: assess the risk to this project, identify which other project they're most stretched on, and give a concrete recommendation (reduce allocation, find a substitute, reassign a deliverable). Prioritise the highest-risk person first.`);
                }}
              />
            ))}
          </ListBody>
          )}
        </div>
      )}

      {/* OPPORTUNITIES */}
      {!(navContext === "library" && archUsersTab) && view === "Opportunities" && (
        <div>
          <SearchStatusNotice notice={searchStatusNotice} />
          {viewMode === "grid" ? (
            opmQ.isLoading && filteredOpps.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: BRAND.textSecondary, fontSize: 13 }}>Loading opportunities…</div>
            ) : opmQ.isError ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#F87171", fontSize: 13 }}>Couldn't load opportunities. Please try again.</div>
            ) : (
            <>
            {filteredOpps.some(o => ((gridOppOpenCountMap[o.id] ?? oppOpenCountMap[o.id] ?? 0) as number) > 0) && <OpenRowsLegend />}
            <RecordDataGrid
              columnPreferenceKey="opportunities"
              rows={filteredOpps}
              rowKey={(o, i) => `${o.id}-${i}`}
              onRowClick={o => {
                if (compareList.some(c => c.id === o.id)) {
                  handleCardMenu("opm", o, "compare");
                  return;
                }
                if (compareList.length === 1 && compareList[0].type === "opm") {
                  handleCardMenu("opm", o, "compare");
                  return;
                }
                // Converted opps don't open the opp detail — they show a popup
                // that points to the resulting project instead.
                const matchedProject =
                  (projectsByTitle.get((o.name || "").trim().toLowerCase()) ?? [])
                    .find(p => sameJobFields(o, p)) ?? null;
                if (isConvertedOpp(o)) {
                  setConvertedPopup({ opp: o, project: matchedProject });
                  return;
                }
                navigate(`/project/${o.id}`);
              }}
              onRowHover={o => hoverPrefetchProject(o.id)}
              onRowHoverEnd={cancelHoverPrefetch}
              rowStyle={o => {
                if (compareList.some(c => c.id === o.id)) return {};
                // Converted rows keep full opacity — their blue tint (via
                // rowClassName) is the signal, not the dimming closed opps get.
                if (o.stage === CONVERTED_STAGE) return undefined;
                // Closed rows are NOT dimmed/tinted (user mandate: every row
                // stays plain white — the colored status pill alone signals
                // Lost/Cancelled/Awarded). Returning a style here would also
                // mark the row "selected" (green tint) in RecordDataGrid.
                return undefined;
              }}
              rowClassName={o => isConvertedOpp(o)
                ? "rm-dg-row-converted"
                : (((gridOppOpenCountMap[o.id] ?? oppOpenCountMap[o.id] ?? 0) as number) > 0 ? "rm-dg-row-open" : undefined)}
              onPageRowsChange={setGridOppPageRows}
              emptyText={search ? `No opportunities matching "${search}"` : "No opportunities found"}
              columns={applyGridColumnDefaults<GridColumn<Opportunity>>("opportunities", [
                { key: "id", label: "RM ONE ID", width: 150, sortValue: o => o.id, render: o => (
                  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <IdPill id={o.id} />
                    {isConvertedOpp(o) && <ConvertedTag />}
                  </span>
                ) },
                { key: "name", label: "Title", minWidth: 180, maxAuto: 240, hoverTitle: o => o.name || undefined, sortValue: o => o.name, render: o => <span style={{ fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span> },
                { key: "client", label: "Client", minWidth: 120, maxAuto: 180, hoverTitle: o => o.client || undefined, sortValue: o => o.client || null },
                // width 160 = chip cap 136 + 24px cell padding (see PMM grid).
                { key: "stage", label: "Status", width: 160, hoverTitle: o => o.displayStatus || undefined, sortValue: o => o.displayStatus || null, render: o => {
                  if (!o.displayStatus) return <span style={{ color: BRAND.textMuted }}>—</span>;
                  // minWidth + centered text = uniform pill size (Lost /
                  // Awarded / Cancelled all render as one width); long custom
                  // stages truncate with "…" (full text on mouseover) instead
                  // of spilling into the neighbouring column.
                  return (
                    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle" }}>
                      <ScheduleStatusChip label={o.displayStatus} />
                      <StageFlowDots mod="OPM" stage={o.stage} closed={o.closed || o.stage === CONVERTED_STAGE} raw={o.raw} />
                    </span>
                  );
                } },
                { key: "value", label: "Value", width: 112, align: "right", sortValue: o => o.value, render: o => o.value > 0
                  ? <ValueBar text={fmtM(o.value)} frac={maxOppValue > 0 ? o.value / maxOppValue : 0} color="#4B9CD3" />
                  : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "probability", label: "Prob %", width: 82, align: "right", sortValue: o => o.probability ?? null, render: o => o.probability != null ? `${o.probability}%` : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "weightedValue", label: "Weighted", width: 104, align: "right", sortValue: o => o.weightedValue ?? null, render: o => o.weightedValue != null ? fmtM(o.weightedValue) : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "bidDate", label: "Bid Date", width: 104, sortValue: o => o.rawBidDate || null, render: o => fmtGridDate(o.rawBidDate) || <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "daysLeft", label: "Days Left", width: 88, align: "right", sortValue: o => o.daysLeft ?? null, render: o => o.daysLeft != null ? String(o.daysLeft) : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "team", label: "Team", width: 96, align: "center",
                  sortValue: o => gridOppTeamCountMap[o.id] ?? oppTeamCountMap[o.id] ?? countAssignedUserGuids(o.assignedUserGuids),
                  render: o => gridOppTeamCountMap[o.id] === null
                    ? <span style={{ color: BRAND.textMuted }}>—</span>
                    : (
                      <button
                        onClick={e => { e.stopPropagation(); setTeamOpp(o); }}
                        title={`View team for ${o.name}${(gridOppOpenCountMap[o.id] ?? oppOpenCountMap[o.id] ?? 0) > 0 ? ` — ${gridOppOpenCountMap[o.id] ?? oppOpenCountMap[o.id]} open position(s)` : ""}`}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <AllocBadge
                          count={gridOppTeamCountMap[o.id] ?? oppTeamCountMap[o.id] ?? countAssignedUserGuids(o.assignedUserGuids)}
                          openCount={(gridOppOpenCountMap[o.id] ?? oppOpenCountMap[o.id] ?? 0) as number}
                        />
                      </button>
                    ) },
                // Admin-added DB-field columns (Settings → Display Defaults).
                ...extraColumnsFor<Opportunity>("opportunities", o => ({
                  City: o.city, Office: o.office, SectorChoice: o.sector,
                  CRMBusinessUnitChoice: o.bu, Division: o.division, Department: o.dept,
                  ERPJobID: o.projectId, OwnersRepresentative: o.ownersRep,
                  // Same honesty rules as the Projects grid: derived closed
                  // state + Project Leads card parity for lead columns.
                  Closed: o.closed,
                  ...(gridOppKpMap[o.id] ?? {}),
                }), (title, people, returnFocus) => setPeoplePopup({ title, people, returnFocus })),
                { key: "ai", label: "AI", width: 56, align: "center", noSort: true, stickyRight: true, render: o => (
                  <AiAnalyzeButton onClick={() => setAiGridTarget({ kind: "opp", rec: o })} title={`AI analysis for ${o.name}`} />
                ) },
                { key: "menu", label: "", width: 44, align: "center", noSort: true, stickyRight: true, render: o => (
                  <GridRowMenu
                    items={oppMenuItems(o, compareList.some(c => c.id === o.id))}
                    inCompare={compareList.some(c => c.id === o.id)}
                    isOnHold={o.stage === "On Hold"}
                    onAction={(action) => handleCardMenu("opm", o, action)}
                  />
                ) },
              ])}
            />
            </>
            )
          ) : (
          <ListBody
            isLoading={opmQ.isLoading}
            isError={opmQ.isError}
            empty={filteredOpps.length === 0}
            emptyText={search ? `No opportunities matching "${search}"` : "No opportunities found"}
            emptyIcon="trending-up"
            totalUnfiltered={opps.length}
            onViewClosed={oppStatusFilter === "Open" ? () => setOppStatusFilter("Closed") : undefined}
            onRefresh={() => void opmQ.refetch()}
            header={
              <div style={{
                margin: "0 16px 12px", padding: 14, backgroundColor: BRAND.card,
                borderRadius: 12, border: `1px solid ${BRAND.cardBorder}`,
              }}>
                <div style={{ fontSize: 10, color: BRAND.textMuted, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
                  PIPELINE ROLL-UP
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <RollupStat label="Total Value" value={fmtM(totalOppValue)} color={BRAND.white} />
                  <div style={{ width: 1, alignSelf: "stretch", backgroundColor: BRAND.cardBorder }} />
                  <RollupStat label="Active Value" value={fmtM(activeOppValue)} color={BRAND.green} />
                  <div style={{ width: 1, alignSelf: "stretch", backgroundColor: BRAND.cardBorder }} />
                  <RollupStat label="Closed Value" value={fmtM(closedOppValue)} color={BRAND.textMuted} />
                  <div style={{ width: 1, alignSelf: "stretch", backgroundColor: BRAND.cardBorder }} />
                  <RollupStat label="Active Opps" value={String(filteredOpps.length)} color={BRAND.green} />
                </div>
              </div>
            }
          totalCount={filteredOpps.length}
          layout="grid"
          >
            {filteredOpps.slice(0, visibleCount).map((o, i) => (
              <OppCard
                key={`${o.id}-${i}`}
                o={o}
                isConverted={isConvertedOpp(o)}
                expanded={expandedOpp === o.id}
                inCompare={compareList.some(c => c.id === o.id)}
                compareMode={compareList.length > 0}
                holdInfo={holdInfoMap[o.id] ?? null}
                teamCount={oppTeamCountMap[o.id]}
                openCount={oppOpenCountMap[o.id]}
                conflicts={oppConflictMap[o.id]}
                onDetails={() => navigate(`/project/${o.id}`)}
                onSchedule={() => setEditingOpp({
                  id: o.id, name: o.name,
                  rawBidDate: o.rawBidDate,
                  rawActualStart: o.rawActualStart,
                  rawActualEnd: o.rawActualEnd,
                })}
                onTeam={() => setTeamOpp(o)}
                onToggleExpand={() => setExpandedOpp(expandedOpp === o.id ? null : o.id)}
                onMenu={(action) => handleCardMenu("opm", o, action)}
                onMemberAnalysis={(c, pname, pid) => setConflictAnalysis({ ...c, memberName: c.name, projectName: pname, projectId: pid })}
                onConflictAI={() => {
                  const cs = oppConflictMap[o.id] ?? [];
                  const memberLines = cs.map(c =>
                    `• ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.thisPct}% on this opportunity — also on ${c.otherProjects.map(op => `${op.name} at ${op.pct}%`).join(", ")}`
                  ).join("\n");
                  handoffToChat(`Analyze the team overlap on opportunity "${o.name}" (${o.id}). There are ${cs.length} shared team member${cs.length === 1 ? "" : "s"} working across multiple projects simultaneously:\n\n${memberLines}\n\nFor each person: assess the risk to this opportunity, identify which other project they're most stretched on, and give a concrete recommendation (reduce allocation, find a substitute, reassign a deliverable). Prioritise the highest-risk person first.`);
                }}
              />
            ))}
          </ListBody>
          )}
        </div>
      )}

      {/* LEADS */}
      {!(navContext === "library" && archUsersTab) && view === "Leads" && (
        <div>
          <SearchStatusNotice notice={searchStatusNotice} />
          {viewMode === "grid" ? (
            lemQ.isLoading && filteredLeads.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: BRAND.textSecondary, fontSize: 13 }}>Loading leads…</div>
            ) : lemQ.isError ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "#F87171", fontSize: 13 }}>Couldn't load leads. Please try again.</div>
            ) : (
            <RecordDataGrid
              columnPreferenceKey="leads"
              rows={filteredLeads}
              rowKey={(l, i) => `${l.id}-${i}`}
              onRowClick={l => {
                // Compare mode: clicking a row toggles it in the compare bar
                // (mirrors the opportunities grid behaviour).
                if (compareList.some(c => c.id === l.id)) {
                  handleCardMenu("lem", l, "compare");
                  return;
                }
                if (compareList.length === 1 && compareList[0].type === "lem") {
                  handleCardMenu("lem", l, "compare");
                  return;
                }
                // Converted leads open the "already converted" popup that
                // links to the new opportunity instead of the lead detail.
                // Same-name-only opps don't count — sameJobFields must agree
                // (client / BU / division), or the popup shows without a link.
                if (l.status === LEM_CONVERTED) {
                  setConvertedLeadPopup({
                    lead: l,
                    opp: (oppsByTitle.get((l.name || "").trim().toLowerCase()) ?? [])
                      .find(op => sameJobFields(l, op)) ?? null,
                  });
                } else {
                  navigate(`/project/${l.id}`);
                }
              }}
              onRowHover={l => hoverPrefetchProject(l.id)}
              onRowHoverEnd={cancelHoverPrefetch}
              rowStyle={l => compareList.some(c => c.id === l.id) ? {} : undefined}
              emptyText={search ? `No leads matching "${search}"` : "No leads found"}
              columns={applyGridColumnDefaults<GridColumn<Lead>>("leads", [
                { key: "id", label: "RM ONE ID", width: 150, sortValue: l => l.id, render: l => (
                  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <IdPill id={l.id} />
                    {l.status === LEM_CONVERTED && <ConvertedTag />}
                  </span>
                ) },
                { key: "name", label: "Title", minWidth: 180, maxAuto: 240, hoverTitle: l => l.name || undefined, sortValue: l => l.name, render: l => <span style={{ fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span> },
                { key: "client", label: "Client", minWidth: 120, maxAuto: 180, hoverTitle: l => l.client || undefined, sortValue: l => l.client || null },
                { key: "clientContact", label: "Client Contact", minWidth: 110, maxAuto: 170, hoverTitle: l => l.clientContact || undefined, sortValue: l => l.clientContact || null,
                  render: l => l.clientContact || <span style={{ color: BRAND.textMuted }}>—</span> },
                // width 160 = chip cap 136 + 24px cell padding (see PMM grid).
                { key: "status", label: "Status", width: 160, hoverTitle: l => l.status || undefined, sortValue: l => l.status || null, render: l => l.status
                  ? <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle" }}>
                      <WorkflowStatusChip label={l.status} />
                      <StageFlowDots mod="LEM" stage={l.status} closed={l.closed || l.status === LEM_CONVERTED} raw={l.raw} />
                    </span>
                  : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "value", label: "Value", width: 112, align: "right", sortValue: l => l.value, render: l => l.value > 0
                  ? <ValueBar text={fmtM(l.value)} frac={maxLeadValue > 0 ? l.value / maxLeadValue : 0} color="#A9C23F" />
                  : <span style={{ color: BRAND.textMuted }}>—</span> },
                { key: "sector", label: "Sector", width: 130, sortValue: l => l.sector || null },
                { key: "bu", label: "Business Unit", width: 150, sortValue: l => l.bu || null,
                  render: l => <OrgCell value={l.bu} kind="bu" /> },
                { key: "due", label: "Due", width: 104, sortValue: l => l.rawDueDate || l.rawTargetEnd || null, render: l => fmtGridDate(l.rawDueDate || l.rawTargetEnd) || <span style={{ color: BRAND.textMuted }}>—</span> },
                // Admin-added DB-field columns (Settings → Display Defaults).
                ...extraColumnsFor<Lead>("leads", l => ({
                  City: l.city, Office: l.office, Division: l.division, Department: l.dept,
                  ERPJobID: l.projectId, CloseDate: l.rawClose, Created: l.rawCreated,
                  TargetStartDate: l.rawTargetStart, TargetCompletionDate: l.rawTargetEnd,
                })),
                { key: "ai", label: "AI", width: 56, align: "center", noSort: true, stickyRight: true, render: l => (
                  <AiAnalyzeButton onClick={() => setAiGridTarget({ kind: "lead", rec: l })} title={`AI analysis for ${l.name}`} />
                ) },
                { key: "menu", label: "", width: 44, align: "center", noSort: true, stickyRight: true, render: l => (
                  <GridRowMenu
                    items={leadMenuItems(l, compareList.some(c => c.id === l.id))}
                    inCompare={compareList.some(c => c.id === l.id)}
                    isOnHold={l.status === "On Hold"}
                    onAction={(action) => handleCardMenu("lem", l, action)}
                  />
                ) },
              ])}
            />
            )
          ) : (
          <ListBody
            isLoading={lemQ.isLoading}
            isError={lemQ.isError}
            empty={filteredLeads.length === 0}
            emptyText={search ? `No leads matching "${search}"` : "No leads found"}
            emptyIcon="star"
            totalCount={filteredLeads.length}
            layout="grid"
          >
            {filteredLeads.slice(0, visibleCount).map((l, i) => (
              <LeadCard
                key={`${l.id}-${i}`}
                l={l}
                onDetails={() => {
                  if (l.status === LEM_CONVERTED) {
                    // Same guard as the grid path: a same-name opp only counts
                    // as the conversion target when sameJobFields agrees.
                    setConvertedLeadPopup({
                      lead: l,
                      opp: (oppsByTitle.get((l.name || "").trim().toLowerCase()) ?? [])
                        .find(op => sameJobFields(l, op)) ?? null,
                    });
                  } else {
                    navigate(`/project/${l.id}`);
                  }
                }}
                onPursue={() => handoffToChat(`I want to pursue the lead "${l.name}" (${l.id})${l.value > 0 ? `, estimated at ${fmtM(l.value)}` : ""}${l.sector && l.sector !== "—" ? `, sector: ${l.sector}` : ""}${l.city ? `, location: ${l.city}` : ""}. First fetch the lead details, then analyze our past win history in this sector, identify similar completed/active projects we can reference, find available people with experience in this sector, and give me a data-driven pursuit strategy.`)}
                onPreStaff={() => handoffToChat(`I want to pre-staff the lead "${l.name}" (${l.id})${l.value > 0 ? `, estimated at ${fmtM(l.value)}` : ""}${l.sector ? `, sector: ${l.sector}` : ""}${l.city ? `, location: ${l.city}` : ""}. First fetch the project details to understand scope and sector, then find available staff ranked by experience in this sector. Recommend specific people by name with their past project experience — no generic roles.`)}
                onMenu={(action) => handleCardMenu("lem", l, action)}
                inCompare={compareList.some(c => c.id === l.id)}
                compareMode={compareList.length === 1 && compareList[0].type === "lem"}
              />
            ))}
          </ListBody>
          )}
        </div>
      )}

      {/* BY CLIENT — unified lifecycle view: every company row shows its
          leads, opportunities, pipeline, projects and closed counts at once.
          (The old Projects/Opps/Leads toggle buttons were removed per client
          markup — the columns themselves now carry that breakdown.) */}
      {view === "Companies" && crmSubTab !== "contacts" && (
        viewMode === "grid" ? (
          <CompanyDataGridSection
            groups={companyGroups}
            items={companyLifecycleItems}
            noun="Records"
            emptyText={search ? `No companies matching "${search}"` : "No companies found"}
          />
        ) : (
          <ClientGroupGrid
            groups={companyGroups}
            items={companyLifecycleItems}
            noun="record"
            onDrilldown={client => { setView("Companies"); setSearch(client); }}
          />
        )
      )}

      {/* CRM CONTACTS */}
      {view === "Companies" && crmSubTab === "contacts" && (
        <div style={{ padding: "0 24px 80px" }}>
          <div style={{ padding: "10px 0 14px" }}>
            <div style={{ display: "flex", backgroundColor: BRAND.card, borderRadius: 10,
              padding: "0 12px", border: `1px solid ${BRAND.cardBorder}`, alignItems: "center", gap: 8 }}>
              <Search size={14} color={search ? BRAND.green : BRAND.textSecondary} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search contacts…"
                style={{ flex: 1, padding: "10px 0", background: "transparent", border: "none",
                  color: BRAND.white, fontSize: 13, outline: "none" }} />
              {search && (
                <button onClick={() => setSearch("")}
                  style={{ background: "none", border: "none", color: BRAND.textSecondary, cursor: "pointer", padding: 0 }}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {conQ.isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
              <Loader2 size={32} color={BRAND.green} className="animate-spin" />
            </div>
          ) : conQ.isError ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
              <AlertCircle size={32} color={"#F87171"} />
              <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>Failed to load contacts</div>
              <button onClick={() => conQ.refetch()}
                style={{ padding: "8px 18px", borderRadius: 8, border: "none",
                  backgroundColor: BRAND.greenBg, color: BRAND.white, fontWeight: 700, cursor: "pointer" }}>
                Retry
              </button>
            </div>
          ) : filteredCrmContacts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: BRAND.textSecondary, fontSize: 14 }}>
              {search ? `No contacts matching "${search}"` : "No contacts on file"}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(max(280px, calc(25% - 8px)), 1fr))", gap: 10 }}>
              {filteredCrmContacts.map((c: any) => (
                <div key={c.id} style={{
                  backgroundColor: BRAND.card, borderRadius: 12,
                  border: `1px solid ${BRAND.cardBorder}`, padding: "14px 16px",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 999, backgroundColor: BRAND.greenBg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: BRAND.white, fontSize: 11, fontWeight: 800, flexShrink: 0,
                    }}>
                      {c.name.split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("")}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: BRAND.white,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name || "—"}
                      </div>
                      {c.title && (
                        <div style={{ fontSize: 11, color: BRAND.textSecondary,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.title}
                        </div>
                      )}
                    </div>
                  </div>
                  {c.company && (
                    <div style={{ fontSize: 12, color: "var(--rm-text-muted)", marginTop: 2 }}>{c.company}</div>
                  )}
                  {c.email && (
                    <div style={{ fontSize: 11, color: BRAND.textSecondary }}>{c.email}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />

      {conflictAnalysis && (
        <ConflictAnalysisModal
          memberName={conflictAnalysis.memberName}
          role={conflictAnalysis.role}
          projectName={conflictAnalysis.projectName}
          projectId={conflictAnalysis.projectId}
          thisPct={conflictAnalysis.thisPct}
          thisHrs={conflictAnalysis.thisHrs}
          otherProjects={conflictAnalysis.otherProjects}
          onClose={() => setConflictAnalysis(null)}
        />
      )}

      {aiGridTarget && (
        <GridRecordIntelPanel
          target={aiGridTarget}
          peers={aiGridTarget.kind === "project"
            ? { count: filteredProjects.length, totalValue: totalProjectValue, noun: "project" }
            : aiGridTarget.kind === "opp"
              ? { count: filteredOpps.length, totalValue: totalOppValue, noun: "opportunity" }
              : { count: filteredLeads.length, totalValue: filteredLeads.reduce((s, l) => s + (l.value || 0), 0), noun: "lead" }}
          onClose={() => setAiGridTarget(null)}
          onAskAI={p => { setAiGridTarget(null); handoffToChat(p); }}
          onOpenRecord={id => { setAiGridTarget(null); navigate(`/project/${id}`); }}
        />
      )}

      {teamProject && (
        <TeamModal
          module="PMM"
          project={teamProject}
          onClose={() => setTeamProject(null)}
          onAskAI={(prompt, opts) => {
            setTeamProject(null);
            // If caller has already prepared chat prompt+context themselves
            // (Notify Team / Manage with AI), just navigate so we don't overwrite it.
            if (opts?.alreadyPrepared) {
              navigate("/chat");
            } else {
              setChatPrompt(prompt, { newSession: true, autoSend: opts?.autoSend ?? true });
              navigate("/chat");
            }
          }}
        />
      )}

      {peoplePopup && createPortal(
        <div
          role="presentation"
          onClick={closePeoplePopup}
          style={{
            position: "fixed", inset: 0, zIndex: Z.GRID_POPUP_BACKDROP,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, background: "rgba(8, 14, 20, 0.58)",
            backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="grid-people-popup-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const focusable = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
              );
              if (focusable.length === 0) {
                e.preventDefault();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }}
            style={{
              width: "min(420px, 100%)", maxHeight: "min(620px, 82vh)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              background: "var(--rm-panel)", color: "var(--rm-text)",
              border: "1px solid var(--rm-panel-border)", borderRadius: 16,
              boxShadow: "0 28px 80px rgba(0,0,0,0.46)",
            }}
          >
            <header style={{
              padding: "18px 20px 14px", display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 14,
              borderBottom: "1px solid var(--rm-panel-border)",
            }}>
              <div style={{ minWidth: 0 }}>
                <h3 id="grid-people-popup-title" style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                  {peoplePopup.title}
                </h3>
                <div style={{ marginTop: 3, fontSize: 12, color: "var(--rm-text-muted)" }}>
                  {peoplePopup.people.length} {peoplePopup.people.length === 1 ? "person" : "people"}
                </div>
              </div>
              <button
                ref={peoplePopupCloseRef}
                type="button"
                onClick={closePeoplePopup}
                aria-label="Close"
                style={{
                  width: 34, height: 34, flexShrink: 0, display: "grid", placeItems: "center",
                  borderRadius: 9, border: "1px solid var(--rm-panel-border)",
                  background: "transparent", color: "var(--rm-text-muted)", cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </header>
            <div style={{ padding: 10, overflowY: "auto" }}>
              {peoplePopup.people.map((person, index) => {
                const initials = person.name.split(/\s+/).filter(Boolean).slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? "").join("");
                return (
                  <div
                    key={`${person.name.toLowerCase()}|${person.role}|${index}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 11,
                      padding: "10px 11px", borderRadius: 10,
                    }}
                  >
                    <div style={{
                      width: 34, height: 34, borderRadius: 999, flexShrink: 0,
                      display: "grid", placeItems: "center",
                      background: "rgba(135, 190, 69, 0.16)", color: BRAND.green,
                      fontSize: 11, fontWeight: 800,
                    }}>
                      {initials || <User size={15} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.5, fontWeight: 700, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {person.name}
                      </div>
                      {/* Roles remain useful context in the full list, but are
                          shown as quiet metadata — never bracketed into names. */}
                      {peoplePopup.title === "Project Lead" && person.role && (
                        <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--rm-text-muted)" }}>
                          {person.role}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>,
        document.body,
      )}

      {/* "Already converted" popup — shown when a user clicks an opportunity
       *  that has already been converted into a project. Instead of opening the
       *  opp detail we explain the conversion and link straight to the project. */}
      {convertedPopup && createPortal(
        <div
          onClick={() => setConvertedPopup(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 460, background: "var(--rm-panel)",
              border: "1px solid var(--rm-panel-border)", borderRadius: 16,
              boxShadow: "0 24px 70px rgba(0,0,0,0.45)", padding: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: "rgba(75,156,211,0.16)", display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
                <CheckCircle2 size={22} color="#2f7fb5" />
              </div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--rm-text)" }}>
                Already converted to a project
              </h3>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.55, color: "var(--rm-text-muted)" }}>
              <strong style={{ color: "var(--rm-text)" }}>{convertedPopup.opp.name}</strong>{" "}
              has already been won and converted into a project.{" "}
              {convertedPopup.project
                ? "Open the project below to view its team, schedule and details."
                : "The linked project couldn't be found — it may have been renamed or removed."}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => setConvertedPopup(null)}
                style={{
                  padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", background: "transparent",
                  border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)",
                }}
              >
                Close
              </button>
              <button
                onClick={() => { const oid = convertedPopup.opp.id; setConvertedPopup(null); navigate(`/project/${oid}`); }}
                style={{
                  padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", background: "transparent",
                  border: "1px solid var(--rm-panel-border)", color: "var(--rm-text)",
                }}
              >
                View opportunity
              </button>
              {convertedPopup.project && (
                <button
                  onClick={() => { const pid = convertedPopup.project!.id; setConvertedPopup(null); navigate(`/project/${pid}`); }}
                  style={{
                    padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: "pointer", color: "#fff", border: "none",
                    background: "linear-gradient(135deg, #4b9cd3, #2f7fb5)",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  Open project <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* "Already converted" popup — shown when a user clicks a lead that has
       *  already been converted into an opportunity. Instead of opening the
       *  lead detail we explain the conversion and link straight to the opp. */}
      {convertedLeadPopup && createPortal(
        <div
          onClick={() => setConvertedLeadPopup(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 460, background: "var(--rm-panel)",
              border: "1px solid var(--rm-panel-border)", borderRadius: 16,
              boxShadow: "0 24px 70px rgba(0,0,0,0.45)", padding: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: "rgba(75,156,211,0.16)", display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
                <CheckCircle2 size={22} color="#2f7fb5" />
              </div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--rm-text)" }}>
                Already converted to an opportunity
              </h3>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.55, color: "var(--rm-text-muted)" }}>
              <strong style={{ color: "var(--rm-text)" }}>{convertedLeadPopup.lead.name}</strong>{" "}
              has already been converted into an opportunity.{" "}
              {convertedLeadPopup.opp
                ? "Open the opportunity below to view its pursuit team and details."
                : "The linked opportunity couldn't be found — it may have been renamed or removed."}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={() => setConvertedLeadPopup(null)}
                style={{
                  padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", background: "transparent",
                  border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)",
                }}
              >
                Close
              </button>
              <button
                onClick={() => { const lid = convertedLeadPopup.lead.id; setConvertedLeadPopup(null); navigate(`/project/${lid}`); }}
                style={{
                  padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: "pointer", background: "transparent",
                  border: "1px solid var(--rm-panel-border)", color: "var(--rm-text)",
                }}
              >
                View lead
              </button>
              {convertedLeadPopup.opp && (
                <button
                  onClick={() => { const oid = convertedLeadPopup.opp!.id; setConvertedLeadPopup(null); navigate(`/project/${oid}`); }}
                  style={{
                    padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: "pointer", color: "#fff", border: "none",
                    background: "linear-gradient(135deg, #4b9cd3, #2f7fb5)",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  Open opportunity <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Opportunity Team modal — reuses TeamModal with the opp adapted
       *  to the Project shape (id/name/dates are shared between PMM and
       *  OPM records; remaining Project-only fields are zero-defaulted
       *  since TeamModal only reads id/name and the raw target dates). */}
      {teamOpp && (
        <TeamModal
          module="OPM"
          project={{
            id: teamOpp.id,
            name: teamOpp.name,
            status: teamOpp.stage || "",
            phase: "",
            city: teamOpp.city || "",
            value: teamOpp.value || 0,
            closed: teamOpp.closed,
            hasSchedule: !!(teamOpp.rawTargetStart || teamOpp.rawActualStart),
            assignedUserGuids: teamOpp.assignedUserGuids || "",
            rawTargetStart: teamOpp.rawTargetStart || "",
            rawTargetEnd: teamOpp.rawTargetEnd || "",
            rawActualStart: teamOpp.rawActualStart || "",
            rawActualEnd: teamOpp.rawActualEnd || "",
            datesFromSchedule: teamOpp.datesFromSchedule,
            office: teamOpp.office || "",
            forecastCost: 0,
            laborContract: 0,
            sector: "",
            division: teamOpp.division || teamOpp.bu || "",
            bu: teamOpp.bu || "",
            dept: teamOpp.dept || "",
            daysInPhase: null,
            client: teamOpp.client || "",
            clientContact: teamOpp.clientContact || "",
            ownersRep: teamOpp.ownersRep || "",
            projectId: teamOpp.projectId || "",
          }}
          onClose={() => setTeamOpp(null)}
          onAskAI={(prompt, opts) => {
            setTeamOpp(null);
            if (opts?.alreadyPrepared) {
              navigate("/chat");
            } else {
              setChatPrompt(prompt, { newSession: true, autoSend: opts?.autoSend ?? true });
              navigate("/chat");
            }
          }}
        />
      )}

      {companyDetail && (
        <CompanyDetailModal
          company={companyDetail.company}
          tab={companyDetail.tab}
          onTabChange={(tab) => setCompanyDetail(prev => prev ? { ...prev, tab } : prev)}
          onClose={() => setCompanyDetail(null)}
          onOpenProject={(pid) => { setCompanyDetail(null); navigate(`/project/${pid}`); }}
          pmm={projects}
          opm={opps}
          lem={leads}
        />
      )}

      <EditOppScheduleModal
        opp={editingOpp}
        onClose={() => setEditingOpp(null)}
        onSaved={(_o, _r: OppScheduleResult) => {
          setEditingOpp(null);
          qcMain.invalidateQueries({ queryKey: ["opm"] });
        }}
      />

      <CreateChoiceModal
        open={showCreateChoice}
        entityLabel={view === "Projects" ? "Project" : "Opportunity"}
        onManual={() => { setShowCreateChoice(false); setShowManualEntry(true); }}
        onBulk={() => { setShowCreateChoice(false); setShowInlineGrid(true); }}
        onClose={() => setShowCreateChoice(false)}
      />

      <ManualEntryModal
        open={showManualEntry}
        entity={view === "Projects" ? "project" : "opportunity"}
        onClose={() => setShowManualEntry(false)}
        onCreated={() => {
          qcMain.invalidateQueries({ queryKey: ["pmm"] });
          qcMain.invalidateQueries({ queryKey: ["opm"] });
        }}
      />


      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {uploadSuccess && (
        <UploadSuccessOverlay
          label={uploadSuccess.label}
          path={uploadSuccess.path}
          onDone={(p) => {
            setUploadSuccess(null);
            bustCache();
            void qcMain.invalidateQueries();
            navigate(p);
          }}
        />
      )}

      {sourceTypePending && (
        <ChangeSourceTypeModal
          record={sourceTypePending.record}
          onClose={() => setSourceTypePending(null)}
          onConfirm={async (value, reason) => {
            const { record, type } = sourceTypePending;
            setSourceTypePending(null);
            try {
              await updateFields(record.id, [{ FieldName: "RequestCategory", Value: value }]);
              // Arm immediately — the optional note write below can fail and
              // the accepted category change must still reach the record
              // page fresh.
              markProjectDetailRefetchFresh(record.id);
              if (reason.trim()) {
                // Lead table has no Note column — its note lives in Comment.
                await updateFields(record.id, [{ FieldName: type === "lem" ? "Comment" : "Note", Value: reason.trim() }]);
              }
              toast({ title: "Source Type Updated", description: `Set to ${value}` });
              bustCache("module:");
              if (type === "lem") void lemQ.refetch(); else void opmQ.refetch();
            } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
          }}
        />
      )}

      {openPosPending && (
        <AddOpenPositionModal
          open
          onClose={() => setOpenPosPending(null)}
          projectId={openPosPending.record.id}
          projectName={openPosPending.record.name}
          defaultStartDate={openPosPending.record.rawTargetStart || ""}
          defaultEndDate={openPosPending.record.rawTargetEnd || ""}
          onCreated={(roleName) => {
            toast({ title: "Open position added", description: `"${roleName}" is now an open slot on ${openPosPending.record.name}.` });
            refreshProjectTeamCache(qcMain, openPosPending.record.id);
          }}
        />
      )}

      {teamPending && (
        <AddTeamMemberModal
          open
          onClose={() => setTeamPending(null)}
          projectId={teamPending.record.id}
          module={teamPending.type === "lem" ? "LEM" : teamPending.type === "opm" ? "OPM" : "PMM"}
          projectName={teamPending.record.name}
          projectStartDate={(teamPending.record.rawTargetStart || new Date().toISOString()).slice(0, 10)}
          projectEndDate={(teamPending.record.rawTargetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
          scheduleStart={teamPending.record.rawTargetStart || undefined}
          scheduleEnd={teamPending.record.rawTargetEnd || undefined}
          personOnly={teamPending.type === "lem"}
          existingAllocations={teamPending.existingAllocations}
          openRoles={[]}
          onAssigned={(personName) => {
            setTeamPending(null);
            toast({ title: "Team member added", description: `${personName} added to ${teamPending.record.name}.` });
            refreshProjectTeamCache(qcMain, teamPending.record.id);
          }}
          onSetupSchedule={() => {
            setTeamPending(null);
            navigate(`/project/${encodeURIComponent(teamPending.record.id)}`);
          }}
          onOpenProject={(targetId) => {
            setTeamPending(null);
            navigate(`/project/${encodeURIComponent(targetId ?? teamPending.record.id)}`);
          }}
        />
      )}

      {notesPending && (
        <NotesModal
          name={notesPending.record.name}
          initialNote={notesPending.record.note ?? ""}
          onClose={() => setNotesPending(null)}
          onSave={async (text) => {
            const { record, type } = notesPending;
            setNotesPending(null);
            try {
              // PMM has no Note column (Comment is the note field) and the
              // Lead table likewise only has Comment; Opportunity uses Note.
              const field = type === "opm" ? "Note" : "Comment";
              await updateFields(record.id, [{ FieldName: field, Value: text }]);
              markProjectDetailRefetchFresh(record.id);
              toast({ title: "Note saved" });
              bustCache("module:");
              if (type === "pmm") void pmmQ.refetch();
              else if (type === "lem") void lemQ.refetch();
              else void opmQ.refetch();
            } catch (e: any) { toast({ title: "Failed to save note", description: e.message, variant: "destructive" }); }
          }}
        />
      )}

      {holdPending && (
        <PutOnHoldModal
          name={holdPending.record.name}
          onCancel={() => setHoldPending(null)}
          onConfirm={async (info) => {
            const { record, type } = holdPending;
            setHoldPending(null);
            try {
              const field = type === "pmm" ? "CRMProjectStatusChoice"
                : type === "opm" ? "CRMOpportunityStatusChoice" : "LeadStatus";
              await updateFields(record.id, [{ FieldName: field, Value: "On Hold" }]);
              markProjectDetailRefetchFresh(record.id);
              setHoldInfoLS(record.id, info);
              setHoldInfoMap(prev => ({ ...prev, [record.id]: info }));
              toast({ title: "Put on Hold", description: `"${record.name}" is on hold until ${info.tillDate ? new Date(info.tillDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "further notice"}.` });
              bustCache("module:");
              if (type === "pmm") void pmmQ.refetch();
              else if (type === "lem") void lemQ.refetch();
              else void opmQ.refetch();
            } catch (e: any) { toast({ title: "Failed", description: e.message, variant: "destructive" }); }
          }}
        />
      )}

      {statusPending && (
        <ChangeStatusModal
          moduleType={statusPending.type}
            recordId={statusPending.record.id}
          name={statusPending.record.name}
          current={
            statusPending.type === "pmm"
                ? ((statusPending.record as Project).displayStatus || (statusPending.record as Project).rawStatus || (statusPending.record as Project).status)
              : statusPending.type === "opm"
                ? ((statusPending.record as Opportunity).displayStatus || (statusPending.record as Opportunity).stage)
                : (statusPending.record as Lead).status
          }
          onCancel={() => setStatusPending(null)}
          onConfirm={async (value) => {
            const { record: rec, type } = statusPending;
            try {
              const field = type === "pmm" ? "CRMProjectStatusChoice"
                : type === "opm" ? "CRMOpportunityStatusChoice" : "LeadStatus";
              await updateFields(rec.id, [{ FieldName: field, Value: value }]);
              // The record page must see the new status on its next open —
              // without this arm its detail cache keeps serving the old value.
              markProjectDetailRefetchFresh(rec.id);
              toast({ title: "Status updated", description: `"${rec.name}" is now ${value}.` });
              setStatusPending(null);
              bustCache("module:");
              if (type === "pmm") void pmmQ.refetch();
              else if (type === "opm") void opmQ.refetch();
              else void lemQ.refetch();
              return true;
            } catch (e: any) {
              toast({ title: "Failed to update status", description: e.message, variant: "destructive" });
              return false;
            }
          }}
        />
      )}

      {compareList.length > 0 && (
        <CompareBar
          items={compareList}
          onRemove={(id) => setCompareList(prev => prev.filter(c => c.id !== id))}
          onCompare={() => { if (compareList.length === 2) setShowCompare(true); }}
          onClear={() => { setCompareList([]); setShowCompare(false); }}
        />
      )}

      {showCompare && compareList.length === 2 && (
        <CompareModal
          items={compareList}
          onClose={() => { setShowCompare(false); setCompareList([]); }}
        />
      )}
    </div>
  );
}

// ── By-Client grouping helpers ─────────────────────────────────────────────
const CLIENT_PALETTE = [
  "#6BA539","#E87722","#3B82F6","#8B5CF6","#EC4899",
  "#14B8A6","#F59E0B","#EF4444","#06B6D4","#10B981",
  "#F97316","#6366F1","#84CC16","#A855F7","#22D3EE",
];
function clientColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return CLIENT_PALETTE[Math.abs(h) % CLIENT_PALETTE.length];
}
function clientInitials(name: string): string {
  return name.split(/[\s\-&/]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}
function cleanClient(raw: string): string {
  // Strip leading/trailing whitespace and commas — DB sometimes stores "CCR," or ", Something"
  return raw.replace(/^[\s,]+|[\s,]+$/g, "").trim();
}
function extractClient(name: string): string {
  const s = name.trim();
  // Name starts with comma → client part is empty (e.g. ", Awaiting RFP", ", Due 8/9/2021")
  if (!s || s.startsWith(",")) return "No Client";
  // Try "BMCC - Cooling Tower" → "BMCC"
  const dashIdx = s.indexOf(" - ");
  if (dashIdx > 0 && dashIdx < 35) return s.slice(0, dashIdx).trim();
  return s;
}
interface ClientGroup {
  client: string; color: string; initials: string;
  count: number; totalValue: number;
  leads: number; opps: number; pipeline: number; projects: number; closed: number;
  /** COM-… Company ID when this group matches a real CRMCompany row. */
  ticketId?: string;
  /** Raw CRMCompany fields when this group matches a real company row. */
  co?: CompanyExtraFields;
}
/** Per-company fields from the COM records endpoint (full New-Company form). */
interface CompanyExtraFields {
  shortName?: string; relationshipType?: string; businessType?: string; secondaryBusinessType?: string;
  phone?: string; fax?: string; email?: string; website?: string;
  address?: string; city?: string; state?: string; zip?: string;
  assignedTo?: string; description?: string;
}
function buildClientGroups(items: ClientGroupItem[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>();
  for (const item of items) {
    const raw = cleanClient(item.client);
    const key = raw || extractClient(item.name);
    if (!map.has(key)) {
      map.set(key, { client: key, color: clientColor(key), initials: clientInitials(key), count: 0, totalValue: 0, leads: 0, opps: 0, pipeline: 0, projects: 0, closed: 0 });
    }
    const g = map.get(key)!;
    g.count++;
    g.totalValue += item.value;
    if (item.lifecycle === "Lead") g.leads++;
    else if (item.lifecycle === "Opportunity") g.opps++;
    else if (item.lifecycle === "Pipeline") g.pipeline++;
    else if (item.lifecycle === "Project") g.projects++;
    else g.closed++;
  }
  // Every client gets its own row/card — no "Other clients" catch-all.
  // The Data Grid paginates and the Cards view lazy-renders as you scroll,
  // so large client counts are safe.
  return Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue || b.count - a.count);
}
interface ClientGroupItem {
  id: string; name: string; value: number; status: string; closed: boolean; client: string;
  lifecycle: CompanyLifecycle;
}
type ClientPopupCategory = "All" | "Leads" | "Opportunities" | "Pipeline" | "Projects" | "Closed";
const LIFECYCLE_BY_CATEGORY: Record<Exclude<ClientPopupCategory, "All">, CompanyLifecycle> = {
  Leads: "Lead", Opportunities: "Opportunity", Pipeline: "Pipeline", Projects: "Project", Closed: "Closed",
};
const CATEGORY_BY_LIFECYCLE: Record<CompanyLifecycle, Exclude<ClientPopupCategory, "All">> = {
  Lead: "Leads", Opportunity: "Opportunities", Pipeline: "Pipeline", Project: "Projects", Closed: "Closed",
};
const LIFECYCLE_COLORS: Record<Exclude<ClientPopupCategory, "All">, string> = {
  Leads: "#A9C23F", Opportunities: "#4B9CD3", Pipeline: "#F59E0B", Projects: "#6BA539", Closed: "#94A3B8",
};
function categoryPhrase(category: ClientPopupCategory, n: number): string {
  switch (category) {
    case "All":           return `${n} record${n !== 1 ? "s" : ""}`;
    case "Leads":         return `${n} lead${n !== 1 ? "s" : ""}`;
    case "Opportunities": return `${n} opportunit${n !== 1 ? "ies" : "y"}`;
    case "Pipeline":      return `${n} in pipeline`;
    case "Projects":      return `${n} project${n !== 1 ? "s" : ""}`;
    case "Closed":        return `${n} closed`;
  }
}
function ClientGroupGrid({
  groups, items, noun, onDrilldown,
}: {
  groups: ClientGroup[]; items: ClientGroupItem[]; noun: string; onDrilldown: (client: string) => void;
}) {
  const [, navigate] = useLocation();
  const [popup, setPopup] = useState<{ client: string; color: string; initials: string; category: ClientPopupCategory } | null>(null);
  const [popupItems, setPopupItems] = useState<ClientGroupItem[]>([]);
  const [popupLoading, setPopupLoading] = useState(false);
  const total = groups.reduce((s, g) => s + g.totalValue, 0);

  // Lazy card rendering: start with a screenful and grow automatically as the
  // user scrolls (sentinel + IntersectionObserver — no buttons). Keeps very
  // large client lists (800+) from rendering thousands of cards at once.
  const CARD_BATCH = 60;
  const [visibleCards, setVisibleCards] = useState(CARD_BATCH);
  const cardSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setVisibleCards(CARD_BATCH); }, [groups]);
  useEffect(() => {
    const el = cardSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(en => en.isIntersecting)) {
        setVisibleCards(v => Math.min(v + CARD_BATCH, groups.length));
      }
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [groups.length, visibleCards]);

  const [legendExpanded, setLegendExpanded] = useState(false);

  // Compute popup items asynchronously so the popup shell paints first
  useEffect(() => {
    if (!popup) { setPopupItems([]); return; }
    setPopupLoading(true);
    const id = setTimeout(() => {
      const result = items.filter(item => {
        const key = cleanClient(item.client) || extractClient(item.name);
        if (key !== popup.client) return false;
        if (popup.category === "All") return true;
        return item.lifecycle === LIFECYCLE_BY_CATEGORY[popup.category];
      });
      setPopupItems(result);
      setPopupLoading(false);
    }, 0);
    return () => clearTimeout(id);
  }, [popup, items]);

  const openPopup = (g: ClientGroup, category: ClientPopupCategory, e: React.MouseEvent) => {
    e.stopPropagation();
    setPopup({ client: g.client, color: g.color, initials: g.initials, category });
  };

  const handleCardClick = (g: ClientGroup) => {
    // Open popup immediately — item filtering happens async in the effect above
    setPopup({ client: g.client, color: g.color, initials: g.initials, category: "All" });
  };

  return (
    <div>
      {/* Distribution bar */}
      {groups.length > 0 && (
        <div style={{ margin: "4px 24px 12px", padding: "10px 14px", backgroundColor: BRAND.card, borderRadius: 12, border: `1px solid ${BRAND.cardBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: BRAND.textMuted, marginBottom: 8 }}>DOLLAR VOLUME</div>
          {/* Each segment shows its dollar value above the color bar so the
              graphic is readable without opening every card. */}
          <div style={{ display: "flex", gap: 1 }}>
            {groups.map((g, i, arr) => {
              const share = total > 0 ? Math.max(g.totalValue / total, 0.01) : 1 / arr.length;
              return (
                <div
                  key={g.client}
                  title={`${g.client} — ${g.totalValue > 0 ? fmtM(g.totalValue) : "no value"}`}
                  style={{ flex: share, minWidth: 0 }}
                >
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: g.color, textAlign: "center", marginBottom: 3,
                    whiteSpace: "nowrap", overflow: "visible",
                  }}>
                    {share >= 0.05 ? (g.totalValue > 0 ? fmtM(g.totalValue) : "—") : ""}
                  </div>
                  <div style={{
                    height: 6, backgroundColor: g.color,
                    borderRadius: i === 0 ? "4px 0 0 4px" : i === arr.length - 1 ? "0 4px 4px 0" : 0,
                  }} />
                </div>
              );
            })}
          </div>
          <div style={{
            display: "flex", flexWrap: "wrap", alignItems: "center",
            gap: "8px 10px", marginTop: 8,
            maxHeight: legendExpanded ? 200 : undefined, overflowY: legendExpanded ? "auto" : undefined,
          }}>
            {(legendExpanded ? groups : groups.slice(0, 10)).map(g => (
              <div key={g.client} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                flex: "0 0 auto", maxWidth: "100%",
                padding: "3px 7px", borderRadius: 6,
                backgroundColor: "rgba(255,255,255,0.035)",
                fontSize: 11, color: BRAND.textSecondary, whiteSpace: "nowrap",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: g.color, flexShrink: 0 }} />
                <span style={{ maxWidth: 180, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{g.client}</span>
                {g.totalValue > 0 && (
                  <span style={{ color: g.color, fontWeight: 700, flexShrink: 0 }}>{fmtM(g.totalValue)}</span>
                )}
              </div>
            ))}
            {groups.length > 10 && (
              <button
                onClick={() => setLegendExpanded(v => !v)}
                style={{
                  fontSize: 11, fontWeight: 700, color: BRAND.green, background: "transparent",
                  border: "none", cursor: "pointer", padding: 0,
                }}
              >
                {legendExpanded ? "Show less" : `+${groups.length - 10} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Client cards grid — compact cards, four across on typical screens */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(max(225px, calc(25% - 8px)), 1fr))", gap: 10, padding: "0 24px 24px" }}>
        {groups.slice(0, visibleCards).map(g => {
          const barPct = total > 0 ? (g.totalValue / total) * 100 : 0;
          return (
            <div
              key={g.client}
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(g)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleCardClick(g); }}
              style={{
                textAlign: "left", padding: 12, borderRadius: 12,
                backgroundColor: BRAND.card, border: `1px solid ${BRAND.cardBorder}`,
                cursor: "pointer", transition: "border-color 0.15s", minWidth: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = g.color)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = BRAND.cardBorder)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  backgroundColor: `${g.color}22`, border: `1px solid ${g.color}55`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: g.color,
                }}>
                  {g.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.client}</div>
                  <div style={{ fontSize: 10, color: BRAND.textMuted }}>{g.count} {noun}{g.count !== 1 ? "s" : ""}</div>
                </div>
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: BRAND.textMuted, marginBottom: 3 }}>DOLLAR VOLUME</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: g.color, marginBottom: 6 }}>
                {g.totalValue > 0 ? fmtM(g.totalValue) : "—"}
              </div>
              <div style={{ height: 3, borderRadius: 2, backgroundColor: BRAND.cardBorder, marginBottom: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barPct}%`, backgroundColor: g.color, borderRadius: 2 }} />
              </div>
              {/* Clickable lifecycle stat columns */}
              <div style={{ display: "flex", gap: 0 }}>
                {([
                  { label: "Leads", short: "Leads", val: g.leads },
                  { label: "Opportunities", short: "Opps", val: g.opps },
                  { label: "Pipeline", short: "Pipe", val: g.pipeline },
                  { label: "Projects", short: "Proj", val: g.projects },
                  { label: "Closed", short: "Closed", val: g.closed },
                ] as { label: Exclude<ClientPopupCategory, "All">; short: string; val: number }[]).map(s => (
                  <button
                    key={s.label}
                    onClick={e => openPopup(g, s.label, e)}
                    disabled={s.val === 0}
                    title={`View ${s.label.toLowerCase()}`}
                    style={{
                      flex: 1, textAlign: "left", background: "transparent", border: "none",
                      padding: "4px 3px 3px", borderRadius: 6, cursor: s.val > 0 ? "pointer" : "default",
                      transition: "background 0.12s", minWidth: 0,
                    }}
                    onMouseEnter={e => { if (s.val > 0) e.currentTarget.style.background = `${g.color}18`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.val > 0 ? BRAND.white : BRAND.textMuted }}>{s.val}</div>
                    <div style={{ fontSize: 9, color: BRAND.textMuted }}>{s.short}</div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scroll sentinel — when it nears the viewport the next batch of cards renders */}
      {visibleCards < groups.length && (
        <div ref={cardSentinelRef} style={{ padding: "14px 0 24px", textAlign: "center", fontSize: 11, color: BRAND.textMuted }}>
          Showing {visibleCards} of {groups.length} clients — scroll for more
        </div>
      )}

      {/* Record drill-down popup */}
      {popup && (
        <>
          <div
            onClick={() => setPopup(null)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 80, backdropFilter: "blur(2px)" }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 81, width: "min(520px, 92vw)", maxHeight: "72vh",
            backgroundColor: BRAND.card, border: `1px solid ${BRAND.cardBorder}`,
            borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Popup header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${BRAND.cardBorder}`, flexShrink: 0 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                backgroundColor: `${popup.color}22`, border: `1px solid ${popup.color}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: popup.color,
              }}>
                {popup.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{popup.client}</div>
                <div style={{ fontSize: 11, color: BRAND.textMuted }}>
                  {popupLoading ? "Loading…" : categoryPhrase(popup.category, popupItems.length)}
                </div>
              </div>
              {popup.category !== "All" && (
                <div style={{
                  padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  backgroundColor: `${popup.color}22`, color: popup.color,
                }}>
                  {popup.category}
                </div>
              )}
              <button onClick={() => setPopup(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: BRAND.textMuted, padding: 4, lineHeight: 1 }}>
                <X size={18} />
              </button>
            </div>
            {/* Record list */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {popupLoading ? (
                <div style={{ padding: "40px 20px", textAlign: "center" }}>
                  <div style={{
                    width: 28, height: 28, margin: "0 auto 12px",
                    border: `3px solid ${popup.color}33`,
                    borderTopColor: popup.color,
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }} />
                  <div style={{ fontSize: 13, color: BRAND.textMuted }}>Filtering records…</div>
                </div>
              ) : popupItems.length === 0 ? (
                <div style={{ padding: "32px 20px", textAlign: "center", color: BRAND.textMuted, fontSize: 13 }}>No {noun}s in this category</div>
              ) : (
                popupItems.map((item, i) => (
                  <button
                    key={item.id}
                    onClick={() => { setPopup(null); navigate(`/project/${item.id}`); }}
                    style={{
                      width: "100%", textAlign: "left", background: "transparent",
                      border: "none", borderTop: i > 0 ? `1px solid ${BRAND.cardBorder}` : "none",
                      padding: "12px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${popup.color}0f`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 2 }}>{(item as any).projectId || item.id} · {item.status || "—"}</div>
                    </div>
                    {item.value > 0 && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: popup.color, flexShrink: 0 }}>{fmtM(item.value)}</div>
                    )}
                    <ChevronRight size={14} style={{ color: BRAND.textMuted, flexShrink: 0 }} />
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════ Companies Data Grid — instant AI intelligence + drill-downs ═══════════ */

function companyKeyOf(item: ClientGroupItem): string {
  return cleanClient(item.client) || extractClient(item.name);
}

/** Instant executive analysis for one company — pure template strings from live data. */
function computeCompanyIntel(g: ClientGroup, companyItems: ClientGroupItem[], totalPipeline: number, noun: string) {
  const n = noun.toLowerCase().replace(/s$/, "");
  const plural = (c: number) => `${c} ${n}${c !== 1 ? "s" : ""}`;
  const share = totalPipeline > 0 ? Math.round((g.totalValue / totalPipeline) * 100) : 0;
  const valued = companyItems.filter(it => it.value > 0);
  const avg = valued.length > 0 ? g.totalValue / valued.length : 0;
  const largest = valued.length > 0 ? valued.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const pursuits = g.leads + g.opps + g.pipeline;
  const deliveryLoad = g.projects;

  const ceo = `${g.client} represents ${share > 0 ? `${share}% of your total ${n} pipeline` : `a relationship with no recorded contract value yet`} with ${plural(g.count)}${g.totalValue > 0 ? ` worth ${fmtM(g.totalValue)}` : ""}. ${
    share >= 20 ? "This is a strategic key account — protect the relationship with executive-level touchpoints and priority delivery."
    : share >= 8 ? "A significant client relationship worth cultivating; consistent delivery here strengthens repeat business."
    : "A standard account today — strong performance on current work is the path to growing this relationship."
  }`;

  const cfo = `${g.totalValue > 0 ? `Total book value is ${fmtM(g.totalValue)}${valued.length > 1 ? `, averaging ${fmtM(avg)} per ${n}` : ""}.` : `No contract value is recorded against this client yet — update ${n} values for accurate forecasting.`}${
    largest ? ` Largest engagement: ${largest.name} at ${fmtM(largest.value)}.` : ""
  } ${
    share >= 25 ? "Watch revenue concentration — this client is a large share of the book; monitor payment terms and cash exposure."
    : share >= 10 ? "Meaningful revenue contribution with manageable concentration risk."
    : "Limited concentration risk from this account."
  }`;

  const pursuitParts = [
    g.leads > 0 ? `${g.leads} lead${g.leads !== 1 ? "s" : ""}` : "",
    g.opps > 0 ? `${g.opps} opportunit${g.opps !== 1 ? "ies" : "y"}` : "",
    g.pipeline > 0 ? `${g.pipeline} in pipeline` : "",
  ].filter(Boolean).join(", ");
  const coo = `${g.projects > 0 ? `${g.projects} project${g.projects !== 1 ? "s" : ""} actively in delivery` : `Nothing currently in active delivery`}${pursuits > 0 ? `, ${pursuits} pursuit${pursuits !== 1 ? "s" : ""} in motion (${pursuitParts})` : ""}${g.closed > 0 ? `, and ${g.closed} closed to date` : ""}. ${
    g.projects > 0 ? `Confirm staffing coverage and schedule health on the ${g.projects} active project${g.projects !== 1 ? "s" : ""}.`
    : pursuits > 0 ? `Line up resources now so the ${pursuits} open pursuit${pursuits !== 1 ? "s" : ""} can start without delay when they convert.`
    : "No current delivery load — capacity is free for other clients."
  }`;

  return { share, avg, largest, deliveryLoad, ceo, cfo, coo };
}

const COMPANY_INTEL_POINTS = [
  { key: "ceo", Icon: Target,     color: "#6BA539", tag: "Strategy" },
  { key: "cfo", Icon: DollarSign, color: "#F59E0B", tag: "Financials" },
  { key: "coo", Icon: Zap,        color: "#4B9CD3", tag: "Delivery" },
] as const;

/** Row the grid AI Analysis panel is open for — discriminated by record kind. */
type AiGridTarget =
  | { kind: "project"; rec: Project }
  | { kind: "opp"; rec: Opportunity }
  | { kind: "lead"; rec: Lead };

/**
 * Right slide-in AI intelligence panel for a single project / opportunity /
 * lead row. All copy is derived deterministically from the live record and
 * the currently filtered dataset — no fabricated numbers.
 */
function GridRecordIntelPanel({
  target, peers, onClose, onAskAI, onOpenRecord,
}: {
  target: AiGridTarget;
  /** Aggregates of the currently visible dataset the record belongs to. */
  peers: { count: number; totalValue: number; noun: string };
  onClose: () => void;
  onAskAI: (prompt: string) => void;
  onOpenRecord: (id: string) => void;
}) {
  const { kind, rec } = target;
  const kindLabel = kind === "project" ? "Project" : kind === "opp" ? "Opportunity" : "Lead";
  const accent = kind === "project" ? "#6BA539" : kind === "opp" ? "#4B9CD3" : "#A9C23F";
  const value = rec.value || 0;
  const share = peers.totalValue > 0 && value > 0 ? Math.round((value / peers.totalValue) * 100) : 0;
  const avg = peers.count > 0 ? peers.totalValue / peers.count : 0;
  const fmtV = value > 0 ? fmtM(value) : null;

  let stats: { icon?: React.ReactNode; label: string; value: React.ReactNode; wide?: boolean }[];
  let strategy: string;
  let financials: string;
  let delivery: string;
  let prompt: string;

  if (kind === "project") {
    const p = target.rec;
    const team = countAssignedUserGuids(p.assignedUserGuids);
    stats = [
      { icon: <DollarSign size={11} />, label: "Contract Value", value: fmtV ?? "—" },
      { icon: <Users size={11} />, label: "Team Size", value: String(team) },
      { icon: <Target size={11} />, label: "Portfolio Share", value: share > 0 ? `${share}%` : "—" },
      { icon: <Zap size={11} />, label: "Status", value: p.status || "—" },
    ];
    strategy = `${p.status || "No status"}${p.phase ? ` · ${p.phase} phase` : ""}${p.client ? ` · for ${p.client}` : ""}. ${
      share >= 15 ? "One of the largest engagements in this view — treat it as a flagship with senior oversight and proactive client communication."
      : share >= 5 ? "A significant engagement in the current book — keep momentum with regular status checkpoints."
      : "A standard engagement in this view — consistent delivery here builds repeat business."}`;
    financials = fmtV
      ? `Contract value ${fmtV}${share > 0 ? ` — ${share}% of the visible ${peers.noun} book` : ""}${avg > 0 ? `, vs ${fmtM(avg)} average per ${peers.noun}` : ""}.`
      : "No contract value recorded — add one for accurate portfolio and forecast math.";
    delivery = `${team > 0 ? `${team} team member${team === 1 ? "" : "s"} assigned.` : "No team assigned yet — staff this project to protect the schedule."}${
      p.rawTargetEnd ? ` End date ${fmtGridDate(p.rawTargetEnd)}.` : " No end date set."}`;
    prompt = `Analyze the project "${p.name}" (${p.id}). First fetch the project details and team, then assess schedule health, staffing coverage and financial position, and give me 3-5 specific data-driven recommendations. Be decisive.`;
  } else if (kind === "opp") {
    const o = target.rec;
    const prob = o.probability;
    stats = [
      { icon: <DollarSign size={11} />, label: "Value", value: fmtV ?? "—" },
      { icon: <TrendingUp size={11} />, label: "Weighted", value: o.weightedValue != null ? fmtM(o.weightedValue) : "—" },
      { icon: <Target size={11} />, label: "Win Probability", value: prob != null ? `${prob}%` : "—" },
      { icon: <Zap size={11} />, label: "Days to Bid", value: o.daysLeft != null ? String(o.daysLeft) : "—" },
    ];
    strategy = `${o.stage ? `Currently in ${o.stage}.` : "No stage recorded."} ${
      prob == null ? "No win probability recorded — set one to keep the weighted pipeline honest."
      : prob >= 70 ? "High win probability — prioritize proposal quality and lock in the delivery team early."
      : prob >= 40 ? "Competitive position — sharpen differentiators and use executive sponsorship to move the odds."
      : "Low probability today — qualify hard before committing significant pre-sales effort."}`;
    financials = `${fmtV ? `Valued at ${fmtV}${share > 0 ? ` — ${share}% of the visible pipeline` : ""}.` : "No value recorded — add one for accurate pipeline forecasting."}${
      o.weightedValue != null ? ` Probability-weighted: ${fmtM(o.weightedValue)}.` : ""}`;
    delivery = o.daysLeft == null
      ? "No bid date set — add one to track the pursuit deadline."
      : o.daysLeft < 0 ? `Bid date passed ${Math.abs(o.daysLeft)} day${Math.abs(o.daysLeft) === 1 ? "" : "s"} ago — confirm the outcome and update the stage.`
      : o.daysLeft <= 14 ? `Only ${o.daysLeft} day${o.daysLeft === 1 ? "" : "s"} to bid${o.rawBidDate ? ` (${fmtGridDate(o.rawBidDate)})` : ""} — finalize proposal and pricing now.`
      : `${o.daysLeft} days until bid${o.rawBidDate ? ` (${fmtGridDate(o.rawBidDate)})` : ""} — schedule internal review milestones.`;
    prompt = `Analyze the opportunity "${o.name}" (${o.id})${fmtV ? `, valued at ${fmtV}` : ""}${o.stage ? `, stage: ${o.stage}` : ""}${prob != null ? `, win probability ${prob}%` : ""}. First fetch the details, then assess our win position, pre-staffing readiness and bid timeline, and give me a data-driven plan to improve our odds.`;
  } else {
    const l = target.rec;
    stats = [
      { icon: <DollarSign size={11} />, label: "Est. Value", value: fmtV ?? "—" },
      { icon: <Target size={11} />, label: "Lead Book Share", value: share > 0 ? `${share}%` : "—" },
      { icon: <Layers size={11} />, label: "Sector", value: l.sector && l.sector !== "—" ? l.sector : "—", wide: true },
    ];
    strategy = `${l.status ? `${l.status} lead` : "Lead"}${l.sector && l.sector !== "—" ? ` in the ${l.sector} sector` : ""}${l.client ? ` for ${l.client}` : ""}. ${
      share >= 10 ? "A large potential engagement — assign a senior pursuit owner and reference past wins in this sector."
      : "Qualify it: confirm budget, timeline and decision makers before investing pursuit effort."}`;
    financials = fmtV
      ? `Estimated at ${fmtV}${share > 0 ? ` — ${share}% of the visible lead book` : ""}${avg > 0 ? `, vs ${fmtM(avg)} average per lead` : ""}.`
      : "No estimated value recorded — add one so this lead shows up in pipeline forecasts.";
    delivery = (l.rawDueDate || l.rawTargetEnd)
      ? `Due ${fmtGridDate(l.rawDueDate || l.rawTargetEnd)} — respond before the window closes.`
      : "No due date recorded — set one to keep the pursuit on track.";
    prompt = `I want to pursue the lead "${l.name}" (${l.id})${fmtV ? `, estimated at ${fmtV}` : ""}${l.sector && l.sector !== "—" ? `, sector: ${l.sector}` : ""}. First fetch the lead details, then analyze our past win history in this sector, find similar projects we can reference and available people with matching experience, and give me a data-driven pursuit strategy.`;
  }

  const points = [
    { Icon: Target, color: "#6BA539", text: strategy },
    { Icon: DollarSign, color: "#F59E0B", text: financials },
    { Icon: Zap, color: "#4B9CD3", text: delivery },
  ];

  return (
    <AiInsightPanel
      open
      onClose={onClose}
      title={rec.name}
      subtitle={`AI Intelligence · ${rec.id}`}
      accent={accent}
      badgeText={`AI ${kindLabel} Intelligence — Live Data`}
      stats={stats}
      analysisTags={["Strategy", "Financials", "Delivery"]}
      bullets={points.map(p => ({ icon: <p.Icon size={13} />, tone: p.color, text: p.text }))}
      onAskAI={() => onAskAI(prompt)}
      askLabel="Ask AI"
    >
      <button
        onClick={() => onOpenRecord(rec.id)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "11px 14px", borderRadius: 12, cursor: "pointer",
          border: "1px solid var(--rm-panel-border)", background: "transparent",
          color: "var(--rm-text)", fontSize: 12.5, fontWeight: 700,
        }}
      >
        Open full record
        <ChevronRight size={14} style={{ color: "var(--rm-text-muted)" }} />
      </button>
    </AiInsightPanel>
  );
}

function CompanyIntelPopup({
  g, items, noun, totalPipeline, onClose, onOpenRecord,
}: {
  g: ClientGroup; items: ClientGroupItem[]; noun: string; totalPipeline: number;
  onClose: () => void; onOpenRecord: (id: string) => void;
}) {
  const intel = computeCompanyIntel(g, items, totalPipeline, noun);
  const statusSegs = [
    { label: "Leads",         val: g.leads,    color: LIFECYCLE_COLORS.Leads },
    { label: "Opportunities", val: g.opps,     color: LIFECYCLE_COLORS.Opportunities },
    { label: "Pipeline",      val: g.pipeline, color: LIFECYCLE_COLORS.Pipeline },
    { label: "Projects",      val: g.projects, color: LIFECYCLE_COLORS.Projects },
    { label: "Closed",        val: g.closed,   color: LIFECYCLE_COLORS.Closed },
  ];
  const texts = { ceo: intel.ceo, cfo: intel.cfo, coo: intel.coo };

  return (
    <AiInsightPanel
      open
      onClose={onClose}
      title={g.client}
      subtitle={`${categoryPhrase("All", g.count)} · ${g.totalValue > 0 ? `${fmtM(g.totalValue)} total value` : "no value recorded"}${intel.share > 0 ? ` · ${intel.share}% of pipeline` : ""}`}
      accent={g.color}
      headerIcon={<span style={{ fontSize: 14, fontWeight: 800 }}>{g.initials}</span>}
      badgeText="AI Company Intelligence — Live Data"
      stats={[
        { icon: <Layers size={11} />, label: noun, value: g.count },
        { icon: <DollarSign size={11} />, label: "Total Value", value: g.totalValue > 0 ? fmtM(g.totalValue) : "—" },
      ]}
      mixLabel="Lifecycle mix"
      mix={statusSegs}
      analysisTags={COMPANY_INTEL_POINTS.map(p => p.tag)}
      bullets={COMPANY_INTEL_POINTS.map(p => ({
        icon: <p.Icon size={13} />,
        tone: p.color,
        text: texts[p.key],
      }))}
    >
      {/* Engagements list */}
          {items.length > 0 && (
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: BRAND.textMuted, marginBottom: 7 }}>
                ENGAGEMENTS ({items.length})
              </div>
              <div style={{ borderRadius: 12, border: `1px solid ${BRAND.cardBorder}`, overflow: "hidden" }}>
                {items.map((item, i) => {
                  const sColor = LIFECYCLE_COLORS[CATEGORY_BY_LIFECYCLE[item.lifecycle]];
                  const sLabel = item.lifecycle === "Closed" ? (item.status || "Closed") : (item.status || item.lifecycle);
                  return (
                    <button
                      key={item.id || i}
                      onClick={() => onOpenRecord(item.id)}
                      style={{
                        width: "100%", textAlign: "left", background: "transparent",
                        border: "none", borderTop: i > 0 ? `1px solid ${BRAND.cardBorder}` : "none",
                        padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${g.color}0F`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: BRAND.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                        <div style={{ fontSize: 10.5, color: BRAND.textMuted, marginTop: 1 }}>{item.id}</div>
                      </div>
                      <span style={{
                        padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                        backgroundColor: `${sColor}1F`, border: `1px solid ${sColor}55`, color: sColor, flexShrink: 0,
                      }}>{sLabel}</span>
                      {item.value > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: g.color, flexShrink: 0 }}>{fmtM(item.value)}</span>
                      )}
                      <ChevronRight size={13} style={{ color: BRAND.textMuted, flexShrink: 0 }} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
    </AiInsightPanel>
  );
}

function CompanyDataGridSection({
  groups, items, noun, emptyText,
}: {
  groups: ClientGroup[]; items: ClientGroupItem[]; noun: string; emptyText: string;
}) {
  const [, navigate] = useLocation();
  // Re-render when the admin's Display Defaults land/change (column filtering
  // below happens inline via applyGridColumnDefaults).
  useDisplayDefaultsVersion();
  const [aiPopup, setAiPopup] = useState<ClientGroup | null>(null);
  const [drill, setDrill] = useState<{ g: ClientGroup; category: ClientPopupCategory } | null>(null);

  const totalPipeline = useMemo(() => groups.reduce((s, g) => s + g.totalValue, 0), [groups]);
  const maxGroupValue = useMemo(() => groups.reduce((m, g) => Math.max(m, g.totalValue || 0), 0), [groups]);
  const itemsByCompany = useMemo(() => {
    const m = new Map<string, ClientGroupItem[]>();
    for (const it of items) {
      const k = companyKeyOf(it);
      const arr = m.get(k);
      if (arr) arr.push(it); else m.set(k, [it]);
    }
    return m;
  }, [items]);

  useEffect(() => {
    if (!aiPopup && !drill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDrill(null); setAiPopup(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiPopup, drill]);

  const drillItems = useMemo(() => {
    if (!drill) return [];
    return (itemsByCompany.get(drill.g.client) ?? []).filter(it => {
      if (drill.category === "All") return true;
      return it.lifecycle === LIFECYCLE_BY_CATEGORY[drill.category];
    });
  }, [drill, itemsByCompany]);

  const nLower = noun.toLowerCase().replace(/s$/, "");

  const countCell = (g: ClientGroup, val: number, category: ClientPopupCategory, color: string) => (
    <CountPill
      count={val}
      color={color}
      onClick={() => setDrill({ g, category })}
      title={`View ${category === "All" ? "all" : category.toLowerCase()} ${nLower}s`}
    />
  );

  // Plain-text cell for the raw CRMCompany fields — em-dash when the group has
  // no matching company row (or the field is blank).
  const coTextCell = (v?: string) => v
    ? <span style={{ fontSize: 11.5, color: BRAND.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", maxWidth: "100%" }} title={v}>{v}</span>
    : <span style={{ color: BRAND.textMuted }}>—</span>;

  return (
    <>
      <RecordDataGrid
        columnPreferenceKey="companies"
        rows={groups}
        rowKey={g => g.client}
        onRowClick={g => setAiPopup(g)}
        emptyText={emptyText}
        initialSort={{ key: "totalValue", dir: "desc" }}
        columns={applyGridColumnDefaults<GridColumn<ClientGroup>>("companies", [
          { key: "client", label: "Company", minWidth: 220, maxAuto: 300, hoverTitle: g => g.client || undefined, sortValue: g => g.client, render: g => (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9, maxWidth: "100%" }}>
              <span style={{
                width: 24, height: 24, borderRadius: 999, backgroundColor: g.color, color: "#fff",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 9.5, fontWeight: 800, flexShrink: 0,
              }}>{g.initials}</span>
              <span
                style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={`Open AI analysis for ${g.client}`}
              >{g.client}</span>
            </span>
          ) },
          { key: "companyId", label: "Company ID", width: 122, sortValue: g => g.ticketId ?? "",
            render: g => g.ticketId
              ? <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.textSecondary, whiteSpace: "nowrap" }}>{g.ticketId}</span>
              : <span style={{ color: BRAND.textMuted }}>—</span> },
          // Full New-Company form fields (Aug 2026) — populated for groups that
          // match a real CRMCompany row; admins can trim via Display Defaults.
          { key: "shortName", label: "Abbrev. Name", width: 112, sortValue: g => g.co?.shortName ?? "", render: g => coTextCell(g.co?.shortName) },
          { key: "relType", label: "Relationship", width: 116, sortValue: g => g.co?.relationshipType ?? "", render: g => coTextCell(g.co?.relationshipType) },
          { key: "bizType", label: "Business Type", width: 132, sortValue: g => g.co?.businessType ?? "", render: g => coTextCell(g.co?.businessType) },
          { key: "secBizType", label: "Secondary Type", width: 132, sortValue: g => g.co?.secondaryBusinessType ?? "", render: g => coTextCell(g.co?.secondaryBusinessType) },
          { key: "phone", label: "Phone", width: 118, sortValue: g => g.co?.phone ?? "", render: g => coTextCell(g.co?.phone) },
          { key: "fax", label: "Fax", width: 112, sortValue: g => g.co?.fax ?? "", render: g => coTextCell(g.co?.fax) },
          { key: "email", label: "Email", width: 160, sortValue: g => g.co?.email ?? "", render: g => coTextCell(g.co?.email) },
          { key: "addr", label: "Address", width: 170, sortValue: g => g.co?.address ?? "", render: g => coTextCell(g.co?.address) },
          { key: "cityState", label: "City / State", width: 126,
            sortValue: g => [g.co?.city, g.co?.state].filter(Boolean).join(", "),
            render: g => coTextCell([g.co?.city, g.co?.state].filter(Boolean).join(", ") || undefined) },
          { key: "zip", label: "Zip", width: 76, sortValue: g => g.co?.zip ?? "", render: g => coTextCell(g.co?.zip) },
          { key: "assignedTo", label: "Assigned To", width: 126, sortValue: g => g.co?.assignedTo ?? "", render: g => coTextCell(g.co?.assignedTo) },
          { key: "description", label: "Description", width: 190, sortValue: g => g.co?.description ?? "", render: g => coTextCell(g.co?.description) },
          { key: "leads", label: "Leads", width: 92, align: "center", sortValue: g => g.leads,
            render: g => countCell(g, g.leads, "Leads", LIFECYCLE_COLORS.Leads) },
          { key: "opps", label: "Opportunities", width: 118, align: "center", sortValue: g => g.opps,
            render: g => countCell(g, g.opps, "Opportunities", LIFECYCLE_COLORS.Opportunities) },
          { key: "pipeline", label: "Pipeline", width: 96, align: "center", sortValue: g => g.pipeline,
            render: g => countCell(g, g.pipeline, "Pipeline", LIFECYCLE_COLORS.Pipeline) },
          { key: "projects", label: "Projects", width: 96, align: "center", sortValue: g => g.projects,
            render: g => countCell(g, g.projects, "Projects", LIFECYCLE_COLORS.Projects) },
          { key: "closed", label: "Closed", width: 92, align: "center", sortValue: g => g.closed,
            render: g => countCell(g, g.closed, "Closed", LIFECYCLE_COLORS.Closed) },
          { key: "totalValue", label: "Total Value", width: 128, align: "right", sortValue: g => g.totalValue,
            render: g => g.totalValue > 0
              ? <ValueBar text={fmtM(g.totalValue)} frac={maxGroupValue > 0 ? g.totalValue / maxGroupValue : 0} color="#6BA539" />
              : <span style={{ color: BRAND.textMuted }}>—</span> },
          { key: "ai", label: "AI", width: 56, align: "center", noSort: true, stickyRight: true, render: g => (
            <AiAnalyzeButton onClick={() => setAiPopup(g)} title={`AI analysis for ${g.client}`} />
          ) },
        ])}
      />

      {/* AI company intelligence popup */}
      {aiPopup && (
        <CompanyIntelPopup
          g={aiPopup}
          items={itemsByCompany.get(aiPopup.client) ?? []}
          noun={noun}
          totalPipeline={totalPipeline}
          onClose={() => setAiPopup(null)}
          onOpenRecord={id => { setAiPopup(null); navigate(`/project/${id}`); }}
        />
      )}

      {/* Count drill-down popup */}
      {drill && (
        <>
          <div onClick={() => setDrill(null)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 80, backdropFilter: "blur(2px)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 81, width: "min(520px, 92vw)", maxHeight: "72vh",
            backgroundColor: BRAND.card, border: `1px solid ${BRAND.cardBorder}`,
            borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${BRAND.cardBorder}`, flexShrink: 0 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                backgroundColor: `${drill.g.color}22`, border: `1px solid ${drill.g.color}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: drill.g.color,
              }}>{drill.g.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{drill.g.client}</div>
                <div style={{ fontSize: 11, color: BRAND.textMuted }}>
                  {categoryPhrase(drill.category, drillItems.length)}
                </div>
              </div>
              {drill.category !== "All" && (
                <div style={{
                  padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  backgroundColor: `${drill.g.color}22`, color: drill.g.color,
                }}>{drill.category}</div>
              )}
              <button onClick={() => setDrill(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: BRAND.textMuted, padding: 4, lineHeight: 1 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {drillItems.length === 0 ? (
                <div style={{ padding: "32px 20px", textAlign: "center", color: BRAND.textMuted, fontSize: 13 }}>No {nLower}s in this category</div>
              ) : (
                drillItems.map((item, i) => (
                  <button
                    key={item.id || i}
                    onClick={() => { setDrill(null); navigate(`/project/${item.id}`); }}
                    style={{
                      width: "100%", textAlign: "left", background: "transparent",
                      border: "none", borderTop: i > 0 ? `1px solid ${BRAND.cardBorder}` : "none",
                      padding: "12px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${drill.g.color}0f`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: BRAND.textMuted, marginTop: 2 }}>{item.id} · {item.closed ? "Closed" : item.status || "—"}</div>
                    </div>
                    {item.value > 0 && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: drill.g.color, flexShrink: 0 }}>{fmtM(item.value)}</div>
                    )}
                    <ChevronRight size={14} style={{ color: BRAND.textMuted, flexShrink: 0 }} />
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function FilterChipRow({
  filters, active, onSelect, trailing, labelMap,
}: {
  filters: readonly string[];
  active: string;
  onSelect: (f: string) => void;
  trailing?: React.ReactNode;
  /** Optional display-label overrides keyed by filter value. */
  labelMap?: Record<string, string>;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 24px", flexWrap: "wrap" }}>
      {filters.map(f => {
        const sel = f === active;
        const label = labelMap?.[f] ?? f;
        return (
          <button key={f} onClick={() => onSelect(f)}
            style={{
              padding: "6px 14px", borderRadius: 999, whiteSpace: "nowrap",
              backgroundColor: sel ? BRAND.greenBg : BRAND.card,
              border: `1px solid ${sel ? BRAND.greenBg : BRAND.cardBorder}`,
              color: sel ? BRAND.white : BRAND.textSecondary,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
            {label}
          </button>
        );
      })}
      {trailing && <div style={{ marginLeft: "auto" }}>{trailing}</div>}
    </div>
  );
}

const PAGE_SIZE = 20;

type SearchStatusNoticeData = {
  noun: "project" | "opportunity" | "lead";
  label: string;
  count: number;
  onClick: () => void;
};

function SearchStatusNotice({ notice }: { notice: SearchStatusNoticeData | null }) {
  if (!notice) return null;
  const noun = `${notice.noun}${notice.count === 1 ? "" : "s"}`;
  return (
    <div
      role="status"
      style={{
        margin: "0 24px 12px",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        borderRadius: 10,
        backgroundColor: "rgba(248,113,113,0.10)",
        border: "1px solid rgba(248,113,113,0.30)",
        color: BRAND.red,
        fontSize: 12,
        fontWeight: 600,
        textAlign: "center",
      }}
    >
      <AlertCircle size={14} />
      <span>
        {notice.count} {noun} {notice.count === 1 ? "is" : "are"} available in {notice.label}.{" "}
        <button
          onClick={notice.onClick}
          style={{
            padding: 0,
            background: "none",
            border: "none",
            color: BRAND.red,
            font: "inherit",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          View {notice.label} →
        </button>
      </span>
    </div>
  );
}

function ListBody({
  isLoading, isError, empty, emptyText, emptyIcon, header, totalCount, children,
  layout = "list", gridMinPx = 280,
  totalUnfiltered, onViewClosed, onRefresh,
}: {
  isLoading: boolean;
  isError: boolean;
  empty: boolean;
  emptyText: string;
  emptyIcon: "briefcase" | "trending-up" | "star";
  header?: React.ReactNode;
  totalCount?: number;
  children: React.ReactNode;
  layout?: "list" | "grid";
  gridMinPx?: number;
  totalUnfiltered?: number;
  onViewClosed?: () => void;
  onRefresh?: () => void;
}) {
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "60px 20px", gap: 12 }}>
        <Loader2 size={32} color={BRAND.green} className="animate-spin" />
        <div style={{ color: BRAND.textSecondary, fontSize: 13 }}>Fetching live data…</div>
      </div>
    );
  }
  if (isError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "60px 20px", gap: 12 }}>
        <CloudOff size={32} color={BRAND.textMuted} />
        <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>APIs under development</div>
        <div style={{ color: BRAND.textSecondary, fontSize: 12, textAlign: "center", maxWidth: 380 }}>
          Our APIs are currently under development and aren't responding right now. Please refresh in a few moments.
        </div>
      </div>
    );
  }
  if (empty) {
    const Icon = emptyIcon === "briefcase" ? Briefcase : emptyIcon === "trending-up" ? TrendingUp : Star;
    const allClosed = (totalUnfiltered ?? 0) > 0;
    return (
      <>
        {header}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "60px 20px", gap: 12 }}>
          <Icon size={32} color={BRAND.textMuted} />
          <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>No results</div>
          <div style={{ color: BRAND.textSecondary, fontSize: 12, textAlign: "center" }}>{emptyText}</div>
          {allClosed && onViewClosed && (
            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ color: BRAND.textMuted, fontSize: 11 }}>
                {totalUnfiltered} record{totalUnfiltered === 1 ? "" : "s"} exist but are marked closed
              </div>
              <button
                onClick={onViewClosed}
                style={{ background: "none", border: `1px solid ${BRAND.cardBorder}`, color: BRAND.green,
                  borderRadius: 8, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}
              >
                View Closed →
              </button>
            </div>
          )}
          {onRefresh && !allClosed && (
            <button
              onClick={onRefresh}
              style={{ marginTop: 4, background: "none", border: `1px solid ${BRAND.cardBorder}`,
                color: BRAND.textSecondary, borderRadius: 8, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}
            >
              Refresh
            </button>
          )}
        </div>
      </>
    );
  }
  const rendered = Children.toArray(children);
  const total = totalCount ?? rendered.length;
  const hasMore = rendered.length < total;
  const containerStyle: React.CSSProperties = layout === "grid"
    ? { display: "grid", gap: 10, padding: "0 24px",
        gridTemplateColumns: `repeat(auto-fill, minmax(max(340px, calc(25% - 8px)), 1fr))`,
        alignItems: "stretch" }
    : { display: "flex", flexDirection: "column", gap: 12, padding: "0 24px" };
  return (
    <div style={{ paddingBottom: 80 }}>
      {header}
      <div style={containerStyle}>
        {rendered}
      </div>
      {hasMore && (
        <div style={{ textAlign: "center", padding: "16px 0", color: BRAND.textSecondary, fontSize: 12 }}>
          Showing {rendered.length} of {total}
        </div>
      )}
    </div>
  );
}

function listHealthColor(score: number): string {
  if (score >= 80) return "#6BA539";
  if (score >= 60) return "#E87722";
  return "#E03C3C";
}

function listHealthLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}

// LIST-VIEW HEALTH PROXY (NOT the shared computeHealth)
// The pipeline list does not load full team allocations or schedule details, so
// this is a deliberate quick-signal score using only fields available on the
// list card. The detail page renders the authoritative gauge from
// @workspace/health computeHealth(). Buckets are aligned with the PMM weights
// in lib/health/src/index.ts where possible (target dates 25, contract value
// 10, team 50, runway 15) but unique behaviour is documented inline.
function countAssignedUserGuids(s: string): number {
  if (!s) return 0;
  return new Set(s.split("|").map((t) => t.trim()).filter((t) => t.length > 0)).size;
}

interface ListHealthCheck {
  label: string;
  weight: number;
  passed: boolean;
  failText?: string;
}

interface ListHealthResult {
  score: number;
  checks: ListHealthCheck[];
}

function summariseChecks(checks: ListHealthCheck[]): ListHealthResult {
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { score: Math.max(0, Math.min(100, score)), checks };
}

function listProjectHealth(p: Project): ListHealthResult {
  const teamCount = countAssignedUserGuids(p.assignedUserGuids);
  const targetStartReal = !!p.rawTargetStart && !p.rawTargetStart.startsWith("0001");
  const targetEndReal = !!p.rawTargetEnd && !p.rawTargetEnd.startsWith("0001");
  const today = Date.now();
  const checks: ListHealthCheck[] = [];
  checks.push({
    label: "Target start date set", weight: 15,
    passed: p.hasSchedule || targetStartReal,
    failText: "Missing target start date",
  });
  checks.push({
    label: "Target completion date set", weight: 10,
    passed: p.hasSchedule || targetEndReal,
    failText: "Missing target completion date",
  });
  checks.push({
    label: "Contract Value set", weight: 10,
    passed: p.value >= 1000,
    failText: p.value === 0 ? "Contract Value is empty" : "Contract Value below $1,000",
  });
  checks.push({
    label: "Team assigned", weight: 25,
    passed: teamCount > 0,
    failText: "No team members assigned",
  });
  checks.push({
    label: "Team adequately staffed (3+)", weight: 10,
    passed: teamCount >= 3,
    failText: teamCount === 0 ? "No team members" : `Only ${teamCount} member${teamCount === 1 ? "" : "s"}`,
  });
  // PM check from list view is approximate — list rows don't carry role info,
  // so we credit any team and only flag empty teams.
  checks.push({
    label: "Project Manager assigned (approx)", weight: 15,
    passed: teamCount > 0,
    failText: "Cannot confirm PM — no team assigned",
  });
  // Runway / overdue
  let runwayPassed = false;
  let runwayText = "";
  let runwayWeight = 20;
  if (p.closed) {
    runwayPassed = true;
  } else {
    const targetMs = targetEndReal ? new Date(p.rawTargetEnd).getTime() : 0;
    if (targetMs > 0 && targetMs < today) {
      runwayPassed = false;
      const days = Math.floor((today - targetMs) / 86400000);
      runwayText = `${days} day${days === 1 ? "" : "s"} past target completion`;
    } else if (targetMs > 0) {
      const daysLeft = Math.floor((targetMs - today) / 86400000);
      if (daysLeft >= 30) {
        runwayPassed = true;
      } else {
        runwayPassed = false;
        runwayWeight = 5;
        runwayText = `Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} of runway left`;
      }
    } else if (p.hasSchedule) {
      runwayPassed = true;
    } else {
      runwayPassed = false;
      runwayText = "No schedule or target end date";
    }
  }
  checks.push({ label: "Schedule on track", weight: runwayWeight, passed: runwayPassed, failText: runwayText });
  return summariseChecks(checks);
}

function listOppHealth(o: Opportunity): ListHealthResult {
  // Mirrors shared OPM computeHealth: status set (10) + value (15) +
  // probability (10) + active (30) = 65 baseline. Remaining 35 pts are
  // list-only proxy signals (bid window scheduled, comfortable bid runway,
  // owner/team assigned) so the gauge is informative even when the upstream
  // record is otherwise minimal.
  const lostStatuses = ["lost", "declined", "cancelled", "dead"];
  const isLost = lostStatuses.includes((o.stage || "").toLowerCase());
  const teamCount = countAssignedUserGuids(o.assignedUserGuids);
  const checks: ListHealthCheck[] = [
    { label: "Opportunity status set", weight: 10, passed: !!o.stage, failText: "Missing status" },
    {
      label: "Contract Value set", weight: 15, passed: o.value >= 1000,
      failText: o.value === 0 ? "Contract Value is empty" : "Contract Value below $1,000",
    },
    { label: "Win probability set", weight: 10, passed: o.probability > 0, failText: "Win probability is 0%" },
    { label: "Opportunity active", weight: 30, passed: !isLost, failText: isLost ? `Status: ${o.stage}` : undefined },
    {
      label: "Bid date scheduled", weight: 15,
      passed: !!o.bidDate && o.daysLeft >= 0 && o.daysLeft < 999,
      failText: "No bid date scheduled",
    },
    {
      label: "Comfortable bid runway (10+ days)", weight: 10, passed: o.daysLeft >= 10,
      failText: o.daysLeft < 0 ? "Bid date in the past" : `Only ${o.daysLeft} days to bid`,
    },
    { label: "Owner / team assigned", weight: 10, passed: teamCount > 0, failText: "No owner/team assigned" },
  ];
  return summariseChecks(checks);
}

function listLeadHealth(l: Lead): ListHealthResult {
  // Lead-specific health checks — leads carry no probability, bid window or
  // phase, so score only the fields a lead actually has.
  const lostStatuses = ["lost", "declined", "cancelled", "dead"];
  const isLost = lostStatuses.includes((l.status || "").toLowerCase());
  const teamCount = countAssignedUserGuids(l.assignedUserGuids);
  const checks: ListHealthCheck[] = [
    { label: "Lead status set", weight: 10, passed: !!l.status && l.status !== "—", failText: "Missing status" },
    {
      label: "Estimated value set", weight: 25, passed: l.value >= 1000,
      failText: l.value === 0 ? "Estimated value is empty" : "Estimated value below $1,000",
    },
    { label: "Lead active", weight: 30, passed: !isLost, failText: isLost ? `Status: ${l.status}` : undefined },
    { label: "Due date scheduled", weight: 15, passed: !!(l.rawDueDate || l.rawTargetEnd), failText: "No due date set" },
    { label: "Client identified", weight: 10, passed: !!l.client, failText: "No client company" },
    { label: "Owner / team assigned", weight: 10, passed: teamCount > 0, failText: "No owner/team assigned" },
  ];
  return summariseChecks(checks);
}

function MiniHealthGauge({
  score, size = 84, onDetails,
}: { score: number; size?: number; onDetails?: (e: React.MouseEvent) => void }) {
  const color = listHealthColor(score);
  const label = listHealthLabel(score);
  const stroke = 7;
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rm-panel-border)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", lineHeight: 1,
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--rm-text)" }}>{score}</div>
          <div style={{ fontSize: 8, fontWeight: 700, color: "var(--rm-text-muted)", marginTop: 2, letterSpacing: 0.5 }}>/100</div>
        </div>
      </div>
      <div style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: 0.7, textTransform: "uppercase" }}>
        {label}
      </div>
      {onDetails && (
        <button
          onClick={(e) => { e.stopPropagation(); onDetails(e); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "3px 8px", borderRadius: 999,
            border: `1px solid ${color}55`, backgroundColor: color + "12",
            color, fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
            cursor: "pointer", textTransform: "uppercase",
          }}
        >
          <Info size={9} /> Details
        </button>
      )}
    </div>
  );
}

function HealthDetailModal({
  title, recordId, result, onClose,
}: {
  title: string;
  recordId: string;
  result: ListHealthResult;
  onClose: () => void;
}) {
  const color = listHealthColor(result.score);
  const label = listHealthLabel(result.score);
  const failed = result.checks.filter((c) => !c.passed);
  const passed = result.checks.filter((c) => c.passed);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto",
          backgroundColor: "var(--rm-panel)", color: "var(--rm-text)",
          borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.30)",
          border: "1px solid var(--rm-panel-border)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px", borderBottom: "1px solid var(--rm-panel-border)",
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--rm-text-muted)", letterSpacing: 1, textTransform: "uppercase" }}>
              Quick Health Check
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--rm-text)", marginTop: 2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </div>
            <div style={{ fontSize: 11, color: "var(--rm-text-muted)", marginTop: 1 }}>{recordId}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 30, height: 30, borderRadius: 8, border: "1px solid var(--rm-panel-border)",
            backgroundColor: "var(--rm-panel)", color: "var(--rm-text-muted)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}><X size={14} /></button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0 6px" }}>
          <MiniHealthGauge score={result.score} size={130} />
        </div>
        <div style={{ textAlign: "center", paddingBottom: 10 }}>
          <span style={{
            display: "inline-block", padding: "4px 12px", borderRadius: 999,
            backgroundColor: color + "1A", color, fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
          }}>{label}</span>
        </div>

        <div style={{ padding: "0 18px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--rm-text-muted)", letterSpacing: 1,
            marginTop: 8, marginBottom: 6, textTransform: "uppercase" }}>
            What needs attention ({failed.length})
          </div>
          {failed.length === 0 ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              borderRadius: 8, backgroundColor: "#6BA53914", border: "1px solid #6BA53940",
            }}>
              <Check size={14} color="#6BA539" />
              <span style={{ fontSize: 12, color: "#3A6622", fontWeight: 700 }}>All checks passed</span>
            </div>
          ) : (
            failed.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderBottom: i < failed.length - 1 ? "1px solid var(--rm-panel-border)" : "none",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#E03C3C", flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, color: "var(--rm-text)", lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>{c.label}</span>
                  {c.failText && <span style={{ color: "var(--rm-text-muted)" }}> — {c.failText}</span>}
                </span>
                <span style={{
                  padding: "2px 7px", borderRadius: 6, backgroundColor: "#E03C3C18",
                  color: "#E03C3C", fontWeight: 800, fontSize: 11, letterSpacing: 0.3,
                }}>−{c.weight}</span>
              </div>
            ))
          )}

          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--rm-text-muted)", letterSpacing: 1,
            marginTop: 16, marginBottom: 6, textTransform: "uppercase" }}>
            Passed ({passed.length})
          </div>
          {passed.map((c, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
              borderBottom: i < passed.length - 1 ? "1px solid var(--rm-panel-border)" : "none",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "var(--rm-green)", flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, color: "var(--rm-text)", lineHeight: 1.4 }}>{c.label}</span>
              <span style={{
                padding: "2px 7px", borderRadius: 6, backgroundColor: "#6BA53918",
                color: "#6BA539", fontWeight: 800, fontSize: 11, letterSpacing: 0.3,
              }}>+{c.weight}</span>
            </div>
          ))}

          <div style={{
            marginTop: 14, padding: "10px 12px", borderRadius: 8,
            backgroundColor: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
            fontSize: 11, color: "var(--rm-text-muted)", lineHeight: 1.5,
          }}>
            This is a quick-signal score from list-view data. Open Details for the
            full breakdown including team allocations, schedule lifecycle, and the
            authoritative health score.
          </div>
        </div>
      </div>
    </div>
  );
}

type ProjectConflict = {
  name: string; role: string; thisPct: number; thisHrs: number;
  otherProjects: { id: string; name: string; pct: number; hrs: number }[];
};

function ProjectCard({
  p, staffing, staffingWindowDays, inCompare, compareMode, holdInfo, teamCount: teamCountProp, openCount, conflicts, onDetails, onReallocate, onTeam, onMenu, onMemberAnalysis, onConflictAI,
}: {
  p: Project;
  staffing?: { count: number; avgPct: number; fte: number; topRole: string | null; roles: string[] };
  staffingWindowDays?: number;
  inCompare?: boolean;
  compareMode?: boolean;
  holdInfo?: HoldInfo | null;
  teamCount?: number;
  openCount?: number;
  conflicts?: ProjectConflict[];
  onDetails: () => void;
  onReallocate: () => void;
  onTeam: () => void;
  onMenu: (action: string) => void;
  onMemberAnalysis?: (c: ProjectConflict, projectName: string, projectId: string) => void;
  onConflictAI?: () => void;
}) {
  const pc = phaseColor(p.phase);
  const hasActual = p.hasSchedule && !!(p.rawActualStart || p.rawActualEnd);
  const hasTarget = !!(p.rawTargetStart || p.rawTargetEnd);
  const teamCount = teamCountProp != null
    ? teamCountProp
    : p.assignedUserGuids
      ? p.assignedUserGuids.split(/[,;]/).filter(s => s.trim().length > 0).length
      : 0;
  const daysVsTarget = (() => {
    if (!hasActual || !p.rawTargetEnd || !p.rawActualEnd) return null;
    const t = new Date(p.rawTargetEnd).getTime();
    const a = new Date(p.rawActualEnd).getTime();
    if (isNaN(t) || isNaN(a)) return null;
    return Math.round((a - t) / 86400000);
  })();
  const scheduleStatus = hasActual ? "actual" : hasTarget ? "target_only" : "none";
  const insightFields: Record<string, unknown> = {
    name: p.name,
    phase: p.phase,
    status: p.status,
    valueUSD: p.value,
    hasSchedule: p.hasSchedule,
    scheduleStatus,
    teamCount,
    targetStart: p.rawTargetStart || null,
    targetEnd: p.rawTargetEnd || null,
    actualStart: p.rawActualStart || null,
    actualEnd: p.rawActualEnd || null,
    closed: p.closed,
    forecastCostUSD: p.forecastCost || null,
    laborContractUSD: p.laborContract || null,
    sector: p.sector || null,
    division: p.division || null,
    city: p.city || null,
    daysInCurrentPhase: p.daysInPhase,
    staffingDemandCount: staffing?.count ?? 0,
    staffingAvgPct: staffing?.avgPct ?? 0,
    staffingFTE: staffing?.fte ?? 0,
    staffingTopRoles: staffing?.roles?.slice(0, 3).join(", ") || null,
  };
  const healthResult = listProjectHealth(p);
  const [healthOpen, setHealthOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const isOnHold = p.rawStatus === "On Hold" || !!holdInfo;
  return (
    <div onClick={onDetails}
      onMouseEnter={() => hoverPrefetchProject(p.id)}
      onMouseLeave={cancelHoverPrefetch}
      style={{
        backgroundColor: BRAND.cardWhite, color: BRAND.cardText, borderRadius: 14,
        padding: "10px 14px", cursor: "pointer",
        border: isOnHold ? `1px solid ${BRAND.orange}60` : "1px solid var(--rm-panel-border)",
        borderLeft: isOnHold ? `4px solid ${BRAND.orange}` : undefined,
        boxShadow: isOnHold ? `0 1px 6px ${BRAND.orange}22` : "0 1px 3px rgba(0,0,0,0.08)",
        position: "relative", display: "flex", flexDirection: "column", height: "100%",
      }}>
      {healthOpen && (
        <HealthDetailModal title={p.name} recordId={p.id} result={healthResult}
          onClose={() => setHealthOpen(false)} />
      )}
      {isOnHold && (
        <div onClick={(e) => e.stopPropagation()} style={{
          margin: "-10px -14px 10px",
          padding: "6px 12px",
          backgroundColor: BRAND.orange + "18",
          borderBottom: `1px solid ${BRAND.orange}30`,
          borderRadius: "13px 13px 0 0",
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        }}>
          <Pause size={11} color={BRAND.orange} />
          <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.orange, letterSpacing: 0.5 }}>ON HOLD</span>
          {holdInfo?.reason && (
            <span style={{ fontSize: 11, color: BRAND.orange, opacity: 0.85 }}>· {holdInfo.reason}</span>
          )}
          {holdInfo?.tillDate && (
            <span style={{ fontSize: 10, color: BRAND.cardMuted, marginLeft: "auto" }}>
              Until {new Date(holdInfo.tillDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          {holdInfo?.comments && (
            <span style={{
              width: "100%", fontSize: 10, color: BRAND.cardMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{holdInfo.comments}</span>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6,
              padding: "2px 10px", borderRadius: 999,
              backgroundColor: pc + "18", border: `1px solid ${pc}50` }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: pc }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: pc }}>{p.phase}</span>
            </div>
            <ScheduleStatusChip label={p.displayStatus || p.rawStatus || p.status} />
            <StageFlowDots mod="PMM" stage={p.displayStatus || p.rawStatus || p.status} closed={p.closed} raw={p.raw} />
            {p.office && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: BRAND.cardMuted, fontSize: 11 }}>
                <Building2 size={9} />
                <span>{p.office}</span>
              </div>
            )}
            {p.city && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: BRAND.cardMuted, fontSize: 11 }}>
                <MapPin size={9} />
                <span>{p.city}</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: BRAND.cardText,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {p.name}
          </div>
          <div style={{ fontSize: 11, color: BRAND.cardMuted, marginTop: 2, marginBottom: 4 }}>{p.projectId || p.id}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {(compareMode || inCompare) && (
            <button
              onClick={(e) => { e.stopPropagation(); onMenu("compare"); }}
              title={inCompare ? "Remove from compare" : "Select to compare"}
              style={{
                width: 18, height: 18, borderRadius: 3, padding: 0, cursor: "pointer",
                border: inCompare ? `2px solid ${BRAND.green}` : `2px solid var(--rm-panel-border)`,
                backgroundColor: inCompare ? BRAND.green : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 0.12s, border-color 0.12s",
                boxShadow: inCompare ? `0 0 0 3px ${BRAND.green}22` : "none",
              }}
            >
              {inCompare && <Check size={11} color="#fff" strokeWidth={3} />}
            </button>
          )}
          <CardContextMenu
            inCompare={inCompare}
            isOnHold={p.rawStatus === "On Hold"}
            items={projectMenuItems(p, inCompare)}
            onAction={onMenu}
          />
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: BRAND.cardLabel, fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>
          PROJECT TIMELINE
        </div>
        {/* ONE date pair (client rule): rawTargetStart/End are already the
            effective dates — schedule-derived when a phase schedule exists,
            Target-date fallback otherwise. Never show two rows. */}
        {hasTarget ? (
          <TimelinePill
            color={BRAND.green}
            label={p.datesFromSchedule ? "Schedule:" : "Target:"}
            range={`${fmtShort(p.rawTargetStart)} – ${fmtShort(p.rawTargetEnd)}`}
          />
        ) : (
          <TimelinePill color="#F59E0B" label="Schedule:" range="Not set — tap Details to build" />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "5px 0", borderTop: `1px solid var(--rm-panel-border)` }}>
        <span style={{ fontSize: 9, color: BRAND.cardLabel, fontWeight: 700, letterSpacing: 1 }}>
          CONTRACT VALUE
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: p.value === 0 ? BRAND.cardMuted : BRAND.cardText }}>
          {p.value > 0 ? fmtM(p.value) : "—"}
        </span>
      </div>

      {!p.closed && staffing && staffing.count > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "5px 0", borderTop: `1px solid var(--rm-panel-border)`, gap: 12 }}>
          <span style={{ fontSize: 9, color: BRAND.greenLight, fontWeight: 800, letterSpacing: 1, flexShrink: 0, lineHeight: "14px", whiteSpace: "pre-line" }}>
            {"STAFFING\nDEMAND"}
          </span>
          <div style={{ flex: 1, textAlign: "right", minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.greenLight }}>
              {staffing.count} req{staffing.count === 1 ? "" : "s"} · avg {staffing.avgPct}% · ~{staffing.fte} FTE
            </div>
            {staffing.roles && staffing.roles.length > 0 && (
              <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.cardMuted, marginTop: 2 }}>
                {staffing.roles.slice(0, 3).join(", ")}{staffing.roles.length > 3 ? ` +${staffing.roles.length - 3}` : ""}
              </div>
            )}
          </div>
        </div>
      )}

      <CardInsight kind="project" id={p.id} fields={insightFields} />

      <div style={{ marginTop: "auto", paddingTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        {p.note && (
          <div onClick={(e) => e.stopPropagation()} style={{
            display: "flex", alignItems: "flex-start", gap: 6,
            padding: "6px 10px", borderRadius: 8,
            backgroundColor: "var(--rm-panel-soft)",
            border: "1px solid var(--rm-panel-border)",
          }}>
            <FileText size={11} color={BRAND.cardMuted} style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{
              fontSize: 11, color: BRAND.cardMuted, lineHeight: 1.4,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>{p.note}</span>
          </div>
        )}
        {conflicts && conflicts.length > 0 && (() => {
          const overlapPct = teamCount > 0 ? Math.round((conflicts.length / teamCount) * 100) : 0;
          return (
            <div onClick={e => e.stopPropagation()} style={{
              borderRadius: 8, border: "1px solid #F59E0B50",
              backgroundColor: "#F59E0B08", overflow: "hidden",
            }}>
              <button
                onClick={e => { e.stopPropagation(); setConflictOpen(v => !v); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", cursor: "pointer",
                  backgroundColor: "transparent", border: "none",
                  color: "#B45309", fontSize: 11, fontWeight: 700,
                }}>
                <AlertTriangle size={11} color="#F59E0B" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>
                  {conflicts.length} shared member{conflicts.length === 1 ? "" : "s"}
                  <span style={{ fontWeight: 400, color: "#D97706", marginLeft: 4 }}>· {overlapPct}% team overlap</span>
                </span>
                {onConflictAI && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); onConflictAI(); }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onConflictAI(); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 3,
                      padding: "2px 7px", borderRadius: 10,
                      border: "1px solid #F59E0B60",
                      backgroundColor: "#F59E0B15",
                      color: "#B45309", fontSize: 10, fontWeight: 700,
                      cursor: "pointer", flexShrink: 0,
                    }}>
                    <Sparkles size={9} />
                    Ask AI
                  </span>
                )}
                <ChevronDown size={10} style={{ flexShrink: 0, transform: conflictOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              {conflictOpen && (
                <div style={{ borderTop: "1px solid #F59E0B30" }}>
                  {conflicts.map((c, ci) => (
                    <div key={ci} style={{
                      padding: "8px 10px",
                      borderTop: ci > 0 ? "1px solid #F59E0B20" : "none",
                    }}>
                      {/* Member header — clickable for AI analysis */}
                      <div
                        onClick={e => { e.stopPropagation(); onMemberAnalysis?.(c, p.name, p.id); }}
                        title="Click for AI conflict analysis"
                        style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, cursor: onMemberAnalysis ? "pointer" : "default", borderRadius: 6, padding: "2px 4px", margin: "-2px -4px 4px", transition: "background 0.12s" }}
                        onMouseEnter={e => { if (onMemberAnalysis) (e.currentTarget as HTMLDivElement).style.background = "#F59E0B18"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                      >
                        <div style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#F59E0B22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <User size={11} color="#F59E0B" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.cardText }}>{c.name}</div>
                          {c.role && <div style={{ fontSize: 10, color: BRAND.cardMuted }}>{c.role}</div>}
                        </div>
                        {/* Allocation on this project */}
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309" }}>{c.thisPct}%</div>
                          <div style={{ fontSize: 9, color: BRAND.cardMuted }}>{Math.round(c.thisHrs)}h here</div>
                        </div>
                      </div>
                      {/* Other projects comparison */}
                      {c.otherProjects.map((op, oi) => (
                        <div key={oi} style={{
                          display: "flex", alignItems: "center", gap: 6, paddingLeft: 29,
                          marginBottom: oi < c.otherProjects.length - 1 ? 3 : 0,
                        }}>
                          <div style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: "#F59E0B", flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 10, color: BRAND.cardMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{op.name}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.cardMuted, flexShrink: 0 }}>
                            {op.pct}% · {Math.round(op.hrs)}h
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Open-positions notice above the action row so it never pushes buttons out of the card */}
        {(openCount ?? 0) > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onTeam(); }}
            title={`${openCount} open position${openCount === 1 ? "" : "s"} — click to view team`}
            style={{
              width: "100%", marginBottom: 6,
              padding: "4px 10px", borderRadius: 8,
              border: `1px solid ${BRAND.orange}50`, backgroundColor: BRAND.orange + "14",
              color: BRAND.orange, fontSize: 11, fontWeight: 800, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
            }}
          >
            <AlertCircle size={11} style={{ flexShrink: 0 }} />
            {openCount} open position{openCount === 1 ? "" : "s"}
          </button>
        )}
        <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
          <CardActionGreen Icon={Info} label="Details" onClick={(e) => { e.stopPropagation(); onDetails(); }} />
          <CardActionOutline Icon={Users} label="AI Reallocate" onClick={(e) => { e.stopPropagation(); onReallocate(); }} />
          <CardActionOutline Icon={Users} label={teamCount > 0 ? `Team (${teamCount})` : "Team"} greenTint onClick={(e) => { e.stopPropagation(); onTeam(); }} />
        </div>
      </div>
    </div>
  );
}

function TimelinePill({ color, label, range }: { color: string; label: string; range: string }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
      backgroundColor: color + "18", borderRadius: 999, border: `1px solid ${color}40`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: color }} />
      <span style={{ fontSize: 11, color, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 11, color: BRAND.cardText }}>{range}</span>
    </div>
  );
}

function CardActionGreen({ Icon, label, onClick }: { Icon: typeof Info; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
      padding: "8px 0", borderRadius: 8, backgroundColor: BRAND.greenBg, color: BRAND.white,
      fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", whiteSpace: "nowrap",
      overflow: "hidden",
    }}>
      <Icon size={11} style={{ flexShrink: 0 }} />
      {label}
    </button>
  );
}

function CardActionOutline({ Icon, label, onClick, greenTint }: {
  Icon: typeof Users; label: string; onClick: (e: React.MouseEvent) => void; greenTint?: boolean;
}) {
  const c = greenTint ? BRAND.green : BRAND.cardMuted;
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
      padding: "8px 0", borderRadius: 8, backgroundColor: "transparent", color: c,
      fontSize: 11, fontWeight: 700, border: `1px solid ${greenTint ? BRAND.green + "60" : "var(--rm-panel-border)"}`,
      cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden",
    }}>
      <Icon size={11} style={{ flexShrink: 0 }} />
      {label}
    </button>
  );
}

function RollupStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: BRAND.textMuted, marginTop: 2, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function OppCard({
  o, isConverted, expanded, inCompare, compareMode, holdInfo, teamCount: teamCountProp, openCount, conflicts, onDetails, onSchedule, onTeam, onToggleExpand, onMenu, onMemberAnalysis, onConflictAI,
}: {
  o: Opportunity;
  isConverted: boolean;
  expanded: boolean;
  inCompare?: boolean;
  compareMode?: boolean;
  holdInfo?: HoldInfo | null;
  teamCount?: number;
  openCount?: number;
  conflicts?: ProjectConflict[];
  onDetails: () => void;
  onSchedule: () => void;
  onTeam: () => void;
  onToggleExpand: () => void;
  onMenu: (action: string) => void;
  onMemberAnalysis?: (c: ProjectConflict, projectName: string, projectId: string) => void;
  onConflictAI?: () => void;
}) {
  const dueColor = o.daysLeft <= 10 ? BRAND.orange : BRAND.green;
  const healthResult = listOppHealth(o);
  const [healthOpen, setHealthOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const isClosed = o.closed;
  const stage = o.displayStatus || o.stage || "";
  const badgeStyle = getOppStagePalette(stage, isClosed);
  const isOnHold = o.stage === "On Hold" || !!holdInfo;
  return (
    <div onClick={onDetails}
      onMouseEnter={() => hoverPrefetchProject(o.id)}
      onMouseLeave={cancelHoverPrefetch}
      style={{
        backgroundColor: BRAND.cardWhite, color: BRAND.cardText, borderRadius: 14,
        padding: "10px 14px", cursor: "pointer",
        border: isOnHold ? `1px solid ${BRAND.orange}60` : `1px solid ${isClosed ? "rgba(128,128,128,0.25)" : "var(--rm-panel-border)"}`,
        borderLeft: isOnHold ? `4px solid ${BRAND.orange}` : undefined,
        boxShadow: isOnHold ? `0 1px 6px ${BRAND.orange}22` : "0 1px 3px rgba(0,0,0,0.08)",
        position: "relative", display: "flex", flexDirection: "column", height: "100%",
        /* No dim on closed cards (user mandate: cards stay plain white — the
           colored status badge alone signals Lost/Cancelled/Awarded). */
      }}>
      {healthOpen && (
        <HealthDetailModal title={o.name} recordId={o.id} result={healthResult}
          onClose={() => setHealthOpen(false)} />
      )}
      {isOnHold && (
        <div onClick={(e) => e.stopPropagation()} style={{
          margin: "-10px -14px 10px",
          padding: "6px 12px",
          backgroundColor: BRAND.orange + "18",
          borderBottom: `1px solid ${BRAND.orange}30`,
          borderRadius: "13px 13px 0 0",
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        }}>
          <Pause size={11} color={BRAND.orange} />
          <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.orange, letterSpacing: 0.5 }}>ON HOLD</span>
          {holdInfo?.reason && (
            <span style={{ fontSize: 11, color: BRAND.orange, opacity: 0.85 }}>· {holdInfo.reason}</span>
          )}
          {holdInfo?.tillDate && (
            <span style={{ fontSize: 10, color: BRAND.cardMuted, marginLeft: "auto" }}>
              Until {new Date(holdInfo.tillDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          {holdInfo?.comments && (
            <span style={{
              width: "100%", fontSize: 10, color: BRAND.cardMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{holdInfo.comments}</span>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            {stage && stage !== "Unknown" && (
              <span style={{
                padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                backgroundColor: badgeStyle.bg,
                color: badgeStyle.fg,
                border: `1px solid ${badgeStyle.border}`,
              }}>{stage}</span>
            )}
            {stage && stage !== "Unknown" && (
              <StageFlowDots mod="OPM" stage={stage} closed={isClosed || o.stage === CONVERTED_STAGE} raw={o.raw} />
            )}
            {o.requestCategory && (
              <span style={{
                padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800,
                backgroundColor: "rgba(100,160,255,0.12)",
                color: "#3a7bd5",
                border: "1px solid rgba(100,160,255,0.4)",
                letterSpacing: 0.5,
              }}>{o.requestCategory}</span>
            )}
            {o.bidDate && (
              <span style={{ fontSize: 11, color: dueColor, fontWeight: 700 }}>
                {o.daysLeft >= 999 ? `Bid ${o.bidDate}` : `${o.daysLeft}d · ${o.bidDate}`}
              </span>
            )}
          </div>

          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{o.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: BRAND.cardMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {o.projectId || o.id}
            </span>
            {isConverted && <ConvertedTag />}
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 11, color: BRAND.cardMuted }}>
            {o.bu && getBusinessRules().showBusinessUnit && <span>{o.bu}</span>}
            {o.office && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Building2 size={10} /> {o.office}
            </span>}
            {o.city && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <MapPin size={10} /> {o.city}
            </span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {(compareMode || inCompare) && (
            <button
              onClick={(e) => { e.stopPropagation(); onMenu("compare"); }}
              title={inCompare ? "Remove from compare" : "Select to compare"}
              style={{
                width: 18, height: 18, borderRadius: 3, padding: 0, cursor: "pointer",
                border: inCompare ? `2px solid ${BRAND.green}` : `2px solid var(--rm-panel-border)`,
                backgroundColor: inCompare ? BRAND.green : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 0.12s, border-color 0.12s",
                boxShadow: inCompare ? `0 0 0 3px ${BRAND.green}22` : "none",
              }}
            >
              {inCompare && <Check size={11} color="#fff" strokeWidth={3} />}
            </button>
          )}
          <CardContextMenu
            inCompare={inCompare}
            isOnHold={o.stage === "On Hold"}
            items={oppMenuItems(o, inCompare)}
            onAction={onMenu}
          />
        </div>
      </div>

      {(() => {
        const isReal = (s?: string) => !!s && !s.startsWith("0001");
        const tStart = isReal(o.rawTargetStart);
        const tEnd = isReal(o.rawTargetEnd);
        if (!tStart && !tEnd) return null;
        const fmtRange = (sOk: boolean, eOk: boolean, s?: string, e?: string) =>
          sOk && eOk ? `${fmtShort(s!)} – ${fmtShort(e!)}`
            : sOk ? `Starts ${fmtShort(s!)}`
            : `Ends ${fmtShort(e!)}`;
        return (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 9, color: BRAND.cardLabel, fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>
              SCHEDULE
            </div>
            {/* ONE date pair (client rule): rawTargetStart/End are already the
                effective dates — schedule-derived when phases exist, Target
                fallback otherwise. */}
            <TimelinePill
              color={BRAND.green}
              label={o.datesFromSchedule ? "Schedule:" : "Target:"}
              range={fmtRange(tStart, tEnd, o.rawTargetStart, o.rawTargetEnd)} />
          </div>
        );
      })()}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end",
        padding: "5px 0 0", marginTop: 6, borderTop: `1px solid var(--rm-panel-border)` }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: BRAND.cardLabel, fontWeight: 700, letterSpacing: 1 }}>FORECASTED</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtM(o.value)}</div>
        </div>
      </div>

      {expanded && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          marginTop: 10, padding: "10px 12px", borderRadius: 10,
          backgroundColor: BRAND.green + "12",
          border: `1px solid ${BRAND.green}40`,
        }}>
          <Info size={13} color={BRAND.green} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.green, marginBottom: 2 }}>
              Opportunity Details
            </div>
            <div style={{ fontSize: 11, color: BRAND.cardMuted }}>
              {o.projectId || o.id} · {o.stage || "No stage"} · {o.city || "No city"}
            </div>
          </div>
        </div>
      )}

      <CardInsight kind="opportunity" id={o.id} fields={{
        name: o.name,
        stage: o.stage,
        valueUSD: o.value,
        weightedValueUSD: o.weightedValue,
        probabilityPct: o.probability,
        daysToBid: o.daysLeft,
        bidDate: o.rawBidDate || null,
        bu: o.bu || null,
        closed: o.closed,
      }} />

      {o.note && (
        <div onClick={(e) => e.stopPropagation()} style={{
          display: "flex", alignItems: "flex-start", gap: 6,
          padding: "6px 10px", borderRadius: 8, marginTop: 4,
          backgroundColor: "var(--rm-panel-soft)",
          border: "1px solid var(--rm-panel-border)",
        }}>
          <FileText size={11} color={BRAND.cardMuted} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{
            fontSize: 11, color: BRAND.cardMuted, lineHeight: 1.4,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{o.note}</span>
        </div>
      )}

      {conflicts && conflicts.length > 0 && (() => {
        const overlapPct = (teamCountProp ?? 0) > 0 ? Math.round((conflicts.length / teamCountProp!) * 100) : 0;
        return (
          <div onClick={e => e.stopPropagation()} style={{
            borderRadius: 8, border: "1px solid #F59E0B50",
            backgroundColor: "#F59E0B08", overflow: "hidden", marginTop: 6,
          }}>
            <button
              onClick={e => { e.stopPropagation(); setConflictOpen(v => !v); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 6,
                padding: "6px 10px", cursor: "pointer",
                backgroundColor: "transparent", border: "none",
                color: "#B45309", fontSize: 11, fontWeight: 700,
              }}>
              <AlertTriangle size={11} color="#F59E0B" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: "left" }}>
                {conflicts.length} shared member{conflicts.length === 1 ? "" : "s"}
                <span style={{ fontWeight: 400, color: "#D97706", marginLeft: 4 }}>· {overlapPct}% team overlap</span>
              </span>
              {onConflictAI && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); onConflictAI(); }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onConflictAI(); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: 3,
                    padding: "2px 7px", borderRadius: 10,
                    border: "1px solid #F59E0B60",
                    backgroundColor: "#F59E0B15",
                    color: "#B45309", fontSize: 10, fontWeight: 700,
                    cursor: "pointer", flexShrink: 0,
                  }}>
                  <Sparkles size={9} />
                  Ask AI
                </span>
              )}
              <ChevronDown size={10} style={{ flexShrink: 0, transform: conflictOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>
            {conflictOpen && (
              <div style={{ borderTop: "1px solid #F59E0B30" }}>
                {conflicts.map((c, ci) => (
                  <div key={ci} style={{ padding: "8px 10px", borderTop: ci > 0 ? "1px solid #F59E0B20" : "none" }}>
                    <div
                      onClick={e => { e.stopPropagation(); onMemberAnalysis?.(c, o.name, o.id); }}
                      title="Click for AI conflict analysis"
                      style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, cursor: onMemberAnalysis ? "pointer" : "default", borderRadius: 6, padding: "2px 4px", margin: "-2px -4px 4px", transition: "background 0.12s" }}
                      onMouseEnter={e => { if (onMemberAnalysis) (e.currentTarget as HTMLDivElement).style.background = "#F59E0B18"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                    >
                      <div style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#F59E0B22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <User size={11} color="#F59E0B" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.cardText }}>{c.name}</div>
                        {c.role && <div style={{ fontSize: 10, color: BRAND.cardMuted }}>{c.role}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309" }}>{c.thisPct}%</div>
                        <div style={{ fontSize: 9, color: BRAND.cardMuted }}>{Math.round(c.thisHrs)}h here</div>
                      </div>
                    </div>
                    {c.otherProjects.map((op, oi) => (
                      <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 29, marginBottom: oi < c.otherProjects.length - 1 ? 3 : 0 }}>
                        <div style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: "#F59E0B", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 10, color: BRAND.cardMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{op.name}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.cardMuted, flexShrink: 0 }}>{op.pct}% · {Math.round(op.hrs)}h</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Open-positions notice above the action row so it never pushes buttons out of the card */}
      {(openCount ?? 0) > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onTeam(); }}
          title={`${openCount} open position${openCount === 1 ? "" : "s"} — click to view team`}
          style={{
            width: "100%", marginTop: "auto", marginBottom: 6,
            padding: "4px 10px", borderRadius: 8,
            border: `1px solid ${BRAND.orange}50`, backgroundColor: BRAND.orange + "14",
            color: BRAND.orange, fontSize: 11, fontWeight: 800, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
          }}
        >
          <AlertCircle size={11} style={{ flexShrink: 0 }} />
          {openCount} open position{openCount === 1 ? "" : "s"}
        </button>
      )}
      <div style={{ display: "flex", gap: 8, paddingTop: 6, alignItems: "stretch", ...((openCount ?? 0) === 0 ? { marginTop: "auto" } : {}) }}>
        <CardActionGreen Icon={Info} label="Details" onClick={(e) => { e.stopPropagation(); onDetails(); }} />
        <CardActionOutline Icon={Calendar} label="Schedule" onClick={(e) => { e.stopPropagation(); onSchedule(); }} />
        <CardActionOutline Icon={Users} label={teamCountProp != null && teamCountProp > 0 ? `Team (${teamCountProp})` : "Team"} greenTint onClick={(e) => { e.stopPropagation(); onTeam(); }} />
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          aria-label={expanded ? "Collapse" : "Expand"}
          style={{
            width: 36, padding: 0,
            borderRadius: 8, border: `1px solid var(--rm-panel-border)`,
            backgroundColor: BRAND.cardWhite, color: BRAND.cardMuted,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
    </div>
  );
}

function LeadCard({ l, onDetails, onPreStaff, onPursue, onMenu, inCompare, compareMode }: {
  l: Lead; onDetails: () => void; onPreStaff: () => void; onPursue: () => void;
  onMenu: (action: string) => void; inCompare: boolean; compareMode: boolean;
}) {
  return (
    <div onClick={onDetails}
      style={{
        backgroundColor: BRAND.cardWhite, color: BRAND.cardText, borderRadius: 14,
        padding: "10px 14px", cursor: "pointer", border: `1px solid var(--rm-panel-border)`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", height: "100%",
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
          ...(l.status === LEM_CONVERTED
            ? { backgroundColor: "rgba(75,156,211,0.16)", color: "#2f7fb5", border: "1px solid rgba(75,156,211,0.55)" }
            : { backgroundColor: BRAND.greenLight + "20", color: BRAND.green, border: `1px solid ${BRAND.green}50` }),
        }}>{l.status}</span>
          <StageFlowDots mod="LEM" stage={l.status} closed={l.closed || l.status === LEM_CONVERTED} raw={l.raw} />
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {l.office && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: BRAND.cardMuted }}>
              <Building2 size={10} /> {l.office}
            </span>
          )}
          {l.city && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: BRAND.cardMuted }}>
              <MapPin size={10} /> {l.city}
            </span>
          )}
          {(compareMode || inCompare) && (
            <button
              onClick={(e) => { e.stopPropagation(); onMenu("compare"); }}
              title={inCompare ? "Remove from compare" : "Select to compare"}
              style={{
                width: 18, height: 18, borderRadius: 3, padding: 0, cursor: "pointer",
                border: inCompare ? `2px solid ${BRAND.green}` : `2px solid var(--rm-panel-border)`,
                backgroundColor: inCompare ? BRAND.green : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 0.12s, border-color 0.12s",
                boxShadow: inCompare ? `0 0 0 3px ${BRAND.green}22` : "none",
              }}
            >
              {inCompare && <Check size={11} color="#fff" strokeWidth={3} />}
            </button>
          )}
          <CardContextMenu
            inCompare={inCompare}
            isOnHold={l.status === "On Hold"}
            items={leadMenuItems(l, inCompare)}
            onAction={onMenu}
          />
        </div>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{l.name}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0, marginTop: 2 }}>
        <span style={{ fontSize: 11, color: BRAND.cardMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {l.projectId || l.id}
        </span>
        {l.status === LEM_CONVERTED && <ConvertedTag />}
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11, color: BRAND.cardMuted }}>
        {getBusinessRules().showBusinessUnit && <span>BU: {l.bu}</span>}
        <span>Sector: {l.sector}</span>
      </div>

      {l.note && (
        <div style={{
          marginTop: 8, padding: "6px 8px",
          backgroundColor: BRAND.green + "10",
          border: `1px solid ${BRAND.green}28`,
          borderRadius: 7,
          fontSize: 11, color: BRAND.cardText, lineHeight: 1.4,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
        }}>
          <span style={{ fontWeight: 700, color: BRAND.green, marginRight: 4 }}>Note:</span>
          {l.note}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "5px 0", marginTop: 6, borderTop: `1px solid var(--rm-panel-border)` }}>
        <span style={{ fontSize: 9, color: BRAND.cardLabel, fontWeight: 700, letterSpacing: 1 }}>VALUE</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: l.value === 0 ? BRAND.cardMuted : BRAND.cardText }}>
          {l.value > 0 ? fmtM(l.value) : "—"}
        </span>
      </div>

      {(() => {
        const now = Date.now();
        const created = l.rawCreated ? new Date(l.rawCreated).getTime() : NaN;
        const due = (l.rawDueDate || l.rawTargetEnd) ? new Date(l.rawDueDate || l.rawTargetEnd).getTime() : NaN;
        const daysSinceCreated = isNaN(created) ? null : Math.round((now - created) / 86400000);
        const daysToDue = isNaN(due) ? null : Math.round((due - now) / 86400000);
        return (
          <CardInsight kind="lead" id={l.id} fields={{
            name: l.name,
            status: l.status,
            sector: l.sector || null,
            bu: l.bu || null,
            valueUSD: l.value,
            daysSinceCreated,
            daysToDue,
            closed: l.closed,
          }} />
        );
      })()}

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <CardActionGreen Icon={TrendingUp} label="Pursue" onClick={(e) => { e.stopPropagation(); onPursue(); }} />
        <CardActionOutline Icon={Users} label="Pre-Staff" greenTint onClick={(e) => { e.stopPropagation(); onPreStaff(); }} />
        <CardActionOutline Icon={Info} label="Details" onClick={(e) => { e.stopPropagation(); onDetails(); }} />
      </div>
    </div>
  );
}

function CompanyCard({ c, onOpen, onProjects, onContacts, onAIProfile }: {
  c: Company;
  onOpen: () => void;
  onProjects: () => void;
  onContacts: () => void;
  onAIProfile: () => void;
}) {
  return (
    <div onClick={onOpen} style={{
      backgroundColor: BRAND.cardWhite, color: BRAND.cardText, borderRadius: 14,
      padding: "18px 16px", border: `1px solid var(--rm-panel-border)`, boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      cursor: "pointer",
      display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 150,
    }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: BRAND.green + "18",
          display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
          <Briefcase size={16} color={BRAND.green} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
          <div style={{ fontSize: 11, color: BRAND.cardMuted, marginTop: 2 }}>
            {[c.city, c.state].filter(Boolean).join(", ") || (c.type && c.type !== "—" ? c.type : "")}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6, fontSize: 11, color: BRAND.cardMuted }}>
        {c.derived ? (
          <>
            {(c.projectCount ?? 0) > 0 && <span>{c.projectCount} project{c.projectCount !== 1 ? "s" : ""}</span>}
            {(c.oppCount ?? 0) > 0 && <span>{c.oppCount} opp{c.oppCount !== 1 ? "s" : ""}</span>}
            {(c.totalValue ?? 0) > 0 && (
              <span>${c.totalValue! >= 1e6 ? `${(c.totalValue! / 1e6).toFixed(1)}M` : `${Math.round(c.totalValue! / 1e3)}K`}</span>
            )}
          </>
        ) : (
          <>
            {(c.city || c.state) && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <MapPin size={10} /> {[c.city, c.state].filter(Boolean).join(", ")}
            </span>}
            {c.phone && c.phone !== "—" && <span>{c.phone}</span>}
            {c.email && c.email !== "—" && <span>{c.email}</span>}
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <CardActionGreen Icon={Briefcase} label="Projects" onClick={(e) => { e.stopPropagation(); onProjects(); }} />
        {!c.derived && <CardActionOutline Icon={Users} label="Contacts" onClick={(e) => { e.stopPropagation(); onContacts(); }} />}
        <CardActionOutline Icon={MessageCircle} label="AI Profile" greenTint onClick={(e) => { e.stopPropagation(); onAIProfile(); }} />
      </div>
    </div>
  );
}

interface CompanyContact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  city?: string;
  state?: string;
  workAddress?: string;
  ownershipType?: string;
}

interface CompanyProjectRow {
  id: string;
  name: string;
  module: "PMM" | "OPM" | "LEM";
  status: string;
  value: number;
  city: string;
  sector: string;
}

function matchCompanyProjectsLocal(
  companyName: string,
  pmm: Project[],
  opm: Opportunity[],
  lem: Lead[],
): CompanyProjectRow[] {
  const norm = (s: string) => s.toLowerCase().replace(/[(),"']/g, " ").replace(/\s+/g, " ").trim();
  const cn = norm(companyName);
  const match = (client: string) => {
    const c = norm(client);
    if (!c || c.length < 2) return false;
    return c === cn || c.includes(cn) || cn.includes(c);
  };
  const results: CompanyProjectRow[] = [];
  const seen = new Set<string>();
  for (const r of pmm) {
    if (!r.id || seen.has(r.id) || !match(r.client)) continue;
    seen.add(r.id);
    results.push({ id: r.id, name: r.name, module: "PMM", status: r.status, value: r.value, city: r.city, sector: r.sector });
  }
  for (const r of opm) {
    if (!r.id || seen.has(r.id) || !match(r.client)) continue;
    seen.add(r.id);
    results.push({ id: r.id, name: r.name, module: "OPM", status: r.stage, value: r.value, city: r.city, sector: "—" });
  }
  for (const r of lem) {
    if (!r.id || seen.has(r.id) || !match(r.client)) continue;
    seen.add(r.id);
    results.push({ id: r.id, name: r.name, module: "LEM", status: r.status, value: r.value, city: r.city, sector: r.sector ?? "—" });
  }
  return results;
}

function CompanyDetailModal({
  company, tab, onTabChange, onClose, onOpenProject, pmm, opm, lem,
}: {
  company: Company;
  tab: "projects" | "contacts";
  onTabChange: (t: "projects" | "contacts") => void;
  onClose: () => void;
  onOpenProject: (pid: string) => void;
  pmm: Project[];
  opm: Opportunity[];
  lem: Lead[];
}) {
  const projectsRows = useMemo(
    () => matchCompanyProjectsLocal(company.name, pmm, opm, lem),
    [company.name, pmm, opm, lem],
  );

  const teamQueries = useQueries({
    queries: projectsRows.map(p => ({
      queryKey: ["project-team", p.id],
      queryFn: async () => { const { getProjectTeam } = await import("@/lib/api"); return getProjectTeam(p.id, false, true); },
      enabled: tab === "contacts" && !!p.id,
      staleTime: 2 * 60 * 1000,
    })),
  });
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const contactsLoading = teamQueries.some(q => q.isLoading);
  const teamMembers = useMemo(() => {
    const seen = new Set<string>();
    const out: (import("@/lib/api").ProjectTeamMember & { id: string })[] = [];
    for (const q of teamQueries) {
      for (const m of (q.data?.team ?? [])) {
        const key = m.resourceId || m.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...m, id: key });
      }
    }
    return out;
  }, [teamQueries]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: Z.MODAL, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: BRAND.bgDeep, color: BRAND.white, borderRadius: 16,
        width: "100%", maxWidth: 640, maxHeight: "85vh", display: "flex", flexDirection: "column",
        border: `1px solid ${BRAND.cardBorder}`, boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 18, borderBottom: `1px solid ${BRAND.cardBorder}` }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: BRAND.green + "20",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            {tab === "contacts" ? <Users size={18} color={BRAND.green} /> : <Briefcase size={18} color={BRAND.green} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company.name}</div>
            <div style={{ fontSize: 11, color: BRAND.cardMuted, marginTop: 2 }}>
              {[company.city, company.state].filter(Boolean).join(", ") || (company.type && company.type !== "—" ? company.type : "")}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close company detail" style={{
            background: "transparent", border: "none", color: BRAND.cardMuted,
            cursor: "pointer", padding: 6, borderRadius: 8,
          }}>
            <X size={20} />
          </button>
        </div>

        {(() => {
          const info: Array<{ label: string; value?: string }> = [
            { label: "Type", value: company.type && company.type !== "—" ? company.type : "" },
            { label: "Ownership", value: company.ownershipType },
            { label: "Contractor License", value: company.contractorLicense },
            { label: "Union Affiliation", value: company.unionAffiliation },
            { label: "Certifications", value: company.certifications },
            { label: "Annual Revenues", value: company.annualRevenues },
            { label: "Location", value: [company.city, company.state, company.zip, company.country].filter(Boolean).join(", ") },
            { label: "Address", value: company.address },
            { label: "Phone", value: company.phone && company.phone !== "—" ? company.phone : "" },
            { label: "Fax", value: company.fax },
            { label: "Email", value: company.email && company.email !== "—" ? company.email : "" },
            { label: "Website", value: company.website },
          ].filter((i) => i.value && i.value.trim());
          if (info.length === 0) return null;
          return (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: "10px 24px",
              padding: "14px 18px", borderBottom: `1px solid ${BRAND.cardBorder}`,
            }}>
              {info.map((i) => (
                <div key={i.label} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: BRAND.cardMuted }}>{i.label}</div>
                  <div style={{ fontSize: 13, marginTop: 2, color: BRAND.white, wordBreak: "break-word" }}>{i.value}</div>
                </div>
              ))}
            </div>
          );
        })()}

        <div style={{ display: "flex", gap: 6, padding: "10px 18px 0", borderBottom: `1px solid ${BRAND.cardBorder}` }}>
          {(["projects", "contacts"] as const).map(t => {
            const sel = t === tab;
            return (
              <button key={t} onClick={() => onTabChange(t)} style={{
                padding: "8px 14px", border: "none", background: "transparent",
                color: sel ? BRAND.green : BRAND.textSecondary,
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                borderBottom: `2px solid ${sel ? BRAND.green : "transparent"}`,
              }}>
                {t === "projects" ? `Projects (${projectsRows.length})` : `Team${teamMembers.length ? ` (${teamMembers.length})` : ""}`}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {tab === "projects" ? (
            projectsRows.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: BRAND.textSecondary, fontSize: 13 }}>
                No projects, opportunities, or leads found for this company.
              </div>
            ) : projectsRows.map(p => (
              <button key={p.id} onClick={() => onOpenProject(p.id)} style={{
                textAlign: "left", padding: 12, borderRadius: 12,
                backgroundColor: BRAND.card, border: `1px solid ${BRAND.cardBorder}`,
                color: BRAND.white, cursor: "pointer", display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 1,
                    padding: "2px 8px", borderRadius: 4,
                    backgroundColor: BRAND.green + "20", color: BRAND.green,
                  }}>{p.module}</span>
                  <span style={{ fontSize: 11, color: BRAND.textSecondary }}>{p.id}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: p.value > 0 ? BRAND.green : BRAND.textMuted }}>
                    {p.value > 0 ? fmtM(p.value) : "—"}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: BRAND.textSecondary, display: "flex", gap: 10 }}>
                  <span>{p.status}</span>
                  {p.city && <span>· {p.city}</span>}
                  {p.sector && p.sector !== "—" && <span>· {p.sector}</span>}
                </div>
              </button>
            ))
          ) : (
            contactsLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, gap: 10 }}>
                <Loader2 size={20} color={BRAND.green} className="animate-spin" />
                <span style={{ color: BRAND.textSecondary, fontSize: 13 }}>Loading team…</span>
              </div>
            ) : teamMembers.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: BRAND.textSecondary, fontSize: 13 }}>
                No team members assigned to this company's projects.
              </div>
            ) : teamMembers.map(m => {
              const open = selectedMember === m.id;
              const fmtUSD = (v?: number) => v != null && v > 0 ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";
              const fmtHrs = (v?: number) => v != null && v > 0 ? `${v.toLocaleString()} hrs` : "—";
              const fmtPct = (v?: number) => v != null ? `${Math.round(v)}%` : "—";
              return (
                <div key={m.id} style={{ borderRadius: 12, backgroundColor: BRAND.card, border: `1px solid ${open ? BRAND.green : BRAND.cardBorder}`, overflow: "hidden", transition: "border-color .15s" }}>
                  <div onClick={() => setSelectedMember(open ? null : m.id)} style={{ padding: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, backgroundColor: BRAND.green + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: BRAND.green }}>
                      {(m.name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{m.name || "—"}</div>
                      {m.role && <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 2 }}>{m.role}</div>}
                    </div>
                    <ChevronDown size={14} color={BRAND.textSecondary} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
                  </div>
                  {open && (
                    <div style={{ borderTop: `1px solid ${BRAND.cardBorder}`, padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px" }}>
                        {[
                          ["Role", m.role || "—"],
                          ["Title", m.title || "—"],
                          ["Division / BU", [m.bu, m.memberBu].filter(Boolean).join(" · ") || "—"],
                          ["Department", m.dept || "—"],
                          ["Allocation", fmtPct(m.pctAllocation)],
                          ["Start → End", m.startDate && m.endDate ? `${m.startDate} → ${m.endDate}` : "—"],
                        ].map(([label, val]) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, color: BRAND.textSecondary, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{label}</div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{val}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ borderTop: `1px solid ${BRAND.cardBorder}`, paddingTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 14px" }}>
                        {[
                          ["EAC Hrs", fmtHrs(m.eacHrs)],
                          ["ETC Hrs", fmtHrs(m.etcHrs)],
                          ["NC Hrs", fmtHrs(m.ncHrs)],
                          ["Labor Rate", fmtUSD(m.laborRate)],
                          ["Cost Rate", fmtUSD(m.costRate)],
                          ["EAC Cost", fmtUSD(m.eacCost)],
                        ].map(([label, val]) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, color: BRAND.textSecondary, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{label}</div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}


// Project-level role-user fields. Same set the mobile app pulls so the project's
// PM / PE / etc. show up in the team list even when they have no time-allocation
// row in RM ONE (and therefore don't appear in /project-team or /allocations).
const ROLE_USER_FIELDS: Record<string, string> = {
  ProjectManagerUser: "Project Manager",
  BusinessLeadUser: "Business Lead",
  ProjectLeadUser: "Project Lead",
  ProjectExecutiveUser: "Project Executive",
  SeniorProjectManagerUser: "Senior Project Manager",
  ElectricalEngineerUser: "Electrical Engineer",
  JuniorEngineerUser: "Junior Engineer",
  SeniorMechanicalEngineerUser: "Senior Mechanical Engineer",
  SeniorPlumbingEngineerUser: "Senior Plumbing Engineer",
  MechanicalEngineerUser: "Mechanical Engineer",
  PlumbingEngineerUser: "Plumbing Engineer",
  PhaseOwnerUser: "Phase Owner",
  ARCHSrProjectArchitectUser: "Sr. Project Architect",
  OwnerUser: "Owner",
};

interface TeamRow {
  name: string;
  role: string;
  pct: number;
  email: string;
  startDate: string;
  endDate: string;
  resourceId?: string;
  teamData?: ProjectTeamMember;
  // "working" = has an allocation row in /project-team or /allocations.
  // "leader" = surfaced from the project's role-user GUID fields (PM/PE/etc.)
  // and has no time allocation; we render these in a separate section.
  kind: "working" | "leader";
}

interface OpenSlot {
  role: string;
  pct: number;
  startDate: string;
  endDate: string;
  bu: string;
  title?: string;
  eacHrs?: number;
  raw: any;
}

function fmtAllocDate(v?: string): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Compact week-start label for the weekly-hours grid (e.g. "2026-06-22" → "Jun 22").
// The raw ISO date overflowed the narrow column and was unreadable.
function fmtWeekShort(v?: string): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
}

function fmtWeekHours(v?: number): string {
  if (v == null || !Number.isFinite(v)) return "0";
  const rounded = Math.round((v + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function TeamModal({ project, module, onClose, onAskAI }: {
  project: Project;
  /** Module of the underlying record — the opportunities tab adapts OPM
   *  records to the Project shape, so the shape alone can't tell. */
  module: "PMM" | "OPM";
  onClose: () => void;
  onAskAI: (prompt: string, opts?: { alreadyPrepared?: boolean; autoSend?: boolean }) => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [editAllocPerson, setEditAllocPerson] = useState<EditAllocPerson | null>(null);
  // When set, the picker opens pre-filled to assign someone to this open slot.
  const [assignSlot, setAssignSlot] = useState<OpenSlot | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const [, navTo] = useLocation();
  // Rates are financial data — only show the "Set rate" shortcut to users
  // who can actually set them (the rate routes are server-gated anyway).
  const canSetRates = useEditFinancialsCap();

  // Mobile parity: combine 4 sources so a project's full team is visible
  // even when /project-team only returns members with time-allocation rows.
  // 1) /project-team — primary (carries EAC/ETC/cost/weeklyHours)
  // 2) /resource-allocations — name + email + role hydration
  // 3) /allocations — pulls in members the team API skipped (e.g. soft / EA-only)
  // 4) /project-details ROLE_USER_FIELDS — adds the PM, PE, etc. from project metadata
  const _teamLsKey = `rmone:v1:teamraw:${project.id}`;
  const teamQ = useQuery({
    queryKey: ["project-team", project.id],
    queryFn: () => getProjectTeam(project.id).catch(() => ({ team: [] as ProjectTeamMember[], openRoles: [] as import("@/lib/api").OpenRole[] })),
    staleTime: 8 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    // Seed from the in-memory store so the modal renders instantly on repeat
    // opens (even before the background prefetch completes on the projects list).
    placeholderData: () => {
      try {
        const raw = memSeed.getItem(_teamLsKey);
        if (!raw) return undefined;
        const { data, ts } = JSON.parse(raw) as { data: unknown; ts: number };
        if (Date.now() - ts > 30 * 60_000) return undefined;
        return data as { team: ProjectTeamMember[]; openRoles: import("@/lib/api").OpenRole[] };
      } catch { return undefined; }
    },
  });
  // Cache the real team response so future opens use placeholderData above.
  useEffect(() => {
    if (!teamQ.data || teamQ.isPlaceholderData) return;
    try { memSeed.setItem(_teamLsKey, JSON.stringify({ data: teamQ.data, ts: Date.now() })); }
    catch { /* non-serializable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamQ.data, teamQ.isPlaceholderData]);
  const resQ = useQuery({
    queryKey: ["resource-allocations"],
    queryFn: () => getResourceAllocations().catch(() => null),
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
  });
  const allocQ = useQuery({
    queryKey: ["project-allocations-raw", project.id],
    queryFn: () => getProjectAllocations(project.id).catch(() => null),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const detailsQ = useQuery({
    queryKey: ["project-details", project.id],
    queryFn: () => getProjectDetails(project.id).catch(() => null),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  // Resource demands surface unfilled allocation slots across the org.
  // Filtered by TicketId below to find this project's open roles.
  const demandsQ = useQuery({
    queryKey: ["resource-demands"],
    queryFn: () => getResourceDemands().catch(() => null),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    closeBtnRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Prefetch the Add Team Member roster into the in-memory seed store as soon
  // as the Team modal opens so clicking "Add Member" shows instantly (no
  // spinner). Shared writer in lib/addMemberRoster — same keys the cascade
  // hook reads, skips work when the seeds are still fresh.
  useEffect(() => {
    void warmAddMemberRoster(project.id);
  }, [project.id]);

  const members: TeamRow[] = useMemo(() => {
    const teamResp = teamQ.data;
    const teamData = (teamResp?.team ?? (Array.isArray(teamResp) ? teamResp as unknown as ProjectTeamMember[] : [])) as ProjectTeamMember[];
    const resData = resQ.data;
    const allocRaw = allocQ.data;
    const projDetails = detailsQ.data;

    const allResources: LiveResource[] = (resData?.resources as LiveResource[] | undefined) ?? [];
    const resMap = new Map<string, LiveResource>();
    const resById = new Map<string, LiveResource>();
    allResources.forEach((r) => {
      if (r.username) resMap.set(r.username.toLowerCase(), r);
      if (r.name) resMap.set(r.name.toLowerCase(), r);
      if (r.id) resById.set(r.id.toLowerCase(), r);
    });
    const guidToName: Record<string, string> = (resData as { userGuidToName?: Record<string, string> } | null | undefined)?.userGuidToName ?? {};

    const teamByName = new Map<string, ProjectTeamMember>();
    if (teamData && teamData.length > 0) {
      for (const tm of teamData) { if (tm.name) teamByName.set(tm.name.toLowerCase(), tm); }
    }

    const out: TeamRow[] = [];
    const seen = new Set<string>();

    // Pass 1 — /project-team
    if (teamData && teamData.length > 0) {
      for (const tm of teamData) {
        if (!tm.name) continue;
        seen.add(tm.name.toLowerCase());
        const match = resMap.get(tm.name.toLowerCase());
        out.push({
          name: tm.name,
          role: tm.role || match?.role || "",
          pct: tm.pctAllocation ?? match?.currentPct ?? 0,
          email: match?.username ?? "",
          startDate: tm.startDate || "",
          endDate: tm.endDate || "",
          resourceId: tm.resourceId ?? "",
          teamData: tm,
          kind: "working",
        });
      }
    }

    // Pass 2 — /allocations (raw EA/NA records)
    if (allocRaw) {
      const allocArr: Record<string, unknown>[] = (() => {
        const obj = allocRaw as Record<string, unknown>;
        const arr = (obj?.Allocations as unknown[] | undefined) ?? (Array.isArray(allocRaw) ? allocRaw : []);
        return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
      })();
      for (const a of allocArr) {
        let name = String(a.AssignedToName ?? a.ResourceUser ?? a.Name ?? "");
        if (/^[0-9a-f]{8}-/.test(name) || !name) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const res = resById.get(userId) ?? resMap.get(userId);
          if (res) name = res.name;
        }
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        let role = String(a.TypeName ?? a.RoleName ?? "");
        if (!role) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const resPerson = resById.get(userId) ?? resMap.get(name.toLowerCase());
          if (resPerson) role = resPerson.role || "";
        }
        const tm = teamByName.get(name.toLowerCase());
        const resMember = resById.get(String(a.AssignedTo ?? "").toLowerCase()) ?? resMap.get(name.toLowerCase());
        out.push({
          name,
          role,
          pct: Number(a.PctAllocation ?? 0),
          email: resMember?.username ?? "",
          startDate: String(a.AllocationStartDate ?? "").slice(0, 10),
          endDate: String(a.AllocationEndDate ?? "").slice(0, 10),
          resourceId: String(a.ResourceId ?? a.ResourceID ?? a.AssignedTo ?? ""),
          teamData: tm,
          kind: "working",
        });
      }
    }

    // Pass 3 — project-details role-user GUIDs (PM, PE, etc.).
    // Always run, mirroring mobile: these people often have no allocation row at all.
    if (projDetails) {
      const d: Record<string, unknown> = {};
      const rawDetails = projDetails as Record<string, unknown>;
      const dataField = rawDetails?.Data;
      const flat: Record<string, unknown> | undefined = Array.isArray(dataField)
        ? (dataField[0] as Record<string, unknown>)
        : ((dataField as Record<string, unknown> | undefined) ?? rawDetails);
      if (flat && Array.isArray(flat.Fields)) {
        for (const f of flat.Fields as { FieldName: string; Value: unknown }[]) {
          if (f.FieldName) d[f.FieldName] = f.Value ?? "";
        }
      } else if (flat) {
        Object.assign(d, flat);
      }
      for (const [field, roleName] of Object.entries(ROLE_USER_FIELDS)) {
        const val = d[field];
        if (!val || typeof val !== "string") continue;
        const guids = val.split(",").map((g: string) => g.trim().toLowerCase()).filter(Boolean);
        for (const guid of guids) {
          if (!/^[0-9a-f]{8}-/.test(guid)) continue;
          const resolvedName = guidToName[guid] || resById.get(guid)?.name;
          if (!resolvedName) continue;
          if (seen.has(resolvedName.toLowerCase())) continue;
          seen.add(resolvedName.toLowerCase());
          const tmr = teamByName.get(resolvedName.toLowerCase());
          const resMbr = resById.get(guid) ?? resMap.get(resolvedName.toLowerCase());
          out.push({
            name: resolvedName,
            role: roleName,
            pct: tmr?.pctAllocation ?? 0,
            email: resMbr?.username ?? "",
            startDate: "",
            endDate: "",
            resourceId: tmr?.resourceId ?? "",
            teamData: tmr,
            kind: "leader",
          });
        }
      }
    }

    return out;
  }, [teamQ.data, resQ.data, allocQ.data, detailsQ.data]);

  // Split the merged team into "working" (has an allocation row) and
  // "leader" (project-role-user GUIDs with no allocation).
  const working = useMemo(() => members.filter((m) => m.kind === "working"), [members]);
  const leaders = useMemo(() => members.filter((m) => m.kind === "leader"), [members]);

  const openSlots: OpenSlot[] = useMemo(() => {
    const serverRoles = teamQ.data?.openRoles ?? [];
    if (!serverRoles.length) return [];
    const out: OpenSlot[] = serverRoles.map((r) => ({
      role: r.role || "Unspecified role",
      pct: r.pct,
      startDate: r.startDate?.slice(0, 10) || "",
      endDate: r.endDate?.slice(0, 10) || "",
      bu: r.bu || "",
      title: r.title || "",
      eacHrs: r.eacHrs || 0,
      raw: r as any,
    }));
    out.sort((a, b) => (a.startDate.localeCompare(b.startDate)) || (b.pct - a.pct));
    return out;
  }, [teamQ.data, project.id]);

  // Apply the search box across all 3 sections.
  const q = search.trim().toLowerCase();
  const matchRow = (m: TeamRow) => !q ||
    m.name.toLowerCase().includes(q) ||
    (m.role || "").toLowerCase().includes(q) ||
    (m.email || "").toLowerCase().includes(q);
  const matchOpen = (s: OpenSlot) =>
    !q || s.role.toLowerCase().includes(q) || (s.bu || "").toLowerCase().includes(q);
  const filteredWorking = useMemo(() => working.filter(matchRow), [working, q]);
  const filteredLeaders = useMemo(() => leaders.filter(matchRow), [leaders, q]);
  const filteredOpen    = useMemo(() => openSlots.filter(matchOpen), [openSlots, q]);


  // Only block the modal on the primary team query. Resource-allocations,
  // allocations-raw, and project-details are enrichment sources — they fill
  // in emails/rates/details AFTER the team list is already visible. Waiting
  // for all four queries caused a multi-second spinner even when teamQ was
  // already cached from the background prefetch on the projects list page.
  const loading = teamQ.isLoading && !teamQ.isPlaceholderData;
  const error = teamQ.isError && allocQ.isError && detailsQ.isError;

  const handleNotifyTeam = () => {
    const teamMembers = members
      .filter((r) => r.name && !/^[0-9a-f]{8}-/.test(r.name) && r.name !== "Team Member")
      .map((r) => `- ${r.name}${r.role ? ` (${r.role})` : ""}${r.email ? ` — ${r.email}` : ""}${r.pct != null ? ` — ${r.pct}%` : ""}`);
    if (teamMembers.length === 0) return;
    const context = `[NOTIFY_TEAM_CONTEXT] Project: "${project.name}" (${project.id}). Team members (${teamMembers.length}):\n${teamMembers.join("\n")}\n\nThe user wants to send a notification email to this team. Ask the user what they'd like to communicate to the team. Once they provide the message, compose a professional email draft addressed to the team and show it for confirmation with [BUTTONS:YES_SEND,EDIT,CANCEL]. Use send_email to send to ALL team member emails listed above.`;
    const prompt = `I want to notify the team on project "${project.name}" (${project.id}). Here are the ${teamMembers.length} team members:\n${teamMembers.join("\n")}\n\nWhat would you like me to tell them?`;
    // Prepare prompt+context here, then signal parent to navigate only.
    // autoSend:true so the assistant immediately reads the [NOTIFY_TEAM_CONTEXT]
    // and asks the user what they'd like to communicate. (chat.tsx discards
    // bridge prompts that have autoSend:false, so we cannot rely on that path.)
    setChatPrompt(prompt, { newSession: true, autoSend: true, context });
    onAskAI(prompt, { alreadyPrepared: true });
  };

  const handleAddMember = () => {
    setShowAddMember(true);
  };

  const existingAllocs: ExistingAllocationRef[] = useMemo(() => {
    // Only working rows have a real allocation row to dedupe against.
    // Leaders (project-role-user GUIDs) often have no allocation in RM ONE,
    // so excluding them lets a leader also be assigned a working role.
    return working
      .filter((m) => m.resourceId)
      .map((m) => ({
        personId: m.resourceId!,
        bu: m.teamData?.bu || "",
        role: m.teamData?.role || m.role || "",
        title: m.teamData?.title || "",
        hours: m.teamData?.eacHrs || 0,
        // Window + row ID let the add popup's duplicate prompt offer
        // "add hours to the existing assignment" (merge via the edit path).
        allocationId: m.teamData?.rwiId ?? undefined,
        startDate: m.teamData?.startDate,
        endDate: m.teamData?.endDate,
      }));
  }, [working]);

  const handleAssigned = (name: string) => {
    setShowAddMember(false);
    setAssignSlot(null);
    setJustAdded(name);
    // Fetch a FRESH team snapshot (bypasses client + server caches) and push
    // it into the query cache so the modal AND the grid TEAM badge update
    // instantly, then refetch the other dependent queries.
    refreshProjectTeamCache(qc, project.id);
    qc.invalidateQueries({ queryKey: ["project-allocations-raw", project.id] });
    qc.invalidateQueries({ queryKey: ["project-details", project.id] });
    qc.invalidateQueries({ queryKey: ["resource-allocations"] });
    qc.invalidateQueries({ queryKey: ["resource-demands"] });
    setTimeout(() => setJustAdded(null), 4500);
  };

  // Section header used for "Working Team", "Project Leadership", "Open Roles".
  // Solid background (not the 10%-opacity tint we used before) so the sticky
  // header never bleeds into the row scrolling underneath it. The colored
  // accent now lives on a left border + the badge text.
  const sectionHeader = (label: string, count: number, color: string) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 14px",
      backgroundColor: "#F8FAFC",
      borderLeft: `3px solid ${color}`,
      borderTop: "1px solid #E5E9EE",
      borderBottom: "1px solid #E5E9EE",
      position: "sticky", top: 0, zIndex: 2,
      boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color, backgroundColor: color + "18",
        padding: "2px 8px", borderRadius: 10 }}>{count}</div>
    </div>
  );

  // Open-slot row — mirrors the working-team row layout EXACTLY (avatar,
  // role/BU/email-style metadata, EAC HRS column on the right) with one
  // difference: the name slot is a dropdown selector. The user picks a
  // person from the inline picker and we assign them to this slot via the
  // same /assign-resource API the modal uses.
  const renderOpenSlot = (s: OpenSlot, key: string, isFirst: boolean) => {
    return (
      <div key={key} style={{ borderTop: isFirst ? "none" : "1px solid #F0F3F6" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
        }}>
          {/* Avatar — orange tint with a "+" so it's visually distinct from
              an assigned person but the row footprint is identical. */}
          <div style={{
            width: 38, height: 38, borderRadius: 19,
            backgroundColor: BRAND.orange + "22", color: BRAND.orange,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>
            <UserPlus size={16} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.role || "Open Role"}</div>
            <div style={{ fontSize: 11, color: "#777", marginTop: 3, fontWeight: 500 }}>
              {s.bu ? `${s.bu} · ` : ""}{s.pct > 0 ? `${s.pct}%` : "—"}{(s as any).eacHrs > 0 ? ` · ${(s as any).eacHrs}h` : ""}{s.startDate && s.endDate ? ` · ${fmtAllocDate(s.startDate)} – ${fmtAllocDate(s.endDate)}` : ""}
            </div>
          </div>

          <button
            onClick={() => { setAssignSlot(s); setShowAddMember(true); }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8,
              backgroundColor: BRAND.greenBg, color: "#FFF",
              border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}
          >
            <UserPlus size={12} />
            Assign
          </button>
        </div>

      </div>
    );
  };

  // Working/leader row — same layout, leader rows skip the EAC/ETC details.
  const renderTeamRow = (r: TeamRow, key: string, isFirst: boolean) => {
    const ini = r.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?";
    const td = r.teamData;
    const eac = td?.eacHrs ?? 0;
    const etc = td?.etcHrs ?? 0;
    // Derive the allocation % from real EAC hours over the allocation
    // period (40hr week capacity), instead of trusting the source
    // PctAllocation field — that field is the staffing commitment as
    // entered in RM ONE, which can disagree with the actual hours and
    // confused users (e.g. "100 EAC HRS but only 19% allocated?").
    // Falls back to the source pct when we don't have enough info to
    // derive it (no dates, or zero-length period). Zero hours always
    // reads as 0%.
    const computeHoursPct = () => {
      const total = eac + etc;
      if (total <= 0) return 0;
      const s = r.startDate ? new Date(r.startDate) : null;
      const e = r.endDate ? new Date(r.endDate) : null;
      if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return r.pct;
      const weeks = Math.max(1, (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 7));
      const pct = (total / (weeks * getBusinessRules().workWeekHours)) * 100;
      // Round to 1 decimal under 10%, whole number above so "2.1%" and "143%" both read well.
      return pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
    };
    const displayPct = computeHoursPct();
    const isExpanded = expandedIdx === key;
    const nonZeroWeeks = (td?.weeklyHours ?? []).filter((w) => w.hours !== 0);
    const fmtCost = (v: number) => `$${(v ?? 0).toLocaleString()}`;
    return (
      <div key={key} style={{ borderTop: isFirst ? "none" : "1px solid #F0F3F6" }}>
        <button onClick={() => setExpandedIdx(isExpanded ? null : key)}
          style={{
            width: "100%", background: "transparent", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
            // Hard dark ink — this row renders inside the hard-white list
            // container, so theme tokens (white in dark mode) would vanish.
            textAlign: "left", color: "#253746",
          }}>
          <div style={{
            width: 38, height: 38, borderRadius: 19,
            backgroundColor: BRAND.green + "22", color: BRAND.green,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}>{ini}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#111",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
            {/* Role · Title — each clearly labelled */}
            <div style={{ fontSize: 12, color: "#777", marginTop: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {r.role && (
                <span>
                  <span style={{ fontWeight: 600, color: "#555" }}>Role:</span>{" "}
                  <span>{r.role}</span>
                </span>
              )}
              {r.role && td?.title && r.role !== td.title && (
                <span style={{ color: "#ccc" }}>·</span>
              )}
              {td?.title && r.role !== td.title && (
                <span>
                  <span style={{ fontWeight: 600, color: "#555" }}>Title:</span>{" "}
                  <span>{td.title}</span>
                </span>
              )}
              {!r.role && !td?.title && <span>—</span>}
            </div>
            {/* BU · Division · Dept */}
            <div style={{ fontSize: 11, color: "#888", marginTop: 3,
              display: "flex", gap: 8, flexWrap: "wrap", lineHeight: 1.4 }}>
              {td?.memberBu && (
                <>
                  <span>
                    <span style={{ fontWeight: 600, color: "#666" }}>BU:</span>{" "}
                    <span style={{ color: BRAND.green }}>{td.memberBu}</span>
                  </span>
                  <span style={{ color: "#ccc" }}>·</span>
                </>
              )}
              <span>
                <span style={{ fontWeight: 600, color: "#666" }}>Division:</span>{" "}
                <span style={{ color: td?.bu ? "#555" : "#aaa" }}>{td?.bu || "—"}</span>
              </span>
              <span style={{ color: "#ccc" }}>·</span>
              <span>
                <span style={{ fontWeight: 600, color: "#666" }}>Dept:</span>{" "}
                <span style={{ color: td?.dept ? "#555" : "#aaa" }}>{td?.dept || "—"}</span>
              </span>
            </div>
            {r.email ? (
              <div style={{ fontSize: 10, color: "#999", marginTop: 2,
                display: "flex", alignItems: "center", gap: 4,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Mail size={10} /> {r.email}
              </div>
            ) : null}
            {r.kind === "working" ? (
              <div style={{ fontSize: 11, color: displayPct > 0 ? BRAND.green : "#E03C3C",
                fontWeight: 600, marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3,
                  backgroundColor: displayPct > 0 ? BRAND.green : "#E03C3C", display: "inline-block" }} />
                {displayPct}% allocated
              </div>
            ) : null}
          </div>
          {r.kind === "working" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#253746" }}>{eac}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: "#999" }}>EAC HRS</div>
              {isExpanded ? <ChevronUp size={14} color="#999" /> : <ChevronDown size={14} color="#999" />}
            </div>
          ) : null}
        </button>

        {!isExpanded && r.kind === "working" && nonZeroWeeks.length > 0 ? (
          <div style={{
            padding: "0 14px 6px 64px",
            backgroundColor: "#FFF",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                flex: "0 0 56px", fontSize: 9, fontWeight: 700, color: "#253746",
              }}>
                Weekly
              </div>
              <div style={{ flex: 1, minWidth: 0, overflowX: "auto", paddingBottom: 1 }}>
              <div style={{ display: "flex", gap: 5, minWidth: "max-content" }}>
                {nonZeroWeeks.map((w) => (
                  <div key={`collapsed-h-${w.week}`} style={{
                    minWidth: 52, textAlign: "center", padding: "2px 5px",
                    backgroundColor: w.hours > 0 ? BRAND.green + "10" : "#F8FAFB",
                    border: `1px solid ${w.hours > 0 ? BRAND.green + "30" : "#EEF1F5"}`,
                    borderRadius: 4,
                  }}>
                    <div style={{
                      fontSize: 8, fontWeight: 600, color: "#777", whiteSpace: "nowrap",
                    }}>
                      {fmtWeekShort(w.week)}
                    </div>
                    <div style={{
                      marginTop: 1, fontSize: 10, fontWeight: 700,
                      color: w.hours > 0 ? BRAND.green : "#999",
                    }}>
                      {fmtWeekHours(w.hours)}h
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>
        ) : null}

        {isExpanded && r.kind === "working" && (
          <div style={{ padding: "0 14px 14px", backgroundColor: "#F8FAFB" }}>
            {r.email ? (
              <a href={`mailto:${r.email}`} style={{
                display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10,
                padding: "6px 10px", backgroundColor: "#FFF", borderRadius: 8,
                border: `1px solid #EEF1F5`, fontSize: 12, color: BRAND.green,
                fontWeight: 500, textDecoration: "none",
              }}>
                <Mail size={12} /> {r.email}
              </a>
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {[
                { label: "EAC Hrs", value: String(eac), color: "#253746" },
                { label: "ETC Hrs", value: String(etc), color: BRAND.orange },
                { label: "EAC Cost", value: fmtCost(td?.eacCost ?? 0), color: BRAND.green },
                { label: "ETC Cost", value: fmtCost(td?.etcCost ?? 0), color: BRAND.orange },
              ].map((item) => (
                <div key={item.label} style={{
                  backgroundColor: "#FFF", borderRadius: 8, padding: 8, minWidth: 80,
                  border: `1px solid #EEF1F5`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#666", marginBottom: 2 }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</div>
                </div>
              ))}
              {/* Cost Rate — shown separately so we can add a "set rate" link when $0 */}
              <div style={{
                backgroundColor: "#FFF", borderRadius: 8, padding: 8, minWidth: 80,
                border: `1px solid #EEF1F5`,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#666", marginBottom: 2 }}>
                  Cost Rate
                </div>
                {(td?.costRate ?? 0) > 0 ? (
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#555" }}>${td!.costRate}/hr</div>
                ) : (
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#555" }}>$0</div>
                    {canSetRates && (
                      <a
                        href={`/import`}
                        style={{ fontSize: 10, color: BRAND.green, textDecoration: "none", fontWeight: 600 }}
                        title={`Set cost rate for ${r.role}`}
                      >
                        Set rate →
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {(td?.startDate || r.startDate || td?.endDate || r.endDate) ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                fontSize: 11, color: "#666" }}>
                <Calendar size={12} color="#999" />
                {fmtAllocDate(td?.startDate || r.startDate)}
                {(td?.startDate || r.startDate) && (td?.endDate || r.endDate) ? " – " : ""}
                {fmtAllocDate(td?.endDate || r.endDate)}
              </div>
            ) : null}

            {nonZeroWeeks.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#253746", marginBottom: 6 }}>
                  Weekly Hours
                </div>
                <div style={{ overflowX: "auto", marginBottom: 4 }}>
                  <div style={{ display: "inline-block" }}>
                    <div style={{ display: "flex" }}>
                      {nonZeroWeeks.map((w) => (
                        <div key={`h-${w.week}`} style={{
                          width: 56, textAlign: "center", padding: "4px 0",
                          borderRight: `1px solid #EEF1F5`,
                          fontSize: 10, fontWeight: 600, color: "#777", whiteSpace: "nowrap",
                        }}>{fmtWeekShort(w.week)}</div>
                      ))}
                    </div>
                    <div style={{ display: "flex" }}>
                      {nonZeroWeeks.map((w) => (
                        <div key={`v-${w.week}`} style={{
                          width: 56, textAlign: "center", padding: "6px 0",
                          backgroundColor: w.hours > 0 ? BRAND.green + "10" : "transparent",
                          borderRight: `1px solid #EEF1F5`,
                          fontSize: 13, fontWeight: 700,
                          color: w.hours > 0 ? BRAND.green : "#ccc",
                        }}>{fmtWeekHours(w.hours)}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#aaa", fontStyle: "italic" }}>
                No weekly hours allocated
              </div>
            )}

            <button onClick={() => setEditAllocPerson({
              name: r.name, role: r.role, pct: r.pct, resourceId: r.resourceId,
            })} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              backgroundColor: BRAND.greenBg, color: "#FFF", border: "none",
              borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", marginTop: 10, width: "100%",
            }}>
              <Edit2 size={12} /> Edit Allocation
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: Z.MODAL, padding: 20,
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-modal-title"
        style={{
          backgroundColor: BRAND.cardWhite, color: BRAND.cardText,
          borderRadius: 16, width: "min(680px, 100%)",
          maxHeight: "calc(100vh - 40px)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}>
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid var(--rm-panel-border)`,
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11,
              backgroundColor: BRAND.green + "20", color: BRAND.green,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Users size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div id="team-modal-title" style={{ fontSize: 16, fontWeight: 700,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Project Team</div>
              <div style={{ fontSize: 12, color: BRAND.cardMuted, marginTop: 2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
              <div style={{ fontSize: 10, color: BRAND.cardMuted, marginTop: 1 }}>{project.id}</div>
            </div>
          </div>
          <button ref={closeBtnRef} onClick={onClose} aria-label="Close team modal"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: BRAND.cardMuted }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", gap: 10 }}>
              <Loader2 size={24} color={BRAND.green} className="animate-spin" />
              <div style={{ fontSize: 12, color: BRAND.cardMuted }}>Loading team…</div>
            </div>
          ) : error ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", gap: 8 }}>
              <CloudOff size={24} color={BRAND.cardMuted} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>Couldn't load team</div>
              <div style={{ fontSize: 12, color: BRAND.cardMuted }}>Please try again in a moment.</div>
            </div>
          ) : working.length === 0 && leaders.length === 0 && openSlots.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", gap: 8 }}>
              <Users size={24} color={BRAND.cardMuted} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>No team or open roles</div>
              <div style={{ fontSize: 12, color: BRAND.cardMuted, textAlign: "center" }}>
                No staff or unfilled allocation slots have been registered for this project in RM ONE yet.
              </div>
               <button
                 type="button"
                 onClick={handleAddMember}
                 style={{
                   display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                   marginTop: 8, padding: "9px 16px", border: "none", borderRadius: 9,
                   backgroundColor: BRAND.greenBg, color: "#FFF",
                   fontSize: 12, fontWeight: 700, cursor: "pointer",
                   boxShadow: "0 4px 10px rgba(107,165,57,0.18)",
                 }}
               >
                 <UserPlus size={14} /> Add team member
               </button>
            </div>
          ) : (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                backgroundColor: BRAND.green + "10", borderRadius: 10, padding: "10px 12px",
              }}>
                <Users size={16} color={BRAND.green} />
                <div style={{ fontSize: 13, color: BRAND.cardText, flex: 1 }}>
                  <strong style={{ color: BRAND.green, fontWeight: 700 }}>
                    {working.length} working
                  </strong>
                  {leaders.length > 0 ? <> · {leaders.length} leadership</> : null}
                  {openSlots.length > 0 ? <> · <strong style={{ color: BRAND.orange, fontWeight: 700 }}>{openSlots.length} open</strong></> : null}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleAddMember} style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  backgroundColor: BRAND.greenBg, color: "#FFF", border: "none",
                  borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>
                  <UserPlus size={14} /> Add Member
                </button>
                <button onClick={handleNotifyTeam} style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  backgroundColor: BRAND.greenBg, color: "#FFF", border: "none",
                  borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>
                  <Mail size={13} /> Notify Team
                </button>
              </div>

              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                backgroundColor: "#FFF", borderRadius: 10, padding: "10px 12px",
                border: `1.5px solid ${search.length > 0 ? BRAND.green : "#E0E3E8"}`,
              }}>
                <Search size={14} color={search.length > 0 ? BRAND.green : "#AABBC0"} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, role, or email…"
                  style={{
                    flex: 1, border: "none", outline: "none", backgroundColor: "transparent",
                    fontSize: 13, color: "#253746",
                  }}
                />
                {search.length > 0 && (
                  <button onClick={() => setSearch("")}
                    style={{ background: "#F0F2F5", border: "none", borderRadius: 10, padding: 2, cursor: "pointer" }}>
                    <X size={13} color="#777" />
                  </button>
                )}
              </div>

              <div style={{
                flex: 1, minHeight: 0, overflowY: "auto",
                backgroundColor: "#FFF", borderRadius: 14,
                border: `1px solid #EEF1F5`,
              }}>
                {q && filteredWorking.length === 0 && filteredLeaders.length === 0 && filteredOpen.length === 0 ? (
                  <div style={{ padding: "30px 20px", textAlign: "center", fontSize: 12, color: "#6B7E8A" }}>
                    No matches for &ldquo;{search}&rdquo;.
                  </div>
                ) : null}

                {filteredWorking.length > 0 ? (
                  <>
                    {sectionHeader("Working Team", filteredWorking.length, BRAND.green)}
                    {filteredWorking.map((r, i) => renderTeamRow(r, `working-${r.resourceId || r.name}-${i}`, i === 0))}
                  </>
                ) : null}

                {filteredOpen.length > 0 ? (
                  <>
                    {sectionHeader("Open Roles", filteredOpen.length, BRAND.orange)}
                    {filteredOpen.map((s, i) => renderOpenSlot(
                      s,
                      `open-${s.role}-${s.startDate}-${i}`,
                      i === 0,
                    ))}
                  </>
                ) : null}

                {filteredLeaders.length > 0 ? (
                  <>
                    {sectionHeader("Project Leadership", filteredLeaders.length, "#253746")}
                    {filteredLeaders.map((r, i) => renderTeamRow(r, `leader-${r.resourceId || r.name}-${i}`, i === 0))}
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>

        {justAdded ? (
          <div style={{
            margin: "0 16px 10px",
            padding: "8px 12px", borderRadius: 8,
            backgroundColor: BRAND.green + "15", border: `1px solid ${BRAND.green}40`,
            fontSize: 12, color: BRAND.green, fontWeight: 600,
          }}>
            Added {justAdded} to the team. Refreshing list…
          </div>
        ) : null}

        <div style={{ padding: "10px 20px", borderTop: `1px solid var(--rm-panel-border)`,
          fontSize: 11, color: BRAND.cardMuted, display: "flex", justifyContent: "space-between" }}>
          <span>
            {working.length} working
            {leaders.length > 0 ? ` · ${leaders.length} leadership` : ""}
            {openSlots.length > 0 ? ` · ${openSlots.length} open` : ""}
          </span>
          <span>Live data</span>
        </div>
      </div>

      <AddTeamMemberModal
        open={showAddMember}
        onClose={() => { setShowAddMember(false); setAssignSlot(null); }}
        projectId={project.id}
        module={module}
        projectName={project.name}
        projectStartDate={(project.rawTargetStart || new Date().toISOString()).slice(0, 10)}
        projectEndDate={(project.rawTargetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
        scheduleStart={project.datesFromSchedule ? (project.rawTargetStart || "") : ""}
        scheduleEnd={project.datesFromSchedule ? (project.rawTargetEnd || "") : ""}
        existingAllocations={existingAllocs}
        onAssigned={handleAssigned}
        prefillBuShort={assignSlot?.bu}
        prefillRole={assignSlot?.role}
        prefillTitle={assignSlot?.title || assignSlot?.role}
        prefillStartDate={assignSlot?.startDate}
        prefillEndDate={assignSlot?.endDate}
        prefillPct={assignSlot?.pct}
        openRoles={teamQ.data?.openRoles ?? []}
         onSetupSchedule={() => {
           setShowAddMember(false);
           setAssignSlot(null);
           onClose();
           navTo(`/project/${project.id}`);
           setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
         }}
      />

      {editAllocPerson && (
        <EditAllocationModal
          person={editAllocPerson}
          projectId={project.id}
          projectName={project.name}
          onClose={() => setEditAllocPerson(null)}
          onSaved={(savedHours) => {
            setEditAllocPerson(null);
            // Put confirmed weekly hours into the visible Team row before its
            // slower fresh verification request returns. The save response is
            // read back from the committed transaction, never an optimistic
            // guess, so this cannot show an unpersisted edit as successful.
            if (savedHours) applyProjectMemberHours(qc, project.id, savedHours);
            refreshProjectTeamCache(qc, project.id);
            qc.invalidateQueries({ queryKey: ["resource-allocations"] });
            qc.invalidateQueries({ queryKey: ["project-allocations-raw", project.id] });
            qc.invalidateQueries({ queryKey: ["full-project-allocations", project.id] });
          }}
          onSetupSchedule={() => {
            setEditAllocPerson(null);
            onClose();
            navTo(`/project/${project.id}`);
            setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
          }}
        />
      )}
    </div>
  );
}

// ── Card context menu ─────────────────────────────────────────────────────────
type ContextMenuItem = {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  action: string;
  color: string;
  bold?: boolean;
};

// User-level access (accessLevel === "user" → stored canEdit=false) only gets
// read-style actions: Notes + Compare. Everything that mutates the record —
// Change Status, Change Source Type, Add Open Position, Put on/Remove Hold —
// is admin/manager only. Applied inside the shared builders so cards AND the
// Data Grid stay in lockstep automatically.
const EDIT_ONLY_MENU_ACTIONS = new Set(["change-status", "source-type", "open-position", "hold", "unhold", "team", "leads"]);
function filterMenuForAccess(items: ContextMenuItem[]): ContextMenuItem[] {
  const u = getStoredUser();
  const canEdit = !u || u.canEdit !== false; // null/undefined grandfathered as editable
  const out = canEdit ? items : items.filter(i => !EDIT_ONLY_MENU_ACTIONS.has(i.action));
  // Superadmin-only: root-allowlist accounts get a Delete action on every
  // record menu (cards AND Data Grid — all three builders route through
  // here). Display-only gating; the server re-checks the same allowlist.
  if (isRootAccount(u?.username)) {
    out.push({ icon: Trash2, label: "Delete Record", action: "delete-record", color: "#EF4444", bold: true });
  }
  return out;
}

// Shared menu definitions — used by both the cards and the Data Grid so the
// two views always offer the identical actions (same handleCardMenu backend).
function projectMenuItems(p: Project, inCompareArg?: boolean): ContextMenuItem[] {
  const inCompare = !!inCompareArg;
  const onHold = p.rawStatus === "On Hold";
  return filterMenuForAccess([
    { icon: RefreshCw, label: "Change Status", action: "change-status", color: BRAND.green, bold: true },
    { icon: Users, label: "Add Team Member", action: "team", color: BRAND.textSecondary },
    { icon: UserPlus, label: "Add Open Position", action: "open-position", color: BRAND.orange },
    { icon: FileText, label: "Notes & Description", action: "notes", color: BRAND.cardMuted },
    { icon: GitCompare, label: inCompare ? "✓ In Compare" : "Compare", action: "compare", color: inCompare ? BRAND.green : BRAND.cardMuted, bold: true },
    { icon: onHold ? Play : Pause, label: onHold ? "Remove Hold" : "Put on Hold", action: onHold ? "unhold" : "hold", color: onHold ? BRAND.green : BRAND.orange },
  ]);
}
function oppMenuItems(o: Opportunity, inCompareArg?: boolean): ContextMenuItem[] {
  const inCompare = !!inCompareArg;
  const onHold = o.stage === "On Hold";
  return filterMenuForAccess([
    { icon: RefreshCw, label: "Change Status", action: "change-status", color: BRAND.green, bold: true },
    { icon: Users, label: "Add Team Member", action: "team", color: BRAND.textSecondary },
    { icon: UserPlus, label: "Add Open Position", action: "open-position", color: BRAND.orange },
    { icon: FileText, label: "Notes & Description", action: "notes", color: BRAND.cardMuted },
    { icon: GitCompare, label: inCompare ? "✓ In Compare" : "Compare", action: "compare", color: inCompare ? BRAND.green : BRAND.cardMuted, bold: true },
    { icon: onHold ? Play : Pause, label: onHold ? "Remove Hold" : "Put on Hold", action: onHold ? "unhold" : "hold", color: onHold ? BRAND.green : BRAND.orange },
  ]);
}
// Lead menu — Change Status, Add Lead (key personnel), Notes & Description, Compare, Hold.
function leadMenuItems(l: Lead, inCompareArg?: boolean): ContextMenuItem[] {
  const inCompare = !!inCompareArg;
  const onHold = l.status === "On Hold";
  return filterMenuForAccess([
    { icon: RefreshCw, label: "Change Status", action: "change-status", color: BRAND.green, bold: true },
    { icon: UserPlus, label: "Add Lead", action: "leads", color: BRAND.orange },
    { icon: FileText, label: "Notes & Description", action: "notes", color: BRAND.cardMuted },
    { icon: GitCompare, label: inCompare ? "✓ In Compare" : "Compare", action: "compare", color: inCompare ? BRAND.green : BRAND.cardMuted, bold: true },
    { icon: onHold ? Play : Pause, label: onHold ? "Remove Hold" : "Put on Hold", action: onHold ? "unhold" : "hold", color: onHold ? BRAND.green : BRAND.orange },
  ]);
}

// Data Grid variant of the context menu. The grid's table cells clip overflow
// and the grid body scrolls, so the dropdown is rendered through a portal with
// fixed positioning (the card version's absolute dropdown would be cut off).
function GridRowMenu({ items, inCompare, isOnHold, onAction }: {
  items: ContextMenuItem[];
  inCompare?: boolean;
  isOnHold?: boolean;
  onAction: (action: string) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    const dismiss = () => setPos(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [pos]);

  const dotColor = isOnHold ? "#F59E0B" : inCompare ? BRAND.green : BRAND.cardMuted;
  const MENU_W = 196;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) { setPos(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          const estH = items.length * 35 + 10;
          const top = r.bottom + 4 + estH > window.innerHeight
            ? Math.max(8, r.top - 4 - estH)
            : r.bottom + 4;
          const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
          setPos({ top, left });
        }}
        title="More actions"
        style={{
          width: 28, height: 28, borderRadius: 8, border: "none",
          backgroundColor: pos ? dotColor + "25" : "transparent",
          color: dotColor, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          verticalAlign: "middle", transition: "background 0.15s",
        }}
      >
        <MoreVertical size={15} strokeWidth={2.8} />
      </button>
      {pos && createPortal(
        <div ref={menuRef} style={{
          position: "fixed", top: pos.top, left: pos.left, zIndex: Z.PAGE_MENU,
          backgroundColor: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          borderRadius: 10, padding: "4px 0", minWidth: MENU_W,
          boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
        }}>
          {items.map((item) => (
            <button
              key={item.action}
              onClick={(e) => { e.stopPropagation(); setPos(null); onAction(item.action); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 9,
                padding: "9px 14px", background: "none", border: "none",
                color: item.color, fontSize: 12, fontWeight: item.bold ? 700 : 500,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--rm-panel-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <item.icon size={13} strokeWidth={2} />
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function CardContextMenu({ items, inCompare, isOnHold, onAction }: {
  items: ContextMenuItem[];
  inCompare?: boolean;
  isOnHold?: boolean;
  onAction: (action: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const dotColor = isOnHold ? "#F59E0B" : inCompare ? BRAND.green : BRAND.cardMuted;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="More actions"
        style={{
          width: 30, height: 30, borderRadius: 8, border: "none",
          backgroundColor: open ? dotColor + "25" : "transparent",
          color: dotColor,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 0.15s",
        }}
      >
        <MoreVertical size={15} strokeWidth={2.8} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 300,
          backgroundColor: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          borderRadius: 10, padding: "4px 0", minWidth: 196,
          boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
        }}>
          {items.map((item) => (
            <button
              key={item.action}
              onClick={(e) => { e.stopPropagation(); onAction(item.action); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 9,
                padding: "9px 14px", background: "none", border: "none",
                color: item.color, fontSize: 12, fontWeight: item.bold ? 700 : 500,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--rm-panel-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <item.icon size={13} strokeWidth={2} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Compare floating bar ──────────────────────────────────────────────────────
function CompareBar({ items, onRemove, onCompare, onClear }: {
  items: Array<{ id: string; type: "pmm" | "opm" | "lem"; data: Project | Opportunity | Lead }>;
  onRemove: (id: string) => void;
  onCompare: () => void;
  onClear: () => void;
}) {
  const count = items.length;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      zIndex: 500, display: "flex", alignItems: "center", gap: 10,
      backgroundColor: "var(--rm-panel)",
      border: "1px solid var(--rm-panel-border)",
      borderRadius: 14, padding: "10px 16px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
    }}>
      <GitCompare size={16} color={BRAND.green} />
      <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.green }}>
        {count === 1 ? "1 selected — pick one more" : "Ready to compare"}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        {items.map(item => (
          <div key={item.id} style={{
            display: "flex", alignItems: "center", gap: 5,
            backgroundColor: BRAND.green + "18", borderRadius: 7, padding: "4px 9px",
            border: `1px solid ${BRAND.green}35`,
          }}>
            <span style={{ fontSize: 11, color: BRAND.white, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(item.data as any).name}
            </span>
            <button onClick={(e) => { e.stopPropagation(); onRemove(item.id); }} style={{
              background: "none", border: "none", cursor: "pointer",
              color: BRAND.cardMuted, padding: 0, display: "flex", alignItems: "center",
              marginLeft: 2,
            }}>
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
      {count === 2 && (
        <button onClick={(e) => { e.stopPropagation(); onCompare(); }} style={{
          padding: "7px 16px", backgroundColor: BRAND.green, color: BRAND.white,
          border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <Scale size={13} /> Compare
        </button>
      )}
      <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={{
        background: "none", border: "none", cursor: "pointer",
        color: BRAND.cardMuted, padding: 4, display: "flex", alignItems: "center",
        marginLeft: 2,
      }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── Compare modal ─────────────────────────────────────────────────────────────
function CompareModal({ items, onClose }: {
  items: Array<{ id: string; type: "pmm" | "opm" | "lem"; data: Project | Opportunity | Lead }>;
  onClose: () => void;
}) {
  const [a, b] = items;
  const isPmm = a.type === "pmm";
  const isLem = a.type === "lem";
  const pa = a.data as Project;
  const pb = b.data as Project;
  const oa = a.data as Opportunity;
  const ob = b.data as Opportunity;
  const la = a.data as Lead;
  const lb = b.data as Lead;

  // Fetch real team counts from /project-team (same cache key as TeamModal).
  // useQueries fires both in parallel; stale cache is served instantly.
  const teamQueries = useQueries({
    queries: [a.id, b.id].map((id) => ({
      queryKey: ["project-team", id],
      queryFn: () => getProjectTeam(id).catch(() => ({ team: [] as ProjectTeamMember[], openRoles: [] as import("@/lib/api").OpenRole[] })),
      staleTime: 5 * 60_000,
      gcTime: 10 * 60_000,
    })),
  });
  const membersA: ProjectTeamMember[] = (teamQueries[0].data as any)?.team ?? [];
  const membersB: ProjectTeamMember[] = (teamQueries[1].data as any)?.team ?? [];
  const teamACount = membersA.length > 0 ? membersA.length : countAssignedUserGuids((a.data as any).assignedUserGuids ?? "");
  const teamBCount = membersB.length > 0 ? membersB.length : countAssignedUserGuids((b.data as any).assignedUserGuids ?? "");
  const teamA = teamACount;
  const teamB = teamBCount;
  const [expandTeam, setExpandTeam] = useState<null | 0 | 1>(null);
  const healthA = isPmm ? listProjectHealth(pa) : isLem ? listLeadHealth(la) : listOppHealth(oa);
  const healthB = isPmm ? listProjectHealth(pb) : isLem ? listLeadHealth(lb) : listOppHealth(ob);

  const fmtVal = (n: number) => n === 0 ? "—" : `$${(n / 1_000_000).toFixed(1)}M`;
  const fmtDate = (s?: string) => {
    if (!s || s.startsWith("0001")) return "—";
    try { return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
    catch { return "—"; }
  };

  function Diff({ vA, vB }: { vA: number; vB: number }) {
    if (!vA && !vB) return null;
    const diff = vA - vB;
    if (diff === 0) return <span style={{ fontSize: 10, color: BRAND.cardMuted, marginLeft: 5 }}>equal</span>;
    const isPos = diff > 0;
    const fmt = Math.abs(diff) >= 1_000_000
      ? `$${(Math.abs(diff) / 1_000_000).toFixed(1)}M`
      : Math.abs(diff) >= 1000 ? `$${Math.round(Math.abs(diff) / 1000)}K` : `$${Math.round(Math.abs(diff))}`;
    return (
      <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 5, color: isPos ? BRAND.green : "#E05050" }}>
        {isPos ? "▲" : "▼"} {fmt}
      </span>
    );
  }

  function ScoreGauge({ score }: { score: number }) {
    const color = score >= 75 ? BRAND.green : score >= 50 ? "#F59E0B" : "#E05050";
    const label = score >= 75 ? "Healthy" : score >= 50 ? "Needs Attention" : "At Risk";
    const pct = score;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ position: "relative", width: 72, height: 72 }}>
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke="#2A3A2A" strokeWidth="8" />
            <circle cx="36" cy="36" r="30" fill="none" stroke={color} strokeWidth="8"
              strokeDasharray={`${2 * Math.PI * 30 * pct / 100} ${2 * Math.PI * 30 * (1 - pct / 100)}`}
              strokeLinecap="round"
              transform="rotate(-90 36 36)" />
          </svg>
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            fontSize: 15, fontWeight: 800, color,
          }}>{score}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>
      </div>
    );
  }

  type RowData = { label: string; vA: React.ReactNode; vB: React.ReactNode; numA?: number; numB?: number; isSection?: boolean };

  const rows: RowData[] = [];

  // ─ Identity ─
  rows.push({ label: "IDENTITY", vA: "", vB: "", isSection: true });
  rows.push({ label: "ID", vA: a.id, vB: b.id });
  if (isPmm) {
    rows.push({ label: "Phase", vA: pa.phase || "—", vB: pb.phase || "—" });
    rows.push({ label: "Status", vA: pa.rawStatus || pa.status || "—", vB: pb.rawStatus || pb.status || "—" });
  } else if (isLem) {
    rows.push({ label: "Status", vA: la.status || "—", vB: lb.status || "—" });
  } else {
    rows.push({ label: "Status", vA: oa.stage || "—", vB: ob.stage || "—" });
  }
  rows.push({ label: "Sector", vA: (a.data as any).sector || "—", vB: (b.data as any).sector || "—" });
  rows.push({ label: "City", vA: (a.data as any).city || "—", vB: (b.data as any).city || "—" });
  rows.push({ label: "BU", vA: (a.data as any).bu || "—", vB: (b.data as any).bu || "—" });
  rows.push({ label: "Division", vA: (a.data as any).division || "—", vB: (b.data as any).division || "—" });
  rows.push({ label: "Client", vA: (a.data as any).client || "—", vB: (b.data as any).client || "—" });

  // ─ Finance ─
  rows.push({ label: "FINANCE", vA: "", vB: "", isSection: true });
  if (isPmm) {
    rows.push({ label: "Contract Value", vA: fmtVal(pa.value), vB: fmtVal(pb.value), numA: pa.value, numB: pb.value });
    rows.push({ label: "Forecast Cost", vA: fmtVal(pa.forecastCost), vB: fmtVal(pb.forecastCost), numA: pa.forecastCost, numB: pb.forecastCost });
    rows.push({ label: "Labor Contract", vA: fmtVal(pa.laborContract), vB: fmtVal(pb.laborContract), numA: pa.laborContract, numB: pb.laborContract });
  } else if (isLem) {
    // Leads only carry an estimated value — no probability/weighted numbers.
    rows.push({ label: "Estimated Value", vA: fmtVal(la.value), vB: fmtVal(lb.value), numA: la.value, numB: lb.value });
  } else {
    rows.push({ label: "Forecasted Value", vA: fmtVal(oa.value), vB: fmtVal(ob.value), numA: oa.value, numB: ob.value });
    rows.push({ label: "Weighted Value", vA: fmtVal(oa.weightedValue), vB: fmtVal(ob.weightedValue), numA: oa.weightedValue, numB: ob.weightedValue });
    rows.push({ label: "Win Probability", vA: oa.probability ? `${oa.probability}%` : "—", vB: ob.probability ? `${ob.probability}%` : "—" });
  }

  // ─ Timeline ─
  rows.push({ label: "TIMELINE", vA: "", vB: "", isSection: true });
  // Leads now carry Target Start/End too (their expected window), so the
  // Start/End rows render for every module.
  rows.push({ label: "Start", vA: fmtDate((a.data as any).rawTargetStart), vB: fmtDate((b.data as any).rawTargetStart) });
  rows.push({ label: "End", vA: fmtDate((a.data as any).rawTargetEnd), vB: fmtDate((b.data as any).rawTargetEnd) });
  if (isLem) {
    // Leads have no bid window — show due/created instead. The Due row only
    // appears when a real DueDate exists (otherwise it would duplicate End).
    if (la.rawDueDate || lb.rawDueDate) {
      rows.push({ label: "Due Date", vA: fmtDate(la.rawDueDate), vB: fmtDate(lb.rawDueDate) });
    }
    rows.push({ label: "Created", vA: fmtDate(la.rawCreated), vB: fmtDate(lb.rawCreated) });
  } else if (!isPmm) {
    rows.push({ label: "Bid Date", vA: fmtDate(oa.rawBidDate), vB: fmtDate(ob.rawBidDate) });
    rows.push({ label: "Days to Bid", vA: oa.daysLeft >= 999 ? "—" : `${oa.daysLeft}d`, vB: ob.daysLeft >= 999 ? "—" : `${ob.daysLeft}d` });
  } else {
    rows.push({ label: "Days in Phase", vA: pa.daysInPhase != null ? `${pa.daysInPhase}d` : "—", vB: pb.daysInPhase != null ? `${pb.daysInPhase}d` : "—" });
  }

  // ─ Team ─
  rows.push({ label: "TEAM", vA: "", vB: "", isSection: true });
  rows.push({ label: "Assigned Members", vA: teamA > 0 ? String(teamA) : "—", vB: teamB > 0 ? String(teamB) : "—", numA: teamA, numB: teamB });

  const SECTION_BG = "var(--rm-panel-soft)";
  const ROW_ALT = "var(--rm-panel-soft)";
  const CELL_COLOR = "var(--rm-text)";
  const LABEL_COLOR = "var(--rm-text-muted)";
  const BORDER = "1px solid var(--rm-panel-border)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 600,
        backgroundColor: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--rm-bg)", borderRadius: 16, width: "100%", maxWidth: 860,
          maxHeight: "92vh", display: "flex", flexDirection: "column",
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Modal header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 24px", borderBottom: BORDER, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Scale size={18} color={BRAND.green} />
            <span style={{ fontSize: 16, fontWeight: 800, color: BRAND.white }}>
              Compare {isPmm ? "Projects" : isLem ? "Leads" : "Opportunities"}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer", color: BRAND.cardMuted,
            display: "flex", alignItems: "center", padding: 6, borderRadius: 8,
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Record names header */}
        <div style={{
          display: "grid", gridTemplateColumns: "200px 1fr 1fr",
          padding: "16px 24px", borderBottom: BORDER, flexShrink: 0,
          backgroundColor: SECTION_BG,
        }}>
          <div />
          {([a, b] as typeof items).map((item, idx) => (
            <div key={item.id} style={{ paddingLeft: idx === 0 ? 0 : 12 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: BRAND.green, letterSpacing: 1, marginBottom: 4,
              }}>
                {isPmm ? "PROJECT" : isLem ? "LEAD" : "OPPORTUNITY"} {idx + 1}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.white, lineHeight: 1.3 }}>
                {(item.data as any).name}
              </div>
              <div style={{ fontSize: 11, color: BRAND.cardMuted, marginTop: 2 }}>{item.id}</div>
            </div>
          ))}
        </div>

        {/* Health gauges */}
        <div style={{
          display: "grid", gridTemplateColumns: "200px 1fr 1fr",
          padding: "18px 24px", borderBottom: BORDER, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.cardMuted, letterSpacing: 1 }}>HEALTH SCORE</span>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ScoreGauge score={healthA.score} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", borderLeft: BORDER }}>
            <ScoreGauge score={healthB.score} />
          </div>
        </div>

        {/* Comparison rows */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 0 20px" }}>
          {rows.map((row, i) => {
            if (row.isSection) {
              return (
                <div key={row.label} style={{
                  padding: "8px 24px 6px",
                  backgroundColor: SECTION_BG,
                  borderTop: i > 0 ? BORDER : undefined,
                  borderBottom: BORDER,
                }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: BRAND.green, letterSpacing: 1.5 }}>
                    {row.label}
                  </span>
                </div>
              );
            }
            const bg = i % 2 === 0 ? "transparent" : ROW_ALT;
            const hasDiff = row.numA != null && row.numB != null;
            const isTeamRow = row.label === "Assigned Members";

            const renderMemberCount = (count: number, side: 0 | 1) => {
              if (count === 0) return <span style={{ fontSize: 12, fontWeight: 700, color: CELL_COLOR }}>—</span>;
              const isOpen = expandTeam === side;
              return (
                <button
                  onClick={() => setExpandTeam(isOpen ? null : side)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 5 }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.green, textDecoration: "underline", textDecorationStyle: "dotted" }}>
                    {count}
                  </span>
                  <span style={{ fontSize: 10, color: BRAND.cardMuted }}>{isOpen ? "▲" : "▼"}</span>
                </button>
              );
            };

            return (
              <div key={row.label}>
                <div style={{
                  display: "grid", gridTemplateColumns: "200px 1fr 1fr",
                  padding: "9px 24px", backgroundColor: bg,
                  borderBottom: isTeamRow && expandTeam !== null ? "none" : `1px solid ${BRAND.green}12`,
                  alignItems: "center",
                }}>
                  <span style={{ fontSize: 11, color: LABEL_COLOR, fontWeight: 600 }}>{row.label}</span>
                  <div style={{ fontSize: 12, fontWeight: 700, color: CELL_COLOR, display: "flex", alignItems: "center", gap: 4 }}>
                    {isTeamRow ? renderMemberCount(teamA, 0) : row.vA}
                    {hasDiff && !isTeamRow && <Diff vA={row.numA!} vB={row.numB!} />}
                    {isTeamRow && teamA > 0 && teamB > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4, color: teamA > teamB ? BRAND.green : "#E05050" }}>
                        {teamA > teamB ? `▲ ${teamA - teamB}` : teamA < teamB ? `▼ ${teamB - teamA}` : "equal"}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: CELL_COLOR,
                    display: "flex", alignItems: "center", paddingLeft: 12,
                    borderLeft: `1px solid ${BRAND.green}12`,
                    gap: 4,
                  }}>
                    {isTeamRow ? renderMemberCount(teamB, 1) : row.vB}
                    {hasDiff && !isTeamRow && <Diff vA={row.numB!} vB={row.numA!} />}
                    {isTeamRow && teamA > 0 && teamB > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4, color: teamB > teamA ? BRAND.green : "#E05050" }}>
                        {teamB > teamA ? `▲ ${teamB - teamA}` : teamB < teamA ? `▼ ${teamA - teamB}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                {/* Expanded team member list */}
                {isTeamRow && expandTeam !== null && (() => {
                  const members = expandTeam === 0 ? membersA : membersB;
                  const loading = expandTeam === 0 ? teamQueries[0].isLoading : teamQueries[1].isLoading;
                  return (
                    <div style={{
                      padding: "8px 24px 12px",
                      backgroundColor: bg,
                      borderBottom: `1px solid ${BRAND.green}12`,
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: BRAND.green,
                        letterSpacing: 1, marginBottom: 8, paddingLeft: 200,
                      }}>
                        {expandTeam === 0 ? (a.data as any).name : (b.data as any).name} — TEAM
                      </div>
                      {loading ? (
                        <div style={{ paddingLeft: 200, fontSize: 11, color: BRAND.cardMuted }}>Loading…</div>
                      ) : members.length === 0 ? (
                        <div style={{ paddingLeft: 200, fontSize: 11, color: BRAND.cardMuted }}>No members found.</div>
                      ) : (
                        <div style={{ paddingLeft: 200, display: "flex", flexDirection: "column", gap: 4 }}>
                          {members.map((m, mi) => {
                            const initials = (m.name || "?").split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
                            const roleLabel = [m.role, m.title].filter(Boolean).join(" · ") || (m.memberBu || m.bu || "");
                            return (
                              <div key={mi} style={{
                                display: "flex", alignItems: "center", gap: 8,
                                padding: "5px 10px", borderRadius: 7,
                                backgroundColor: "var(--rm-panel-soft)",
                              }}>
                                <div style={{
                                  width: 26, height: 26, borderRadius: "50%",
                                  backgroundColor: BRAND.green + "33",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 9, fontWeight: 800, color: BRAND.green, flexShrink: 0,
                                }}>{initials}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--rm-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {m.name || "Name not recorded"}
                                  </div>
                                  {roleLabel && (
                                    <div style={{ fontSize: 10, color: BRAND.cardMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {roleLabel}
                                    </div>
                                  )}
                                </div>
                                {m.eacHrs > 0 && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.green, flexShrink: 0 }}>
                                    {Math.round(m.eacHrs)}h
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* Health checks breakdown */}
          <div style={{ padding: "8px 24px 6px", backgroundColor: SECTION_BG, borderTop: BORDER, borderBottom: BORDER }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: BRAND.green, letterSpacing: 1.5 }}>HEALTH CHECKS</span>
          </div>
          {healthA.checks.map((chk, i) => {
            const chkB = healthB.checks[i];
            return (
              <div key={chk.label} style={{
                display: "grid", gridTemplateColumns: "200px 1fr 1fr",
                padding: "7px 24px", backgroundColor: i % 2 === 0 ? "transparent" : ROW_ALT,
                borderBottom: `1px solid ${BRAND.green}12`,
                alignItems: "center",
              }}>
                <span style={{ fontSize: 11, color: LABEL_COLOR, fontWeight: 500 }}>{chk.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  {chk.passed
                    ? <CheckCircle2 size={13} color={BRAND.green} />
                    : <AlertCircle size={13} color="#E05050" />}
                  <span style={{ fontSize: 11, color: chk.passed ? BRAND.green : "#E05050", fontWeight: 600 }}>
                    {chk.passed ? "Pass" : (chk.failText || "Fail")}
                  </span>
                </div>
                {chkB && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 5,
                    paddingLeft: 12, borderLeft: `1px solid ${BRAND.green}12`,
                  }}>
                    {chkB.passed
                      ? <CheckCircle2 size={13} color={BRAND.green} />
                      : <AlertCircle size={13} color="#E05050" />}
                    <span style={{ fontSize: 11, color: chkB.passed ? BRAND.green : "#E05050", fontWeight: 600 }}>
                      {chkB.passed ? "Pass" : (chkB.failText || "Fail")}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 24px", borderTop: BORDER, flexShrink: 0,
          display: "flex", gap: 10, justifyContent: "flex-end",
        }}>
          <button onClick={() => window.open(`/project/${a.id}`, "_self")} style={{
            padding: "8px 16px", borderRadius: 8, border: `1px solid ${BRAND.green}50`,
            backgroundColor: "transparent", color: BRAND.green,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            Open {isPmm ? "Project" : "Opp"} 1
          </button>
          <button onClick={() => window.open(`/project/${b.id}`, "_self")} style={{
            padding: "8px 16px", borderRadius: 8, border: `1px solid ${BRAND.green}50`,
            backgroundColor: "transparent", color: BRAND.green,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            Open {isPmm ? "Project" : "Opp"} 2
          </button>
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            backgroundColor: BRAND.green, color: BRAND.white,
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change Source Type modal ──────────────────────────────────────────────────
const SOURCE_TYPE_OPTIONS = [
  { value: "CNS", label: "Service Projects (CNS)" },
  { value: "CPR", label: "Construction (CPR)" },
  { value: "HLT", label: "Healthcare (HLT)" },
  { value: "EDU", label: "Education (EDU)" },
  { value: "GOV", label: "Government (GOV)" },
  { value: "TRN", label: "Transportation (TRN)" },
  { value: "COM", label: "Commercial (COM)" },
  { value: "IND", label: "Industrial (IND)" },
];

function ChangeSourceTypeModal({ record, onClose, onConfirm }: {
  record: Opportunity | Lead;
  onClose: () => void;
  onConfirm: (value: string, reason: string) => Promise<void>;
}) {
  const isKnown = SOURCE_TYPE_OPTIONS.some(o => o.value === record.requestCategory);
  const [value, setValue] = useState(
    record.requestCategory
      ? (isKnown ? record.requestCategory : "__custom__")
      : SOURCE_TYPE_OPTIONS[0].value
  );
  const [customValue, setCustomValue] = useState(
    record.requestCategory && !isKnown ? record.requestCategory : ""
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const isCustom = value === "__custom__";
  const effectiveValue = isCustom ? customValue.trim() : value;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveValue) return;
    setSaving(true);
    await onConfirm(effectiveValue, reason);
    setSaving(false);
  }

  const currentLabel = SOURCE_TYPE_OPTIONS.find(o => o.value === record.requestCategory)?.label
    ?? record.requestCategory;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 700,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--rm-panel)", borderRadius: 14, width: "100%", maxWidth: 460,
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--rm-panel-border)",
          backgroundColor: "rgba(100,160,255,0.07)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={15} color="#3a7bd5" />
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)" }}>Change Source Type</span>
          </div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--rm-text-muted)", display: "flex", alignItems: "center", padding: 4, borderRadius: 6,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 20px 10px" }}>
          <div style={{
            fontSize: 12, color: "var(--rm-text-muted)", marginBottom: 16,
            padding: "7px 12px", backgroundColor: "var(--rm-panel-soft)", borderRadius: 8,
          }}>
            <strong style={{ color: "var(--rm-text)" }}>{record.name}</strong>
            {currentLabel && (
              <span style={{ marginLeft: 8, opacity: 0.7 }}>· Currently: {currentLabel}</span>
            )}
          </div>

          {/* Source type dropdown */}
          <div style={{ marginBottom: isCustom ? 10 : 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: 0.8, marginBottom: 6 }}>
              SOURCE TYPE <span style={{ color: "#3a7bd5" }}>*</span>
            </label>
            <select
              value={value}
              onChange={(e) => { setValue(e.target.value); if (e.target.value !== "__custom__") setCustomValue(""); }}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--rm-panel-border)",
                backgroundColor: "var(--rm-panel-soft)",
                color: "var(--rm-text)", fontSize: 13,
                boxSizing: "border-box",
              }}
            >
              {SOURCE_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
          </div>

          {/* Custom type text input */}
          {isCustom && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: 0.8, marginBottom: 6 }}>
                CUSTOM TYPE <span style={{ color: "#3a7bd5" }}>*</span>
              </label>
              <input
                type="text"
                required={isCustom}
                autoFocus
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder="e.g. RES, MIX, ENV…"
                maxLength={20}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: `1px solid ${customValue.trim() ? "#3a7bd5" : "var(--rm-panel-border)"}`,
                  backgroundColor: "var(--rm-panel-soft)",
                  color: "var(--rm-text)", fontSize: 13,
                  boxSizing: "border-box", fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <div style={{ fontSize: 10, color: "var(--rm-text-muted)", marginTop: 4 }}>
                Short code or full name — saved exactly as entered.
              </div>
            </div>
          )}

          {/* Reason */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: 0.8, marginBottom: 6 }}>
              REASON FOR CHANGE
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why the source type is being changed…"
              rows={3}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--rm-panel-border)",
                backgroundColor: "var(--rm-panel-soft)",
                color: "var(--rm-text)", fontSize: 13,
                resize: "vertical", boxSizing: "border-box",
                fontFamily: "inherit", lineHeight: 1.5,
              }}
            />
            <div style={{ fontSize: 10, color: "var(--rm-text-muted)", marginTop: 4 }}>
              This reason will be saved as a note on the opportunity.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", gap: 10, justifyContent: "flex-end",
          padding: "10px 20px 16px",
          borderTop: "1px solid var(--rm-panel-border)",
        }}>
          <button type="button" onClick={onClose} style={{
            padding: "8px 18px", borderRadius: 8,
            border: "1px solid var(--rm-panel-border)",
            backgroundColor: "transparent", color: "var(--rm-text-muted)",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            backgroundColor: "#3a7bd5", color: "#fff",
            fontSize: 13, fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 7,
            opacity: saving ? 0.7 : 1,
          }}>
            <Zap size={13} />
            {saving ? "Saving…" : "Update Source Type"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Notes modal ───────────────────────────────────────────────────────────────
function NotesModal({ name, initialNote, onClose, onSave }: {
  name: string;
  initialNote: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initialNote);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave(text);
    setSaving(false);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 700,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--rm-panel)", borderRadius: 14, width: "100%", maxWidth: 520,
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--rm-panel-border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={15} color={BRAND.green} />
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)" }}>Notes</span>
          </div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--rm-text-muted)", display: "flex", alignItems: "center", padding: 4, borderRadius: 6,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 20px 12px" }}>
          <div style={{
            fontSize: 12, color: "var(--rm-text-muted)", marginBottom: 14,
            padding: "7px 12px", backgroundColor: "var(--rm-panel-soft)", borderRadius: 8,
          }}>
            <strong style={{ color: "var(--rm-text)" }}>{name}</strong>
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note about this record…"
            rows={6}
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 9,
              border: "1px solid var(--rm-panel-border)",
              backgroundColor: "var(--rm-panel-soft)",
              color: "var(--rm-text)", fontSize: 13, lineHeight: 1.5,
              resize: "vertical", boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", gap: 10, justifyContent: "flex-end",
          padding: "10px 20px 16px",
        }}>
          <button type="button" onClick={onClose} style={{
            padding: "8px 18px", borderRadius: 8,
            border: "1px solid var(--rm-panel-border)",
            backgroundColor: "transparent", color: "var(--rm-text-muted)",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            backgroundColor: BRAND.green, color: "#fff",
            fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 7,
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? "Saving…" : "Save Note"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Change Status modal ───────────────────────────────────────────────────────
// Pipeline (Committed — No Contract) vs Active (Contracted) designation, plus a
// free-form custom status. Status and the Phase column are independent — Phase
// keeps following the project's schedule dates automatically.
// Fallback stage/status presets shown while the live OPM option list loads
// (or if the fetch fails). "Closed – Won" / "Converted" are system-stamped by
// the convert flows and are never manually selectable.
const OPM_STATUS_FALLBACK = [
  "Prospecting", "Qualifying", "Proposal", "Negotiation",
  "Shortlisted", "Interview", "Awarded", "On Hold", "Lost", "Cancelled",
];
const LEM_STATUS_PRESETS = ["Active", "On Hold", "Awarded", "Lost", "Cancelled", "Closed"];

function ChangeStatusModal({ name, current, recordId, moduleType = "pmm", onCancel, onConfirm }: {
  name: string;
  current: string;
  recordId: string;
  moduleType?: "pmm" | "opm" | "lem";
  onCancel: () => void;
  /** Resolves true only when the status write was accepted. */
  onConfirm: (value: string) => Promise<boolean>;
}) {
  const requiresLifecycleInspection = moduleType === "pmm" || moduleType === "opm";
  const initialPresets = moduleType === "lem" ? LEM_STATUS_PRESETS : [];
  const [choice, setChoice] = useState<string>(
    current
  );
  const [saving, setSaving] = useState(false);
  const [scheduleData, setScheduleData] = useState<{ tasks: unknown; cfg: ReturnType<typeof parseStageCfg> } | null>(null);
  const [scheduleError, setScheduleError] = useState("");
  const [lifecycleState, setLifecycleState] = useState<"loading" | "ready" | "error">(
    requiresLifecycleInspection ? "loading" : "ready",
  );
  const [lifecycleAttempt, setLifecycleAttempt] = useState(0);
  // CONFIRMED no lifecycle on the record (task fetch answered empty).
  const [noLifecycle, setNoLifecycle] = useState(false);
  // Free-typed custom status draft (mirrors the record page's type-to-save).
  const [customDraft, setCustomDraft] = useState("");
  // Opportunities and leads: swap the curated fallback for the tenant's live
  // status list once it arrives (module-scoped — PMM phases must never leak
  // in). Tenant-provided statuses (from imports or edits) are first-class.
  const [presets, setPresets] = useState<string[]>(initialPresets);
  useEffect(() => {
    let alive = true;
    const includeCurrent = (options: string[]) => options.some((option) => option.trim().toLowerCase() === current.trim().toLowerCase())
      ? options
      : current.trim() ? [...options, current.trim()] : options;
    setScheduleData(null);
    setScheduleError("");
    setPresets(initialPresets);
    setNoLifecycle(false);
    setCustomDraft("");
    if (moduleType === "pmm" || moduleType === "opm") {
      setLifecycleState("loading");
      const field = moduleType === "opm" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
      void Promise.all([getTaskData(recordId, "0"), getStageCfg(recordId, field, { strict: true })]).then(([tasks, cfg]) => {
        if (!alive) return;
        const phases = schedulePhaseNames(tasks);
        const parsedCfg = parseStageCfg(cfg);
        if (phases.length) {
          setScheduleData({ tasks, cfg: parsedCfg });
          setPresets(includeCurrent(applyStageCfgToOptions(phases, parsedCfg, true)));
          setLifecycleState("ready");
          return;
        }
        // CONFIRMED no lifecycle: mirror the record page — options are the
        // record's OWN custom statuses (Override cfg) plus the current value,
        // NEVER the tenant-wide status pile. Typing a new status below is the
        // primary path, same as the record's Status field.
        setNoLifecycle(true);
        setScheduleData({ tasks, cfg: parsedCfg });
        setPresets(includeCurrent(applyStageCfgToOptions([], parsedCfg, false)));
        setLifecycleState("ready");
      }).catch(() => {
        if (alive) setLifecycleState("error");
      });
    }
    if (requiresLifecycleInspection) return () => { alive = false; };
    if (moduleType !== "lem") return () => { alive = false; };
    getFieldOptions("status", "LEM")
      .then(opts => {
        if (!alive) return;
        const seen = new Set<string>();
        const live = opts
          .map(s => s.trim())
          .filter(s => {
            if (!s || s === CONVERTED_STAGE || s === "Converted") return false;
            const k = s.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        if (live.length > 0) setPresets(includeCurrent(live));
      })
      .catch(() => { /* fallback list stays */ });
    return () => { alive = false; };
  }, [moduleType, recordId, lifecycleAttempt]);
  const value = choice.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value || saving || (requiresLifecycleInspection && lifecycleState !== "ready")) return;
    if (scheduleData) {
      const future = futureSchedulePhase(value, scheduleData.tasks, scheduleData.cfg);
      if (future) {
        setScheduleError(`${future.phase} starts on ${new Date(`${future.startDay}T00:00:00`).toLocaleDateString()}. Update the schedule instead of moving this record ahead.`);
        return;
      }
    }
    setSaving(true);
    const accepted = await onConfirm(value);
    // A free-typed status saves as a reusable custom option on the record's
    // Override cfg too — same as typing it on the record page or in Quick
    // Actions. Only after the status write is ACCEPTED (a rejected save must
    // not persist an unused option), and against a freshly re-read cfg so a
    // concurrent override edit (e.g. new sub-statuses) is never overwritten
    // by the modal's open-time copy. Best-effort: never blocks the close.
    if (accepted && scheduleData && requiresLifecycleInspection) {
      const base = schedulePhaseNames(scheduleData.tasks);
      const field = moduleType === "opm" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
      void getStageCfg(recordId, field, { strict: true }).then((freshRaw) => {
        const freshCfg = parseStageCfg(freshRaw);
        const nextCfg = ensureCustomStatusInStageCfg(freshCfg, base, value);
        if (JSON.stringify(nextCfg) === JSON.stringify(freshCfg)) return;
        return saveStageCfg(recordId, field, nextCfg, { strict: true }).then(() => {
          const key = tenantScopedKey(`rmone:stageCfg:${field}:${recordId}`);
          try { localStorage.setItem(key, JSON.stringify(nextCfg)); } catch { /* storage unavailable */ }
          try { window.dispatchEvent(new CustomEvent("rmone:stageCfgChanged", { detail: { key } })); } catch { /* non-browser */ }
        });
      }).catch((cfgError) => {
        console.warn("[projects] status saved but reusable option sync failed", cfgError);
      });
    }
    setSaving(false);
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 700,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--rm-panel)", borderRadius: 14, width: "100%", maxWidth: 440,
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          backgroundColor: BRAND.green + "14",
          borderBottom: `1px solid ${BRAND.green}30`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <RefreshCw size={16} color={BRAND.green} />
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)" }}>Change Status</span>
          </div>
          <button type="button" onClick={onCancel} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--rm-text-muted)", display: "flex", alignItems: "center", padding: 4, borderRadius: 6,
          }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "20px 20px 8px" }}>
          <div style={{
            fontSize: 12, color: "var(--rm-text-muted)", marginBottom: 16,
            padding: "8px 12px", backgroundColor: "var(--rm-panel-soft)", borderRadius: 8,
          }}>
            Changing status for: <strong style={{ color: "var(--rm-text)" }}>{name}</strong>
          </div>
          {scheduleError && (
            <div style={{ marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: "#7F1D1D18", border: "1px solid #B91C1C66", color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>
              {scheduleError}
            </div>
          )}
          {requiresLifecycleInspection && lifecycleState === "loading" && (
            <div style={{ padding: "8px 0 16px", color: "var(--rm-text-muted)", fontSize: 13 }}>
              Checking this record’s schedule…
            </div>
          )}
          {requiresLifecycleInspection && lifecycleState === "error" && (
            <div style={{ marginBottom: 14, padding: "10px 11px", borderRadius: 8, background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text)", fontSize: 12, fontWeight: 600 }}>
              We couldn’t verify the schedule, so no status change was made.
              <button type="button" onClick={() => setLifecycleAttempt((attempt) => attempt + 1)} style={{ marginLeft: 8, border: "none", background: "none", color: BRAND.green, fontWeight: 800, cursor: "pointer", textDecoration: "underline" }}>
                Try again
              </button>
            </div>
          )}

            {lifecycleState === "ready" && requiresLifecycleInspection && noLifecycle && (
              <div style={{ marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                No lifecycle schedule on this record yet — assign one from the record page and its phases become the status choices. Until then, pick one of its saved statuses or type a new one below.
              </div>
            )}
            {lifecycleState === "ready" && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {presets.map(stage => {
                const selected = choice === stage;
                  const pal = moduleType === "opm"
                  ? getOppStagePalette(stage, OPM_CLOSED.has(stage))
                  : { bg: "#6BA53918", fg: "#6BA539", border: "#6BA53950" };
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => { setChoice(stage); setCustomDraft(""); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "6px 12px", borderRadius: 999,
                      border: `2px solid ${selected ? pal.fg : "var(--rm-panel-border)"}`,
                      backgroundColor: selected ? pal.bg : "var(--rm-panel-soft)",
                      color: selected ? pal.fg : "var(--rm-text)",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      transition: "border-color 0.12s, background-color 0.12s",
                    }}
                  >
                    {selected && <Check size={12} />}
                    {stage}
                  </button>
                );
              })}
            </div>}
          {lifecycleState === "ready" && requiresLifecycleInspection && (
            <input
              value={customDraft}
              onChange={(e) => { setCustomDraft(e.target.value); setChoice(e.target.value); }}
              placeholder="Need a different status? Type it here — it saves as a reusable option."
              style={{
                width: "100%", boxSizing: "border-box", marginBottom: 4,
                padding: "9px 12px", borderRadius: 9,
                border: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel-soft)",
                color: "var(--rm-text)", fontSize: 12.5, outline: "none",
              }}
            />
          )}
          <div style={{ fontSize: 10.5, color: "var(--rm-text-faint)", marginTop: 10, lineHeight: 1.5 }}>
            {moduleType === "pmm"
              ? "When this record has a schedule, its ordered schedule phases are the available statuses. Manage extra statuses from the record's Status override."
              : moduleType === "opm"
                ? "Lost, Cancelled and similar stages close the opportunity. Winning an opportunity is done with \"Convert to Project\" on its detail page — not from here."
                : "Lost, Cancelled and Closed end the lead. Converting a lead into an opportunity is done from the lead's detail page — not from here."}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 20px" }}>
          <button type="button" onClick={onCancel} style={{
            padding: "8px 16px", borderRadius: 9, border: "1px solid var(--rm-panel-border)",
            backgroundColor: "transparent", color: "var(--rm-text-muted)",
            fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button type="submit" disabled={!value || saving || (requiresLifecycleInspection && lifecycleState !== "ready")} style={{
            padding: "8px 18px", borderRadius: 9, border: "none",
            backgroundColor: !value || saving || (requiresLifecycleInspection && lifecycleState !== "ready") ? "var(--rm-panel-border)" : BRAND.green,
            color: !value || saving || (requiresLifecycleInspection && lifecycleState !== "ready") ? "var(--rm-text-muted)" : "#fff",
            fontSize: 12.5, fontWeight: 800, cursor: !value || saving || (requiresLifecycleInspection && lifecycleState !== "ready") ? "default" : "pointer",
          }}>
            {saving ? "Saving…" : "Save Status"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Put on Hold modal ─────────────────────────────────────────────────────────
const HOLD_REASONS = [
  "Waiting on Client",
  "Waiting on User",
  "Budget Hold",
  "Pending Approval",
  "Resource Unavailable",
  "Client Decision Pending",
  "Regulatory / Permit Hold",
  "Scope Change Review",
  "Other",
];

function PutOnHoldModal({ name, onCancel, onConfirm }: {
  name: string;
  onCancel: () => void;
  onConfirm: (info: HoldInfo) => Promise<void>;
}) {
  const today = new Date();
  const defaultTill = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const [reason, setReason] = useState(HOLD_REASONS[0]);
  const [tillDate, setTillDate] = useState(defaultTill);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onConfirm({ reason, tillDate, comments, setAt: new Date().toISOString() });
    setSaving(false);
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 700,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--rm-panel)", borderRadius: 14, width: "100%", maxWidth: 480,
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          backgroundColor: BRAND.orange + "14",
          borderBottom: `1px solid ${BRAND.orange}30`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Pause size={16} color={BRAND.orange} />
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)" }}>Put on Hold</span>
          </div>
          <button type="button" onClick={onCancel} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--rm-text-muted)", display: "flex", alignItems: "center", padding: 4, borderRadius: 6,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 20px 8px" }}>
          <div style={{
            fontSize: 12, color: "var(--rm-text-muted)", marginBottom: 18,
            padding: "8px 12px", backgroundColor: "var(--rm-panel-soft)", borderRadius: 8,
          }}>
            Putting on Hold: <strong style={{ color: "var(--rm-text)" }}>{name}</strong>
          </div>

          {/* Row: Hold Till + Reason */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: 0.8, marginBottom: 6 }}>
                HOLD TILL <span style={{ color: BRAND.orange }}>*</span>
              </label>
              <DateField
                required
                value={tillDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={setTillDate}
                style={{
                  padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--rm-panel-border)",
                  backgroundColor: "var(--rm-panel-soft)",
                  color: "var(--rm-text)", fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: 0.8, marginBottom: 6 }}>
                REASON
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--rm-panel-border)",
                  backgroundColor: "var(--rm-panel-soft)",
                  color: "var(--rm-text)", fontSize: 13,
                  boxSizing: "border-box",
                }}
              >
                {HOLD_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Comments */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--rm-text-muted)", letterSpacing: 0.8, marginBottom: 6 }}>
              ADDITIONAL COMMENTS
            </label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Describe why this is being put on hold…"
              rows={3}
              style={{
                width: "100%", padding: "9px 10px", borderRadius: 8,
                border: "1px solid var(--rm-panel-border)",
                backgroundColor: "var(--rm-panel-soft)",
                color: "var(--rm-text)", fontSize: 13,
                resize: "vertical", boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", gap: 10, justifyContent: "flex-end",
          padding: "12px 20px",
          borderTop: "1px solid var(--rm-panel-border)",
        }}>
          <button type="button" onClick={onCancel} style={{
            padding: "8px 18px", borderRadius: 8,
            border: "1px solid var(--rm-panel-border)",
            backgroundColor: "transparent", color: "var(--rm-text-muted)",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            backgroundColor: BRAND.orange, color: "#fff",
            fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 7,
            opacity: saving ? 0.7 : 1,
          }}>
            <Pause size={13} />
            {saving ? "Saving…" : "Put on Hold"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── ConflictAnalysisModal ─────────────────────────────────────────────────────
function ConflictAnalysisModal({
  memberName, role, projectName, projectId, thisPct, thisHrs, otherProjects, onClose,
}: {
  memberName: string;
  role: string;
  projectName: string;
  projectId: string;
  thisPct: number;
  thisHrs: number;
  otherProjects: { id: string; name: string; pct: number; hrs: number }[];
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalPct = thisPct + otherProjects.reduce((s, o) => s + o.pct, 0);
  const totalHrs = thisHrs + otherProjects.reduce((s, o) => s + o.hrs, 0);

  const overBy = Math.max(0, Math.round(totalPct - 100));
  const sorted = [{ name: projectName, id: projectId, pct: thisPct, hrs: Math.round(thisHrs) }, ...otherProjects.map(o => ({ ...o, hrs: Math.round(o.hrs) }))].sort((a, b) => b.pct - a.pct);
  const heaviest = sorted[0];
  const lightest = sorted[sorted.length - 1];

  const prompt = [
    `You are a senior staffing analyst. Analyze this specific resource conflict and output concise, data-driven recommendations.`,
    ``,
    `IMPORTANT RULES:`,
    `- Do NOT use markdown, asterisks, bold, italics, or any formatting symbols whatsoever.`,
    `- Every recommendation MUST name the specific project (use the exact project name) and cite the exact % or hours.`,
    `- Do not give generic advice like "reduce allocation" without specifying which project and by how much.`,
    `- Keep each line under 25 words.`,
    ``,
    `PERSON: ${memberName}${role ? ` (${role})` : ""}`,
    `TOTAL LOAD: ${Math.round(totalPct)}% across ${1 + otherProjects.length} projects (${Math.round(totalHrs)}h total)${totalPct > 100 ? ` — ${overBy}% over capacity` : ""}`,
    ``,
    `ALLOCATION BREAKDOWN:`,
    `• ${projectName} (${projectId}): ${thisPct}% — ${Math.round(thisHrs)}h  ← this project`,
    ...otherProjects.map(o => `• ${o.name} (${o.id}): ${o.pct}% — ${Math.round(o.hrs)}h`),
    ``,
    `CONTEXT:`,
    `• Heaviest project: ${heaviest.name} at ${heaviest.pct}%`,
    `• Lightest project: ${lightest.name} at ${lightest.pct}%`,
    totalPct > 100 ? `• Over-capacity by ${overBy}% — must reduce or redistribute ${overBy}% of workload to reach 100%` : `• Not over-allocated but workload is split across multiple projects`,
    ``,
    `Respond using EXACTLY this format — no extra lines, no markdown:`,
    `HEADLINE: <one sentence citing ${memberName}'s total %, project count, and risk level>`,
    `RISK: <specific delivery or quality risk citing which project(s) are most exposed>`,
    `REC1: <action citing exact project name, current %, and target % or specific change>`,
    `REC2: <action citing exact project name, current %, and target % or specific change>`,
    `REC3: <third action if needed — cite project name and numbers — otherwise omit this line>`,
    `ACTION: <the single highest-priority action right now, citing project name and specific step>`,
  ].join("\n");

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setText(""); setError(null); setLoading(true); setProgress(0);

    // Fake progress bar while waiting for first token
    const iv = setInterval(() => setProgress(p => p < 80 ? p + 4 : p), 120);

    (async () => {
      try {
        await chatStream(
          [{ role: "user", content: prompt }],
          (e) => {
            if (e.type === "token" || e.type === "content") {
              setText(t => t + e.text);
              setLoading(false);
              setProgress(100);
              clearInterval(iv);
            } else if (e.type === "error") {
              setError(e.message); setLoading(false); clearInterval(iv);
            } else if (e.type === "done") {
              setLoading(false); setProgress(100); clearInterval(iv);
            }
          },
          ctrl.signal,
        );
      } catch (err) {
        if (!ctrl.signal.aborted) { setError(err instanceof Error ? err.message : "Analysis failed"); setLoading(false); clearInterval(iv); }
      }
    })();
    return () => { ctrl.abort(); clearInterval(iv); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  // Parse structured lines — strip markdown asterisks/underscores first so
  // "**HEADLINE:** text" and "HEADLINE: text" both match correctly.
  const parsed = useMemo(() => {
    const out: Record<string, string> = {};
    for (const raw of text.split("\n")) {
      const clean = raw.replace(/\*\*/g, "").replace(/__/g, "").trim();
      const m = clean.match(/^\s*(HEADLINE|RISK|REC\d+|ACTION)\s*:\s*(.*)$/i);
      if (m) out[m[1].toUpperCase()] = m[2].trim();
    }
    return out;
  }, [text]);

  const recs = [parsed.REC1, parsed.REC2, parsed.REC3].filter(Boolean) as string[];
  const anyParsed = parsed.HEADLINE || recs.length > 0;

  const C = {
    bg: "#FFFFFF", header: "#FFF8EC", border: "#FED7AA",
    amber: "#B45309", amberLight: "#F59E0B", amberBg: "#FEF3C7",
    text: "#1A2635", muted: "#6B7E8A",
    green: BRAND.green, greenBg: BRAND.green + "18",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2, backgroundColor: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, backgroundColor: C.bg, borderRadius: 16, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 16px 48px rgba(0,0,0,0.35)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: C.header, borderBottom: `1px solid ${C.border}`, padding: "14px 18px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.amberBg, border: `1.5px solid ${C.amberLight}50`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle size={17} color={C.amberLight} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.amber, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 }}>AI Conflict Analysis</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{memberName}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{role ? `${role} · ` : ""}{1 + otherProjects.length} projects · {Math.round(totalPct)}% total allocation</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, border: "none", backgroundColor: "#F0F3F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            <X size={13} color={C.muted} />
          </button>
        </div>

        {/* Progress bar */}
        {loading && (
          <div style={{ padding: "10px 18px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Loader2 size={13} color={C.amberLight} style={{ animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 11, color: C.muted }}>Analyzing conflict…</span>
            </div>
            <div style={{ height: 4, borderRadius: 4, backgroundColor: "#F0F3F6", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 4, backgroundColor: C.amberLight, width: `${progress}%`, transition: "width 0.18s ease" }} />
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ overflowY: "auto", flex: 1, padding: "14px 18px 20px" }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5", fontSize: 12, color: "#991B1B" }}>{error}</div>
          )}

          {/* Allocation breakdown */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>Allocation Breakdown</div>
            {[{ name: projectName, id: projectId, pct: thisPct, hrs: thisHrs }, ...otherProjects].map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === 0 ? C.amberLight : C.muted, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? C.amber : C.muted, flexShrink: 0 }}>{p.pct}%</span>
                <div style={{ width: 60, height: 4, borderRadius: 3, backgroundColor: "#F0F3F6", overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ height: "100%", borderRadius: 3, backgroundColor: i === 0 ? C.amberLight : "#94A3B8", width: `${Math.min(100, p.pct)}%` }} />
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4, fontSize: 11, fontWeight: 800, color: totalPct > 100 ? "#C2410C" : C.amber }}>
              Total: {Math.round(totalPct)}% {totalPct > 100 ? "⚠ OVER-ALLOCATED" : ""}
            </div>
          </div>

          {/* AI parsed output */}
          {anyParsed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {parsed.HEADLINE && (
                <div style={{ padding: "9px 12px", borderRadius: 8, backgroundColor: C.amberBg, border: `1px solid ${C.amberLight}50`, fontSize: 12, fontWeight: 700, color: C.amber }}>
                  {parsed.HEADLINE}
                </div>
              )}
              {parsed.RISK && (
                <div style={{ padding: "9px 12px", borderRadius: 8, backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#991B1B", letterSpacing: 0.6, marginBottom: 3 }}>RISK</div>
                  <div style={{ fontSize: 12, color: "#7F1D1D" }}>{parsed.RISK}</div>
                </div>
              )}
              {recs.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>Recommendations</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {recs.map((r, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", borderRadius: 8, backgroundColor: "#F8FAFC", border: "1px solid #E5EAEF" }}>
                        <div style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.green + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <CheckCircle2 size={11} color={C.green} />
                        </div>
                        <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {parsed.ACTION && (
                <div style={{ padding: "10px 12px", borderRadius: 8, backgroundColor: C.greenBg, border: `1px solid ${C.green}40`, display: "flex", gap: 8 }}>
                  <ArrowRight size={14} color={C.green} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: C.green, letterSpacing: 0.6, marginBottom: 2 }}>NEXT ACTION</div>
                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{parsed.ACTION}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Streaming fallback — raw text if no structured fields parsed yet */}
          {!anyParsed && !loading && text && (
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</div>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
