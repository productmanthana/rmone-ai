import { compactUsd } from "../lib/money";
import { fmtHours } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AuditTrailCard } from "@/components/AuditTrailCard";
import { useQuery } from "@tanstack/react-query";
import { buildQuarters, quarterFromLabel, currentQuarterLabel, defaultUtilFilters, type Quarter } from "@/lib/quarters";
import { useLocation, Link } from "wouter";
import {
  RefreshCw,
  Search,
  X,
  Calendar,
  ChevronDown,
  Check,
  Sliders,
  AlertCircle,
  Loader2,
  Users,
  User,
  MapPin,
  Phone,
  Mail,
  Building2,
  Briefcase,
  ChevronRight,
  ChevronUp,
  Layers,
  Lock,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Eye,
  ExternalLink,
  Activity,
  MoreVertical,
  Lightbulb,
  Sparkles,
  Zap,
  Target,
  Flame,
  UserPlus,
  Pencil,
  LayoutGrid,
  Table2,
  BarChart2,
  Plus,
  FolderOpen,
  UserX,
  CheckCircle2,
  ArrowRight,
  ChevronLeft,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { getBusinessRules, getPastWeekEditStateFor, useBusinessRulesVersion } from "@/lib/businessRules";
import { empTypeColor, empTypeLegend } from "@/lib/employmentColor";
import { collapseDemandsToPositions } from "@/lib/demandPositions";
import { roleQueryMatcher } from "@workspace/role-match";
import {
  deriveWindowedLoad,
  avgAvailabilityPct,
  activeAvailabilityWindow,
  type AvailabilityWindow,
} from "@workspace/alloc-math";
import {
  bustCache,
  getModuleRecords,
  getResourceAllocations,
  getResourceDemands,
  getAllResourceAvailability,
  getResourceAvailability,
  getAllocationUtilization,
  markAllocationRefetchFresh,
  getStoredUser,
  chatStream,
  getRoleBillingRates,
  getUserSkills,
  getUserExperienceTags,
  addUserSkill,
  deleteUserSkill,
  addUserExperienceTag,
  deleteUserExperienceTag,
  updateStaffExtra,
  getManagersList,
  getManagerStaff,
  getManagerHierarchy,
  getDuplicateStaffNames,
  getResourceWeekAllocations,
  tenantScopedKey,
  type ModuleRecord,
  type LiveResourceProxy,
  type ActiveAllocationProxy,
  type ManagerEntry,
  type ManagerStaffResponse,
  type DuplicateNameGroup,
} from "@/lib/api";
import { subscribeDataChanged } from "@/lib/dataSync";
import { getMyCapabilities, usePermissionsVersion, revertMyAccessLevel, notifyPermissionsChanged, fetchAccessLevels, isCustomAcl, type MyCapabilities, type AccessLevelDef } from "@/lib/permissions";
import { AddStaffModal } from "@/components/AddStaffModal";
import InviteMembersDialog from "@/components/InviteMembersDialog";
import { RecordDataGrid, GridChip, AllocBadge, ViewModeToggle, CountPill, AiAnalyzeButton } from "@/components/RecordDataGrid";
import { OrgCell } from "@/components/OrgPopup";
import { AiInsightPanel } from "@/components/AiInsightPanel";
import { EditStaffModal } from "@/components/EditStaffModal";
import CreateChoiceModal from "@/components/CreateChoiceModal";
import BulkUploadModal from "@/components/BulkUploadModal";
import { setChatPrompt } from "@/lib/chatBridge";
import { ResumeDownloadButton } from "@/pages/talent";
import type { ResumeExtraSummary } from "@/lib/resumeGenerator";
import { useAuth } from "@/lib/useAuth";
import { useTheme } from "@/lib/theme";
import { useDraggable } from "@/lib/useDraggable";
import { CardInsight } from "@/components/CardInsight";
import { InfoTicker, type InfoTickerItem } from "@/components/InfoTicker";
import { DemandOverview } from "@/components/DemandOverview";
import { ResourcesTimelineGrid, type ResourceProjectWeekEdit, type ResourceProjectWeeksEdit } from "@/components/ResourcesTimelineGrid";
import {
  parseUtilCell, parsePeriodKey, mondayOf, parseLocalDay,
  allocEntryHrsPerWeek, hoursWinFilter, fmtPeriodLabel, MAX_WEEK_HOURS,
  selectedWeekDays, splitWeeklyHoursAcrossDays, splitTotalHoursByWeights, type UtilMode,
} from "@/lib/utilGrid";
import { GANTT_HIGHLIGHT, PHASE_COLORS, UTIL_COLORS } from "@/lib/phaseColors";
import { isLeadProject, loadProjectPhaseMap, projectPhaseColor, projectPhaseDisplayName, type ProjectPhaseMap } from "@/lib/projectPhases";
import { Z } from "@/lib/zLayers";
import { runFastWeeklyHoursSave } from "@/lib/fastWeeklyHoursSave";
import { SaveMismatchError } from "@/lib/saveMemberWeeklyHours";
import { parseWeeklyHoursDraft } from "@/lib/weeklyHoursValidation";
import { createWeeklyCellSaveCoalescer } from "@/lib/coalesceWeeklyCellSaves";
import { toast } from "@/hooks/use-toast";
import { planMonthlyDistribution, type MonthWeekSlot } from "@/lib/monthlyHoursDistribution";
import {
  applyResourceWeekOverrides,
  applyResourceWeekOverridesToUtilRows,
  hasResourceWeekOverrideInWindow,
  pruneConfirmedResourceWeekOverrides,
  removeResourceWeekOverrideIfRevision,
  resourceWeekOverrideKey,
  storeResourceWeekOverride,
  type ResourceWeekOverrideMap,
} from "@/lib/resourceWeekOptimism";
import { canonicalizeResourcePopupProjectRefs } from "@/lib/resourcePopupProjectIdentity";
import { abbrevRole } from "@/lib/roleAbbrev";
import { useStaffingQuickActions } from "@/hooks/useStaffingQuickActions";
import { DisabledMemberStatus } from "@/components/DisabledMemberStatus";
// Self-contained Manager person picker (extracted so its debounce-cancellation
// contract is testable in the node chain — see the component header).
import { ManagerSearchPicker } from "@/components/ManagerSearchPicker";
import {
  StaffRecordAssignmentModal,
  type StaffAssignmentTarget,
} from "@/components/StaffRecordAssignmentModal";

const BRAND = {
  bg: "var(--rm-bg)",
  bgDeep: "var(--rm-bg)",
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  greenLight: "#A9C23F",
  orange: "#E87722",
  red: "#F87171",
  redDeep: "#E03C3C",
  white: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  textMuted: "var(--rm-text-faint)",
};

type ResView = "Timeline" | "Staff" | "Demand" | "Manager";
type TimelineSubView = "Grid" | "Gantt";
interface ResourcesProps {
  initialView?: ResView;
  standaloneManager?: boolean;
}

/** Timestamp portion of the data-free cross-tab allocation change marker. */
function allocationMarkerTimestamp(value: string | null): number {
  return Number((value ?? "").split(":", 1)[0]) || 0;
}

// Quarter type + helpers (buildQuarters / quarterFromLabel) live in
// lib/quarters.ts so App.tsx's post-login prewarm can build the exact same
// default utilization query key without importing this page chunk.

function shiftQuarterLabel(label: string, direction: -1 | 1): string {
  const current = quarterFromLabel(label);
  if (!current) return label;
  const start = new Date(current.sd);
  start.setMonth(start.getMonth() + direction * 3);
  return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
}

// Headline hour figures: "183900h" is unreadable — compact big values to
// "183.9k h" and give smaller ones a thousands separator ("3,616h").
function fmtStatHours(h: number): string {
  const n = Math.round(h);
  if (n >= 10000) {
    const k = n / 1000;
    const s = k.toFixed(1).replace(/\.0$/, "");
    return `${s}k h`;
  }
  return `${n.toLocaleString("en-US")}h`;
}

// Concentration risk — a person whose allocation sits above the admin
// threshold while effectively carrying only ONE real project. A project only
// counts as "real" when its allocation actually carries load (>0% or >0
// hours): 0% placeholder assignments (e.g. someone added to a second project
// with no hours yet) must NOT hide the risk. Shared by the StaffCard chip/tint
// and the list-level sorting so both always agree.
function staffConcentrationRisk(
  r: { currentPct: number; activeProjects: string[]; activeAllocations?: { projectId: string; pct: number; hours?: number }[] },
  thresholdPct: number,
): boolean {
  const allocs = r.activeAllocations ?? [];
  const funded = new Set(
    allocs.filter(a => (a.pct ?? 0) > 0 || (a.hours ?? 0) > 0).map(a => a.projectId)
  );
  // Fall back to the raw project list only when allocation detail is absent.
  const count = allocs.length > 0 ? funded.size : new Set(r.activeProjects).size;
  return count <= 1 && r.currentPct > thresholdPct;
}

// Cross-project conflict count for a person — number of concurrent FUNDED
// active projects when there are 2 or more (0 otherwise). A project only
// counts when its allocation carries real load (>0% or >0 hours), matching
// the funded-projects rule used by staffConcentrationRisk and the projects
// page conflict map. 0% placeholder assignments never create a conflict.
function staffConflictCount(
  r: { activeProjects: string[]; activeAllocations?: { projectId: string; pct: number; hours?: number }[] },
): number {
  // Quarter-enriched rows (Staff grid) carry TRUE weekly overlap — the max number
  // of funded projects sharing any single week. Prefer it: the enriched
  // activeAllocations are merged per project across the whole quarter, so entry
  // counting would falsely flag strictly SEQUENTIAL projects as concurrent.
  const qmc = (r as { qMaxConcurrent?: number }).qMaxConcurrent;
  if (typeof qmc === "number") return qmc >= 2 ? qmc : 0;
  const allocs = r.activeAllocations ?? [];
  const funded = new Set(
    allocs.filter(a => (a.pct ?? 0) > 0 || (a.hours ?? 0) > 0).map(a => a.projectId)
  );
  const count = allocs.length > 0 ? funded.size : new Set(r.activeProjects).size;
  return count >= 2 ? count : 0;
}

// Days from today until a demand row's start date (negative = already started).
// Shared by the list-level urgency sorting and the DemandCard tag/tint logic
// so both always agree on which cards are flagged.
function demandDaysUntil(start?: string | null): number | null {
  if (!start) return null;
  const t = new Date(start).getTime();
  return isNaN(t) ? null : Math.round((t - Date.now()) / 86400000);
}

function utilCellColor(p: number): string {
  if (p === 0) return "transparent";
  const r = getBusinessRules();
  if (p >= r.overCapacityPct) return BRAND.redDeep;
  if (p > r.underAllocatedPct) return BRAND.green;
  return BRAND.orange;
}

const MONTH_NAMES = new Set([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

const META_KEYS = new Set([
  "UserId", "ResourceUser", "Name", "Title", "Department",
  "Discipline", "Role", "OfficeName", "ManagerName", "Total",
]);

function isPeriodKey(k: string): boolean {
  if (META_KEYS.has(k)) return false;
  // e.g. "Apr-15-26", "Apr-26", "15-Apr-26", "Apr-2026"
  if (/^[A-Z][a-z]{2}-\d{2}-\d{2}$/.test(k)) return true;
  if (/^\d{1,2}-[A-Z][a-z]{2}-\d{2,4}$/.test(k)) return true;
  if (/^[A-Z][a-z]{2}-\d{2,4}$/.test(k)) return true;
  return false;
}

function getDateColumns(row: Record<string, unknown> | undefined): string[] {
  if (!row) return [];
  return Object.keys(row).filter(isPeriodKey);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Format an imported staff date (YYYY-MM-DD or ISO) for display; blank if empty
// or unparseable so the card/profile only ever renders a real date.
function fmtStaffDate(s?: string): string {
  const v = (s || "").trim();
  if (!v) return "";
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
// ── Leave / partial-availability window helpers ──────────────────────────
// Format a single "YYYY-MM-DD" date as e.g. "12 Aug 2026" (year optional).
function fmtAvailDay(s: string, withYear: boolean): string {
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", withYear
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short" });
}
// "12 Aug – 20 Aug 2026" (year shown once, only on the end unless they differ).
function fmtAvailRange(startDate: string, endDate: string): string {
  const sYr = startDate.slice(0, 4);
  const eYr = endDate.slice(0, 4);
  const start = fmtAvailDay(startDate, sYr !== eYr);
  const end = fmtAvailDay(endDate, true);
  return `${start} – ${end}`;
}
// Plain-language label for a window's remaining capacity.
function availPctLabel(pct: number): string {
  return pct <= 0 ? "On leave" : `Available ${Math.round(pct)}%`;
}

// Availability window as used on this page — the shared alloc-math shape plus
// the optional human reason (only rendered in tooltips / the detail modal).
type AvailWindow = AvailabilityWindow & { reason?: string | null; leaveType?: string | null };

interface StatusInfo { label: string; color: string }
// Platform-wide utilization color convention (matches Timeline Grid + client
// LiRo logic, see UTIL_COLORS in lib/phaseColors): RED = under-utilized
// (revenue leak), GREEN = healthy/optimal, ORANGE = over-utilized (attention).
function statusInfo(pct: number): StatusInfo {
  const r = getBusinessRules();
  if (pct >= r.overCapacityPct)      return { label: "Overloaded", color: BRAND.orange };
  if (pct >= r.targetUtilizationPct) return { label: "Optimal",    color: BRAND.green };
  if (pct >  r.underAllocatedPct)    return { label: "Partial",    color: BRAND.greenLight };
  if (pct > 0)                       return { label: "Under-used", color: BRAND.red };
  return                               { label: "Bench",          color: BRAND.red };
}

// Simplified 3-band model (Under / Healthy / Over) for the weekly-timeline
// visualisations, cell-detail modal and AI prompt. Derived from the SAME
// business-rule knobs as the canonical 5-band statusInfo so a global threshold
// save drives every Resources subview consistently (no hardcoded 40/100/120).
function weekBandColor(pct: number, deep = false): string {
  const r = getBusinessRules();
  if (pct >= r.overCapacityPct)   return BRAND.orange;
  if (pct >  r.underAllocatedPct) return BRAND.green;
  if (pct >  0)                   return deep ? BRAND.redDeep : BRAND.red;
  return BRAND.cardBorder;
}
function weekBandLabel(pct: number): string {
  const r = getBusinessRules();
  if (pct >= r.overCapacityPct)   return "Over";
  if (pct >  r.underAllocatedPct) return "Healthy";
  if (pct >  0)                   return "Under";
  return "Idle";
}
function weekBandRanges(): { healthy: string; under: string; over: string } {
  const r = getBusinessRules();
  return {
    healthy: `${r.underAllocatedPct + 1}–${r.overCapacityPct - 1}%`,
    under:   `1–${r.underAllocatedPct}%`,
    over:    `≥${r.overCapacityPct}%`,
  };
}
function isOverloaded(pct: number): boolean {
  return pct >= getBusinessRules().overCapacityPct;
}

function UtilGauge({ pct, color, label, size = 64, onClick }: {
  pct: number; color: string; label: string; size?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const stroke = 6;
  const r = (size - stroke - 2) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.min(Math.max(pct, 0), 100);
  const dash = (filled / 100) * c;
  const overPct = Math.max(0, pct - 100);
  const overDash = (Math.min(overPct, 100) / 100) * c;
  const uid = `g${Math.abs((color.charCodeAt(1) || 0) + Math.round(pct))}`;
  const fillId = `${uid}-fill`;
  const overId = `${uid}-over`;
  const shadowId = `${uid}-shadow`;
  const wrapper = (
    <div style={{ position: "relative", width: size, height: size,
      borderRadius: "50%",
      background: "radial-gradient(circle at 30% 30%, #FFFFFF 0%, #F4F6F9 60%, #DEE3EA 100%)",
      boxShadow: `0 4px 10px rgba(37,55,70,0.18), 0 1px 2px rgba(37,55,70,0.12), inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -2px 4px rgba(37,55,70,0.08)`,
    }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <defs>
          <linearGradient id={fillId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={0.7} />
            <stop offset="50%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.85} />
          </linearGradient>
          <linearGradient id={overId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={BRAND.red} stopOpacity={0.75} />
            <stop offset="100%" stopColor={BRAND.red} stopOpacity={1} />
          </linearGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor={color} floodOpacity={0.45} />
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5EAEF" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${fillId})`} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" filter={`url(#${shadowId})`}
        />
        {overPct > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${overId})`} strokeWidth={stroke}
            strokeDasharray={`${overDash} ${c}`} strokeLinecap="round"
          />
        )}
      </svg>
      {/* glossy highlight overlay */}
      <div style={{
        position: "absolute", inset: 4, borderRadius: "50%", pointerEvents: "none",
        background: "radial-gradient(ellipse at 35% 25%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 55%)",
      }} />
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        lineHeight: 1, pointerEvents: "none",
      }}>
        <span style={{
          fontSize: Math.round(size * 0.20), fontWeight: 800, color,
          textShadow: "0 1px 0 rgba(255,255,255,0.8)",
          lineHeight: 1,
        }}>{Number(pct.toFixed(2))}</span>
        <span style={{
          fontSize: Math.round(size * 0.10), fontWeight: 800, color,
          opacity: 0.7, lineHeight: 1, marginTop: Math.round(size * 0.03),
          letterSpacing: 0.3,
        }}>%</span>
      </div>
    </div>
  );
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      {onClick ? (
        <button
          onClick={(e) => { e.stopPropagation(); onClick(e); }}
          aria-label={`Show projects · ${pct}% ${label}`}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >{wrapper}</button>
      ) : wrapper}
      <div style={{ fontSize: 8, fontWeight: 800, color, letterSpacing: 0.6, textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

type StaffModalMode = "active" | "all" | "allocation";

interface AllocSpan {
  startDate: string;
  endDate: string;
  avgPct: number;
  totalHrs: number;
  weekCount: number;
  isActive: boolean;
}

/** Merge weekly allocation rows into contiguous spans for clean timeline display. */
function mergeAllocSpans(entries: ActiveAllocationProxy[]): AllocSpan[] {
  if (entries.length === 0) return [];
  const now = Date.now();
  const sorted = entries.slice().sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );
  const spans: AllocSpan[] = [];
  let cur: AllocSpan | null = null;
  for (const e of sorted) {
    const sMs = new Date(e.startDate).getTime();
    const eMs = new Date(e.endDate).getTime();
    if (isNaN(sMs) || isNaN(eMs)) continue;
    const wks = Math.max(1, Math.round((eMs - sMs) / (7 * 24 * 3600 * 1000)));
    const hrsWk = allocEntryHrsPerWeek(e, getBusinessRules().workWeekHours);
    const hrs = Math.round(hrsWk * wks);
    const active = sMs <= now && eMs >= now;
    if (!cur) {
      cur = { startDate: e.startDate, endDate: e.endDate, avgPct: e.pct, totalHrs: hrs, weekCount: wks, isActive: active };
    } else {
      const curEndMs = new Date(cur.endDate).getTime();
      const gap = sMs - curEndMs;
      // Merge if consecutive (≤9 day gap) AND pct within 10pp — otherwise start new span
      if (gap <= 9 * 24 * 3600 * 1000 && Math.abs(e.pct - cur.avgPct) <= 10) {
        const prevWks = cur.weekCount;
        cur.endDate = e.endDate;
        cur.weekCount += wks;
        cur.totalHrs += hrs;
        cur.avgPct = Math.round((cur.avgPct * prevWks + e.pct * wks) / cur.weekCount);
        if (active) cur.isActive = true;
      } else {
        spans.push(cur);
        cur = { startDate: e.startDate, endDate: e.endDate, avgPct: e.pct, totalHrs: hrs, weekCount: wks, isActive: active };
      }
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

/* Distinct categorical colors for per-project chart segments */
const PROJ_PALETTE = ["#4E9CF5", "#F5A83B", "#A78BFA", "#34D399", "#F472B6", "#22D3EE", "#FBBF24", "#818CF8", "#F87171", "#A3E635", "#2DD4BF", "#FB923C"];

/* Per-week / per-project stacked series for the cell-detail chart */
type CellWeekSeg = { pid: string; hrs: number };
type CellWeek = { start: number; hrs: number; pct: number; segs: CellWeekSeg[] };
function allocEntryTotalHrs(a: ActiveAllocationProxy): number {
  const startMs = new Date(a.startDate).getTime();
  const endMs   = new Date(a.endDate).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;
  const weeks = Math.max(1, Math.round((endMs - startMs) / (7 * 24 * 3600 * 1000)));
  return Math.round(allocEntryHrsPerWeek(a, getBusinessRules().workWeekHours) * weeks);
}
function ProjectAllocGanttModal({
  r, projectId, pName, onClose, onProjectClick, canEditHours = false, onSaveProjectWeek,
  embedded = false, inlineGantt = false, onCollapse,
}: {
  r: LiveResourceProxy;
  projectId: string;
  pName: (pid: string) => string;
  status: StatusInfo;
  onClose: () => void;
  onProjectClick: (pid: string) => void;
  canEditHours?: boolean;
  onSaveProjectWeek?: (edit: ResourceProjectWeekEdit) => Promise<void>;
  /** Render inside the person workload popup instead of as a second modal. */
  embedded?: boolean;
  /** Render only the weekly editor directly in the workload Gantt. */
  inlineGantt?: boolean;
  /** Hides the embedded weekly panel without closing the person popup. */
  onCollapse?: () => void;
}) {
  const [phaseMap, setPhaseMap] = useState<ProjectPhaseMap | null>(null);
  useEffect(() => {
    let alive = true;
    loadProjectPhaseMap().then(m => { if (alive) setPhaseMap(m); });
    return () => { alive = false; };
  }, []);
  const allAllocs: ActiveAllocationProxy[] = (r.allAllocations as ActiveAllocationProxy[] | undefined) || [];
  const entries = allAllocs.filter(a => a.projectId === projectId);
  const projectModule = entries.find(a => a.module)?.module;
  const projName = pName(projectId);
  const spans = mergeAllocSpans(entries);
  const totalHrs = spans.reduce((s, sp) => s + sp.totalHrs, 0);
  const totalWks = spans.reduce((s, sp) => s + sp.weekCount, 0);
  const hasActive = spans.some(sp => sp.isActive);
  const [weekEdit, setWeekEdit] = useState<{ start: number; draft: string; original: number } | null>(null);
  const [savingWeek, setSavingWeek] = useState<number | null>(null);
  const [weekEditError, setWeekEditError] = useState<string | null>(null);
  const weekCommitRef = useRef(false);

  // ── Week-by-week hour buckets for the scrollable Gantt ────────────────
  // Each allocation entry carries implied hrs/week; a week's total is the sum
  // of hrs/week across all entries overlapping that week. Week boundaries are
  // walked with setDate(+7) (not raw ms addition) so DST never drifts them.
  // Uses module-level parseLocalDay/mondayOf (local-midnight, DST-safe).
  const weeks: { start: number; hrs: number }[] = (() => {
    let minS = Infinity, maxE = -Infinity;
    for (const e of entries) {
      const s = parseLocalDay(e.startDate), en = parseLocalDay(e.endDate);
      if (!isNaN(s)) minS = Math.min(minS, s);
      if (!isNaN(en)) maxE = Math.max(maxE, en);
    }
    const out: { start: number; hrs: number }[] = [];
    if (!isFinite(minS) || !isFinite(maxE) || maxE < minS) {
      // Lead container allocations carry no dates until the first weekly
      // save. Bootstrap a window around today so admins can type initial
      // Lead hours; after the first save the real weekly rows take over.
      if (!(isLeadProject(projectModule, projectId) && entries.length > 0)) return out;
      // Local-calendar week stepping (setDate) — fixed-millisecond week
      // arithmetic drifts the bounds off local midnight across DST changes.
      const anchor = new Date(mondayOf(Date.now()));
      const start = new Date(anchor); start.setDate(anchor.getDate() - 14);
      const end = new Date(anchor); end.setDate(anchor.getDate() + 7 * 12);
      minS = start.getTime();
      maxE = end.getTime() - 1;
    }
    const cursor = new Date(mondayOf(minS));
    while (cursor.getTime() <= maxE && out.length < 520) {
      const ws = cursor.getTime();
      const weNext = new Date(cursor); weNext.setDate(weNext.getDate() + 7);
      const we = weNext.getTime() - 1;
      const inWeek = entries.filter(e => {
        const s = parseLocalDay(e.startDate), en = parseLocalDay(e.endDate);
        return !isNaN(s) && !isNaN(en) && s <= we && en >= ws;
      });
      // hours-win: real hours replace the %-plan for this week, never add.
      const hrs = hoursWinFilter(inWeek).reduce((t, e) => t + allocEntryHrsPerWeek(e, getBusinessRules().workWeekHours), 0);
      out.push({ start: ws, hrs: Math.round(hrs * 10) / 10 });
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  })();
  const nowMonday   = mondayOf(Date.now());
  const curWeekIdx  = weeks.findIndex(w => w.start === nowMonday);
  const shownWeeks = weeks;
  const maxWeekHrs  = shownWeeks.reduce((m, w) => Math.max(m, w.hrs), 0);
  const loadedWeeks = shownWeeks.filter(w => w.hrs > 0);
  const avgWeekHrs  = loadedWeeks.length
    ? Math.round(loadedWeeks.reduce((s, w) => s + w.hrs, 0) / loadedWeeks.length * 10) / 10
    : 0;
  const COL_W = 38;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Auto-centre the scroller on the current week (or start at the beginning).
    const el = scrollRef.current;
    if (!el) return;
    const target = curWeekIdx >= 0 ? curWeekIdx : 0;
    el.scrollLeft = Math.max(0, target * COL_W - el.clientWidth / 2 + COL_W / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const fmtDateShort = (d: string) => {
    const p = new Date(d);
    if (isNaN(p.getTime())) return "—";
    return p.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };
  const localIsoDay = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const pastWeekLocked = (weekStart: number): boolean =>
    // Canonical local-calendar rule — hand-rolled ms/7d age math miscounts
    // across DST transitions (a 167-hour week floors to age 0).
    getPastWeekEditStateFor(localIsoDay(weekStart), projectId.split("-")[0]).locked;
  const commitWeekEdit = async () => {
    if (weekCommitRef.current || !weekEdit || !onSaveProjectWeek) return;
    const acceptedEdit = weekEdit;
    const hours = parseWeeklyHoursDraft(acceptedEdit.draft);
    if (hours === null || hours < 0 || hours > MAX_WEEK_HOURS) {
      setWeekEditError(`Enter a weekly allocation from 0 to ${MAX_WEEK_HOURS} hours. The value was not saved.`);
      return;
    }
    if (hours === acceptedEdit.original) {
      setWeekEdit(null);
      return;
    }
    weekCommitRef.current = true;
    setSavingWeek(acceptedEdit.start);
    setWeekEditError(null);
    let handedOff = false;
    try {
      await onSaveProjectWeek({
        personId: r.id,
        personName: r.name,
        role: r.role,
        projectId,
        projectName: projName,
        week: localIsoDay(acceptedEdit.start),
        hours,
        onAccepted: () => {
          handedOff = true;
          setWeekEdit(current =>
            current?.start === acceptedEdit.start && current.draft === acceptedEdit.draft
              ? null
              : current
          );
        },
      });
      setWeekEdit(null);
    } catch (e) {
      if (handedOff) {
        setWeekEdit(current => current ?? acceptedEdit);
      }
      setWeekEditError(e instanceof Error ? e.message : String(e));
    } finally {
      weekCommitRef.current = false;
      setSavingWeek(null);
    }
  };

  if (inlineGantt) {
    return (
      <div style={{
        marginTop: 12, padding: "12px 0 4px",
        borderTop: "2px solid #D8E7EA",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ color: "#4E7780", fontSize: 9, fontWeight: 900, letterSpacing: 0.9, textTransform: "uppercase" }}>
              Edit weekly hours in Gantt
            </div>
            <div style={{ color: "#253746", fontSize: 12, fontWeight: 800, marginTop: 2 }}>
              {projName} <span style={{ color: "#94A3B8", fontWeight: 600 }}>· {projectId}</span>
            </div>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              style={{
                border: "1px solid #D8E7EA", borderRadius: 7, background: "#fff",
                color: "#5B6B77", padding: "5px 9px", fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}
            >
              Hide weekly hours
            </button>
          )}
        </div>
        {weeks.length === 0 ? (
          <div style={{ padding: "12px", borderRadius: 8, background: "#F5F7FA", color: "#6B7E8A", fontSize: 11 }}>
            No weekly allocation history found for this project.
          </div>
        ) : (
          <>
            <div ref={scrollRef} style={{
              overflowX: "auto", padding: "8px 6px 6px",
              border: "1px solid #E5EDF0", borderRadius: 9, background: "#FAFBFC",
            }}>
              <div style={{ display: "flex", alignItems: "flex-end", minWidth: weeks.length * COL_W }}>
                {shownWeeks.map((w, i) => {
                  const d = new Date(w.start);
                  const isNow = w.start === nowMonday;
                  const prev = i > 0 ? new Date(weeks[i - 1].start) : null;
                  const newMonth = !prev || prev.getMonth() !== d.getMonth();
                  const monthLbl = d.toLocaleDateString("en-US", { month: "short" });
                  const yearLbl = (!prev || prev.getFullYear() !== d.getFullYear())
                    ? ` ’${String(d.getFullYear()).slice(2)}` : "";
                  const barH = w.hrs > 0 ? Math.max(6, Math.round(w.hrs / Math.max(1, maxWeekHrs) * 72)) : 2;
                  const pc = w.hrs > 0 && phaseMap ? projectPhaseColor(phaseMap, projectId, w.start).color : null;
                  const editingThis = weekEdit?.start === w.start;
                  const draftValue = editingThis ? Number(weekEdit.draft) : NaN;
                  const draftInvalid = editingThis && (
                    weekEdit.draft.trim() === "" ||
                    !Number.isFinite(draftValue) ||
                    draftValue < 0 ||
                    draftValue > MAX_WEEK_HOURS
                  );
                  const editable = canEditHours && Boolean(onSaveProjectWeek) && !pastWeekLocked(w.start);
                  return (
                    <div key={w.start} style={{
                      width: COL_W, flexShrink: 0, display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "flex-end",
                      borderLeft: newMonth && i > 0 ? "1px dashed #DDE3E9" : "1px solid transparent",
                      background: isNow ? BRAND.green + "10" : "transparent",
                      borderRadius: isNow ? 7 : 0,
                    }}>
                      {editingThis ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          step={0.5}
                          value={weekEdit.draft}
                          disabled={savingWeek === w.start}
                          aria-label={`${projName}, week of ${localIsoDay(w.start)}, hours`}
                          title={draftValue > MAX_WEEK_HOURS ? `${MAX_WEEK_HOURS} hours is the maximum for one week` : "Press Enter to save · Escape to cancel"}
                          onChange={e => {
                            setWeekEdit(cur => cur ? { ...cur, draft: e.target.value } : cur);
                            setWeekEditError(null);
                          }}
                          onBlur={() => {
                            if (savingWeek !== w.start) void commitWeekEdit();
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter" && savingWeek !== w.start) {
                              e.preventDefault();
                              void commitWeekEdit();
                            } else if (e.key === "Escape" && savingWeek !== w.start) {
                              weekCommitRef.current = true;
                              setWeekEdit(null);
                              setWeekEditError(null);
                            }
                          }}
                          style={{
                            width: 34, height: 19, boxSizing: "border-box", marginBottom: 2,
                            padding: "0 2px", border: draftInvalid ? "2px solid #F87171" : `2px solid ${BRAND.green}`,
                            borderRadius: 4, outline: "none", background: draftInvalid ? "#FEF2F2" : "#fff",
                            color: "#253746", fontSize: 9, fontWeight: 800, textAlign: "center",
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!editable || savingWeek === w.start}
                          onClick={() => {
                            if (!editable) return;
                            weekCommitRef.current = false;
                            setWeekEditError(null);
                            setWeekEdit({ start: w.start, draft: String(w.hrs), original: w.hrs });
                          }}
                          title={editable
                            ? `Edit ${w.hrs} hours for the week of ${localIsoDay(w.start)}`
                            : pastWeekLocked(w.start) ? "Past-week editing is disabled by your business rules" : undefined}
                          style={{
                            minWidth: 28, height: 19, marginBottom: 2, padding: "0 2px",
                            border: "none", borderRadius: 4, background: "transparent",
                            fontSize: 9, fontWeight: 900, color: w.hrs > 0 ? "#526A73" : "#C2CBD3",
                            whiteSpace: "nowrap", cursor: editable ? "text" : "default",
                          }}
                        >
                          {savingWeek === w.start
                            ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} />
                            : w.hrs > 0 ? (w.hrs % 1 === 0 ? w.hrs : w.hrs.toFixed(1)) : "·"}
                        </button>
                      )}
                      <div style={{
                        width: 19, height: barH, borderRadius: 4,
                        background: pc?.bg ?? (w.hrs > 0 ? BRAND.green : "#D5DCE3"),
                        border: pc?.outline ? `1px solid ${pc.outline}` : "none",
                        opacity: w.hrs > 0 ? 1 : 0.55,
                      }} />
                      <span style={{ fontSize: 8, color: isNow ? BRAND.green : "#8A97A3", fontWeight: isNow ? 800 : 600, marginTop: 3 }}>
                        {d.getDate()}
                      </span>
                      <span style={{ fontSize: 8, fontWeight: 800, marginTop: 1, whiteSpace: "nowrap", color: newMonth ? "#5B6B77" : "transparent" }}>
                        {monthLbl}{yearLbl}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ fontSize: 9.5, color: "#8A97A3", marginTop: 5 }}>
              Click a Monday week-hour value above to edit this exact person and project. Scroll sideways for more weeks.
              {canEditHours && onSaveProjectWeek ? "" : " Editing is read-only for your current access."}
            </div>
            {weekEditError && (
              <div role="alert" style={{ fontSize: 10, color: "#DC2626", fontWeight: 700, marginTop: 5 }}>
                {weekEditError}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div onClick={embedded ? undefined : onClose}
      style={{
        ...(embedded
          ? { marginTop: 16, border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }
          : {
              position: "fixed", inset: 0, backgroundColor: "rgba(15,25,35,0.65)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: Z.POPUP_CHILD, padding: 16,
            }),
      }}>
      <div onClick={embedded ? undefined : (e) => e.stopPropagation()}
        style={{
          backgroundColor: "#FFFFFF", color: "#253746", borderRadius: 20,
          maxWidth: embedded ? "none" : 660, width: "100%",
          maxHeight: embedded ? "none" : "85vh", overflow: embedded ? "visible" : "auto",
          boxShadow: embedded ? "none" : "0 24px 64px rgba(0,0,0,0.35)",
        }}>

        {/* Header */}
        <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {projName}
            </div>
            <div style={{ fontSize: 11, color: "#6B7E8A", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
              <span>{projectId}</span>
              {phaseMap && (() => {
                const ph = projectPhaseColor(phaseMap, projectId, Date.now());
                const lead = isLeadProject(projectModule, projectId);
                const phaseLabel = projectPhaseDisplayName(projectModule, projectId, ph.phaseName);
                const phaseColor = lead ? PHASE_COLORS["Lead"] : ph.color;
                return (
                  <span style={{ background: phaseColor.bg, border: phaseColor.outline ? `1px solid ${phaseColor.outline}` : "none", color: phaseColor.text, fontSize: 9, padding: "1px 7px", borderRadius: 8, fontWeight: 700 }} title={lead ? "Lead record" : `Current phase: ${ph.phaseName}`}>{phaseLabel}</span>
                );
              })()}
            </div>
          </div>
          <button onClick={embedded ? (onCollapse ?? onClose) : onClose} aria-label={embedded ? "Hide weekly hours" : "Close"}
            style={{ background: "transparent", border: "none", padding: 6, cursor: "pointer", color: "#9BA8B3", flexShrink: 0, marginTop: -2 }}>
            <X size={18} />
          </button>
        </div>

        {/* Person + summary stats */}
        <div style={{ padding: "12px 20px 14px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid #F0F3F6" }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            backgroundColor: BRAND.green + "18", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: BRAND.green }}>
              {r.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#253746" }}>{r.name}</div>
            {r.role && <div style={{ fontSize: 11, color: "#6B7E8A" }}>{r.role}</div>}
          </div>
          <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
            {totalHrs > 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#253746" }}>{totalHrs >= 1000 ? `${fmtHours(totalHrs / 1000, 1)}k` : fmtHours(totalHrs)}</div>
                <div style={{ fontSize: 9, color: "#6B7E8A", fontWeight: 600, letterSpacing: 0.5 }}>TOTAL HRS</div>
              </div>
            )}
            {totalWks > 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#253746" }}>{totalWks}</div>
                <div style={{ fontSize: 9, color: "#6B7E8A", fontWeight: 600, letterSpacing: 0.5 }}>WEEKS</div>
              </div>
            )}
            {hasActive && (
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{
                  fontSize: 9, fontWeight: 800, color: BRAND.green, letterSpacing: 0.6,
                  padding: "3px 8px", borderRadius: 20, backgroundColor: BRAND.green + "18",
                }}>ACTIVE</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>
          {spans.length === 0 && weeks.length === 0 ? (
            <div style={{ padding: "24px 12px", backgroundColor: "#F5F7FA", borderRadius: 12,
              fontSize: 13, color: "#6B7E8A", textAlign: "center" }}>
              No allocation history found for this project.
            </div>
          ) : (
            <>
              {/* Week-by-week Gantt — scrollable, one bar per week */}
              {weeks.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#9BA8B3", letterSpacing: 0.9, textTransform: "uppercase" }}>
                      Weekly Hours · {weeks.length} week{weeks.length !== 1 ? "s" : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "#6B7E8A", fontWeight: 600, whiteSpace: "nowrap" }}>
                      peak {maxWeekHrs}h{avgWeekHrs > 0 && <> · avg {avgWeekHrs}h/wk</>}
                    </div>
                  </div>
                  <div ref={scrollRef}
                    style={{
                      overflowX: "auto", paddingBottom: 4,
                      border: "1px solid #EEF1F5", borderRadius: 12,
                      backgroundColor: "#FAFBFC",
                    }}>
                    <div style={{ display: "flex", alignItems: "flex-end", minWidth: weeks.length * COL_W, padding: "10px 6px 8px" }}>
                       {shownWeeks.map((w, i) => {
                        const d = new Date(w.start);
                        const isNow = w.start === nowMonday;
                        const prev = i > 0 ? new Date(weeks[i - 1].start) : null;
                        const newMonth = !prev || prev.getMonth() !== d.getMonth();
                        const monthLbl = d.toLocaleDateString("en-US", { month: "short" });
                        const yearLbl  = (!prev || prev.getFullYear() !== d.getFullYear())
                          ? ` ’${String(d.getFullYear()).slice(2)}` : "";
                        const barH  = w.hrs > 0 ? Math.max(6, Math.round(w.hrs / Math.max(1, maxWeekHrs) * 88)) : 2;
                        const pc = w.hrs > 0 && phaseMap ? projectPhaseColor(phaseMap, projectId, w.start).color : null;
                        const color = pc?.bg ?? (w.hrs > 0 ? BRAND.green : "#D5DCE3");
                         const editingThis = weekEdit?.start === w.start;
                         const draftValue = editingThis ? Number(weekEdit.draft) : NaN;
                         const draftInvalid = editingThis && (
                           weekEdit.draft.trim() === "" ||
                           !Number.isFinite(draftValue) ||
                           draftValue < 0 ||
                           draftValue > MAX_WEEK_HOURS
                         );
                         const editable = canEditHours && Boolean(onSaveProjectWeek) && !pastWeekLocked(w.start);
                        return (
                          <div key={w.start}
                            title={`Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${w.hrs} hrs`}
                            style={{
                              width: COL_W, flexShrink: 0,
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
                              borderLeft: newMonth && i > 0 ? "1px dashed #DDE3E9" : "1px solid transparent",
                              backgroundColor: isNow ? BRAND.green + "10" : "transparent",
                              borderRadius: isNow ? 8 : 0,
                            }}>
                            {/* Exact person + project + week: edit directly.
                                Aggregate capacity/totals elsewhere stay drill-through only. */}
                            {editingThis ? (
                              <input
                                autoFocus
                                type="number"
                                min={0}
                                step={0.5}
                                value={weekEdit.draft}
                                disabled={savingWeek === w.start}
                                aria-label={`${projName}, week of ${localIsoDay(w.start)}, hours`}
                                title={draftValue > MAX_WEEK_HOURS ? `${MAX_WEEK_HOURS} hours is the maximum for one week` : "Press Enter to save · Escape to cancel"}
                                onChange={e => {
                                  setWeekEdit(cur => cur ? { ...cur, draft: e.target.value } : cur);
                                  setWeekEditError(null);
                                }}
                                onBlur={() => {
                                  if (savingWeek !== w.start) void commitWeekEdit();
                                }}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && savingWeek !== w.start) {
                                    e.preventDefault();
                                    void commitWeekEdit();
                                  } else if (e.key === "Escape" && savingWeek !== w.start) {
                                    weekCommitRef.current = true;
                                    setWeekEdit(null);
                                    setWeekEditError(null);
                                  }
                                }}
                                style={{
                                  width: 34, height: 18, boxSizing: "border-box", marginBottom: 2, padding: "0 2px",
                                  border: draftInvalid ? "2px solid #F87171" : `2px solid ${BRAND.green}`,
                                  borderRadius: 4, outline: "none", background: draftInvalid ? "#FEF2F2" : "#fff",
                                  color: "#253746", fontSize: 9, fontWeight: 800, textAlign: "center",
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                disabled={!editable || savingWeek === w.start}
                                onClick={() => {
                                  if (!editable) return;
                                  weekCommitRef.current = false;
                                  setWeekEditError(null);
                                  setWeekEdit({ start: w.start, draft: String(w.hrs), original: w.hrs });
                                }}
                                title={editable
                                  ? `Edit ${w.hrs} hours for this project/week`
                                  : pastWeekLocked(w.start) ? "Past-week editing is disabled by your business rules" : undefined}
                                style={{
                                  minWidth: 28, height: 18, marginBottom: 2, padding: "0 2px",
                                  border: "none", borderRadius: 4, background: "transparent",
                                  fontSize: 9, fontWeight: 800,
                                  color: w.hrs > 0 ? "#5B6B77" : "#C2CBD3", whiteSpace: "nowrap",
                                  cursor: editable ? "text" : "default",
                                }}
                              >
                                {savingWeek === w.start
                                  ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} />
                                  : w.hrs > 0 ? (w.hrs % 1 === 0 ? w.hrs : w.hrs.toFixed(1)) : "·"}
                              </button>
                            )}
                            {/* Bar */}
                            <div style={{
                              width: 20, height: barH, borderRadius: 5,
                              backgroundColor: color,
                              border: pc?.outline ? `1px solid ${pc.outline}` : "none",
                              boxSizing: "border-box",
                              opacity: w.hrs > 0 ? 1 : 0.55,
                            }} />
                            {/* Week-start day */}
                            <span style={{ fontSize: 8.5, color: isNow ? BRAND.green : "#8A97A3", fontWeight: isNow ? 800 : 600, marginTop: 4 }}>
                              {d.getDate()}
                            </span>
                            {/* Month label on month change */}
                            <span style={{
                              fontSize: 8.5, fontWeight: 800, marginTop: 1, whiteSpace: "nowrap",
                              color: newMonth ? "#5B6B77" : "transparent",
                            }}>
                              {monthLbl}{yearLbl}
                            </span>
                            {isNow ? (
                              <span style={{
                                fontSize: 7.5, fontWeight: 900, color: "#fff", letterSpacing: 0.5,
                                backgroundColor: BRAND.green, borderRadius: 6,
                                padding: "1px 5px", marginTop: 2,
                              }}>NOW</span>
                            ) : (
                              <span style={{ fontSize: 7.5, padding: "1px 5px", marginTop: 2, visibility: "hidden" }}>·</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: 9.5, color: "#9BA8B3", marginTop: 6 }}>
                    Scroll sideways to see every week — each bar is one week's allocated hours on this project.
                    {canEditHours && onSaveProjectWeek ? " Click an hour value to edit it." : ""}
                  </div>
                  {weekEditError && (
                    <div role="alert" style={{ fontSize: 10, color: "#DC2626", fontWeight: 700, marginTop: 6 }}>
                      {weekEditError}
                    </div>
                  )}
                </div>
              )}

              {/* Span breakdown — one row per merged phase. Hidden entirely
                  for dateless Lead allocations (no spans to break down). */}
              {spans.length > 0 && (
              <div style={{ fontSize: 9, fontWeight: 800, color: "#9BA8B3", letterSpacing: 0.9, marginBottom: 8, textTransform: "uppercase" }}>
                Phase Breakdown · {spans.length} period{spans.length !== 1 ? "s" : ""}
              </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {spans.slice().reverse().map((sp, i) => {
                  const barColor = statusInfo(sp.avgPct).color;
                  return (
                    <div key={i} style={{
                      padding: "10px 14px", borderRadius: 12,
                      border: `1px solid ${sp.isActive ? barColor + "35" : "#EEF1F5"}`,
                      backgroundColor: sp.isActive ? barColor + "08" : "#FAFBFC",
                      display: "flex", alignItems: "center", gap: 12,
                    }}>
                      {/* Pct badge */}
                      <div style={{
                        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                        backgroundColor: barColor + "18",
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: barColor, lineHeight: 1 }}>{sp.avgPct}</span>
                        <span style={{ fontSize: 8, color: barColor + "BB", fontWeight: 700 }}>%</span>
                      </div>
                      {/* Details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#253746" }}>
                            {fmtDateShort(sp.startDate)} – {fmtDateShort(sp.endDate)}
                          </span>
                          {sp.isActive && (
                            <span style={{ fontSize: 8, fontWeight: 800, color: barColor,
                              padding: "2px 6px", borderRadius: 10, backgroundColor: barColor + "18", letterSpacing: 0.4 }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#6B7E8A" }}>
                          {sp.weekCount} wk{sp.weekCount !== 1 ? "s" : ""}
                          {sp.totalHrs > 0 && ` · ~${sp.totalHrs >= 1000 ? `${fmtHours(sp.totalHrs / 1000, 1)}k` : fmtHours(sp.totalHrs)} hrs`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "0 20px 18px" }}>
          <button onClick={() => { if (!embedded) onClose(); onProjectClick(projectId); }}
            style={{
              width: "100%", padding: "11px 16px", borderRadius: 12,
              backgroundColor: "#44A2B1", color: "#fff",
              border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            Open Project →
          </button>
        </div>
      </div>
    </div>
  );
}

function InlineGanttWeeklyBar({
  r, projectId, projectName, entries, windowStart, windowEnd, color, outline,
  canEditHours, onSaveProjectWeek,
}: {
  r: LiveResourceProxy;
  projectId: string;
  projectName: string;
  entries: ActiveAllocationProxy[];
  windowStart: number;
  windowEnd: number;
  color: string;
  outline?: string;
  canEditHours: boolean;
  onSaveProjectWeek?: (edit: ResourceProjectWeekEdit) => Promise<void>;
}) {
  const [draftByWeek, setDraftByWeek] = useState<Record<number, string>>({});
  const [savingWeeks, setSavingWeeks] = useState<Record<number, boolean>>({});
  const [weekEditError, setWeekEditError] = useState<string | null>(null);
  const savingWeekRef = useRef<Set<number>>(new Set());
  const localIsoDay = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const pastWeekLocked = (weekStart: number): boolean =>
    getPastWeekEditStateFor(localIsoDay(weekStart), projectId.split("-")[0]).locked;
  // Walk the visible Gantt window itself. Deriving the range from a merged
  // source-row span could leave a selected, visible bar with no week cells.
  const windowWeeks: { start: number; hrs: number; hasAllocation: boolean }[] = [];
  const cursor = new Date(mondayOf(windowStart));
  while (cursor.getTime() < windowEnd && windowWeeks.length < 54) {
    const ws = cursor.getTime();
    const next = new Date(cursor);
    next.setDate(next.getDate() + 7);
    const we = next.getTime() - 1;
    const inWeek = entries.filter(e => {
      const s = parseLocalDay(e.startDate), en = parseLocalDay(e.endDate);
      return !isNaN(s) && !isNaN(en) && s <= we && en >= ws;
    });
    const hrs = hoursWinFilter(inWeek)
      .reduce((total, e) => total + allocEntryHrsPerWeek(e, getBusinessRules().workWeekHours), 0);
    windowWeeks.push({
      start: ws,
      hrs: Math.round(hrs * 10) / 10,
      hasAllocation: inWeek.length > 0,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  const firstAllocated = windowWeeks.findIndex(w => w.hasAllocation);
  const lastAllocated = windowWeeks.map(w => w.hasAllocation).lastIndexOf(true);
  const visibleWeeks = (firstAllocated >= 0
    ? windowWeeks.slice(firstAllocated, lastAllocated + 1)
    : windowWeeks
  );
  const maxWeekHrs = visibleWeeks.reduce((max, w) => Math.max(max, w.hrs), 0);

  const commitWeekEdit = async (weekStart: number, original: number) => {
    const draft = draftByWeek[weekStart];
    if (draft === undefined || savingWeekRef.current.has(weekStart) || !onSaveProjectWeek) return;
    const hours = parseWeeklyHoursDraft(draft);
    if (hours === null || hours < 0 || hours > MAX_WEEK_HOURS) {
      setWeekEditError(`Enter 0–${MAX_WEEK_HOURS} hours. Nothing was saved.`);
      return;
    }
    if (hours === original) {
      setDraftByWeek(current => {
        const next = { ...current };
        delete next[weekStart];
        return next;
      });
      return;
    }
    savingWeekRef.current.add(weekStart);
    setSavingWeeks(current => ({ ...current, [weekStart]: true }));
    setWeekEditError(null);
    let handedOff = false;
    try {
      await onSaveProjectWeek({
        personId: r.id,
        personName: r.name,
        role: r.roleName || r.role,
        projectId,
        projectName,
        week: localIsoDay(weekStart),
        hours,
        onAccepted: () => {
          handedOff = true;
          setDraftByWeek(current => {
            if (current[weekStart] !== draft) return current;
            const next = { ...current };
            delete next[weekStart];
            return next;
          });
        },
      });
      setDraftByWeek(current => {
        const next = { ...current };
        delete next[weekStart];
        return next;
      });
    } catch (e) {
      if (handedOff) {
        setDraftByWeek(current =>
          current[weekStart] === undefined
            ? { ...current, [weekStart]: draft }
            : current
        );
      }
      setWeekEditError(e instanceof Error ? e.message : String(e));
    } finally {
      savingWeekRef.current.delete(weekStart);
      setSavingWeeks(current => {
        const next = { ...current };
        delete next[weekStart];
        return next;
      });
    }
  };

  return (
    <div
      onClick={event => event.stopPropagation()}
      title={`${projectName} · type directly into any weekly value`}
      style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "stretch",
        background: `${color}E8`, border: outline ? `1px solid ${outline}` : "none",
        borderRadius: 17, overflow: "visible", zIndex: 6,
      }}
    >
      {visibleWeeks.map((w, index) => {
        const d = new Date(w.start);
        const draft = draftByWeek[w.start] ?? String(w.hrs);
        const draftValue = Number(draft);
        const draftInvalid =
          draft.trim() === "" ||
          !Number.isFinite(draftValue) ||
          draftValue < 0 ||
          draftValue > MAX_WEEK_HOURS;
        const editable = canEditHours && Boolean(onSaveProjectWeek) && !pastWeekLocked(w.start);
        const slotWidth = `${100 / visibleWeeks.length}%`;
        const barHeight = w.hrs > 0
          ? Math.max(4, Math.round(w.hrs / Math.max(1, maxWeekHrs) * 22))
          : 2;
        return (
          <div
            key={w.start}
            style={{
              width: slotWidth, minWidth: 0, height: "100%", display: "flex",
              flexDirection: "column", alignItems: "center", justifyContent: "center",
              borderLeft: index > 0 ? "1px solid rgba(255,255,255,0.25)" : "none",
            }}
          >
            <input
              type="number"
              min={0}
              step={0.5}
              value={draft}
              disabled={!editable || Boolean(savingWeeks[w.start])}
              aria-label={`${projectName}, week of ${localIsoDay(w.start)}, hours`}
              title={editable
                ? `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · type hours and press Enter`
                : pastWeekLocked(w.start) ? "Past-week editing is disabled by your business rules" : "Read-only"}
              onClick={event => event.stopPropagation()}
              onChange={event => {
                setDraftByWeek(current => ({ ...current, [w.start]: event.target.value }));
                setWeekEditError(null);
              }}
              onBlur={() => void commitWeekEdit(w.start, w.hrs)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitWeekEdit(w.start, w.hrs);
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  setDraftByWeek(current => {
                    const next = { ...current };
                    delete next[w.start];
                    return next;
                  });
                  setWeekEditError(null);
                  event.currentTarget.blur();
                }
              }}
              style={{
                width: "calc(100% - 2px)", minWidth: 0, height: 18, padding: "0 1px",
                appearance: "textfield", WebkitAppearance: "none",
                border: draftInvalid ? "2px solid #F87171" : "1px solid rgba(255,255,255,0.95)",
                borderRadius: 3, outline: "none", background: editable ? "#FFFFFFE8" : "transparent",
                color: editable ? "#253746" : "#fff", fontSize: visibleWeeks.length > 18 ? 7 : 9,
                fontWeight: 900, textAlign: "center",
                textShadow: editable ? "none" : "0 1px 2px rgba(0,0,0,0.35)",
                cursor: editable ? "text" : "default",
              }}
            />
            <div style={{
              width: "65%", maxWidth: 18, height: barHeight, marginTop: 1,
              borderRadius: 3, background: "rgba(255,255,255,0.55)",
            }} />
          </div>
        );
      })}
      {weekEditError && (
        <div role="alert" style={{
          position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 20,
          background: "#FEF2F2", border: "1px solid #F87171", borderRadius: 5,
          color: "#B91C1C", fontSize: 9, fontWeight: 800, padding: "4px 6px",
          whiteSpace: "nowrap",
        }}>
          {weekEditError}
        </div>
      )}
    </div>
  );
}

function ProjectGanttWeekCell({
  r, projectId, projectName, weekStart, hours, color, outline,
  canEditHours, editing, saveInFlight, onEditingChange, onSavingChange, onSaveProjectWeek,
  allocationLocked = false, onSaveError,
}: {
  r: LiveResourceProxy;
  projectId: string;
  projectName: string;
  weekStart: number;
  hours: number;
  color: string;
  outline?: string;
  canEditHours: boolean;
  editing: boolean;
  /** True only for this exact project/week cell. */
  saveInFlight: boolean;
  onEditingChange: (editing: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  onSaveProjectWeek?: (edit: ResourceProjectWeekEdit) => Promise<void>;
  /** This member's allocation on THIS project carries the lock flag — the
   *  save contract (and the server, via 423 allocation_locked) rejects hours
   *  edits until it is unlocked from the project Team grid's FLAGS column. */
  allocationLocked?: boolean;
  /** Mirrors save failures to a popup-level banner. The under-cell message
   *  alone can sit clipped/off-screen in the scrolling timeline, which made
   *  failed saves look like silent reverts (locked-allocation incident). */
  onSaveError?: (message: string) => void;
}) {
  const [draft, setDraft] = useState(String(hours));
  const [savedHours, setSavedHours] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSaveWaitNotice, setShowSaveWaitNotice] = useState(false);
  const savingRef = useRef(false);
  const saveWaitNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const value = savedHours ?? hours;
  // Once the verified parent refresh catches up with an optimistic cell value,
  // return to the canonical server-supplied hour value rather than holding a
  // local projection indefinitely.
  useEffect(() => {
    if (savedHours !== null && hours === savedHours) setSavedHours(null);
  }, [hours, savedHours]);
  const localIsoDay = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const pastWeekLocked = () =>
    getPastWeekEditStateFor(localIsoDay(weekStart), projectId.split("-")[0]).locked;
  // Every single-cell write is serialized by the shared save contract. Keep
  // only its own cell unavailable while it is saving; unrelated project/week
  // cells must stay editable instead of looking like a second locked surface.
  const editable = canEditHours && Boolean(onSaveProjectWeek) && !pastWeekLocked() && !allocationLocked && !saveInFlight;
  const wasEditingRef = useRef(editing);
  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = editing;
    if (!editing) {
      setDraft(String(value));
      // Clear the error ONLY when an edit session actually closes. This
      // effect also re-runs when `value` changes while the editor is closed —
      // exactly what happens when a FAILED save rolls its optimistic hours
      // back — and unconditionally clearing here wiped the failure message in
      // the same render it was set (the "silent revert" bug: a locked
      // allocation rejected the save and the cell just flipped back with no
      // explanation).
      if (wasEditing) setError(null);
    }
  }, [editing, value]);
  useEffect(() => {
    return () => {
      if (saveWaitNoticeTimerRef.current) clearTimeout(saveWaitNoticeTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (!saveInFlight) setShowSaveWaitNotice(false);
  }, [saveInFlight]);
  const showSaveWait = () => {
    setShowSaveWaitNotice(true);
    if (saveWaitNoticeTimerRef.current) clearTimeout(saveWaitNoticeTimerRef.current);
    saveWaitNoticeTimerRef.current = setTimeout(() => {
      setShowSaveWaitNotice(false);
      saveWaitNoticeTimerRef.current = null;
    }, 1800);
  };
  const commit = async () => {
    if (savingRef.current || !onSaveProjectWeek) return;
    const nextHours = parseWeeklyHoursDraft(draft);
    if (nextHours === null || nextHours < 0 || nextHours > MAX_WEEK_HOURS) {
      setError(`Use 0–${MAX_WEEK_HOURS}`);
      return;
    }
    if (nextHours === value) {
      onEditingChange(false);
      return;
    }
    const previousSavedHours = savedHours;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    onSavingChange(true);
    // Match the Project Team editor: the entered number is the visible result
    // immediately. The verified save continues in the background and rolls
    // this projection back if it fails.
    setSavedHours(nextHours);
    onEditingChange(false);
    try {
      await onSaveProjectWeek({
        personId: r.id,
        personName: r.name,
        role: r.roleName || r.role,
        projectId,
        projectName,
        week: localIsoDay(weekStart),
        hours: nextHours,
        onAccepted: () => {
          // The shared page overlay (acceptedWeekOverrides) was installed
          // BEFORE this callback fired, and the popup's `hours` prop is
          // derived from the overlay-adjusted allocations — so the saved
          // number keeps rendering from page state while this cell releases
          // its local projection. Both state updates land in one batched
          // render: the old number never flashes back. Release ONLY if the
          // projection is still OUR draft — a newer edit in this same cell
          // must not be cleared by an older save's acceptance, and a stale
          // projection held indefinitely would mask later live values.
          setSavedHours(current => current === nextHours ? null : current);
        },
      });
    } catch (e) {
      setSavedHours(previousSavedHours);
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // The popup-level banner is the guaranteed-visible surface; the
      // under-cell message can be clipped by the scrolling timeline.
      onSaveError?.(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };
  const weekLabel = new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div
      onClick={event => event.stopPropagation()}
      title={showSaveWaitNotice ? "Another allocation save is in progress. Please wait a moment." : undefined}
      aria-busy={saving || saveInFlight}
      style={{
        position: "relative", width: "100%", height: 30, borderRadius: 5,
        background: color, border: allocationLocked ? "1.5px solid #F59E0B" : outline ? `1px solid ${outline}` : "1px solid rgba(255,255,255,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxSizing: "border-box", overflow: "visible",
      }}
    >
      {showSaveWaitNotice && (
        <span
          role="status"
          style={{
            position: "absolute", left: "50%", top: -17, transform: "translateX(-50%)",
            zIndex: 30, padding: "2px 5px", borderRadius: 4,
            background: "#1E293B", color: "#fff", boxShadow: "0 2px 6px rgba(15,23,42,0.25)",
            fontSize: 8, fontWeight: 800, lineHeight: 1.2, whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          Saving… please wait
        </span>
      )}
      {editing ? (
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          aria-label={`${projectName}, week of ${localIsoDay(weekStart)}, hours`}
          onChange={event => { setDraft(event.target.value); setError(null); }}
          onFocus={event => event.currentTarget.select()}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onBlur={event => {
            // Let an in-input mouse selection finish before click-away saves.
            // This also keeps the cell from disappearing while the user is
            // selecting the existing number to replace it.
            const input = event.currentTarget;
            setTimeout(() => {
              if (document.activeElement !== input) void commit();
            }, 0);
          }}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(String(value));
              onEditingChange(false);
              setError(null);
            }
          }}
          style={{
            width: "calc(100% - 4px)", minWidth: 0, height: 22, padding: "0 1px",
            appearance: "textfield", WebkitAppearance: "none",
            border: error ? "2px solid #F87171" : "2px solid #fff",
            borderRadius: 3, outline: "none", background: "#fff", color: "#253746",
            fontSize: 10, fontWeight: 900, textAlign: "center",
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!canEditHours || !onSaveProjectWeek || pastWeekLocked() || allocationLocked}
          title={showSaveWaitNotice
            ? "Another allocation save is in progress. Please wait a moment."
            : allocationLocked
            ? `${projectName}: allocation locked — unlock it from the project's Team grid FLAGS column to edit hours`
            : editable
            ? `Week of ${weekLabel}: ${value} hours. Click to edit.`
            : pastWeekLocked() ? "Past-week editing is disabled by your business rules" : "Read-only"}
          onClick={() => {
            if (saving || saveInFlight) {
              showSaveWait();
              return;
            }
            if (!editable) return;
            setDraft(String(value));
            setError(null);
            onEditingChange(true);
          }}
          style={{
            width: "100%", height: "100%", padding: 0, border: "none", background: "transparent",
            color: "#fff", fontSize: 10, fontWeight: 900,
            cursor: editable ? "text" : "default",
            textShadow: "0 1px 2px rgba(0,0,0,0.32)", fontVariantNumeric: "tabular-nums",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          }}
        >
          {allocationLocked && <Lock size={8} strokeWidth={3} aria-hidden style={{ flexShrink: 0 }} />}
          {value % 1 === 0 ? value : value.toFixed(1)}
        </button>
      )}
      {error && (
        <span role="alert" style={{
          position: "absolute", top: "calc(100% + 2px)", zIndex: 25,
          padding: "2px 4px", borderRadius: 3, background: "#FEF2F2", color: "#B91C1C",
          border: "1px solid #F87171", fontSize: 8, fontWeight: 800, whiteSpace: "nowrap",
        }}>{error}</span>
      )}
    </div>
  );
}

/* ── Month total editor ──────────────────────────────────────────────────
   The Monthly workload view edits ONE number: the person's TOTAL hours on a
   project for that calendar month. The total is distributed evenly across
   the month's editable Mon-start weeks (remainder-carry at 0.1h so the weeks
   sum exactly); weeks locked by past-week rules keep their hours and count
   toward the total. Weekly rows stay the single source of truth — this saves
   through the SAME atomic weekly path (weekPatches), so the 168h cap,
   past-week rules, permission gating, member write queue and post-save
   verification all still apply. The preview below the input shows the exact
   per-week split BEFORE anything is saved. */
function MonthTotalEditor({
  personName, projectName, monthLabel, weeks, onClose, onSave,
}: {
  personName: string;
  projectName: string;
  monthLabel: string;
  weeks: MonthWeekSlot[];
  onClose: () => void;
  onSave: (patches: Record<string, number>) => Promise<void>;
}) {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const currentTotal = round1(weeks.reduce((t, w) => t + w.hours, 0));
  const [draft, setDraft] = useState(String(currentTotal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseWeeklyHoursDraft(draft);
  const plan = parsed === null ? null : planMonthlyDistribution(weeks, parsed, MAX_WEEK_HOURS);
  const fmtWk = (iso: string) => {
    const ms = parseLocalDay(iso);
    return isNaN(ms) ? iso : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const commit = async () => {
    if (saving) return;
    if (parsed === null || !plan) { setError("Enter a valid number of hours."); return; }
    if (!plan.ok) { setError(plan.error); return; }
    const changed = Object.entries(plan.patches).some(([iso, hrs]) =>
      round1(weeks.find(w => w.iso === iso)?.hours ?? 0) !== hrs);
    if (!changed) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(plan.patches);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  return (
    <div
      onClick={e => { e.stopPropagation(); if (!saving) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,25,35,0.45)",
        // Opened from inside the staff popup (Z.POPUP) — must beat its opener.
        zIndex: Z.POPUP + 10,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={`Edit ${monthLabel} total hours`} style={{
        background: "#fff", color: "#253746", borderRadius: 12, border: "1px solid #e2e8f0",
        boxShadow: "0 18px 50px rgba(0,0,0,0.28)", width: 420, maxWidth: "94vw",
        padding: 18, boxSizing: "border-box",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{monthLabel} — monthly total</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {personName} · {projectName}
            </div>
          </div>
          <button onClick={() => { if (!saving) onClose(); }} aria-label="Close"
            style={{ border: "none", background: "transparent", color: "#94a3b8", fontSize: 16, cursor: "pointer", padding: 2, lineHeight: 1 }}>✕</button>
        </div>

        {/* Current per-week hours — the exact weeks this edit covers. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {weeks.map(w => (
            <span key={w.iso} title={w.locked ? "Locked by past-week editing rules — stays unchanged" : `Week of ${fmtWk(w.iso)}`}
              style={{
                fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                background: w.locked ? "#F1F5F9" : "#EFF6FF",
                color: w.locked ? "#94A3B8" : "#1D4ED8",
                border: `1px solid ${w.locked ? "#E2E8F0" : "#BFDBFE"}`,
                fontVariantNumeric: "tabular-nums",
              }}>
              {fmtWk(w.iso)}: {w.hours % 1 === 0 ? w.hours : w.hours.toFixed(1)}h{w.locked ? " · locked" : ""}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>
          Currently <b>{currentTotal}h</b> total across {weeks.length} week{weeks.length === 1 ? "" : "s"}.
        </div>

        <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "#475569", marginTop: 14 }}>
          New total hours for {monthLabel}
          <input
            autoFocus
            type="number"
            min={0}
            step={1}
            value={draft}
            disabled={saving}
            onChange={e => { setDraft(e.target.value); setError(null); }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); void commit(); }
              else if (e.key === "Escape" && !saving) onClose();
            }}
            style={{
              display: "block", width: "100%", boxSizing: "border-box", marginTop: 5,
              border: `2px solid ${error ? "#F87171" : "#cbd5e1"}`, borderRadius: 8,
              padding: "8px 10px", fontSize: 14, fontWeight: 800, outline: "none",
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </label>

        {/* Live preview: the exact per-week split that Save will write. */}
        <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, minHeight: 34 }}>
          {plan?.ok ? (
            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "7px 10px", color: "#166534" }}>
              Will save: {plan.shares.map(s => `${fmtWk(s.iso)} → ${s.hours % 1 === 0 ? s.hours : s.hours.toFixed(1)}h`).join(" · ")}
              {plan.lockedWeeks > 0 && (
                <div style={{ color: "#92400E", marginTop: 3 }}>
                  {plan.lockedHours}h stay unchanged in {plan.lockedWeeks} locked past week{plan.lockedWeeks === 1 ? "" : "s"} and count toward the total.
                </div>
              )}
            </div>
          ) : plan && !plan.ok ? (
            <div style={{ color: "#B91C1C", fontWeight: 700 }}>{plan.error}</div>
          ) : draft.trim() !== "" ? (
            <div style={{ color: "#B91C1C", fontWeight: 700 }}>Enter a valid number of hours.</div>
          ) : null}
        </div>

        {error && (
          <div role="alert" style={{ marginTop: 6, fontSize: 11.5, color: "#B91C1C", fontWeight: 700 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={() => { if (!saving) onClose(); }} disabled={saving}
            style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#64748b", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>
            Cancel
          </button>
          <button onClick={() => void commit()} disabled={saving || !plan || !plan.ok}
            style={{
              background: saving || !plan || !plan.ok ? "#94D3A2" : "#16A34A",
              border: "none", color: "#fff", borderRadius: 8, padding: "7px 16px",
              fontSize: 12.5, fontWeight: 800, cursor: saving || !plan || !plan.ok ? "default" : "pointer",
            }}>
            {saving ? "Saving…" : "Save monthly total"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Staff modal — approved Gantt design (mockup 3) ──────────────────────
   Person-level view: monthly capacity bars (utilization-band colored) over a
   pageable 6-month window, plus a phase-colored project Gantt with a TODAY
   marker. Modes: active / all (project rows) and allocation (one row per
   active assignment). Row click keeps the weekly-detail drill contract. */
type StaffQuickAction = "PMM" | "OPM" | "LEM" | "allocation" | "audit" | "edit";

/* Three-dots row menu for the Staff grid. The dropdown is portal-positioned
 * (grid cells clip overflow) — same pattern as the projects-list row menu.
 * These entries open the same staff action hub used by Quick Actions. Profile
 * editing lives here too so the row has one consolidated action control. */
function StaffDotsMenu({ onAction }: { onAction: (action: StaffQuickAction) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setPos(null);
    };
    const onScroll = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pos]);
  const MENU_W = 218;
  const actions: ReadonlyArray<{
    id: StaffQuickAction;
    label: string;
    Icon: typeof Briefcase;
  }> = [
    { id: "edit", label: "Edit staff", Icon: Pencil },
    { id: "PMM", label: "Add to project", Icon: Briefcase },
    { id: "OPM", label: "Add to opportunity", Icon: Target },
    { id: "LEM", label: "Add to lead", Icon: Zap },
    { id: "allocation", label: "Edit allocation", Icon: BarChart2 },
    { id: "audit", label: "Audit Trail", Icon: Activity },
  ];
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="More actions"
        data-testid="staff-row-dots"
        onClick={(e) => {
          e.stopPropagation();
          if (pos) { setPos(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
           const estH = actions.length * 37 + 10;
          const top = r.bottom + 4 + estH > window.innerHeight ? Math.max(8, r.top - 4 - estH) : r.bottom + 4;
          const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
          setPos({ top, left });
        }}
        style={{
          width: 28, height: 28, borderRadius: 7, border: "1px solid var(--rm-panel-border)",
          background: pos ? "var(--rm-panel-hover)" : "transparent",
          color: "var(--rm-text-muted)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0,
        }}
      >
        <MoreVertical size={14} strokeWidth={2.6} />
      </button>
      {pos && createPortal(
        // React portal events bubble through the REACT tree (not the DOM), so
        // without this stop a click on the menu's own padding would reach the
        // grid row's onClick and open the staff profile popup underneath.
        <div ref={menuRef} onClick={(e) => e.stopPropagation()} style={{
          position: "fixed", top: pos.top, left: pos.left, zIndex: Z.PAGE_MENU,
          backgroundColor: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)",
          borderRadius: 10, padding: "4px 0", minWidth: MENU_W,
          boxShadow: "0 10px 32px rgba(0,0,0,0.25)",
        }}>
          {actions.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              data-testid={`staff-row-dots-${id.toLowerCase()}`}
              onClick={(e) => { e.stopPropagation(); setPos(null); onAction(id); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 9,
                padding: "9px 14px", background: "none", border: "none",
                color: "var(--rm-text)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--rm-panel-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <Icon size={13} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function StaffUtilModal({
  r, status, pName, onClose, onProjectClick, canEditHours = false, onSaveProjectWeek,
  onSaveProjectWeeks,
  initialProjectId, mode = "active", windows: windowsProp, projectScope,
  scopeOwnerName,
}: {
  r: LiveResourceProxy;
  status: StatusInfo;
  pName: (pid: string) => string;
  onClose: () => void;
  onProjectClick: (pid: string, module?: "PMM" | "OPM" | "LEM") => void;
  canEditHours?: boolean;
  onSaveProjectWeek?: (edit: ResourceProjectWeekEdit) => Promise<void>;
  /** Atomic multi-week save — enables direct month-total editing in Monthly view. */
  onSaveProjectWeeks?: (edit: ResourceProjectWeeksEdit) => Promise<void>;
  /** Opens a project’s inline weekly panel when the person popup first opens. */
  initialProjectId?: string | null;
  mode?: StaffModalMode;
  /** Leave / partial-availability windows for this person (may be undefined). */
  windows?: AvailWindow[];
  /** Manager hierarchy only: records shared with the selected hierarchy owner. */
  projectScope?: string[];
  /** Display name of the hierarchy owner the scope belongs to (labels only). */
  scopeOwnerName?: string;
}) {
  // A PROVIDED scope always filters — even when the shared-record list is
  // empty. Treating [] as "unscoped" would show the person's FULL
  // company-wide history precisely when they share NOTHING with the selected
  // manager (the Manager-view leak). Absent scope (undefined) = no filtering.
  const scopeKeys = useMemo(
    () => projectScope
      ? new Set(projectScope.map(projectId => projectId.trim().toLowerCase()))
      : null,
    [projectScope],
  );
  const inScope = useCallback(
    (projectId: string) => !scopeKeys || scopeKeys.has(projectId.trim().toLowerCase()),
    [scopeKeys],
  );
  // Fetch availability directly for this person — more reliable than the
  // batch-map lookup because it uses the exact same GUID that was used when
  // saving the leave window.
  const [fetchedWindows, setFetchedWindows] = useState<AvailWindow[] | null>(null);
  useEffect(() => {
    let alive = true;
    getResourceAvailability(r.id, r.tenantId || undefined)
      .then(rows => { if (alive) setFetchedWindows(rows as AvailWindow[]); })
      .catch(() => { if (alive) setFetchedWindows(prev => prev ?? []); });
    return () => { alive = false; };
    // windowsProp in the deps: a leave save bumps the page-level availability
    // map, which flows down here as a new prop reference — refetching then
    // keeps an ALREADY-OPEN popup in sync immediately instead of pinning the
    // first (pre-save) fetch forever.
  }, [r.id, r.tenantId, windowsProp]);
  // Use freshly-fetched windows; fall back to the prop while the fetch is in
  // flight so the UI can still display any pre-loaded data immediately.
  const windows = fetchedWindows ?? windowsProp;

  // ── Engine weekly truth ─────────────────────────────────────────────────
  // The grid used to DERIVE weekly cell numbers client-side from raw
  // r.allAllocations rows (hours-win + per-week spread). That derivation is a
  // THIRD implementation of week bucketing: it disagreed with the server
  // engine on narrow cross-boundary rows and repainted from the racy
  // /resource-allocations feed, so a freshly saved cell could flash back to
  // a stale number seconds later (Aug 2026 flip-flop incident). Weekly
  // NUMBERS now come from /resource-week-allocations — the same per-week
  // source the save path verifies against and the Quick Actions planner
  // popup renders — so the popup displays exactly what saves read and write.
  // Allocation-derived math stays ONLY as a fallback while this fetch is
  // loading or failed (bars, spans and leave rows keep allocation entries by
  // design — they show ranges, not editable numbers).
  const engineFetchStartRef = useRef(0);
  const engineQ = useQuery({
    queryKey: [tenantScopedKey("staff-popup-week-engine"), r.id],
    enabled: Boolean(r.id),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: () => {
      // Stamped at FETCH START so the confirmed-edit prune below can tell
      // whether a completed fetch began after a given save was accepted.
      engineFetchStartRef.current = Date.now();
      const s = new Date(); s.setFullYear(s.getFullYear() - 2);
      const e = new Date(); e.setFullYear(e.getFullYear() + 3);
      return getResourceWeekAllocations(r.id, s.toISOString().slice(0, 10), e.toISOString().slice(0, 10));
    },
  });
  const engineRefetchRef = useRef(engineQ.refetch);
  engineRefetchRef.current = engineQ.refetch;
  useEffect(() => {
    const refresh = () => { void engineRefetchRef.current(); };
    // Fired by the shared save pipeline once a weekly write is verified —
    // exactly when a refetch will return post-save truth.
    window.addEventListener("rmone:allocationConfirmed", refresh);
    const unsubscribe = subscribeDataChanged(["allocation", "team"], refresh);
    return () => {
      window.removeEventListener("rmone:allocationConfirmed", refresh);
      unsubscribe();
    };
  }, []);

  // Accepted-but-not-yet-refetched saves. Written when the server ACCEPTS a
  // weekly write, dropped once an engine fetch that STARTED after the
  // acceptance lands — from then on the engine rows themselves carry the
  // saved number. Without this bridge a just-saved cell would flash the
  // pre-save engine value between acceptance and the refetch.
  const [confirmedWeekEdits, setConfirmedWeekEdits] = useState<Record<string, { hours: number; createdAt: number }>>({});
  const weekEditKey = (pid: string, weekIso: string) => `${(pid ?? "").trim().toLowerCase()}|${weekIso}`;
  const recordConfirmedWeek = useCallback((pid: string, weekIso: string, hours: number) => {
    if (typeof pid !== "string" || !pid.trim()) return; // no project identity — nothing to pin
    setConfirmedWeekEdits(current => ({
      ...current,
      [`${(pid ?? "").trim().toLowerCase()}|${weekIso}`]: { hours, createdAt: Date.now() },
    }));
  }, []);
  useEffect(() => {
    if (!engineQ.dataUpdatedAt) return;
    const fetchStartedAt = engineFetchStartRef.current;
    setConfirmedWeekEdits(current => {
      let changed = false;
      const next: typeof current = {};
      for (const [key, value] of Object.entries(current)) {
        if (value.createdAt < fetchStartedAt) changed = true;
        else next[key] = value;
      }
      return changed ? next : current;
    });
  }, [engineQ.dataUpdatedAt]);

  // Wrap the callers' savers so ACCEPTED weekly writes are recorded locally
  // no matter which editor fired them — a weekly cell, a coalesced batch, or
  // the Month editor. The chain records BEFORE the cell's own onAccepted
  // releases its local projection, so the resolved prop already shows the
  // saved number in the same render.
  const trackedSaveProjectWeek = useMemo(() => {
    if (!onSaveProjectWeek) return undefined;
    return (edit: ResourceProjectWeekEdit) =>
      onSaveProjectWeek({
        ...edit,
        onAccepted: () => {
          recordConfirmedWeek(edit.projectId, edit.week, edit.hours);
          edit.onAccepted?.();
        },
      });
  }, [onSaveProjectWeek, recordConfirmedWeek]);
  const trackedSaveProjectWeeks = useMemo(() => {
    if (!onSaveProjectWeeks) return undefined;
    return (edit: ResourceProjectWeeksEdit) =>
      onSaveProjectWeeks({
        ...edit,
        onAccepted: () => {
          for (const [weekIso, hours] of Object.entries(edit.weeks)) {
            recordConfirmedWeek(edit.projectId, weekIso, hours);
          }
          edit.onAccepted?.();
        },
      });
  }, [onSaveProjectWeeks, recordConfirmedWeek]);

  // Per-project week→hours lookup from the engine rows. Keys match the save
  // path: project ids compared case-insensitively, weeks by Monday ISO date.
  const engineWeekByProject = useMemo(() => {
    const byProject = new Map<string, Map<string, number>>();
    for (const row of engineQ.data?.weeks ?? []) {
      if (!inScope(row.projectId)) continue;
      const key = row.projectId.trim().toLowerCase();
      let inner = byProject.get(key);
      if (!inner) { inner = new Map(); byProject.set(key, inner); }
      inner.set(row.weekStart, (inner.get(row.weekStart) ?? 0) + row.hours);
    }
    return byProject;
  }, [engineQ.data, inScope]);
  // Projects whose allocation rows carry the LOCK flag (RA-level flags OR'd
  // per member — the same aggregation the Team grid FLAGS column shows).
  // Weekly cells on these projects are read-only UPFRONT: the shared save
  // contract client-side and the server (423 allocation_locked) both reject
  // hours edits while locked, so letting the user type only to bounce the
  // value back reads as a silent revert.
  const lockedProjectIds = useMemo(() => {
    const locked = new Set<string>();
    for (const row of engineQ.data?.weeks ?? []) {
      if (!inScope(row.projectId)) continue;
      if (row.isLocked && row.projectId) locked.add(row.projectId.trim().toLowerCase());
    }
    return locked;
  }, [engineQ.data, inScope]);
  const isoOfWs = (ws: number): string => {
    const d = new Date(ws);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  /** Engine hours for one project week; null = the engine can't answer
   *  (loading, error, or week outside the fetched range) → caller keeps the
   *  legacy allocation-derived number. Inside the range, no bucket = true 0. */
  const resolveWeekHours = (pid: string, ws: number): number | null => {
    // Some rows carry no project id at runtime (legacy/placeholder rows) — the
    // engine can't answer for them, so keep the legacy allocation-derived math.
    if (typeof pid !== "string" || !pid.trim()) return null;
    const iso = isoOfWs(ws);
    const confirmed = confirmedWeekEdits[weekEditKey(pid, iso)];
    if (confirmed) return confirmed.hours;
    const data = engineQ.data;
    if (!data) return null;
    if (iso < data.start || iso > data.end) return null;
    return engineWeekByProject.get(pid.trim().toLowerCase())?.get(iso) ?? 0;
  };
  /** Engine total booked hours for one week across ALL projects, with
   *  confirmed saves replacing that project's contribution; null = fall back. */
  const resolveWeekTotal = (ws: number): number | null => {
    const data = engineQ.data;
    if (!data) return null;
    const iso = isoOfWs(ws);
    if (iso < data.start || iso > data.end) return null;
    let total = 0;
    for (const inner of engineWeekByProject.values()) total += inner.get(iso) ?? 0;
    for (const [key, value] of Object.entries(confirmedWeekEdits)) {
      const [pidKey, weekIso] = key.split("|");
      if (weekIso !== iso) continue;
      total += value.hours - (engineWeekByProject.get(pidKey)?.get(iso) ?? 0);
    }
    return total;
  };

  // Rapid weekly edits must not fire one heavy save per cell. When the atomic
  // multi-week saver is available, coalesce: the first edit saves right away,
  // and cells edited while that save is in flight accumulate into ONE bulk
  // weekPatches save per project through the same shared backend contract.
  // Without the bulk saver (legacy callers), single-cell saves work as before.
  // r.id in the deps: a person switch gets a FRESH coalescer so no lane state
  // crosses members. The coalescer also keys lanes by person+project as a
  // second guard for saves still in flight across the switch.
  const coalescedSaveProjectWeek = useMemo(
    () => (trackedSaveProjectWeeks ? createWeeklyCellSaveCoalescer(trackedSaveProjectWeeks) : trackedSaveProjectWeek),
    [trackedSaveProjectWeek, trackedSaveProjectWeeks, r.id],
  );

  // Windows that are active today or start in the future — shown read-only in
  // the "Leave & availability" block. Past windows are dropped to keep it tidy.
  const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const upcomingLeave = (windows ?? [])
    .filter(w => {
      const e = parseLocalDay(w.endDate);
      return !isNaN(e) && e >= todayMs; // active or future
    })
    .slice()
    .sort((a, b) => parseLocalDay(a.startDate) - parseLocalDay(b.startDate));
  const activeProjects = Array.from(new Set(r.activeProjects)).filter(inScope);
  const allProjects = Array.from(new Set(r.allProjectIds || [])).filter(inScope).sort();
  const allocations = (r.activeAllocations || []).filter(a => inScope(a.projectId)).slice().sort((a, b) => b.pct - a.pct);
  const allAllocs: ActiveAllocationProxy[] = ((r.allAllocations as ActiveAllocationProxy[] | undefined) || [])
    .filter(a => inScope(a.projectId));
  // One workload view control drives both Capacity and Projects. Weekly is
  // deliberately the default so the exact editable Monday cells are visible.
  const [capView, setCapView] = useState<"weekly" | "monthly">("weekly");
  const [activeProjectWeekEdit, setActiveProjectWeekEdit] = useState<string | null>(null);
  const [activeProjectWeekSaves, setActiveProjectWeekSaves] = useState<Set<string>>(() => new Set());
  /** Last weekly-save failure — rendered as a banner above the workload grid
   *  so a rejected edit is NEVER a silent revert, wherever the failing cell
   *  sits in the horizontal scroll. */
  const [weekSaveError, setWeekSaveError] = useState<string | null>(null);
  /* Month-total editor target — a project row + window-month index. */
  const [monthEdit, setMonthEdit] = useState<{ rowKey: string; monthIdx: number } | null>(null);
  useEffect(() => {
    setCapView("weekly");
    setActiveProjectWeekEdit(null);
    setActiveProjectWeekSaves(new Set());
    setMonthEdit(null);
    setWeekSaveError(null);
  }, [r.id, initialProjectId]);

  const [phaseMap, setPhaseMap] = useState<ProjectPhaseMap | null>(null);
  useEffect(() => {
    let alive = true;
    loadProjectPhaseMap().then(m => { if (alive) setPhaseMap(m); });
    return () => { alive = false; };
  }, []);

  /* 6-month window, pageable one month per click; today sits in the 4th
     column at offset 0 (mockup layout) */
  const M = 6;
  const [mOff, setMOff] = useState(0);
  const nowD = new Date();
  const winStart = new Date(nowD.getFullYear(), nowD.getMonth() - 3 + mOff, 1);
  const months: Date[] = Array.from({ length: M }, (_, i) => new Date(winStart.getFullYear(), winStart.getMonth() + i, 1));
  const winEnd = new Date(winStart.getFullYear(), winStart.getMonth() + M, 1);
  const wsMs = winStart.getTime(), weMs = winEnd.getTime();
  const todayFrac = (Date.now() - wsMs) / (weMs - wsMs);

  const br = getBusinessRules();
  const bandOf = (p: number) =>
    p >= br.overCapacityPct ? UTIL_COLORS.over
    : p >= br.targetUtilizationPct ? UTIL_COLORS.good
    : UTIL_COLORS.under;

  /* Average weekly utilisation % per window month from allocation spans.
     Leave does NOT change the % (see the plain-formula block below) — it is
     surfaced separately via hatching, tags, and the conflict banner. */
  const DAY_MS = 86_400_000;
  /* DST-safe "day after": adding a flat 24h to a local midnight can land in
     the SAME local day across a spring-forward boundary — advance the local
     date instead. Used everywhere an INCLUSIVE leave end becomes exclusive. */
  const nextLocalDayMs = (ms: number) => { const d = new Date(ms); d.setDate(d.getDate() + 1); return d.getTime(); };
  const leaveEndExclusive = (endDate: string) => {
    const e = parseLocalDay(endDate);
    return isNaN(e) ? NaN : nextLocalDayMs(e);
  };

  /* Utilisation % — PLAIN formula (user-confirmed Aug 2026):
       % = booked hours ÷ configured work-week hours (Settings, default 40h).
     Leave and company holidays NEVER change the % — the bar answers "how
     booked is this person vs a standard week"; leave/holidays are separate
     signals (hatching, tags, tooltips, red conflict banner). The old
     capacity-scaled denominator turned 30h booked during a mostly-on-leave
     week into 375% — misleading, so it was removed entirely. */
  const wwHrs = br.workWeekHours || 40;

  /* Company holidays (tenant-wide): "YYYY-MM-DD" or "YYYY-MM-DD|Label". */
  const holidayList = (br.holidayDates ?? [])
    .map(h => {
      const [d, label] = h.split("|");
      return { ms: parseLocalDay(d), label: label || "Company holiday" };
    })
    .filter(h => !isNaN(h.ms));

  /* Booked hours for the Mon-start week [ws, weExcl) — engine truth first
     (same per-week source the save path verifies against), allocation-derived
     hours-win math only while the engine fetch is loading/failed, so the
     capacity strip, FTE footer and the editable cells all agree. */
  const weekBookedHrs = (ws: number, weExcl: number): number => {
    const engineTotal = resolveWeekTotal(ws);
    if (engineTotal !== null) return engineTotal;
    const inWeek = allAllocs.filter(a => {
      const s = parseLocalDay(a.startDate), en = parseLocalDay(a.endDate);
      return !isNaN(s) && !isNaN(en) && s < weExcl && en >= ws;
    });
    return hoursWinFilter(inWeek).reduce((t, a) => t + allocEntryHrsPerWeek(a, wwHrs), 0);
  };
  const weekLeaveOverlap = (ws: number, weExcl: number): boolean =>
    (windows ?? []).some(w => {
      const ls = parseLocalDay(w.startDate), le = leaveEndExclusive(w.endDate);
      return !isNaN(ls) && !isNaN(le) && ls < weExcl && le > ws;
    });

  /* Monthly capacity: average booked h/wk across the month's weeks. */
  const monthlyCap = months.map(m0 => {
    const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime();
    // Start from the first Monday that falls ON OR AFTER the 1st of the month.
    // mondayOf(m0) can land in the previous month (e.g. Oct 1 is Thu → Mon Sep 28).
    // Without this guard that lead-in week is double-counted: once under the
    // previous month AND once here, inflating the bar for months starting mid-week.
    const cursor = new Date(mondayOf(m0.getTime()));
    if (cursor.getTime() < m0.getTime()) cursor.setDate(cursor.getDate() + 7);
    let sum = 0, n = 0;
    while (cursor.getTime() < m1 && n < 7) {
      const ws = cursor.getTime();
      const weN = new Date(cursor); weN.setDate(weN.getDate() + 7);
      sum += weekBookedHrs(ws, weN.getTime());
      n++;
      cursor.setDate(cursor.getDate() + 7);
    }
    const avgHrs = n ? sum / n : 0;
    return {
      pct: Math.round((avgHrs / wwHrs) * 100),
      hrs: Math.round(avgHrs * 10) / 10,
      holidays: holidayList.filter(h => h.ms >= m0.getTime() && h.ms < m1),
    };
  });
  const monthlyPct = monthlyCap.map(c => c.pct);

  /* Weekly capacity: one bar per Mon-start week across the visible window. */
  const weeklyCap = (() => {
    const out: { ws: number; hrs: number; pct: number; hasLeave: boolean; holidays: { ms: number; label: string }[] }[] = [];
    const c = new Date(mondayOf(wsMs));
    let guard = 0;
    while (c.getTime() < weMs && guard < 60) {
      const ws = c.getTime();
      const weN = new Date(c); weN.setDate(weN.getDate() + 7);
      const weExcl = weN.getTime();
      const hrs = weekBookedHrs(ws, weExcl);
      out.push({
        ws,
        hrs: Math.round(hrs * 10) / 10,
        pct: Math.round((hrs / wwHrs) * 100),
        hasLeave: weekLeaveOverlap(ws, weExcl),
        holidays: holidayList.filter(h => h.ms >= ws && h.ms < weExcl),
      });
      c.setDate(c.getDate() + 7);
      guard++;
    }
    return out;
  })();
  const projectTimelineColumns = capView === "weekly"
    ? weeklyCap.map(week => ({ start: week.ws, label: new Date(week.ws).toLocaleDateString("en-US", { month: "short", day: "numeric" }) }))
    : months.map(month => ({ start: month.getTime(), label: month.toLocaleDateString("en-US", { month: "short", year: "numeric" }) }));
  const projectTimelineCount = projectTimelineColumns.length;
  const WEEKLY_VISIBLE_COLUMNS = 8;
  const projectTimelineWidth = capView === "weekly" && projectTimelineCount > WEEKLY_VISIBLE_COLUMNS
    ? `${(projectTimelineCount / WEEKLY_VISIBLE_COLUMNS) * 100}%`
    : "100%";
  const projectTimelineScrollRef = useRef<HTMLDivElement>(null);
  // The browser puts a native horizontal scrollbar beneath the LAST project
  // row. Keep a second, synchronized rail beside the week headers so users
  // never have to scroll down through a long project list just to move weeks.
  const projectTimelineTopScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollSyncing = useRef(false);
  const todayWeekIndex = weeklyCap.findIndex(week => week.ws === mondayOf(Date.now()));

  // A person/project popup should open on the current Monday week, not at the
  // beginning of the six-month range. Keep several surrounding weeks visible
  // so users can immediately compare and edit adjacent allocations.
  useEffect(() => {
    if (capView !== "weekly" || todayWeekIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const timeline = projectTimelineScrollRef.current;
      if (!timeline || timeline.scrollWidth <= timeline.clientWidth) return;
      const columnWidth = timeline.scrollWidth / projectTimelineCount;
      const targetLeft = todayWeekIndex * columnWidth - (timeline.clientWidth - columnWidth) / 2;
      timeline.scrollLeft = Math.max(0, Math.min(targetLeft, timeline.scrollWidth - timeline.clientWidth));
      if (projectTimelineTopScrollRef.current) {
        projectTimelineTopScrollRef.current.scrollLeft = timeline.scrollLeft;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [r.id, initialProjectId, capView, projectTimelineCount, todayWeekIndex]);

  /* Gantt rows per mode */
  const activeSet = new Set(activeProjects);
  const pctByPid = new Map<string, number>();
  for (const a of allocations) pctByPid.set(a.projectId, (pctByPid.get(a.projectId) || 0) + (a.pct || 0));
  const spanOf = (pid: string) => {
    let s = Infinity, e = -Infinity;
    const fullEntries = allAllocs.filter(a => a.projectId === pid);
    const sourceEntries = fullEntries.length > 0 ? fullEntries : allocations.filter(a => a.projectId === pid);
    for (const a of sourceEntries) {
      const as = parseLocalDay(a.startDate), ae = parseLocalDay(a.endDate);
      if (!isNaN(as)) s = Math.min(s, as);
      if (!isNaN(ae)) e = Math.max(e, ae);
    }
    return { s, e };
  };
  // A project can have several source allocation rows (for example, one
  // percentage-plan row plus a real-hours row). Any project-level weekly edit
  // must show their hours-win total, never a partial source row.
  const completeProjectEntries = (pid: string): ActiveAllocationProxy[] => {
    const fullEntries = allAllocs.filter(a => a.projectId === pid);
    return fullEntries.length > 0 ? fullEntries : allocations.filter(a => a.projectId === pid);
  };
  type GRow = {
    key: string;
    pid: string;
    module?: "PMM" | "OPM" | "LEM";
    pct: number;
    startMs: number;
    endMs: number;
    isActive: boolean;
    entries: ActiveAllocationProxy[];
  };
  const rowsLive: GRow[] = mode === "allocation"
    ? Array.from(new Set(allocations.map(a => a.projectId))).map(pid => {
        const entries = completeProjectEntries(pid);
        const sp = entries.length > 0 ? spanOf(pid) : { s: Infinity, e: -Infinity };
        return {
          key: pid, pid, module: entries.find(entry => entry.module)?.module,
          pct: Math.round((pctByPid.get(pid) || 0) * 100) / 100,
          startMs: sp.s, endMs: sp.e, isActive: true, entries,
        };
      })
    : (mode === "all" ? allProjects : activeProjects).map(pid => {
        const entries = completeProjectEntries(pid);
        const sp = spanOf(pid);
        return {
          key: pid, pid, module: entries.find(entry => entry.module)?.module,
          pct: Math.round((pctByPid.get(pid) || 0) * 100) / 100,
          startMs: sp.s, endMs: sp.e, isActive: activeSet.has(pid), entries,
        };
      });

  /* While a weekly hours cell is actively being edited, freeze the row list.
     The post-save fresh refetch (and any background allocation refresh) can
     momentarily reshape `allocations` — in the worst case dropping a project
     row entirely — which would UNMOUNT the in-progress editor, discard the
     user's draft, and let the remounted input's autoFocus steal focus so
     stray keystrokes blur-commit into the wrong week (the Aug 2026 hours
     corruption incident). Freezing row identity + entries for the duration
     of one cell edit makes that impossible; the edit's own cell paints its
     draft/optimistic value locally, and the freeze lifts the moment editing
     ends, letting the fresh data (with accepted-week overrides) repaint. */
  const frozenRowsRef = useRef<GRow[] | null>(null);
  const anyCellEditActive =
    activeProjectWeekEdit !== null || activeProjectWeekSaves.size > 0 || monthEdit !== null;
  if (!anyCellEditActive) {
    frozenRowsRef.current = null;
  } else if (frozenRowsRef.current === null) {
    frozenRowsRef.current = rowsLive;
  }
  const rows: GRow[] = frozenRowsRef.current ?? rowsLive;

  /* Leave-conflict detection: allocation entries that overlap an active or
     upcoming leave window (reduced availability). Powers the warning banner,
     the pulsing red bar outlines, and the per-row "on leave" badges — a
     person on leave with hours still booked needs a REDUCE/REASSIGN nudge,
     not a silently unchanged Gantt.
     Hours are computed PER WEEK (hoursWinFilter is only valid inside one
     week bucket — summing across weeks double-counts multi-week rows); each
     row reports its PEAK conflicted week within the leave. */
  const conflictByRow = new Map<string, { hrs: number; win: AvailWindow }>();
  for (const row of rows) {
    let best: { hrs: number; win: AvailWindow } | null = null;
    for (const w of upcomingLeave) {
      if ((w.availabilityPct ?? 100) >= 100) continue;
      const ls = parseLocalDay(w.startDate);
      const leEx = leaveEndExclusive(w.endDate);
      if (isNaN(ls) || isNaN(leEx)) continue;
      const cursor = new Date(mondayOf(ls));
      let guard = 0;
      while (cursor.getTime() < leEx && guard < 106) { // hard cap ≈ 2 years
        const ws = cursor.getTime();
        const weN = new Date(cursor); weN.setDate(weN.getDate() + 7);
        const we = weN.getTime() - 1;
        const inWeek = row.entries.filter(a => {
          const s = parseLocalDay(a.startDate), en = parseLocalDay(a.endDate);
          return !isNaN(s) && !isNaN(en) && s <= we && en >= ws;
        });
        const hrs = hoursWinFilter(inWeek).reduce((t, a) => t + allocEntryHrsPerWeek(a, getBusinessRules().workWeekHours), 0);
        if (hrs > 0 && (!best || hrs > best.hrs)) best = { hrs: Math.round(hrs * 10) / 10, win: w };
        cursor.setDate(cursor.getDate() + 7);
        guard++;
      }
    }
    if (best) conflictByRow.set(row.key, best);
  }
  /* The banner names the leave window behind the WORST conflict — never an
     unrelated window that happens to sort first. */
  const worstConflict = Array.from(conflictByRow.values()).sort((a, b) => b.hrs - a.hrs)[0] ?? null;

  /* Leave windows visible in the current 6-month window — rendered as their
     OWN rows in the Gantt (type + hours off per week), separate from the
     project assignments. */
  const LEAVE_ROW_H = 40;
  const leaveRows = (windows ?? [])
    .filter(w => {
      const ls = parseLocalDay(w.startDate), le = leaveEndExclusive(w.endDate);
      return !isNaN(ls) && !isNaN(le) && le > wsMs && ls < weMs;
    })
    .slice()
    .sort((a, b) => parseLocalDay(a.startDate) - parseLocalDay(b.startDate));

  /* Average weekly hours per window month for a row's allocation entries —
     the client reference shows HOURS inside the bars, not percentages. */
  const rowMonthHrs = (entries: ActiveAllocationProxy[], pid: string) => months.map(m0 => {
    const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime();
    // Same lead-in guard as monthlyPct: skip the Monday that belongs to the
    // previous month so weeks are never double-counted across month boundaries.
    const cursor = new Date(mondayOf(m0.getTime()));
    if (cursor.getTime() < m0.getTime()) cursor.setDate(cursor.getDate() + 7);
    let sum = 0, n = 0;
    while (cursor.getTime() < m1 && n < 7) {
      const ws = cursor.getTime();
      // Engine truth first — same source as the weekly cells, so the monthly
      // bars aggregate exactly the numbers the weekly view edits.
      const engineWk = resolveWeekHours(pid, ws);
      let wk: number;
      if (engineWk !== null) {
        wk = engineWk;
      } else {
        const weN = new Date(cursor); weN.setDate(weN.getDate() + 7);
        const we = weN.getTime() - 1;
        const inWeek = entries.filter(a => {
          const s = parseLocalDay(a.startDate), en = parseLocalDay(a.endDate);
          return !isNaN(s) && !isNaN(en) && s <= we && en >= ws;
        });
        // hours-win: real hours replace the %-plan for this week, never add.
        wk = hoursWinFilter(inWeek).reduce((t, a) => t + allocEntryHrsPerWeek(a, getBusinessRules().workWeekHours), 0);
      }
      sum += wk; n++;
      cursor.setDate(cursor.getDate() + 7);
    }
    return n ? Math.round((sum / n) * 10) / 10 : 0;
  });

  /* Mon-start weeks of one window month for the Month editor — the SAME
     attribution as rowMonthHrs/monthlyCap (first Monday on/after the 1st,
     boundary weeks never double-counted), plus each week's current hours and
     past-week lock state. What you edit is exactly what the bar aggregated. */
  const monthWeekSlots = (entries: ActiveAllocationProxy[], monthIdx: number, pid: string): MonthWeekSlot[] => {
    const m0 = months[monthIdx];
    if (!m0) return [];
    const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime();
    const cursor = new Date(mondayOf(m0.getTime()));
    if (cursor.getTime() < m0.getTime()) cursor.setDate(cursor.getDate() + 7);
    const out: MonthWeekSlot[] = [];
    let n = 0;
    while (cursor.getTime() < m1 && n < 7) {
      const ws = cursor.getTime();
      const engineWk = resolveWeekHours(pid, ws);
      let hrs: number;
      if (engineWk !== null) {
        hrs = engineWk;
      } else {
        const weN = new Date(cursor); weN.setDate(weN.getDate() + 7);
        const we = weN.getTime() - 1;
        const inWeek = entries.filter(a => {
          const s = parseLocalDay(a.startDate), en = parseLocalDay(a.endDate);
          return !isNaN(s) && !isNaN(en) && s <= we && en >= ws;
        });
        hrs = hoursWinFilter(inWeek).reduce((t, a) => t + allocEntryHrsPerWeek(a, wwHrs), 0);
      }
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      out.push({
        iso,
        hours: Math.round(hrs * 10) / 10,
        locked: getPastWeekEditStateFor(iso, pid.split("-")[0]).locked,
      });
      n++;
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  };

  const scopeOwnerLabel = scopeOwnerName?.trim() || "the selected manager";
  const heading =
    mode === "all" ? (scopeKeys ? "Shared Projects" : "All Projects") :
    mode === "allocation" ? "Allocation Breakdown" :
    "Active Projects";
  const subtitle =
    mode === "all" ? `${allProjects.length} project${allProjects.length === 1 ? "" : "s"} · ${scopeKeys ? `shared with ${scopeOwnerLabel}` : "full history"}` :
    mode === "allocation" ? `${r.currentPct}% total across ${allocations.length} active assignment${allocations.length === 1 ? "" : "s"}` :
    `${activeProjects.length} project${activeProjects.length === 1 ? "" : "s"} currently in flight`;

  const handleProjectRow = (_pid: string) => {
    setActiveProjectWeekEdit(null);
    setCapView("weekly");
  };

  /* Month cells edit in place whenever the viewer can edit hours AND the
     bulk weekly save path is wired (onSaveProjectWeeks). Shared by the value
     labels, the narrow-bar fallback and the full-cell month click targets. */
  const monthEditable = canEditHours && Boolean(onSaveProjectWeeks);

  const rangeLabel = `${months[0].toLocaleDateString("en-US", { month: "short" })}${months[0].getFullYear() !== months[M - 1].getFullYear() ? ` ${months[0].getFullYear()}` : ""} – ${months[M - 1].toLocaleDateString("en-US", { month: "short" })} ${months[M - 1].getFullYear()}`;
  const DAY = 24 * 3600 * 1000;
  const ROW_H = 56;
  const projectHeaderH = capView === "weekly" ? 46 : 36;

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, backgroundColor: "rgba(15,25,35,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: Z.POPUP, padding: 16,
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#FFFFFF", color: "#253746", border: "1px solid #e2e8f0",
          borderRadius: 12, maxWidth: 920, width: "100%", maxHeight: "88vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}>
        {/* Blink/pulse for leave-vs-allocation conflicts (banner + bars). */}
        <style>{`@keyframes leavePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); } 50% { box-shadow: 0 0 0 5px rgba(220,38,38,0); } }`}</style>

        {/* ── HEADER ── */}
        <div style={{ background: "#f8fafc", padding: "9px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: status.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
            {initialsOf(r.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#1e293b", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
            <div style={{ color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.role ? `${r.role} · ` : ""}{heading} · {subtitle}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 8px", display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setMOff(o => o - 1)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}
              ><ChevronLeft size={14} color="#94a3b8" /></button>
              <span style={{ color: "#475569", fontSize: 12, minWidth: 110, textAlign: "center" }}>{rangeLabel}</span>
              <button onClick={() => setMOff(o => o + 1)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex" }}
              ><ChevronRight size={14} color="#94a3b8" /></button>
            </div>
            <button onClick={onClose} aria-label="Close"
              style={{ width: 30, height: 30, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={14} color="#94a3b8" />
            </button>
          </div>
        </div>

        {/* ── COMPACT UTILIZATION STRIP ── */}
        <div style={{ padding: "7px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flexShrink: 0, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8 }}>Utilization</div>
            <div style={{ display: "flex", gap: 13 }}>
              {([["Under", UTIL_COLORS.under], ["Good", UTIL_COLORS.good], ["Over", UTIL_COLORS.over]] as const).map(([lbl, c]) => (
                <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: c.bg, border: "1px solid rgba(0,0,0,0.08)", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#475569", fontWeight: 700 }}>{lbl}</span>
                </div>
              ))}
            </div>
          </div>
          {upcomingLeave.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, borderLeft: "1px solid #e2e8f0", paddingLeft: 16 }}>
              <Calendar size={13} color="#DC2626" style={{ flexShrink: 0 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                {upcomingLeave.map((w, i) => {
                  const isOut = w.availabilityPct === 0;
                  return (
                    <div key={`${w.startDate}-${w.endDate}-${i}`} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: "#334155", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {fmtAvailRange(w.startDate, w.endDate)}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: isOut ? "#FEE2E2" : "#FFF7ED", color: isOut ? "#B91C1C" : "#C2410C", whiteSpace: "nowrap" }}>
                        {availPctLabel(w.availabilityPct)}
                      </span>
                      {w.leaveType && (
                        <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "#FDE9D9", color: "#B45309", whiteSpace: "nowrap" }}>
                          {w.leaveType}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {conflictByRow.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, borderLeft: "1px solid #fecaca", paddingLeft: 14, color: "#B91C1C" }}>
              <AlertTriangle size={14} color="#DC2626" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 10.5, fontWeight: 800, lineHeight: 1.25 }}>
                ≈{worstConflict?.hrs ?? 0}h/week remains allocated during leave — reduce or reassign
              </span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "9px 20px 12px" }}>

          {/* ── PROJECT GANTT ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "4px 0 8px" }}>
            <div>
              <div style={{ color: "#253746", fontSize: 12, fontWeight: 800 }}>Projects</div>
              <div style={{ color: "#94a3b8", fontSize: 9.5 }}>
                {capView === "weekly" ? "8 weeks at a time · scroll horizontally to see more · click one Monday cell to edit" : monthEditable ? "Monthly overview · click any month cell to edit that month's total hours" : "Monthly overview · switch Projects to Weekly to edit hours"}
              </div>
            </div>
            <div aria-label="Workload timeline view" role="group" style={{ display: "inline-flex", flexShrink: 0, background: "#f1f5f9", borderRadius: 6, padding: 2, gap: 2 }}>
              {(["weekly", "monthly"] as const).map(v => (
                <button key={v} type="button" aria-pressed={capView === v} onClick={() => {
                  setActiveProjectWeekEdit(null);
                  setCapView(v);
                }} style={{
                  border: "none", cursor: "pointer", borderRadius: 5,
                  padding: "3px 10px", fontSize: 10.5, fontWeight: 700,
                  background: capView === v ? "#FFFFFF" : "transparent",
                  color: capView === v ? "#1e293b" : "#64748b",
                  boxShadow: capView === v ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
                }}>{v === "weekly" ? "Weekly" : "Monthly"}</button>
              ))}
            </div>
          </div>
          {weekSaveError && (
            <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "0 0 8px", padding: "7px 10px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
              <AlertTriangle size={13} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ flex: 1, minWidth: 0, color: "#B91C1C", fontSize: 11, fontWeight: 700, lineHeight: 1.35 }}>
                {weekSaveError}
              </span>
              <button
                type="button"
                aria-label="Dismiss save error"
                onClick={() => setWeekSaveError(null)}
                style={{ border: "none", background: "transparent", color: "#B91C1C", cursor: "pointer", fontSize: 13, fontWeight: 900, lineHeight: 1, padding: "0 2px" }}
              >
                ×
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <div style={{ padding: "16px 12px", borderRadius: 10, backgroundColor: "#F5F7FA", fontSize: 13, color: "#6B7E8A", textAlign: "center" }}>
              {mode === "all"
                ? (scopeKeys
                    ? `No records shared with ${scopeOwnerLabel} — this person's hours are on other records.`
                    : "No project history found.")
                : mode === "allocation" ? "No active allocations — currently on bench." : "No active project assignments — currently on bench."}
            </div>
          ) : (
            <div style={{ display: "flex" }}>
              {/* LEFT: project labels */}
              <div style={{ width: 286, flexShrink: 0, borderRight: "1px solid #e2e8f0" }}>
                <div style={{ height: projectHeaderH, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", paddingLeft: 8 }}>
                  <span style={{ color: "#94a3b8", fontSize: 10, fontWeight: 600 }}>PROJECT</span>
                </div>
                {rows.map(row => {
                  const rowLocked = typeof row.pid === "string" && lockedProjectIds.has(row.pid.trim().toLowerCase());
                  const phMs = isFinite(row.startMs) && isFinite(row.endMs)
                    ? Math.min(Math.max(Date.now(), row.startMs), row.endMs)
                    : Date.now();
                  const ph = phaseMap ? projectPhaseColor(phaseMap, row.pid, phMs) : null;
                  const lead = isLeadProject(row.module, row.pid);
                  const phaseLabel = ph
                    ? projectPhaseDisplayName(row.module, row.pid, ph.phaseName)
                    : lead ? "Lead" : "";
                  const phaseColor = lead ? PHASE_COLORS["Lead"] : ph?.color;
                  return (
                    <div key={row.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleProjectRow(row.pid)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleProjectRow(row.pid);
                        }
                      }}
                      title={rowLocked ? "Allocation locked — hours are read-only until it's unlocked from this project's Team grid FLAGS column" : "Open this project in the aligned Weekly timeline"}
                       style={{ height: ROW_H, borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", paddingRight: 8, paddingLeft: 8, gap: 6, cursor: "pointer" }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: phaseColor?.bg ?? "#cbd5e0", border: phaseColor?.outline ? `1px solid ${phaseColor.outline}` : "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
                       <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                        <div style={{ color: "#94a3b8", fontSize: 10 }}>{row.pid}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, maxWidth: 230 }}>
                          {rowLocked && (
                            <span title="Allocation locked — unlock from the project's Team grid FLAGS column to edit hours" style={{ display: "inline-flex", flexShrink: 0 }}>
                              <Lock size={10} color="#B45309" strokeWidth={2.75} aria-label="Allocation locked" />
                            </span>
                          )}
                          <div style={{ color: "#1e293b", fontSize: 12, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pName(row.pid)}</div>
                        </div>
                        {/* Phase chip + leave warning share ONE line — stacking
                            them overflowed the fixed row height and the text
                            bled into the row below. */}
                        {(phaseLabel || conflictByRow.has(row.key)) && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 }}>
                            {phaseLabel && phaseColor && (
                              <div style={{ background: phaseColor.bg, border: phaseColor.outline ? `1px solid ${phaseColor.outline}` : "none", color: phaseColor.text, fontSize: 9, padding: "1px 6px", borderRadius: 8, fontWeight: 700, maxWidth: conflictByRow.has(row.key) ? 88 : 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={lead ? "Lead record" : ph?.phaseName}>{phaseLabel}</div>
                            )}
                            {conflictByRow.has(row.key) && (
                              <span title={`On leave · ${conflictByRow.get(row.key)!.hrs}h/wk still booked`} style={{ display: "inline-flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                                <AlertTriangle size={9} color="#DC2626" style={{ flexShrink: 0 }} />
                                <span style={{ fontSize: 9, color: "#DC2626", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  On leave · {conflictByRow.get(row.key)!.hrs}h/wk
                                </span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                       <button
                         type="button"
                         title={`Open ${pName(row.pid)} Project Team`}
                         aria-label={`Open ${pName(row.pid)} Project Team`}
                         onClick={(event) => {
                           event.stopPropagation();
                           onClose();
                            onProjectClick(row.pid, row.module);
                         }}
                         style={{
                           display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                           padding: "4px 5px", borderRadius: 5, border: "1px solid #cbd5e1",
                           background: "#fff", color: "#2563eb", fontSize: 9, fontWeight: 800, cursor: "pointer",
                         }}
                       >
                         Team <ExternalLink size={10} />
                       </button>
                    </div>
                  );
                })}
                {/* Dedicated LEAVE rows: type + period, matched 1:1 with the
                    hatched bars on the timeline side. */}
                {leaveRows.map((w, i) => (
                  <div key={`lv-${i}`} style={{ height: LEAVE_ROW_H, borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", paddingRight: 12, paddingLeft: 8, gap: 6, background: "#FFFBF5", overflow: "hidden" }}>
                    <Calendar size={12} color="#E87722" style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0, overflow: "hidden" }}>
                      <div style={{ color: "#B45309", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        Leave{w.leaveType ? ` · ${w.leaveType}` : ""}
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {fmtAvailRange(w.startDate, w.endDate)} · {availPctLabel(w.availabilityPct)}
                      </div>
                    </div>
                  </div>
                ))}
                {/* Allocated Demand footer label (client reference) */}
                <div style={{ height: 28, display: "flex", alignItems: "center", paddingLeft: 8, borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <span style={{ color: "#64748b", fontSize: 9.5, fontWeight: 700 }}>Allocated Demand (FTE)</span>
                </div>
              </div>

              {/* RIGHT: timeline. NO overflow:hidden here — an overflow ancestor
                  would become the sticky scrollport and the pinned week
                  scroller below would never stick to the popup body. minWidth:0
                  alone contains the wide timeline (the child scroller clips). */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                {capView === "weekly" && (
                  <div
                    ref={projectTimelineTopScrollRef}
                    aria-label="Scroll timeline weeks"
                    onScroll={(event) => {
                      if (timelineScrollSyncing.current) return;
                      const body = projectTimelineScrollRef.current;
                      if (!body) return;
                      timelineScrollSyncing.current = true;
                      body.scrollLeft = event.currentTarget.scrollLeft;
                      requestAnimationFrame(() => { timelineScrollSyncing.current = false; });
                    }}
                    // sticky: the week scroller stays pinned at the top of the
                    // popup while the long project list scrolls underneath —
                    // users never scroll to the very bottom just to move the
                    // weeks sideways.
                    style={{ height: 14, overflowX: "auto", overflowY: "hidden", flexShrink: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 10 }}
                  >
                    <div style={{ width: projectTimelineWidth, minWidth: projectTimelineWidth, height: 1 }} />
                  </div>
                )}
              <div ref={projectTimelineScrollRef}
                onScroll={(event) => {
                  if (timelineScrollSyncing.current) return;
                  const top = projectTimelineTopScrollRef.current;
                  if (!top) return;
                  timelineScrollSyncing.current = true;
                  top.scrollLeft = event.currentTarget.scrollLeft;
                  requestAnimationFrame(() => { timelineScrollSyncing.current = false; });
                }}
                style={{ flex: 1, minWidth: 0, overflowX: capView === "weekly" ? "auto" : "hidden", overflowY: "hidden" }}>
                <div style={{ position: "relative", width: projectTimelineWidth, minWidth: projectTimelineWidth }}>
                {/* Project timeline headers follow the selected workload view. */}
                <div style={{ display: "flex", height: projectHeaderH, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  {projectTimelineColumns.map((column, i) => {
                    const utilization = capView === "weekly" ? weeklyCap[i] : monthlyCap[i];
                    const pct = utilization?.pct ?? null;
                    const pctColor = pct === null ? "#94a3b8" : bandOf(pct).bg;
                    // Over- AND under-allocated weeks get an unmissable header:
                    // solid legend color (Over = orange, Under = red) + the
                    // exact hours to shave off / add to get back to a full
                    // (100%) week. Same band boundaries as bandOf so the
                    // header always agrees with the legend and the % text.
                    const isOver = capView === "weekly" && pct !== null && pct >= br.overCapacityPct;
                    const isUnder = capView === "weekly" && pct !== null && !isOver && pct < br.targetUtilizationPct;
                    const reduceBy = isOver && utilization ? Math.max(0, Math.round((utilization.hrs - wwHrs) * 10) / 10) : 0;
                    const addBy = isUnder && utilization ? Math.max(0, Math.round((wwHrs - utilization.hrs) * 10) / 10) : 0;
                    const banded = isOver || isUnder;
                    return (
                      <div key={column.start} title={pct === null ? undefined : isOver ? `${column.label} · ${pct}% — over-allocated, reduce by ${reduceBy}h to reach 100%` : isUnder ? `${column.label} · ${pct}% — under-utilized, add ${addBy}h to reach 100%` : `${column.label} · ${pct}% utilization`} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: banded ? "#fff" : "#64748b", fontSize: capView === "weekly" ? 8 : 10, fontWeight: 600, borderRight: "1px solid #e2e8f0", whiteSpace: "nowrap", overflow: "hidden", background: isOver ? UTIL_COLORS.over.bg : isUnder ? UTIL_COLORS.under.bg : undefined }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{column.label}</span>
                        {pct !== null && (
                          <span style={{ color: banded ? "#fff" : pctColor, fontSize: capView === "weekly" ? 9 : 9.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                            {pct}%
                          </span>
                        )}
                        {isOver && reduceBy > 0 && (
                          <span style={{ color: "#fff", fontSize: 8, fontWeight: 800 }}>
                            reduce {reduceBy}h
                          </span>
                        )}
                        {isUnder && addBy > 0 && (
                          <span style={{ color: "#fff", fontSize: 8, fontWeight: 800 }}>
                            add {addBy}h
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Rows */}
                {rows.map(row => {
                  const rowLocked = typeof row.pid === "string" && lockedProjectIds.has(row.pid.trim().toLowerCase());
                  const hasSpan = isFinite(row.startMs) && isFinite(row.endMs) && row.endMs >= row.startMs;
                  const bs = hasSpan ? Math.max(row.startMs, wsMs) : NaN;
                  const be = hasSpan ? Math.min(row.endMs + DAY, weMs) : NaN;
                  const visible = hasSpan && be > bs;
                  const leftPct = visible ? ((bs - wsMs) / (weMs - wsMs)) * 100 : 0;
                  const widthPct = visible ? ((be - bs) / (weMs - wsMs)) * 100 : 0;
                  const phMs = hasSpan ? Math.min(Math.max(Date.now(), row.startMs), row.endMs) : Date.now();
                  const ph = phaseMap ? projectPhaseColor(phaseMap, row.pid, phMs) : null;
                  const lead = isLeadProject(row.module, row.pid);
                  const phaseLabel = ph
                    ? projectPhaseDisplayName(row.module, row.pid, ph.phaseName)
                    : lead ? "Lead" : "";
                  const phaseColor = lead ? PHASE_COLORS["Lead"] : ph?.color;
                  const bg = phaseColor?.bg ?? "#cbd5e0";
                  const txt = phaseColor?.text ?? "#1e293b";
                  const conflict = conflictByRow.get(row.key);
                  const barLabel = conflict
                    ? `⚠ ${r.name} is on leave ${fmtAvailRange(conflict.win.startDate, conflict.win.endDate)}${conflict.win.leaveType ? ` (${conflict.win.leaveType})` : ""} but ≈${conflict.hrs}h/week is still allocated here — reduce or reassign`
                    : row.pct > 0 && phaseLabel ? `${row.pct}% · ${phaseLabel}` : phaseLabel || (row.pct > 0 ? `${row.pct}%` : "");
                  const monthHrs = visible ? rowMonthHrs(row.entries, row.pid) : [];
                  return (
                    <div key={row.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleProjectRow(row.pid)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleProjectRow(row.pid);
                        }
                      }}
                      title={capView === "weekly" ? "Weekly project hours" : monthEditable ? "Click any month cell to edit that month's total hours" : "Change the Workload view to Weekly to edit hours"}
                      style={{ height: ROW_H, position: "relative", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", cursor: "pointer" }}>
                      {projectTimelineColumns.map((column, i) => (
                        <div key={column.start} style={
                          // Over-allocated week → tint the ENTIRE column in
                          // the "Over" color (soft alpha of #F9AB33) so the
                          // problem weeks read at a glance; other columns
                          // keep the plain 1px grid line.
                          capView === "weekly" && (weeklyCap[i]?.pct ?? 0) >= br.overCapacityPct
                            ? { position: "absolute", left: `${(i / projectTimelineCount) * 100}%`, top: 0, bottom: 0, width: `${100 / projectTimelineCount}%`, background: "rgba(249,171,51,0.16)", borderLeft: "1px solid #f1f5f9" }
                            : { position: "absolute", left: `${(i / projectTimelineCount) * 100}%`, top: 0, bottom: 0, width: 1, background: "#f1f5f9" }
                        } />
                      ))}
                      {todayFrac >= 0 && todayFrac <= 1 && (
                        // pointerEvents none: the 2px marker must never swallow
                        // a click meant for the cell underneath it.
                        <div style={{ position: "absolute", left: `${todayFrac * 100}%`, top: 0, bottom: 0, width: 2, background: "#FF5757", zIndex: 5, pointerEvents: "none" }} />
                      )}
                      {capView === "weekly" ? (
                        <>
                          {weeklyCap.map((week, i) => {
                            const cellKey = `${row.pid}:${week.ws}`;
                            const weekEnd = new Date(week.ws);
                            weekEnd.setDate(weekEnd.getDate() + 7);
                            const inWeek = row.entries.filter(entry => {
                              const start = parseLocalDay(entry.startDate);
                              const end = parseLocalDay(entry.endDate);
                              return !isNaN(start) && !isNaN(end) && start < weekEnd.getTime() && end >= week.ws;
                            });
                            // Always render a cell for EVERY week column, even
                            // when no allocation entry spans it (weekHours
                            // computes to 0). Skipping empty weeks (the old
                            // `inWeek.length === 0 → null` gate) caused three
                            // compounding bugs: (1) a week whose hours were
                            // zeroed rendered as an unclickable white gap the
                            // user could never edit again; (2) a refetch that
                            // momentarily dropped an entry UNMOUNTED the cell
                            // mid-edit, losing the draft; (3) the remount
                            // re-fired autoFocus and stole focus, so stray
                            // keystrokes committed partial drafts into the
                            // wrong weeks (real data corruption incident,
                            // Aug 2026). A missing row means 0 hours — render
                            // it as an editable 0 like the Team card grid.
                            // Engine truth first: the same per-week numbers
                            // the save path verifies against. The hours-win
                            // derivation from allocation entries survives
                            // only as a fallback while the engine fetch is
                            // loading/failed.
                            const engineHours = resolveWeekHours(row.pid, week.ws);
                            const weekHours = engineHours !== null
                              ? Math.round(engineHours * 10) / 10
                              : Math.round(
                                  hoursWinFilter(inWeek)
                                    .reduce((total, entry) => total + allocEntryHrsPerWeek(entry, wwHrs), 0) * 10,
                                ) / 10;
                            return (
                              <div
                                key={week.ws}
                                style={{
                                  position: "absolute",
                                  left: `calc(${(i / projectTimelineCount) * 100}% + 1px)`,
                                  width: `calc(${100 / projectTimelineCount}% - 2px)`,
                                  top: 13,
                                  zIndex: 4,
                                }}
                              >
                                <ProjectGanttWeekCell
                                  r={r}
                                  projectId={row.pid}
                                  projectName={pName(row.pid)}
                                  weekStart={week.ws}
                                  hours={weekHours}
                                  color={bg}
                                  outline={conflict ? "#DC2626" : ph?.color.outline}
                                  canEditHours={canEditHours}
                                  editing={activeProjectWeekEdit === cellKey}
                                  saveInFlight={activeProjectWeekSaves.has(cellKey)}
                                  onEditingChange={nextEditing => {
                                    if (nextEditing) setWeekSaveError(null);
                                    setActiveProjectWeekEdit(current =>
                                      nextEditing ? cellKey : current === cellKey ? null : current,
                                    );
                                  }}
                                  onSavingChange={saving => {
                                    setActiveProjectWeekSaves(current => {
                                      const next = new Set(current);
                                      if (saving) next.add(cellKey);
                                      else next.delete(cellKey);
                                      return next;
                                    });
                                  }}
                                  onSaveProjectWeek={coalescedSaveProjectWeek}
                                  allocationLocked={rowLocked}
                                  onSaveError={setWeekSaveError}
                                />
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <>
                          {/* Month-cell click targets: with edit rights EVERY
                              month column opens the month-total editor — blank
                              cells outside the bar span and rows whose dates
                              are out of window or missing included — matching
                              Weekly, where every week cell is editable. z 3
                              sits above the bar (2) and leave hatch (1) but
                              below the value labels (4), which keep their own
                              identical click handling. Without these, blank
                              cells fell through to the row handler and
                              silently switched the view to Weekly. */}
                          {monthEditable && months.map((mcell, mi) => {
                            const mLabel = mcell.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                            return (
                              <div
                                key={`mcell-${mi}`}
                                // div[role=button] like WhyInfo — the row is
                                // itself role=button, so never nest REAL
                                // buttons. Enter/Space opens the editor and
                                // must not bubble into the row's
                                // switch-to-Weekly keyboard handler.
                                role="button"
                                tabIndex={0}
                                aria-label={`Edit ${pName(row.pid)} total hours for ${mLabel}`}
                                title={`${mLabel} · click to edit this month's total hours`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setMonthEdit({ rowKey: row.key, monthIdx: mi });
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setMonthEdit({ rowKey: row.key, monthIdx: mi });
                                  }
                                }}
                                style={{ position: "absolute", left: `${(mi / M) * 100}%`, width: `${100 / M}%`, top: 0, bottom: 0, zIndex: 3, cursor: "pointer" }}
                              />
                            );
                          })}
                          {visible ? (
                        <>
                          <div
                           title={`${barLabel} · Switch Projects to Weekly to edit exact hours`}
                           onClick={(event) => {
                             event.stopPropagation();
                             handleProjectRow(row.pid);
                           }}
                           style={{
                              position: "absolute",
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              height: 34,
                              background: `linear-gradient(to right, ${bg}9E 0%, ${bg}9E 4%, ${bg} 12%)`,
                              border: conflict ? "2px solid #DC2626" : ph?.color.outline ? `1px solid ${ph.color.outline}` : "none",
                              borderRadius: 17,
                              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                              boxSizing: "border-box",
                              minWidth: 6,
                              zIndex: 2, // above the leave hatch stripes (z 1)
                              animation: conflict ? "leavePulse 1.4s ease-in-out infinite" : undefined,
                              cursor: "pointer",
                            }}
                           />
                         {/* Monthly values: with edit rights each value (and
                             every empty month inside the bar) opens the
                             month-total editor; blank months OUTSIDE the bar
                             are covered by the transparent month-cell targets
                             behind these labels. Read-only viewers keep the
                             old jump to the aligned Weekly timeline. */}
                         {monthHrs.map((h, i) => {
                          if (h <= 0 && !monthEditable) return null;
                          const cx = ((i + 0.5) / M) * 100;
                          if (cx < leftPct + 1 || cx > leftPct + widthPct - 1) return null;
                          return (
                             <div
                               key={i}
                                title={monthEditable
                                  ? `${months[i].toLocaleDateString("en-US", { month: "long", year: "numeric" })} · click to edit this month's total hours`
                                  : `${barLabel} · Open the aligned Weekly project timeline`}
                               onClick={(event) => {
                                 event.stopPropagation();
                                 if (monthEditable) setMonthEdit({ rowKey: row.key, monthIdx: i });
                                 else handleProjectRow(row.pid);
                               }}
                               style={{
                              position: "absolute", left: `${cx}%`, top: "50%",
                              transform: "translate(-50%, -50%)", zIndex: 4,
                              color: txt, fontSize: 11, fontWeight: 700,
                               cursor: "pointer", whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                              opacity: h <= 0 ? 0.75 : 1,
                              padding: "2px 5px",
                            }}>{h <= 0 ? "+" : h % 1 === 0 ? h : h.toFixed(1)}</div>
                          );
                        })}
                        {/* Narrow bar fallback: no month center falls inside —
                            show the peak hours centered on the bar itself */}
                         {(() => {
                          const anyShown = monthHrs.some((h, i) => {
                            const cx = ((i + 0.5) / M) * 100;
                            return (h > 0 || monthEditable) && cx >= leftPct + 1 && cx <= leftPct + widthPct - 1;
                          });
                          const hVal = monthHrs.reduce((m, h) => Math.max(m, h), 0);
                          if (anyShown || (hVal <= 0 && !monthEditable)) return null;
                          // Narrow bar: no month center falls inside — edit the
                          // month under the bar's center point.
                          const centerIdx = Math.min(M - 1, Math.max(0, Math.floor(((leftPct + widthPct / 2) / 100) * M)));
                          return (
                             <div
                               title={monthEditable
                                 ? `${months[centerIdx].toLocaleDateString("en-US", { month: "long", year: "numeric" })} · click to edit this month's total hours`
                                 : `${barLabel} · Open the aligned Weekly project timeline`}
                               onClick={(event) => {
                                 event.stopPropagation();
                                 if (monthEditable) setMonthEdit({ rowKey: row.key, monthIdx: centerIdx });
                                 else handleProjectRow(row.pid);
                               }}
                               style={{
                              position: "absolute", left: `${leftPct + widthPct / 2}%`, top: "50%",
                              transform: "translate(-50%, -50%)", zIndex: 4,
                              color: txt, fontSize: 11, fontWeight: 700,
                               cursor: "pointer", whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                            }}>{hVal > 0 ? (hVal % 1 === 0 ? hVal : hVal.toFixed(1)) : "+"}</div>
                          );
                        })()}
                        </>
                          ) : hasSpan ? (
                            <div style={{ position: "absolute", left: row.endMs < wsMs ? 6 : undefined, right: row.startMs >= weMs ? 6 : undefined, fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>
                              {row.endMs < wsMs ? "← earlier" : "later →"}
                            </div>
                          ) : (
                            <div style={{ position: "absolute", left: 6, fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>no dates</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Dedicated LEAVE rows (timeline side): hatched bar spanning
                    the window with the weekly hours OFF shown separately from
                    project hours. */}
                {leaveRows.map((w, i) => {
                  const ls = Math.max(parseLocalDay(w.startDate), wsMs);
                  const le = Math.min(leaveEndExclusive(w.endDate), weMs);
                  const leftPct = ((ls - wsMs) / (weMs - wsMs)) * 100;
                  const widthPct = ((le - ls) / (weMs - wsMs)) * 100;
                  const offHrs = Math.round(br.workWeekHours * (100 - (w.availabilityPct ?? 0)) / 100 * 10) / 10;
                  const lbl = `${offHrs}h/wk off`;
                  const tip = `${w.leaveType || "Leave"} ${fmtAvailRange(w.startDate, w.endDate)} · ${availPctLabel(w.availabilityPct)} · ≈${lbl}`;
                  return (
                    <div key={`lv-${i}`} style={{ height: LEAVE_ROW_H, position: "relative", borderBottom: "1px solid #f1f5f9", background: "#FFFBF5", display: "flex", alignItems: "center" }}>
                      {projectTimelineColumns.map((column, mi) => (
                        <div key={column.start} style={
                          // Keep the footer FTE row's over-week tint in
                          // lockstep with the project rows above.
                          capView === "weekly" && (weeklyCap[mi]?.pct ?? 0) >= br.overCapacityPct
                            ? { position: "absolute", left: `${(mi / projectTimelineCount) * 100}%`, top: 0, bottom: 0, width: `${100 / projectTimelineCount}%`, background: "rgba(249,171,51,0.16)", borderLeft: "1px solid #f1f5f9" }
                            : { position: "absolute", left: `${(mi / projectTimelineCount) * 100}%`, top: 0, bottom: 0, width: 1, background: "#f1f5f9" }
                        } />
                      ))}
                      {todayFrac >= 0 && todayFrac <= 1 && (
                        <div style={{ position: "absolute", left: `${todayFrac * 100}%`, top: 0, bottom: 0, width: 2, background: "#FF5757", zIndex: 5 }} />
                      )}
                      {/* Bar + label in one div — keeps the text from drifting
                          outside its bar and rendering sideways when the bar
                          is near the right edge of the timeline. */}
                      <div title={tip} style={{
                        position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`,
                        height: 24, borderRadius: 12, minWidth: 6, boxSizing: "border-box",
                        background: "repeating-linear-gradient(135deg, #FDE9D9 0 6px, #FBD1A5 6px 12px)",
                        border: "1.5px dashed #E87722", zIndex: 2,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        overflow: "hidden",
                      }}>
                        <span style={{
                          color: "#B45309", fontSize: 10.5, fontWeight: 800,
                          whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                          paddingLeft: 4, paddingRight: 4,
                          overflow: "hidden", textOverflow: "ellipsis",
                        }}>{lbl}</span>
                      </div>
                    </div>
                  );
                })}

                {/* Allocated Demand (FTE) follows the selected Projects timeline. */}
                <div style={{ display: "flex", height: 28, borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  {(capView === "weekly" ? weeklyCap.map(week => week.pct) : monthlyPct).map((pct, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, color: "#475569", borderRight: "1px solid #e2e8f0", fontVariantNumeric: "tabular-nums", background: capView === "weekly" && pct >= br.overCapacityPct ? "rgba(249,171,51,0.16)" : undefined }}>
                      {capView === "weekly" && projectTimelineCount > 18 ? (pct / 100).toFixed(1) : (pct / 100).toFixed(2)}
                    </div>
                  ))}
                </div>

                {/* Leave windows shaded across the whole timeline — makes an
                    applied leave visible IN the Gantt itself, not just in the
                    list above. Translucent so bars underneath stay readable. */}
                {(windows ?? []).map((w, i) => {
                  const ls = parseLocalDay(w.startDate);
                  const le = leaveEndExclusive(w.endDate); // inclusive end → exclusive, DST-safe
                  if (isNaN(ls) || isNaN(le)) return null;
                  const s = Math.max(ls, wsMs), e = Math.min(le, weMs);
                  if (e <= s) return null;
                  const left = ((s - wsMs) / (weMs - wsMs)) * 100;
                  const width = ((e - s) / (weMs - wsMs)) * 100;
                  return (
                    <div key={`leave-${i}`} style={{
                      // Ends ABOVE the dedicated leave rows — they draw their
                      // own hatched bar, so overlapping this stripe onto them
                      // would double-hatch the leave period.
                      position: "absolute", top: 36, bottom: 28 + leaveRows.length * LEAVE_ROW_H,
                      left: `${left}%`, width: `${width}%`,
                      background: "repeating-linear-gradient(135deg, rgba(232,119,34,0.08) 0 6px, rgba(232,119,34,0.18) 6px 12px)",
                      borderLeft: "1.5px dashed #E87722", borderRight: "1.5px dashed #E87722",
                      // Under the bars (z 2) so allocations + their red pulse
                      // stay fully readable; the hatch fills the empty track.
                      // No floating label chip here — it collided with the
                      // TODAY badge; the dedicated leave row + banner carry
                      // the wording instead.
                      zIndex: 1, pointerEvents: "none", boxSizing: "border-box",
                    }} />
                  );
                })}

                {/* TODAY label */}
                {todayFrac >= 0 && todayFrac <= 1 && (
                  <div style={{ position: "absolute", top: 36, left: `${todayFrac * 100}%`, transform: "translateX(-50%)", zIndex: 10 }}>
                    <div style={{ background: "#FF5757", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>TODAY</div>
                  </div>
                )}
                </div>
              </div>
              </div>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ fontSize: 9.5, color: "#9BA8B3", marginTop: 8 }}>
              The Workload view above changes both Capacity and Projects. Weekly lets you click and edit one Monday cell at a time.{monthEditable ? " Monthly lets you click any month cell to edit that month's total." : ""}
            </div>
          )}
          {engineQ.isError && (
            <div style={{ fontSize: 10, color: "#B45309", marginTop: 6, fontWeight: 700 }}>
              Live weekly totals are unavailable right now, so the numbers shown are estimates from allocation spans. Edits still save safely against the live numbers.
            </div>
          )}
        </div>

        {/* Month-total editor — opened by clicking a month value in the
            Monthly Projects view. Fixed overlay so the hidden-overflow
            timeline can't clip it. */}
        {monthEdit && trackedSaveProjectWeeks && (() => {
          const row = rows.find(x => x.key === monthEdit.rowKey);
          const m0 = months[monthEdit.monthIdx];
          if (!row || !m0) return null;
          return (
            <MonthTotalEditor
              personName={r.name}
              projectName={pName(row.pid)}
              monthLabel={m0.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              weeks={monthWeekSlots(row.entries, monthEdit.monthIdx, row.pid)}
              onClose={() => setMonthEdit(null)}
              onSave={async patches => {
                await trackedSaveProjectWeeks({
                  personId: r.id,
                  personName: r.name,
                  role: r.roleName || r.role,
                  projectId: row.pid,
                  projectName: pName(row.pid),
                  weeks: patches,
                });
              }}
            />
          );
        })()}

        {/* ── FOOTER ── */}
        <div style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0", padding: "10px 20px", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#64748b", borderRadius: 8, padding: "6px 18px", fontSize: 13, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface Contact {
  id: string; name: string; title: string; company: string;
  companyId: string; phone: string; email: string; city: string;
}
function mapContact(r: ModuleRecord): Contact {
  const a = r as any;
  const firstName: string = a.FirstName || a.First_Name || "";
  const lastName: string = a.LastName || a.Last_Name || a.Surname || "";
  const firstLast = firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName);
  const fullName: string =
    a.FullName || a.ContactName || a.ContactDisplayName || a.DisplayName || a.Name ||
    firstLast || (r as any).ShortName || "";

  const companyName = a.CompanyName ?? a.AccountName ?? a.Company ?? a.Organization ?? a.CRMCompanyLookupName ?? "";
  return {
    id: (r as any).TicketId ?? "",
    name: fullName,
    title: a.JobTitle ?? a.Title2 ?? a.ContactTitle ?? a.Position ?? a.Title ?? "",
    company: companyName,
    companyId: a.CompanyId ?? a.CompanyTicketId ?? a.AccountId ?? "",
    phone: a.PhoneNumber ?? a.Phone ?? a.MobilePhone ?? a.CellPhone ?? a.DirectPhone ?? "",
    email: a.Email ?? a.EmailAddress ?? a.WorkEmail ?? "",
    city: a.City ?? (r as any).City ?? "",
  };
}

function contactInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Company → BU → Division → Dept hierarchy filter options (mirrors the
 * cascading BU/Division/Dept filter on the Projects page). Division options
 * are scoped to the selected BU, and Department options are scoped to the
 * selected BU + Division; ambiguous department names (same name under 2+
 * divisions) get a "Under: ..." disambiguation label.
 */
type OrgRow = { bu: string; division: string; dept: string };
/** Normalize a stored access level (any casing / null) to its display form.
 *  Returns "" for unset/grandfathered people so callers can decide fallbacks. */
function normAccessDisplay(v?: string | null): "" | "Admin" | "Manager" | "User" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "admin" ? "Admin" : s === "manager" ? "Manager" : s === "user" ? "User" : "";
}
const ACCESS_LEVEL_COLORS: Record<string, string> = {
  Admin: "#8B5CF6",   // purple — full control
  Manager: "#4B9CD3", // blue — operational edit
  User: "#6B7280",    // slate — read-only
};

type OrgFilterOption = { value: string; label: string; sub: string };
function buildOrgFilterOptions(rows: OrgRow[], buFilter: string, divFilter: string): {
  bus: string[]; divs: string[]; depts: OrgFilterOption[];
} {
  const norm = (s: string) => (s && s !== "—" ? s.trim() : "");
  // Hidden Division tier (flexible hierarchy): suppress the Division filter
  // entirely — its values are hidden bridge divisions (mirror-named after BUs).
  const divTierOn = getBusinessRules().showDivision;
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
  return { bus: Array.from(buSet).sort(), divs: divTierOn ? Array.from(divSet).sort() : [], depts };
}

export interface ResourcesIntegrationController {
  saveProjectWeek: (edit: ResourceProjectWeekEdit) => Promise<void>;
  /** Read-only snapshot of the page's accepted-week overlay for assertions. */
  debugAcceptedWeekOverrides: () => Array<{ week: string; hours: number; revision: number }>;
}

let resourcesIntegrationObserver:
  | ((controller: ResourcesIntegrationController) => void)
  | null = null;

/** Browser-integration seam; normal application mounts never register one. */
export function observeResourcesIntegrationController(
  observer: ((controller: ResourcesIntegrationController) => void) | null,
): void {
  resourcesIntegrationObserver = observer;
}

export default function Resources({ initialView, standaloneManager = false }: ResourcesProps = {}) {
  const [, navigate] = useLocation();
  // Demand-tab "Add member" quick action → same shared Add Team Member flow
  // as the Alerts/Briefing panels (prefilled project + role, consumes the
  // exact RA rows behind the clicked position on save).
  const staffingQA = useStaffingQuickActions({ onNavigate: navigate });
  const [view, setView] = useState<ResView>(() => {
    if (typeof window === "undefined") return "Demand";
    if (initialView === "Manager") return "Manager";
    const v = new URLSearchParams(window.location.search).get("view");
    const allowed: ResView[] = ["Timeline", "Staff", "Demand"];
    return (allowed.includes(v as ResView) ? v : "Demand") as ResView;
  });

  const allQuarters = useMemo(() => buildQuarters(), []);
  const currentQ = useMemo(() => currentQuarterLabel(), []);
  const [selectedQ, setSelectedQ] = useState(currentQ);
  const [showQDropdown, setShowQDropdown] = useState(false);
  const [utilMode, setUtilMode] = useState<UtilMode>("Weekly");
  const [timelineSubView, setTimelineSubView] = useState<TimelineSubView>("Grid");
  const [ganttPeriod, setGanttPeriod] = useState<string | null>(null);

  // Deep links (e.g. the home/briefing "Resolve now" picker) can pre-filter
  // the page to a person via ?q=<name>.
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [demandGroup, setDemandGroup] = useState<"all" | "positions" | "project" | "role">("all");
  // Demand render cap: tenants can have thousands of weekly demand rows, and
  // rendering a card (with hooks) for every one freezes tab switching. Render
  // in pages of DEMAND_PAGE_SIZE with a "Load more" button; reset the cap
  // whenever the tab, search text, or group mode changes.
  const DEMAND_PAGE_SIZE = 60;
  const [demandVisible, setDemandVisible] = useState(DEMAND_PAGE_SIZE);
  useEffect(() => { setDemandVisible(DEMAND_PAGE_SIZE); }, [view, search, demandGroup]);
  // Timeline deep links (e.g. an alert row for an over-allocated person)
  // land on ?view=Timeline&q=<name> — seed the Timeline filter too so the
  // page opens scrolled to that person's row instead of the full roster.
  const [utilSearch, setUtilSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    const sp = new URLSearchParams(window.location.search);
    return sp.get("view") === "Timeline" ? sp.get("q") ?? "" : "";
  });
  const [threshold, setThreshold] = useState(150);
  const [staffBuFilter, setStaffBuFilter] = useState("All");
  const [staffDivFilter, setStaffDivFilter] = useState("All");
  const [staffDeptFilter, setStaffDeptFilter] = useState("All");
  const [staffRoleFilter, setStaffRoleFilter] = useState("All");
  const [staffTitleFilter, setStaffTitleFilter] = useState("All");
  const [staffProjectFilter, setStaffProjectFilter] = useState("All");
  const [staffAccessFilter, setStaffAccessFilter] = useState("All");
  // Employment-type chip filter — null means "show all types".
  const [staffEmpTypeFilter, setStaffEmpTypeFilter] = useState<string | null>(null);
  // Which single filter popup (bu/div/dept/role/title) is open in ResOrgFilterBar.
  // Only one at a time; picking a BU/Division/Dept value never resets the
  // other two — all three combine (AND) same as the Projects page.
  const [staffOpenMenu, setStaffOpenMenu] = useState<string | null>(null);
  // Clickable tier pill filter — null means "show all tiers".
  const [staffTierFilter, setStaffTierFilter] = useState<string | null>(null);
  // Manager filter — null means "show all staff"; non-null = a manager's GUID.
  const [staffManagerFilter, setStaffManagerFilter] = useState<string | null>(null);
  // Whether the manager org-chart popup is visible. Used by both the Staff
  // manager filter and the standalone Manager view.
  const [showManagerOrgChart, setShowManagerOrgChart] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  // Initial value MUST stay in lockstep with defaultUtilQuery() in
  // lib/quarters.ts — the post-login prewarm prefetches the utilization grid
  // under a key built from these same defaults.
  const [filters, setFilters] = useState(defaultUtilFilters());

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showStaffChoice, setShowStaffChoice] = useState(false);
  const [showStaffBulk, setShowStaffBulk] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Edit gating: RDS tenants carry a canEdit flag (false = view-only). RM ONE-cloud
  // users have no flag (undefined) and are treated as editable.
  // Staff management (Add Staff / edit staff / Manage Staff) answers to the
  // "manage staff" capability ALONE — a customized built-in User or custom
  // level can hold it without Edit data. Never AND this with the legacy
  // user.canEdit flag: that flag is false for every built-in User regardless
  // of the tenant's explicit capability override.
  const permsVer = usePermissionsVersion();
  const [dataCapOk, setDataCapOk] = useState(false);
  const [staffCapOk, setStaffCapOk] = useState(false);
  // Admin-defined custom access levels — resolve "custom:<id>" markers to
  // their display names in the grid + Access filter. Soft-fail: built-ins
  // always work. Re-fetches when permissions change (level created/renamed).
  const [accessLevelDefs, setAccessLevelDefs] = useState<AccessLevelDef[]>([]);
  useEffect(() => {
    let alive = true;
    fetchAccessLevels().then(ls => { if (alive) setAccessLevelDefs(ls); }).catch(() => {});
    return () => { alive = false; };
  }, [permsVer]);
  const customAclNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of accessLevelDefs) m.set(`custom:${l.id}`.toLowerCase(), l.name);
    return m;
  }, [accessLevelDefs]);
  // If the Access filter points at a custom level that was renamed/deleted,
  // reset to "All" — otherwise the orphaned name silently over-filters forever.
  useEffect(() => {
    setStaffAccessFilter(cur => {
      if (cur === "All" || cur === "Admin" || cur === "Manager" || cur === "User") return cur;
      return accessLevelDefs.some(l => l.name === cur) ? cur : "All";
    });
  }, [accessLevelDefs]);
  /** Display name for any stored access level: built-in, custom level name,
   *  or "" for unset/grandfathered (deleted custom markers show ""). */
  const accessDisplayOf = useCallback((v?: string | null): string => {
    const builtIn = normAccessDisplay(v);
    if (builtIn) return builtIn;
    const s = String(v ?? "").trim().toLowerCase();
    return isCustomAcl(s) ? (customAclNames.get(s) ?? "") : "";
  }, [customAclNames]);
  const [staffSelfRevert, setStaffSelfRevert] = useState<MyCapabilities["selfRevert"]>(null);
  useEffect(() => {
    let alive = true;
    setDataCapOk(false);
    setStaffCapOk(false);
    getMyCapabilities({ fresh: true })
      .then((c) => {
        if (!alive) return;
        setDataCapOk(c.caps.editData === true);
        setStaffCapOk(c.caps.manageStaff === true);
        setStaffSelfRevert(c.selfRevert ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setDataCapOk(false);
        setStaffCapOk(false);
        setStaffSelfRevert(null);
      });
    return () => { alive = false; };
  }, [permsVer]);
  const canEdit = dataCapOk;
  const canManageStaff = staffCapOk;
  // The logged-in user's own username — used below to suppress the Edit button
  // on the row that represents the current user (you can't edit yourself).
  // Exception: site admins (isAdmin=true) can edit their own profile too.
  const currentUsername = getStoredUser()?.username ?? null;
  const isCurrentUserAdmin = useMemo(() => getStoredUser()?.isAdmin === true, []);
  // Self-revert confirm state: when a user self-changed their level (losing
  // manageStaff), they still see a pencil on their own row so they can change
  // it back — clicking it shows this small confirmation before calling revert.
  const [selfRevertConfirm, setSelfRevertConfirm] = useState(false);
  const [selfRevertLoading, setSelfRevertLoading] = useState(false);
  const [selfRevertErr, setSelfRevertErr] = useState<string | null>(null);

  // ── Duplicate login identity detection (admin-only) ─────────────────────
  // Different people may share a display name. Only a repeated email/login
  // identity is actionable here.
  const [dupNames, setDupNames] = useState<DuplicateNameGroup[]>([]);
  const [dupNamesDismissed, setDupNamesDismissed] = useState(false);
  useEffect(() => {
    if (!canManageStaff || view !== "Staff") return;
    let alive = true;
    getDuplicateStaffNames()
      .then(groups => { if (alive) setDupNames(groups); })
      .catch(() => { /* non-fatal: banner is informational only */ });
    return () => { alive = false; };
  }, [canManageStaff, view]);
  const doSelfRevert = async () => {
    setSelfRevertLoading(true); setSelfRevertErr(null);
    try {
      await revertMyAccessLevel();
      notifyPermissionsChanged();
      setSelfRevertConfirm(false);
    } catch (e) {
      setSelfRevertErr(e instanceof Error ? e.message : "Could not change your access level back.");
    } finally { setSelfRevertLoading(false); }
  };

  // Arrow navigation can move beyond the finite quarter list shown in the
  // picker. Resolve those labels directly so the timeline remains continuous
  // instead of stopping at the picker bounds.
  const selectedQuarter = quarterFromLabel(selectedQ) ?? allQuarters.find(q => q.label === currentQ)!;
  const navigateTimelineQuarter = useCallback((direction: -1 | 1) => {
    setSelectedQ(current => shiftQuarterLabel(current, direction));
  }, []);

  // In Monthly mode expand the range to 12 months from the quarter start so all months are visible.
  const effectiveEndDate = useMemo(() => {
    if (utilMode !== "Monthly" || !selectedQuarter) return selectedQuarter?.ed;
    const d = new Date(selectedQuarter.sd);
    d.setMonth(d.getMonth() + 12);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [utilMode, selectedQuarter]);

  // Persist responses to sessionStorage so the page shows stale-but-instant
  // data on revisit instead of a blank spinner. Keys include the last 16 chars
  // of the auth token to prevent cross-tenant data leaks on login switch.
  const _tok = (() => { try { return (localStorage.getItem("rmone_token") ?? "").slice(-16); } catch { return ""; } })();

  const allocCacheKey = `rm_alloc_cache_${_tok}`;
  const allocPlaceholder = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(allocCacheKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      // Never seed from an empty roster — a previously-failed fetch may have
      // persisted it; seeding would instantly render an all-zero page. Also
      // reject degraded payloads (_degraded: backend survived a partial DB
      // failure — names-only roster at 0% would render as all-dashes).
      const p = parsed as { resources?: unknown[]; _degraded?: unknown } | null;
      const resources = p?.resources;
      return Array.isArray(resources) && resources.length > 0 && !p?._degraded ? parsed : undefined;
    } catch { return undefined; }
  }, [allocCacheKey]);

  const [acceptedWeekOverrides, setAcceptedWeekOverrides] = useState<ResourceWeekOverrideMap>({});
  const acceptedWeekRevisionRef = useRef(0);
  const allocationWorkWeekHours = getBusinessRules().workWeekHours || 40;

  const allocQ = useQuery({
    queryKey: ["resource-allocations"],
    queryFn: () => getResourceAllocations(),
    // Always enabled: the Staff tab count is shown on every view — gating this
    // behind the Staff/Timeline tabs made the count render 0 while on Demand.
    staleTime: 5 * 60 * 1000,
    // Function form: keep whatever we already have; fall back to the session
    // seed. Never lets data drop to undefined once something was shown.
    placeholderData: (prev: unknown) => prev ?? allocPlaceholder,
    // A degraded payload (_degraded: backend survived a partial DB failure)
    // would otherwise sit in the in-memory query cache for the full staleTime.
    // Poll every 30s while degraded so the page heals as fast as the server.
    refetchInterval: (query) =>
      (query.state.data as { _degraded?: unknown } | undefined)?._degraded ? 30_000 : false,
  });

  useEffect(() => {
    // Persist only healthy, non-empty rosters: an empty or degraded payload
    // (transient backend failure) must never overwrite a good cached snapshot.
    const d = allocQ.data as { resources?: unknown[]; _degraded?: unknown } | undefined;
    if (Array.isArray(d?.resources) && d.resources.length > 0 && !d._degraded) {
      try { sessionStorage.setItem(allocCacheKey, JSON.stringify(allocQ.data)); } catch { /* storage full — skip */ }
    }
  }, [allocQ.data, allocCacheKey]);

  // util: cache key encodes the variable params so we serve the right stale slice
  const utilCacheKey = (() => {
    const params = `${selectedQuarter?.sd ?? ""}_${effectiveEndDate}_${utilMode}_${filters.showActuals ? 1 : 0}${filters.onlyNCO ? 1 : 0}${filters.includeClosedProject ? 1 : 0}${filters.includeSoftAllocations ? 1 : 0}`;
    return `rm_util_cache_${_tok}_${params}`;
  })();
  const utilPlaceholder = useMemo<unknown[] | undefined>(() => {
    try {
      const raw = sessionStorage.getItem(utilCacheKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      // Never seed from an empty grid — showing it would render an all-zero
      // Timeline instantly and mask the real (possibly loading) data.
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
    } catch { return undefined; }
  }, [utilCacheKey]);

  const utilQ = useQuery({
    queryKey: ["util", selectedQuarter?.sd, effectiveEndDate, utilMode, filters],
    queryFn: () => getAllocationUtilization({
      startDate: selectedQuarter.sd,
      endDate: effectiveEndDate,
      mode: utilMode,
      showActuals: filters.showActuals,
      onlyNCO: filters.onlyNCO,
      includeClosedProject: filters.includeClosedProject,
      includeSoftAllocations: filters.includeSoftAllocations,
    }),
    // Always enabled (prefetch): the fetch used to start only when the user
    // clicked Timeline/Staff, so the first open always sat on a spinner for
    // the full network round-trip. Kicking it off on page mount means the
    // grid is typically already loaded by the time the tab is opened.
    enabled: true,
    staleTime: 5 * 60 * 1000,
    // Function form: when the quarter/filter changes the queryKey, keep the
    // previous grid on screen while the new slice loads instead of flashing
    // an empty Timeline.
    placeholderData: (prev: unknown[] | undefined) => prev ?? utilPlaceholder,
  });

  useEffect(() => {
    // Persist only non-empty grids — an empty response must never poison the
    // instant-load snapshot (all-zero Timeline until re-login otherwise).
    if (Array.isArray(utilQ.data) && utilQ.data.length > 0) {
      try { sessionStorage.setItem(utilCacheKey, JSON.stringify(utilQ.data)); } catch { /* storage full — skip */ }
    }
  }, [utilQ.data, utilCacheKey]);

  const demandCacheKey = `rm_demand_cache_${_tok}`;
  const demandPlaceholder = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(demandCacheKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      // Never seed from an empty payload — it would flash zero counts.
      const rows = (parsed as { data?: unknown[] } | null)?.data;
      return Array.isArray(rows) && rows.length > 0 ? parsed : undefined;
    } catch { return undefined; }
  }, [demandCacheKey]);

  const demandQ = useQuery({
    queryKey: ["resource-demands"],
    queryFn: () => getResourceDemands(),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: unknown) => prev ?? demandPlaceholder,
  });

  useEffect(() => {
    // Persist only non-empty payloads — a transient backend failure must
    // never poison the instant-load snapshot with zeros.
    const rows = (demandQ.data as { data?: unknown[] } | undefined)?.data;
    if (Array.isArray(rows) && rows.length > 0) {
      try { sessionStorage.setItem(demandCacheKey, JSON.stringify(demandQ.data)); } catch { /* storage full — skip */ }
    }
  }, [demandQ.data, demandCacheKey]);

  const conCacheKey = `rm_con_cache_${_tok}`;
  const conPlaceholder = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(conCacheKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      const rows = (parsed as { data?: unknown[] } | null)?.data;
      return Array.isArray(rows) && rows.length > 0 ? parsed : undefined;
    } catch { return undefined; }
  }, [conCacheKey]);

  const conQ = useQuery({
    queryKey: ["con"],
    queryFn: () => getModuleRecords("CON"),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: unknown) => prev ?? conPlaceholder,
  });

  // Manager directory also carries the real unique-team count used by the
  // Manager search dropdown. Load it on either surface that consumes it.
  const includeLeadershipTitles = view === "Manager";
  const managersQ = useQuery({
    queryKey: ["managers-list", includeLeadershipTitles ? "leadership" : "relationships"],
    queryFn: () => getManagersList(includeLeadershipTitles),
    staleTime: 5 * 60 * 1000,
    enabled: view === "Staff" || view === "Manager",
    placeholderData: (prev: ManagerEntry[] | undefined) => prev,
  });
  const managersList: ManagerEntry[] = managersQ.data ?? [];
  const managerTeamCounts = useMemo(
    () => new Map(
      managersList
        .filter((manager): manager is ManagerEntry & { teamMemberCount: number } =>
          typeof manager.teamMemberCount === "number")
        .map(manager => [manager.id.trim().toLowerCase(), manager.teamMemberCount]),
    ),
    [managersList],
  );

  // Per-manager staff (direct reports + project team) — only loaded when a
  // manager is selected. Clears when manager filter is unset.
  const managerStaffQ = useQuery({
    queryKey: ["manager-staff", staffManagerFilter],
    queryFn: () => getManagerStaff(staffManagerFilter!),
    staleTime: 5 * 60 * 1000,
    enabled: !!staffManagerFilter,
    placeholderData: (prev: ManagerStaffResponse | undefined) => prev,
  });
  const managerStaffData: ManagerStaffResponse | undefined = managerStaffQ.data;

  // Flat set of IDs to show when manager filter is active (direct + projectTeam combined).
  const managerFilterIds = useMemo<Set<string> | null>(() => {
    if (!staffManagerFilter || !managerStaffData) return null;
    const s = new Set<string>();
    for (const d of managerStaffData.direct ?? []) s.add(d.id.toLowerCase());
    for (const pt of managerStaffData.projectTeam ?? []) s.add(pt.id.toLowerCase());
    return s;
  }, [staffManagerFilter, managerStaffData]);

  // ── Manager view (role-rank hierarchy) ─────────────────────────────────────
  // Default = the full Timeline grid + a person search on top. Picking a
  // person swaps the rows for their hierarchy: their row first, then — per
  // record they lead or sit on — every team member whose role ranks BELOW
  // theirs (leads outrank the whole team regardless of role).
  const [managerSelectedId, setManagerSelectedId] = useState<string | null>(null);
  // Grid live-filter text. Updated DEBOUNCED from the self-contained picker
  // (ManagerSearchPicker) so typing never re-renders the heavy timeline grid
  // on every keystroke — that lag made the search feel stuck.
  const [managerSearch, setManagerSearch] = useState("");
  // NO placeholderData: person A's team must never flash while B loads.
  const managerCtxQ = useQuery({
    queryKey: ["manager-hierarchy", managerSelectedId],
    queryFn: () => getManagerHierarchy(managerSelectedId!),
    staleTime: 5 * 60 * 1000,
    enabled: view === "Manager" && !!managerSelectedId,
  });

  useEffect(() => {
    const rows = (conQ.data as { data?: unknown[] } | undefined)?.data;
    if (Array.isArray(rows) && rows.length > 0) {
      try { sessionStorage.setItem(conCacheKey, JSON.stringify(conQ.data)); } catch { /* storage full — skip */ }
    }
  }, [conQ.data, conCacheKey]);

  const refetchAlloc = allocQ.refetch;
  const refetchUtil = utilQ.refetch;
  const renderedUtilModeRef = useRef(utilMode);
  renderedUtilModeRef.current = utilMode;
  const refetchRenderedUtilRef = useRef(refetchUtil);
  refetchRenderedUtilRef.current = refetchUtil;
  const allocDataUpdatedAt = allocQ.dataUpdatedAt;
  const utilDataUpdatedAt = utilQ.dataUpdatedAt;
  // Every allocation-sync path must consume fresh server reads, not this tab's
  // warm five-minute resource cache. This matters both after the initial
  // change event races the write and when a separate browser tab receives the
  // data-free timestamp marker.
  const refetchAllocationViewsFresh = useCallback(async () => {
    markAllocationRefetchFresh();
    return Promise.all([refetchAlloc(), refetchUtil()]);
  }, [refetchAlloc, refetchUtil]);
  const refetchRenderedUtilFresh = useCallback(() => {
    markAllocationRefetchFresh();
    return refetchRenderedUtilRef.current();
  }, []);
  const warnResourceHoursVerificationFailed = useCallback((personName: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof SaveMismatchError) {
      // Authoritative disagreement: the verify read COMPLETED and the server
      // kept different hours (e.g. a silent no-op). The caller rolls the
      // accepted overlay back, so the timeline shows server truth — the copy
      // must not imply the change stuck.
      toast({
        title: "Hours change didn't stick",
        description: `The server kept different hours than were saved for ${personName}, so the timeline shows the server's values. ${detail}`,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Hours saved, but the follow-up check failed",
      description: `${personName}'s change was accepted. Refresh Resources or open the Project Team card to confirm it. ${detail}`,
      variant: "destructive",
    });
  }, []);
  const saveResourceProjectWeek = useCallback(async (edit: ResourceProjectWeekEdit) => {
    if (!canEdit) throw new Error("You do not have permission to edit allocation hours.");
    if (!edit.personId) {
      throw new Error(`Could not identify ${edit.personName}. Refresh Resources and try again.`);
    }
    const revision = ++acceptedWeekRevisionRef.current;
    let acceptedKey: string | null = null;
    try {
      await runFastWeeklyHoursSave(
        {
          projectId: edit.projectId,
          memberId: edit.personId,
          memberName: edit.personName,
          memberRole: edit.role,
          weekPatch: { week: edit.week, hours: edit.hours },
        },
        {
          bustCache,
          onAccepted: accepted => {
          const key = resourceWeekOverrideKey(accepted.memberId, accepted.projectId, edit.week);
          acceptedKey = key;
          const acceptedHours = accepted.acceptedWeekMap[edit.week] ?? edit.hours;
          const previousHours = accepted.previousWeekMap[edit.week] ?? 0;
          setAcceptedWeekOverrides(current => storeResourceWeekOverride(current, {
            personId: accepted.memberId,
            personName: accepted.memberName,
            projectId: accepted.projectId,
            projectName: edit.projectName,
            week: edit.week,
            previousHours,
            hours: acceptedHours,
            revision,
          }));
          if (renderedUtilModeRef.current !== utilMode) {
            // The switch happened before this write was accepted, so the
            // mode-change effect did not yet have an overlay to refresh.
            void refetchRenderedUtilFresh();
          }
          edit.onAccepted?.();
          },
          onVerified: () => {
            if (acceptedKey) {
              setAcceptedWeekOverrides(current => {
                const existing = current[acceptedKey!];
                if (!existing || existing.revision !== revision) return current;
                return {
                  ...current,
                  [acceptedKey!]: { ...existing, verificationSucceeded: true },
                };
              });
            }
            void refetchAllocationViewsFresh();
          },
          warnVerificationFailed: error => {
            if (error instanceof SaveMismatchError && acceptedKey) {
              // Verification completed and DISAGREED — keeping the accepted
              // overlay would display hours the server does not have. Drop
              // this save's overlay (revision-guarded so a newer queued edit
              // for the same tuple survives) and let the fresh re-read paint
              // server truth.
              setAcceptedWeekOverrides(current =>
                removeResourceWeekOverrideIfRevision(current, acceptedKey!, revision));
            }
            void refetchAllocationViewsFresh();
            warnResourceHoursVerificationFailed(edit.personName, error);
          },
        },
      );
      // The visible save completes as soon as the POST is accepted. Refreshes
      // and authoritative verification continue without holding the editor.
      void refetchAllocationViewsFresh();
    } catch (error) {
      // Verification rejected or disagreed. Re-read authoritative truth first,
      // then remove only this save's overlay; a newer queued edit for the same
      // tuple must not be cleared by this older failure.
      void refetchAllocationViewsFresh();
      if (acceptedKey) {
        setAcceptedWeekOverrides(current =>
          removeResourceWeekOverrideIfRevision(current, acceptedKey!, revision)
        );
      }
      throw error;
    }
  }, [canEdit, refetchAllocationViewsFresh, refetchRenderedUtilFresh, utilMode, warnResourceHoursVerificationFailed]);

  /* Month-editor save: ONE atomic weekPatches write covering every editable
     week of the month — same member queue, past-week locks, 168h validation
     and post-save verification as the weekly path, plus the same per-week
     optimistic overlays so every mounted Resources view agrees immediately. */
  const saveResourceProjectWeeks = useCallback(async (edit: ResourceProjectWeeksEdit) => {
    if (!canEdit) throw new Error("You do not have permission to edit allocation hours.");
    if (!edit.personId) {
      throw new Error(`Could not identify ${edit.personName}. Refresh Resources and try again.`);
    }
    const weekKeys = Object.keys(edit.weeks);
    if (weekKeys.length === 0) return;
    const revision = ++acceptedWeekRevisionRef.current;
    let acceptedKeys: string[] = [];
    try {
      await runFastWeeklyHoursSave(
        {
          projectId: edit.projectId,
          memberId: edit.personId,
          memberName: edit.personName,
          memberRole: edit.role,
          weekPatches: edit.weeks,
        },
        {
          bustCache,
          onAccepted: accepted => {
          acceptedKeys = weekKeys.map(week =>
            resourceWeekOverrideKey(accepted.memberId, accepted.projectId, week));
          setAcceptedWeekOverrides(current => {
            let next = current;
            for (const week of weekKeys) {
              next = storeResourceWeekOverride(next, {
                personId: accepted.memberId,
                personName: accepted.memberName,
                projectId: accepted.projectId,
                projectName: edit.projectName,
                week,
                previousHours: accepted.previousWeekMap[week] ?? 0,
                hours: accepted.acceptedWeekMap[week] ?? edit.weeks[week],
                revision,
              });
            }
            return next;
          });
          if (renderedUtilModeRef.current !== utilMode) {
            // Match the single-week path when the mode changed before this
            // batch installed its accepted overlays.
            void refetchRenderedUtilFresh();
          }
          edit.onAccepted?.();
          },
          onVerified: () => {
            if (acceptedKeys.length > 0) {
              setAcceptedWeekOverrides(current => {
                let next = current;
                let changed = false;
                for (const key of acceptedKeys) {
                  const existing = next[key];
                  if (existing && existing.revision === revision) {
                    next = { ...next, [key]: { ...existing, verificationSucceeded: true } };
                    changed = true;
                  }
                }
                return changed ? next : current;
              });
            }
            void refetchAllocationViewsFresh();
          },
          warnVerificationFailed: error => {
            if (error instanceof SaveMismatchError && acceptedKeys.length > 0) {
              // Verification completed and DISAGREED — roll every folded
              // week of this batch back to server truth (revision-guarded so
              // newer queued edits for the same tuples survive).
              setAcceptedWeekOverrides(current => {
                let next = current;
                for (const key of acceptedKeys) {
                  next = removeResourceWeekOverrideIfRevision(next, key, revision);
                }
                return next;
              });
            }
            void refetchAllocationViewsFresh();
            warnResourceHoursVerificationFailed(edit.personName, error);
          },
        },
      );
      void refetchAllocationViewsFresh();
    } catch (error) {
      // Verification rejected or disagreed. Re-read authoritative truth first,
      // then remove only this save's overlays; newer queued edits for the same
      // tuples must not be cleared by this older failure.
      void refetchAllocationViewsFresh();
      if (acceptedKeys.length > 0) {
        setAcceptedWeekOverrides(current => {
          let next = current;
          for (const key of acceptedKeys) {
            next = removeResourceWeekOverrideIfRevision(next, key, revision);
          }
          return next;
        });
      }
      throw error;
    }
  }, [canEdit, refetchAllocationViewsFresh, refetchRenderedUtilFresh, utilMode, warnResourceHoursVerificationFailed]);

  // Timeline-grid weekly cells share the popup's rapid-edit coalescer: the
  // first edit saves immediately, and cells edited while that save is in
  // flight fold into ONE atomic weekPatches save per person+project lane
  // (the coalescer keys lanes person-first, so one page-level instance is
  // safe across every roster row). A failed batch rejects every folded
  // cell's promise, so each cell rolls back its optimistic value and the
  // grid surfaces the error — no silent drops.
  // The coalescer's lane state (in-flight save + queued folds) lives inside
  // its closure, so the instance must survive re-renders. Depending on the
  // save callback directly rebuilt it whenever any of that callback's deps
  // changed identity — the fresh re-reads kicked off by the FIRST cell's
  // accepted save flip the query refetch identities, so the rebuilt coalescer
  // forgot its in-flight lane and rapid follow-up cells each POSTed
  // separately instead of folding into one atomic batch. Route the latest
  // saver through a ref and create the coalescer exactly once.
  const saveResourceProjectWeeksRef = useRef(saveResourceProjectWeeks);
  saveResourceProjectWeeksRef.current = saveResourceProjectWeeks;
  const coalescedTimelineWeekSave = useMemo(
    () => createWeeklyCellSaveCoalescer(edit => saveResourceProjectWeeksRef.current(edit)),
    [],
  );

  const acceptedWeekOverridesRef = useRef(acceptedWeekOverrides);
  acceptedWeekOverridesRef.current = acceptedWeekOverrides;
  const previousRenderedUtilModeRef = useRef(utilMode);
  useEffect(() => {
    const previousMode = previousRenderedUtilModeRef.current;
    previousRenderedUtilModeRef.current = utilMode;
    if (previousMode !== utilMode && Object.keys(acceptedWeekOverridesRef.current).length > 0) {
      // Mode changes can reuse a warm utilization query from before the save.
      // Refresh it so the rendered-mode prune can confirm the accepted value
      // instead of leaving the overlay around until the next background read.
      void refetchRenderedUtilFresh();
    }
  }, [utilMode, refetchRenderedUtilFresh]);
  useEffect(() => {
    resourcesIntegrationObserver?.({
      saveProjectWeek: saveResourceProjectWeek,
      debugAcceptedWeekOverrides: () =>
        Object.values(acceptedWeekOverridesRef.current).map(override => ({
          week: override.week,
          hours: override.hours,
          revision: override.revision,
        })),
    });
  }, [saveResourceProjectWeek]);

  // Case 1: Resources is open in this tab. Refresh when any roster-affecting
  // write lands — hours, team membership, open positions, staff changes —
  // via the unified data-sync bus, and once a direct weekly save has been
  // verified against server truth (rmone:allocationConfirmed).
  // Case 2 (a different browser tab changed data) rides the same
  // subscription: the bus marker carries scopes + timestamp only — no
  // customer data — and storage events fire only in the receiving tab.
  useEffect(() => {
    const handler = () => { void refetchAllocationViewsFresh(); };
    const unsubscribe = subscribeDataChanged(["allocation", "team", "demand", "staff"], handler);
    window.addEventListener("rmone:allocationConfirmed", handler);
    return () => {
      unsubscribe();
      window.removeEventListener("rmone:allocationConfirmed", handler);
    };
  }, [refetchAllocationViewsFresh]);

  // Case 3: User switches to any Resources view after making a change on
  // another page. The event already fired while we were elsewhere, so compare
  // the data-free marker on every view switch instead of leaving a linked
  // Resources surface stale until a browser refresh.
  useEffect(() => {
    try {
      const allocationTs = allocationMarkerTimestamp(localStorage.getItem("rmone:allocationTs"));
      if (allocationTs > allocDataUpdatedAt || allocationTs > utilDataUpdatedAt) {
        void refetchAllocationViewsFresh();
      }
    } catch { /* storage unavailable */ }
  }, [view, allocDataUpdatedAt, utilDataUpdatedAt, refetchAllocationViewsFresh]);

  // Display source: if the live payload is degraded (backend survived a
  // partial DB failure — names-only roster at 0%, typically the ~20 login
  // accounts instead of the full imported staff), fall back to the last
  // HEALTHY snapshot persisted in sessionStorage. The page keeps showing
  // real staff + allocations while the 30s degraded poll heals in the
  // background; without this, a single transient blip repainted the whole
  // page as "21 staff, all 0%".
  const rawAllocResp = useMemo(() => {
    const d = allocQ.data as (typeof allocQ.data & { _degraded?: unknown }) | undefined;
    if (d?._degraded) {
      try {
        const raw = sessionStorage.getItem(allocCacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { resources?: unknown[]; _degraded?: unknown } | null;
          if (Array.isArray(parsed?.resources) && parsed.resources.length > 0 && !parsed._degraded) {
            return parsed as typeof allocQ.data;
          }
        }
      } catch { /* fall through to the degraded payload */ }
    }
    return allocQ.data;
  }, [allocQ.data, allocCacheKey]);
  const acceptedWeekOverrideList = useMemo(
    () => Object.values(acceptedWeekOverrides),
    [acceptedWeekOverrides],
  );
  const allocResp = useMemo(() => {
    if (!rawAllocResp || acceptedWeekOverrideList.length === 0) return rawAllocResp;
    return {
      ...rawAllocResp,
      resources: applyResourceWeekOverrides(
        (rawAllocResp.resources ?? []) as LiveResourceProxy[],
        acceptedWeekOverrideList,
        allocationWorkWeekHours,
      ),
    };
  }, [rawAllocResp, acceptedWeekOverrideList, allocationWorkWeekHours]);
  const rawUtilRows = (utilQ.data ?? []) as Record<string, unknown>[];
  const utilRows = useMemo(
    () => applyResourceWeekOverridesToUtilRows(
      rawUtilRows,
      (rawAllocResp?.resources ?? []) as LiveResourceProxy[],
      acceptedWeekOverrideList,
      utilMode,
      allocationWorkWeekHours,
    ),
    [rawUtilRows, rawAllocResp, acceptedWeekOverrideList, utilMode, allocationWorkWeekHours],
  );
  const utilPeriods = useMemo(() => getDateColumns(utilRows[0]), [utilRows]);
  const filteredUtilRows = useMemo(() => {
    if (!utilSearch.trim()) return utilRows;
    const q = utilSearch.toLowerCase();
    return utilRows.filter(r => String(r.ResourceUser ?? "").toLowerCase().includes(q));
  }, [utilRows, utilSearch]);

  useEffect(() => {
    const rawResources = (rawAllocResp?.resources ?? []) as LiveResourceProxy[];
    if (rawResources.length === 0) return;
    setAcceptedWeekOverrides(current =>
      pruneConfirmedResourceWeekOverrides(
        current,
        rawResources,
        rawUtilRows,
        utilMode,
        allocationWorkWeekHours,
      )
    );
  }, [rawAllocResp, rawUtilRows, utilMode, allocationWorkWeekHours]);
  /* Quarter-windowed staff stats: the Staff grid must read the SAME window the
     Timeline shows (the selected quarter), not just "active this instant".
     People whose bookings start later in the quarter (e.g. Aug) otherwise show
     0% here while the Timeline shows full weeks of hours. Derived from
     allAllocations — the exact payload the Timeline endpoint wraps — so both
     views agree by construction:
     - currentPct        → avg summed load across the person's ACTIVE weeks in the quarter
     - activeAllocations → one merged entry per project overlapping the quarter
     - qTotalHrs / qActiveWeeks → totals for the AI-analysis modal header */
  // Leave / partial-availability windows for every person in the company, in
  // ONE cached call. Best-effort: a failure leaves the map empty so the page
  // simply behaves as if nobody is on leave — never crashes. Grouped by the
  // person GUID (r.id) lowercased so matches are case-insensitive.
  // availRefreshKey is bumped by onSaved so the map re-fetches after a leave save.
  const [availRefreshKey, setAvailRefreshKey] = useState(0);
  const [availByGuid, setAvailByGuid] = useState<Map<string, AvailWindow[]>>(() => new Map());
  useEffect(() => {
    let alive = true;
    getAllResourceAvailability()
      .then(list => {
        if (!alive) return;
        const m = new Map<string, AvailWindow[]>();
        for (const w of list) {
          const key = String(w.resourceGuid || "").toLowerCase();
          if (!key) continue;
          const arr = m.get(key) ?? [];
          arr.push({ startDate: w.startDate, endDate: w.endDate, availabilityPct: w.availabilityPct, reason: w.reason, leaveType: w.leaveType });
          m.set(key, arr);
        }
        setAvailByGuid(m);
      })
      .catch(() => { /* best-effort: leave the map empty */ });
    return () => { alive = false; };
  }, [availRefreshKey]);
  const windowsForResource = useMemo(
    () => (guid: string): AvailWindow[] | undefined => availByGuid.get(String(guid || "").toLowerCase()),
    [availByGuid],
  );

  const staffResources: LiveResourceProxy[] = useMemo(() => {
    const base = (allocResp?.resources ?? []) as LiveResourceProxy[];
    const qsd = parseLocalDay(selectedQuarter.sd);
    const qed = parseLocalDay(selectedQuarter.ed); // deriveWindowedLoad treats end as inclusive end-of-day
    if (isNaN(qsd) || isNaN(qed)) return base;
    return base.map(r => {
      // Leave-aware capacity: someone available only cap% of the quarter who is
      // e.g. 50% booked is effectively fully loaded, so scale the displayed
      // utilization by 100/cap. All overlap math funnels through the shared
      // alloc-math helper — no inline date logic here. This is the single choke
      // point that feeds the Staff grid, the cards, and the over/under/bench
      // summaries, so every surface agrees by construction.
      const windows = availByGuid.get(String(r.id || "").toLowerCase());
      const cap = avgAvailabilityPct(windows, qsd, qed); // 100 when no leave
      // cap === 0 (fully out for the ENTIRE window): scaling would divide by
      // zero, and any booking is a conflict no multiplier expresses honestly.
      // DELIBERATE choice: leave the raw pct untouched — the "On leave" chip
      // (activeAvailabilityWindow) is the surface that communicates the
      // unavailability, so numbers stay real instead of fabricated.
      const scale = (raw: number) => (cap > 0 && cap < 100 ? Math.round(raw * (100 / cap) * 100) / 100 : raw);
      // Shared windowed-load math (lib/alloc-math) — the same derivation the
      // Daily Briefing, home intelligence, and the server's daily snapshot
      // use, so every surface agrees by construction.
      const load = deriveWindowedLoad(
        (r.allAllocations ?? []) as ActiveAllocationProxy[],
        qsd,
        qed,
      );
      if (!load) {
        const hasAcceptedWeek = hasResourceWeekOverrideInWindow(
          acceptedWeekOverrideList,
          r.id || "",
          qsd,
          qed,
        );
        if (hasAcceptedWeek) {
          return {
            ...r,
            currentPct: 0,
            activeAllocations: [],
            activeProjects: [],
            qTotalHrs: 0,
            qActiveWeeks: 0,
            qMaxConcurrent: 0,
          } as LiveResourceProxy;
        }
        // Nothing booked this quarter — keep backend values, but still scale
        // the reported utilization so partial-availability shows through.
        if (cap > 0 && cap < 100) return { ...r, currentPct: scale(r.currentPct) } as LiveResourceProxy;
        return r;
      }
      return {
        ...r,
        currentPct: scale(load.pct),
        activeAllocations: load.merged as ActiveAllocationProxy[],
        activeProjects: load.merged.map(m => String(m.projectId ?? "")),
        qTotalHrs: load.totalHrs,
        qActiveWeeks: load.activeWeeks,
        qMaxConcurrent: load.maxConcurrent,
      } as LiveResourceProxy;
    });
  }, [allocResp, selectedQuarter.sd, selectedQuarter.ed, availByGuid, acceptedWeekOverrideList]);

  // ── Manager view grid slice: manager + direct reports + project team ──────
  // Reuses the SAME utilization rows as the Timeline tab (identical week
  // math), sliced to the selected person's hierarchy. People with zero
  // allocations this quarter get a synthesized name-only row so the
  // hierarchy stays complete — honest zeros, never fabricated hours.
  // GUIDs absent from the active roster are dropped, not guessed at.
  const managerGrid = useMemo(() => {
    if (view !== "Manager" || !managerSelectedId) return null;
    const mid = managerSelectedId.trim().toLowerCase();
    const rowById = new Map<string, Record<string, unknown>>();
    for (const r of utilRows) {
      const uid = String((r as Record<string, unknown>).UserId ?? "").trim().toLowerCase();
      if (uid && !rowById.has(uid)) rowById.set(uid, r);
    }
    const staffById = new Map<string, { id: string; name: string; title: string }>();
    for (const sr of staffResources) {
      if (sr.id && sr.name) staffById.set(String(sr.id).toLowerCase(), { id: String(sr.id), name: sr.name, title: sr.role || "" });
    }
    const rowFor = (idL: string): Record<string, unknown> | null => {
      const live = rowById.get(idL);
      if (live) return live;
      const sr = staffById.get(idL);
      return sr ? { ResourceUser: sr.name, UserId: sr.id, Title: sr.title } : null;
    };
    const h = managerCtxQ.data;
    // Self/direct-report rows are reserved as one person-level row. Record
    // sections may repeat everyone else once per shared record so every
    // project shows its complete team; those repeated rows are project-scoped.
    // Manager view deliberately scopes both the person-level cells and
    // expansion rows to shared records. Seed every displayed person with an
    // empty scope first so a person with no shared record fails closed instead
    // of falling back to their company-wide allocation history.
    const reserved = new Set<string>([mid]);
    const uniquePeopleUnder = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    const sections: { label: string; userIds: string[]; rowKeys?: string[] }[] = [];
    const projectIdsByPerson = new Map<string, Set<string>>();
    const ensurePersonScope = (personId: string) => {
      const id = personId.trim().toLowerCase();
      if (id && !projectIdsByPerson.has(id)) projectIdsByPerson.set(id, new Set<string>());
    };
    const addScopedProject = (personId: string, projectId: string) => {
      const id = personId.trim().toLowerCase();
      const pid = projectId.trim();
      if (!id || !pid) return;
      const scoped = projectIdsByPerson.get(id) ?? new Set<string>();
      scoped.add(pid);
      projectIdsByPerson.set(id, scoped);
    };
    const pushSection = (label: string, idsL: string[], projectId?: string) => {
      const kept: string[] = [];
      const rowKeys: string[] = [];
      for (const idL of idsL) {
        const r = rowFor(idL);
        if (!r) continue;
        if (projectId) {
          const rowKey = `${projectId.trim().toLowerCase()}::${idL}`;
          rows.push({
            ...r,
            __managerSectionKey: rowKey,
            __managerProjectScope: [projectId],
          });
          rowKeys.push(rowKey);
        } else {
          rows.push(r);
        }
        kept.push(idL);
        ensurePersonScope(idL);
        if (idL !== mid) uniquePeopleUnder.add(idL);
      }
      if (kept.length) sections.push({
        label,
        userIds: kept,
        ...(rowKeys.length ? { rowKeys } : {}),
      });
    };
    const selfRow = rowFor(mid);
    const selfStaff = staffById.get(mid);
    const selfTitle = (selfStaff?.title ?? String(selfRow?.Title ?? "")).trim();
    if (selfRow) {
      rows.push(selfRow);
      ensurePersonScope(mid);
      sections.push({ label: "", userIds: [mid] }); // blank label = no divider above their own row
    }
    // 1. TRUE direct reports (imported Manager/Supervisor relationship).
    const directL: string[] = [];
    for (const d of h?.direct ?? []) {
      const idL = d.id.trim().toLowerCase();
      if (idL && !reserved.has(idL)) { reserved.add(idL); directL.push(idL); }
    }
    pushSection("Direct reports", directL);
    // 2. Per record (led OR plain membership): every other active team member.
    // "Manager" here is a team-context view, not a reporting-line filter: when
    // any person is selected, higher, equal, and lower roles on their shared
    // records must all remain visible. Direct reports stay in their person-level
    // section. Everyone else repeats once per record; each row carries a
    // one-record scope, preventing hour double-counting.
    for (const rec of h?.records ?? []) {
      addScopedProject(mid, rec.ticketId);
      const teammates = rec.team
        .filter(m => m.id.trim().toLowerCase() !== mid)
        .sort((a, b) => a.name.localeCompare(b.name));
      const idsL: string[] = [];
      for (const m of teammates) {
        const idL = m.id.trim().toLowerCase();
        addScopedProject(idL, rec.ticketId);
        if (idL && !reserved.has(idL)) idsL.push(idL);
      }
      pushSection(`${rec.ticketId} — ${rec.title}`, idsL, rec.ticketId);
    }
    const self = selfStaff
      ?? (selfRow ? { id: managerSelectedId, name: String(selfRow.ResourceUser ?? ""), title: selfTitle } : null);
    return {
      rows, sections, self,
      peopleShown: uniquePeopleUnder.size,
      recordCount: h?.records?.length ?? 0,
      projectIdsByPerson: Object.fromEntries(
        [...projectIdsByPerson].map(([personId, projectIds]) => [personId, [...projectIds]]),
      ),
    };
  }, [view, managerSelectedId, managerCtxQ.data, utilRows, staffResources]);

  // The Staff manager dropdown and the Manager view use different API
  // response shapes. Normalize the Manager view's hierarchy into the same
  // shape consumed by ManagerOrgChartPopup so both entry points render the
  // exact same visual chart.
  const managerChartData = useMemo<ManagerStaffResponse | undefined>(() => {
    if (!managerSelectedId || !managerCtxQ.data) return undefined;
    const managerId = managerSelectedId.trim().toLowerCase();
    const directIds = new Set((managerCtxQ.data.direct ?? []).map(d => d.id.trim().toLowerCase()));
    const projectTeam = new Map<string, string>();
    for (const record of managerCtxQ.data.records ?? []) {
      for (const member of record.team ?? []) {
        const id = member.id.trim();
        const idLower = id.toLowerCase();
        if (!id || idLower === managerId || directIds.has(idLower)) continue;
        if (!projectTeam.has(idLower)) projectTeam.set(idLower, record.ticketId);
      }
    }
    return {
      direct: (managerCtxQ.data.direct ?? []).map(d => ({ id: d.id })),
      projectTeam: Array.from(projectTeam, ([id, ticketId]) => ({ id, ticketId })),
      managedProjects: (managerCtxQ.data.records ?? [])
        .map(record => ({
          ticketId: record.ticketId,
          title: record.title,
          leadRole: record.selfIsLead ? "Lead" : "Team",
          teamMemberIds: record.team
            .filter(member => {
              const idLower = member.id.trim().toLowerCase();
              return idLower !== managerId && !directIds.has(idLower);
            })
            .map(member => member.id.trim())
            .filter(Boolean),
        })),
      projectTeamError: managerCtxQ.data.teamError,
    };
  }, [managerSelectedId, managerCtxQ.data]);

  // Default Manager view rows: the whole Timeline grid, live-filtered by the
  // person search while nobody is selected yet.
  const managerDefaultRows = useMemo(() => {
    if (view !== "Manager" || managerSelectedId) return utilRows;
    const q = managerSearch.trim().toLowerCase();
    if (!q) return utilRows;
    return utilRows.filter(r => {
      const rec = r as Record<string, unknown>;
      return String(rec.ResourceUser ?? "").toLowerCase().includes(q)
        || String(rec.Title ?? "").toLowerCase().includes(q);
    });
  }, [view, managerSelectedId, managerSearch, utilRows]);
  const sliderMax = useMemo(() => {
    if (!staffResources.length) return 150;
    const maxPct = Math.max(...staffResources.map(r => r.currentPct));
    return Math.max(150, Math.ceil(maxPct / 10) * 10);
  }, [staffResources]);
  // Auto-expand threshold ceiling when data loads with someone above current max
  useEffect(() => {
    setThreshold(prev => Math.max(prev, sliderMax));
  }, [sliderMax]);
  const projectNameMap = allocResp?.projectNameMap ?? {};
  const projectModuleMap = allocResp?.projectModuleMap ?? {};
  const pName = (pid: string) => projectNameMap[pid] || pid;
  const openProjectTeam = (
    pid: string,
    moduleHint?: "PMM" | "OPM" | "LEM",
    highlightOpen = false,
  ) => {
    // Use the allocation's exact TicketId and explicit module. Never omit the
    // module and let the record page auto-detect this custom ID as a Lead.
    const module = moduleHint || projectModuleMap[pid] || "PMM";
    navigate(`/project/${encodeURIComponent(pid)}?section=team&module=${module}${highlightOpen ? "&highlight=open" : ""}`);
  };
  const openProjectRecord = (
    pid: string,
    moduleHint?: "PMM" | "OPM" | "LEM",
  ) => {
    // Resource assignments belong to projects or opportunities. If an
    // ambiguous/custom TicketId inherited a Lead hint from the global map,
    // never send the user to the Leads page from an allocation row.
    const hintedModule = moduleHint || projectModuleMap[pid];
    const module = hintedModule === "OPM" ? "OPM" : "PMM";
    navigate(`/project/${encodeURIComponent(pid)}?module=${module}`);
  };
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  // Cards vs dense Data Grid rendering for the staff list (persisted preference)
  const [staffViewMode, setStaffViewMode] = useState<"cards" | "grid">(() => {
    if (typeof window === "undefined") return "cards";
    try { return localStorage.getItem("rmone:staffViewMode") === "grid" ? "grid" : "cards"; } catch { return "cards"; }
  });
  useEffect(() => {
    try { localStorage.setItem("rmone:staffViewMode", staffViewMode); } catch { /* ignore */ }
  }, [staffViewMode]);
  const [profileResource, setProfileResource] = useState<LiveResourceProxy | null>(null);
  const [availabilityDetail, setAvailabilityDetail] = useState<{
    resource: LiveResourceProxy;
    availability: AvailWindow;
  } | null>(null);
  // When navigating from Quick Actions, the URL carries ?openProfile=<guid>.
  // Once staffResources is loaded, open the matching profile and clear the param.
  const openProfileGuid = useRef(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("openProfile") ?? ""
      : "",
  );
  const openProfileFired = useRef(false);
  useEffect(() => {
    const guid = openProfileGuid.current;
    if (!guid || openProfileFired.current) return;
    if (!staffResources.length) return; // wait for data
    const r = staffResources.find((x) =>
      (x.id || "").toLowerCase() === guid.toLowerCase() ||
      (x.username || "").toLowerCase() === guid.toLowerCase(),
    );
    // Only consume the param once a match is actually found — a transient or
    // partial resource list must NOT permanently swallow the request; we keep
    // retrying on every staffResources update until the person appears.
    if (!r) return;
    openProfileFired.current = true;
    setProfileResource(r);
    // Strip the param from the URL so a refresh doesn't re-trigger.
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("openProfile");
      const next = sp.toString() ? `?${sp.toString()}` : window.location.pathname;
      window.history.replaceState({}, "", next);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffResources]);
  const [editResource, setEditResource] = useState<LiveResourceProxy | null>(null);
  // Bumped whenever the Edit Staff modal saves — StaffCards refetch their
  // Postgres-side skills/experience tags (those are fetched once per card and
  // would otherwise show stale chips until a full page reload).
  const [staffPgVersion, setStaffPgVersion] = useState(0);
  const [aiAnalysis, setAiAnalysis] = useState<{
    name: string;
    subtitle: string;
    prompt: string;
    clickedPeriod?: string;
    ganttProjects: { projectId: string; name: string; startDate: string; endDate: string; pct: number }[];
    qRange: { sd: string; ed: string };
  } | null>(null);

  const [ganttModal, setGanttModal] = useState<{
    name: string;
    subtitle: string;
    ganttProjects: { projectId: string; name: string; startDate: string; endDate: string; pct: number }[];
    qRange: { sd: string; ed: string };
  } | null>(null);

  // Staff-grid Conflict cell → same AI conflict analysis modal as the Projects tab.
  const [conflictModal, setConflictModal] = useState<{
    memberName: string;
    role: string;
    projectName: string;
    projectId: string;
    thisPct: number;
    thisHrs: number;
    otherProjects: { id: string; name: string; pct: number; hrs: number }[];
  } | null>(null);

  // Staff-grid Active/Total Projects cells → project-list popup (no AI).
  const [staffListModal, setStaffListModal] = useState<{
    r: LiveResourceProxy;
    mode: StaffModalMode;
    /** Present only for a selected Manager hierarchy row. */
    projectScope?: string[];
    /** Hierarchy owner's display name — labels the scoped popup honestly. */
    scopeOwnerName?: string;
  } | null>(null);
  // Staff-grid three-dots menu → person-filtered audit trail popup.
  const [auditResource, setAuditResource] = useState<LiveResourceProxy | null>(null);
  // Staff-grid three-dots assignment actions stay on Resources: first pick the
  // target record, then reuse the shared Add Team Member modal in place.
  const [staffAssignmentAction, setStaffAssignmentAction] = useState<{
    resource: LiveResourceProxy;
    target: StaffAssignmentTarget;
  } | null>(null);
  // Shared by the Staff Data Grid and Cards views so the three-dots menu
  // exposes the same actions, permissions, and in-place popups in both.
  const handleStaffDotsAction = (r: LiveResourceProxy, action: StaffQuickAction) => {
    if (action === "audit") {
      setAuditResource(r);
      return;
    }
    if (action === "allocation") {
      setStaffListModal({ r, mode: "all" });
      return;
    }
    if (action === "edit") {
      if (!canManageStaff && staffSelfRevert && r.username === currentUsername) {
        setSelfRevertConfirm(true);
        setSelfRevertErr(null);
      } else if (canManageStaff) {
        setEditResource(r);
      } else {
        toast({
          title: "This action is locked",
          description: "Your access level doesn't allow managing staff. Ask an administrator for help.",
        });
      }
      return;
    }
    if (!canManageStaff) {
      toast({
        title: "This action is locked",
        description: "Your access level doesn't allow managing staff. Ask an administrator for help.",
      });
      return;
    }
    setStaffAssignmentAction({ resource: r, target: action });
  };
  // When arriving from an over-allocation alert ("Edit Allocation" on a
  // person spread across multiple projects), the URL carries
  // ?openTimeline=<guid|username|display name>. Once resources load, open
  // that person's full timeline popup (all projects, weekly editing) and
  // strip the param. Same retry-until-found contract as openProfile above:
  // a transient/partial resource list must not swallow the request.
  const openTimelineKey = useRef(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("openTimeline") ?? ""
      : "",
  );
  const openTimelineFired = useRef(false);
  useEffect(() => {
    const key = openTimelineKey.current.trim().toLowerCase();
    if (!key || openTimelineFired.current) return;
    if (!staffResources.length) return; // wait for data
    const r = staffResources.find((x) =>
      (x.id || "").toLowerCase() === key ||
      (x.username || "").toLowerCase() === key ||
      (x.name || "").trim().toLowerCase() === key,
    );
    if (!r) return; // keep retrying on every staffResources update
    openTimelineFired.current = true;
    setStaffListModal({ r, mode: "all" });
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("openTimeline");
      const next = sp.toString() ? `?${sp.toString()}` : window.location.pathname;
      window.history.replaceState({}, "", next);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffResources]);
  // Staff member the grid "AI Analysis" slide-in panel is open for.
  const [aiStaffTarget, setAiStaffTarget] = useState<LiveResourceProxy | null>(null);

  const [weekColModal, setWeekColModal] = useState<{ period: string } | null>(null);

  type CellModalState = {
    name: string;
    userId?: string;
    role: string;
    period: string;
    pct: number;
    hours: number;
    projects: number;
    weeks: CellWeek[];
    projList: { pid: string; name: string; color: string; module?: "PMM" | "OPM" | "LEM" }[];
    projectAllocs: { projectId: string; projectName: string; module?: "PMM" | "OPM" | "LEM"; pct: number; startDate: string; endDate: string }[];
    /** Manager view only: records shared with the selected hierarchy owner. */
    projectScope?: string[];
  };
  const [cellModal, setCellModal] = useState<CellModalState | null>(null);

  /* Weekly Hours modal — pure data view (no AI) opened from the staff grid
     Allocation / Active Projects cells and Timeline person clicks. */
  const [weeklyHours, setWeeklyHours] = useState<{
    name: string;
    role: string;
    focus: "allocation" | "active";
    pct: number;
    activeCount: number;
    weeks: CellWeek[];
    projList: { pid: string; name: string; color: string }[];
  } | null>(null);

  /* ── Shared per-person weekly hours series ──
     Used by the grid cell popup AND the Weekly Hours modal (Allocation /
     Active Projects / Timeline person clicks).
     Preferred source: the person's full allocation records (covers ALL
     weeks, not just the visible quarter) with per-project weekly hours.
     Fallback: the quarter's grid cells, splitting each week's hours by
     the per-project pct encoded in the cell. */
  const buildPersonWeekly = (name: string, userId?: string, resolvedStaffRow?: LiveResourceProxy) => {
    const uid = userId?.trim().toLowerCase();
    const row = uid
      ? utilRows.find((r) => String((r as Record<string,unknown>).UserId ?? "").toLowerCase() === uid)
        ?? utilRows.find((r) => String(r.ResourceUser ?? "").toLowerCase() === name.toLowerCase())
      : utilRows.find((r) => String(r.ResourceUser ?? "").toLowerCase() === name.toLowerCase());

    const staffRow = resolvedStaffRow ?? (uid
      ? (staffResources.find((r) => (r.id || "").toLowerCase() === uid || (r.username || "").toLowerCase() === uid)
          ?? staffResources.find((r) => r.name.toLowerCase().trim() === name.toLowerCase().trim()))
      : staffResources.find((r) => r.name.toLowerCase().trim() === name.toLowerCase().trim()));
    const rawAllocEntries = (staffRow?.allAllocations ?? staffRow?.activeAllocations ?? []) as ActiveAllocationProxy[];
    // Do not let placeholder 0 / missing RDS dates manufacture a 1970
    // workload timeline. If the full allocation feed is incomplete, the
    // visible utilization-grid cells below remain the authoritative fallback.
    const allocEntries = rawAllocEntries.filter((entry) => {
      const start = parseLocalDay(entry.startDate);
      const end = parseLocalDay(entry.endDate);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start;
    });
    const wkHours = getBusinessRules().workWeekHours || 40;

    let weeks: CellWeek[] = [];
    if (allocEntries.length > 0) {
      let minS = Infinity, maxE = -Infinity;
      for (const e of allocEntries) {
        const s = parseLocalDay(e.startDate), en = parseLocalDay(e.endDate);
        if (!isNaN(s)) minS = Math.min(minS, s);
        if (!isNaN(en)) maxE = Math.max(maxE, en);
      }
      if (isFinite(minS) && isFinite(maxE) && maxE >= minS) {
        const cursor = new Date(mondayOf(minS));
        while (cursor.getTime() <= maxE && weeks.length < 520) {
          const ws = cursor.getTime();
          const weNext = new Date(cursor); weNext.setDate(weNext.getDate() + 7);
          const we = weNext.getTime() - 1;
          const segMap = new Map<string, number>();
          const inWeek = allocEntries.filter(e => {
            const s = parseLocalDay(e.startDate), en = parseLocalDay(e.endDate);
            return !isNaN(s) && !isNaN(en) && s <= we && en >= ws;
          });
          // hours-win: real hours replace the %-plan for this week, never add.
          for (const e of hoursWinFilter(inWeek)) segMap.set(e.projectId, (segMap.get(e.projectId) ?? 0) + allocEntryHrsPerWeek(e, getBusinessRules().workWeekHours));
          const segs = Array.from(segMap.entries())
            .map(([pid, hrs]) => ({ pid, hrs: Math.round((hrs + Number.EPSILON) * 100) / 100 }))
            .filter((s) => s.hrs > 0);
          const hrs = Math.round((segs.reduce((s, x) => s + x.hrs, 0) + Number.EPSILON) * 100) / 100;
          weeks.push({ start: ws, hrs, pct: Math.round((hrs / wkHours) * 1000) / 10, segs });
          cursor.setDate(cursor.getDate() + 7);
        }
      }
    }
    if (weeks.length === 0 && row) {
      /* Fallback: quarter cells only — split each week's hours by encoded pcts */
      weeks = utilPeriods
        .map((p) => {
          const c = parseUtilCell(row[p]);
          const start = parsePeriodKey(p);
          if (isNaN(start)) return null;
          const hrs = c?.h ?? 0;
          const ids = c?.projectIds ?? [];
          const pctSum = ids.reduce((s, x) => s + x.pct, 0);
          const splitHours = splitTotalHoursByWeights(hrs, pctSum > 0 ? ids.map(x => x.pct) : ids.map(() => 1));
          const segs = hrs > 0 && ids.length > 0
            ? ids.map((x, index) => ({ pid: x.pid, hrs: splitHours[index] }))
            : hrs > 0 ? [{ pid: "", hrs }] : [];
          return { start: mondayOf(start), hrs, pct: c?.p ?? 0, segs };
        })
        .filter((w): w is CellWeek => w !== null);
    }

    /* Stable color per project — ordered by total hours desc */
    const totalsByPid = new Map<string, number>();
    for (const w of weeks) for (const s of w.segs) if (s.pid) totalsByPid.set(s.pid, (totalsByPid.get(s.pid) ?? 0) + s.hrs);
    const nameByPid = new Map<string, string>();
    const moduleByPid = new Map<string, "PMM" | "OPM" | "LEM">();
    for (const e of allocEntries) {
      if (e.projectName && e.projectName !== e.projectId && !nameByPid.has(e.projectId)) nameByPid.set(e.projectId, e.projectName);
      if (e.module && !moduleByPid.has(e.projectId)) moduleByPid.set(e.projectId, e.module);
    }
    const projList = Array.from(totalsByPid.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([pid], i) => ({
        pid,
        name: nameByPid.get(pid) ?? pName(pid),
        color: PROJ_PALETTE[i % PROJ_PALETTE.length],
        module: moduleByPid.get(pid) || projectModuleMap[pid],
      }));

    /* Sort every week's segments by overall project size (desc) so the
       largest project always sits at the bottom of the stacked bar and the
       stack order matches the legend. */
    for (const w of weeks) {
      w.segs.sort((a, b) => (totalsByPid.get(b.pid) ?? 0) - (totalsByPid.get(a.pid) ?? 0));
    }

    const projectAllocsById = new Map<string, {
      projectId: string;
      projectName: string;
      module?: "PMM" | "OPM" | "LEM";
      pct: number;
      startDate: string;
      endDate: string;
    }>();
    for (const entry of allocEntries) {
      const projectId = entry.projectId?.trim();
      if (!projectId) continue;
      const existing = projectAllocsById.get(projectId);
      if (existing) {
        existing.pct += entry.pct || 0;
        continue;
      }
      projectAllocsById.set(projectId, {
        projectId,
        projectName: entry.projectName?.trim() || pName(projectId),
        module: entry.module || projectModuleMap[projectId],
        pct: entry.pct || 0,
        startDate: entry.startDate,
        endDate: entry.endDate,
      });
    }

    return { row, staffRow, weeks, projList, projectAllocs: [...projectAllocsById.values()] };
  };

  const buildCellModalState = (
    name: string,
    period: string,
    cell: { p: number; h: number; c: number; projectIds?: { pid: string; pct: number }[] },
    userId?: string,
    resolvedStaffRow?: LiveResourceProxy,
    projectScope?: string[],
  ): CellModalState => {
    const {
      row,
      staffRow,
      weeks: allAllocationWeeks,
      projList: allAllocationProjList,
      projectAllocs: allAllocationProjectAllocs,
    } = buildPersonWeekly(name, userId, resolvedStaffRow);
    // Provided-but-empty scope = "no shared records": filter to nothing
    // rather than falling open to the person's full history.
    const scopeKeys = projectScope
      ? new Set(projectScope.map(projectId => projectId.trim().toLowerCase()))
      : null;
    const inScope = (projectId: string) =>
      !scopeKeys || scopeKeys.has(projectId.trim().toLowerCase());
    // A Manager hierarchy row represents only the selected person's shared
    // records. Never let the person's unrelated assignments leak into that
    // row's drill-down merely because buildPersonWeekly loads their full
    // company-wide allocation history.
    const allocationWeeks = scopeKeys
      ? allAllocationWeeks.map(week => {
          const segs = week.segs.filter(segment => inScope(segment.pid));
          const hrs = Math.round((segs.reduce((sum, segment) => sum + segment.hrs, 0) + Number.EPSILON) * 100) / 100;
          const wkHours = getBusinessRules().workWeekHours || 40;
          return { ...week, segs, hrs, pct: Math.round((hrs / wkHours) * 1000) / 10 };
        })
      : allAllocationWeeks;
    const allocationProjList = scopeKeys
      ? allAllocationProjList.filter(project => inScope(project.pid))
      : allAllocationProjList;
    const allocationProjectAllocs = scopeKeys
      ? allAllocationProjectAllocs.filter(project => inScope(project.projectId))
      : allAllocationProjectAllocs;
    const canonicalizeProjectRefs = (refs: { pid: string; pct: number }[]) =>
      canonicalizeResourcePopupProjectRefs(refs, allAllocationProjectAllocs, pName)
        .filter(({ pid }) => inScope(pid));
    const clickedProjectRefs = canonicalizeProjectRefs(cell.projectIds ?? []);
    const selectedWeek = mondayOf(parsePeriodKey(period));
    const clickedProjectIds = new Set(clickedProjectRefs.map(({ pid }) => pid));
    const selectedAllocationWeek = allocationWeeks.find((week) => week.start === selectedWeek);
    const selectedAllocationProjectIds = new Set(
      (selectedAllocationWeek?.segs ?? [])
        .filter(segment => segment.hrs > 0)
        .map(segment => segment.pid),
    );
    const overlappingClickedProjectCount = [...clickedProjectIds]
      .filter(projectId => selectedAllocationProjectIds.has(projectId))
      .length;
    // If none of the IDs overlap, the compact grid may be carrying a display
    // alias while the allocation feed carries the canonical TicketId. A
    // matching total is enough in that case. If even one ID is comparable,
    // require the allocation week to cover the ENTIRE clicked set so a stale
    // A-only detail row cannot replace an authoritative A+B grid cell.
    const selectedWeekCoversClickedProjects = clickedProjectIds.size === 0
      || overlappingClickedProjectCount === 0
      || [...clickedProjectIds].every(projectId => selectedAllocationProjectIds.has(projectId));
    const selectedWeekMatchesAllocationTotal = Boolean(
      selectedAllocationWeek
      && selectedAllocationWeek.hrs > 0
      && Math.abs(selectedAllocationWeek.hrs - cell.h) < 0.1,
    );

    // The clicked cell is already the server-calculated truth for this
    // quarter. Prefer the complete allocation timeline when it contains that
    // exact person/project/Monday identity; otherwise use the visible grid
    // series so an allocation never disappears merely because a legacy source
    // row has missing dates or sits outside the detail feed.
    const gridWeeks: CellWeek[] = row
      ? utilPeriods.map((gridPeriod) => {
          const gridCell = parseUtilCell(row[gridPeriod]);
          const start = parsePeriodKey(gridPeriod);
          if (!Number.isFinite(start)) return null;
          const ids = canonicalizeProjectRefs(gridCell?.projectIds ?? []);
          const pctSum = ids.reduce((sum, item) => sum + item.pct, 0);
          const totalHours = gridCell?.h ?? 0;
          const splitHours = splitTotalHoursByWeights(totalHours, pctSum > 0 ? ids.map(item => item.pct) : ids.map(() => 1));
          const segs = totalHours > 0 && ids.length > 0
            ? ids.map((item, index) => ({
                pid: item.pid,
                hrs: splitHours[index],
              }))
            : [];
          return {
            start: mondayOf(start),
            hrs: totalHours,
            pct: gridCell?.p ?? 0,
            segs,
          };
        }).filter((week): week is CellWeek => week !== null)
      : [];
    // The compact utilization response can retain a display alias in `IDS`
    // (for example "testtt") while the person's allocation rows hold the
    // canonical OPM/PMM ticket. When the weekly total agrees, the allocation
    // rows are the richer, editable source and match the person-name popup.
    const useAllocationDetails = Boolean(scopeKeys) || gridWeeks.length === 0
      || (selectedWeekMatchesAllocationTotal && selectedWeekCoversClickedProjects);
    const weeks = useAllocationDetails ? allocationWeeks : gridWeeks;

    // Keep projects advertised by the clicked cell even if an older allocation
    // feed cannot resolve their span. This makes the popup agree with the
    // `30 / 1 project` cell the user just selected.
    const knownProjectIds = new Set(allocationProjList.map((project) => project.pid));
    const projList = useAllocationDetails
      ? allocationProjList
      : [
          ...allocationProjList,
          ...clickedProjectRefs
            .filter(({ pid }) => !knownProjectIds.has(pid))
            .map(({ pid }, index) => ({
              pid,
              name: pName(pid),
              color: PROJ_PALETTE[(allocationProjList.length + index) % PROJ_PALETTE.length],
            })),
        ];

    /* Build project allocations directly from the cell's encoded project IDs —
       same source as the hours, no dependency on a separate staffResources lookup
       that may be stale or mismatched. */
    const projectAllocs = useAllocationDetails
      ? allocationProjectAllocs
      : clickedProjectRefs
          .sort((a, b) => b.pct - a.pct)
          .map(({ pid, pct }) => ({
            projectId: pid,
            projectName: pName(pid),
            pct,
            startDate: "",
            endDate: "",
          }));
    return {
      name,
      userId: userId || staffRow?.id,
      role: staffRow?.roleName || staffRow?.role || "",
      period,
      pct: scopeKeys
        ? (selectedAllocationWeek?.pct ?? 0)
        : cell.p,
      hours: scopeKeys
        ? (selectedAllocationWeek?.hrs ?? 0)
        : cell.h,
      projects: scopeKeys
        ? (selectedAllocationWeek?.segs.filter(segment => segment.hrs > 0).length ?? 0)
        : cell.c,
      weeks,
      projList,
      projectAllocs,
      projectScope,
    };
  };
  const openCellModal = (
    name: string,
    period: string,
    cell: { p: number; h: number; c: number; projectIds?: { pid: string; pct: number }[] },
    userId?: string,
    resolvedStaffRow?: LiveResourceProxy,
    projectScope?: string[],
  ) => {
    setCellModal(buildCellModalState(name, period, cell, userId, resolvedStaffRow, projectScope));
  };
  const liveCellModal = cellModal
    ? (() => {
        const uid = cellModal.userId?.trim().toLowerCase();
        const liveRow = uid
          ? utilRows.find(row => String(row.UserId ?? "").trim().toLowerCase() === uid)
            ?? utilRows.find(row => String(row.ResourceUser ?? "").trim().toLowerCase() === cellModal.name.trim().toLowerCase())
          : utilRows.find(row => String(row.ResourceUser ?? "").trim().toLowerCase() === cellModal.name.trim().toLowerCase());
        if (!liveRow) return cellModal;
        const liveCell = parseUtilCell(liveRow[cellModal.period]) ?? {
          p: 0,
          h: 0,
          c: 0,
          projectIds: [],
        };
        const liveStaffRow = uid
          ? staffResources.find(row =>
              row.id.trim().toLowerCase() === uid
              || (row.username || "").trim().toLowerCase() === uid
            )
          : staffResources.find(row => row.name.trim().toLowerCase() === cellModal.name.trim().toLowerCase());
        const rebuilt = buildCellModalState(
          cellModal.name,
          cellModal.period,
          liveCell,
          cellModal.userId,
          liveStaffRow,
          cellModal.projectScope,
        );
        return {
          ...rebuilt,
          role: rebuilt.role || cellModal.role,
        };
      })()
    : null;

  const openWeeklyHours = (r: LiveResourceProxy, focus: "allocation" | "active") => {
    /* Approved Gantt design (mockup 3): same person popup as the staff list,
       in the mode matching the clicked cell. */
    setStaffListModal({ r, mode: focus === "allocation" ? "allocation" : "active" });
  };

  const openWeeklyHoursByName = (
    name: string,
    userId?: string,
    projectScope?: string[],
    scopeOwnerName?: string,
  ) => {
    const { staffRow, weeks, projList } = buildPersonWeekly(name, userId);
    if (staffRow) {
      /* Approved Gantt design (mockup 3): person popup with monthly capacity
         bars + phase-colored project Gantt — same modal as the staff list. */
      setStaffListModal({ r: staffRow, mode: "all", projectScope, scopeOwnerName });
      return;
    }
    // No staff row → legacy weekly-hours popup. It honors the Manager
    // hierarchy scope too: provided-but-empty = nothing shared (fail closed),
    // absent = the person's full history.
    const scopeSet = projectScope
      ? new Set(projectScope.map(projectId => projectId.trim().toLowerCase()))
      : null;
    const wkHours = getBusinessRules().workWeekHours || 40;
    const scopedWeeks = scopeSet
      ? weeks.map(week => {
          const segs = week.segs.filter(segment => scopeSet.has(segment.pid.trim().toLowerCase()));
          const hrs = Math.round((segs.reduce((sum, segment) => sum + segment.hrs, 0) + Number.EPSILON) * 100) / 100;
          return { ...week, segs, hrs, pct: Math.round((hrs / wkHours) * 1000) / 10 };
        })
      : weeks;
    const scopedProjList = scopeSet
      ? projList.filter(project => scopeSet.has(project.pid.trim().toLowerCase()))
      : projList;
    const activeWeeks = scopedWeeks.filter((w) => w.hrs > 0);
    const avgPct = activeWeeks.length > 0
      ? Math.round((activeWeeks.reduce((s, w) => s + w.pct, 0) / activeWeeks.length) * 10) / 10
      : 0;
    setWeeklyHours({
      name,
      role: "",
      focus: "allocation",
      pct: avgPct,
      activeCount: scopedProjList.length,
      weeks: scopedWeeks,
      projList: scopedProjList,
    });
  };

  const openAnalysis = (name: string, clickedPeriod?: string, userId?: string) => {
    window.dispatchEvent(new CustomEvent("rmone:gridViewActivated"));
    const uid = userId?.trim().toLowerCase();
    const row = uid
      ? filteredUtilRows.find((r) => String((r as Record<string,unknown>).UserId ?? "").toLowerCase() === uid)
        ?? filteredUtilRows.find((r) => String(r.ResourceUser ?? "").toLowerCase() === name.toLowerCase())
      : filteredUtilRows.find((r) => String(r.ResourceUser ?? "").toLowerCase() === name.toLowerCase());
    const allWeeks = row
      ? utilPeriods
          .map((p) => {
            const c = parseUtilCell(row[p]);
            return c ? { period: p, p: c.p, h: c.h, c: c.c } : null;
          })
          .filter((x): x is { period: string; p: number; h: number; c: number } => x !== null && x.h > 0)
      : [];
    const totalHrs = allWeeks.reduce((s, w) => s + w.h, 0);
    const avgPct = allWeeks.length > 0
      ? Math.round(allWeeks.reduce((s, w) => s + w.p, 0) / allWeeks.length)
      : 0;
    const aiRules = getBusinessRules();
    const overWeeks = allWeeks.filter((w) => w.p >= aiRules.overCapacityPct).length;
    const underWeeks = allWeeks.filter((w) => w.p > 0 && w.p <= aiRules.underAllocatedPct).length;
    const peakWeek = allWeeks.reduce<{ period: string; p: number; h: number; c: number } | null>(
      (m, w) => (!m || w.p > m.p ? w : m), null,
    );
    /* Convert raw period key "Apr-20-26" → human-readable "Apr 20" */
    const fmtPeriod = (p: string) => {
      const m = p.match(/^([A-Z][a-z]{2})-(\d{1,2})-/);
      return m ? `${m[1]} ${parseInt(m[2], 10)}` : p;
    };
    const recent = allWeeks.slice(-8).map((w) => `${fmtPeriod(w.period)}: ${w.p}%, ${w.h}h`).join(" | ");
    const idleWeeks = utilPeriods.length - allWeeks.length;
    const gapVsTarget = aiRules.targetUtilizationPct - avgPct;

    /* Build active-project context for the AI prompt — use allAllocations
       filtered to overlap with the viewed quarter, so past-quarter projects show up */
    const staffRow = uid
      ? (staffResources.find((r) => (r.id || "").toLowerCase() === uid)
          ?? staffResources.find((r) => r.name.toLowerCase().trim() === name.toLowerCase().trim()))
      : staffResources.find((r) => r.name.toLowerCase().trim() === name.toLowerCase().trim());
    const qStartMs = new Date(selectedQuarter.sd).getTime();
    const qEndMs   = new Date(selectedQuarter.ed).getTime();
    const qAllocs = (staffRow?.allAllocations ?? staffRow?.activeAllocations ?? [])
      .filter(a => {
        const s = new Date(a.startDate).getTime();
        const e = new Date(a.endDate).getTime();
        return !isNaN(s) && !isNaN(e) && s <= qEndMs && e >= qStartMs;
      });
    /* Deduplicate by projectId — sum pct, keep best resolved name */
    const projMap = new Map<string, { pct: number; name: string }>();
    for (const a of qAllocs) {
      const resolvedName = (a.projectName && a.projectName !== a.projectId)
        ? a.projectName : pName(a.projectId);
      const cur = projMap.get(a.projectId);
      if (!cur) {
        projMap.set(a.projectId, { pct: a.pct, name: resolvedName });
      } else {
        projMap.set(a.projectId, {
          pct: cur.pct + a.pct,
          name: (cur.name && cur.name !== a.projectId) ? cur.name : resolvedName,
        });
      }
    }
    const activeAllocs = Array.from(projMap.entries())
      .map(([projectId, v]) => ({ projectId, pct: v.pct, name: v.name }))
      .sort((a, b) => b.pct - a.pct);
    const projectsLine = activeAllocs.length > 0
      ? `Active projects for ${name} in ${selectedQ}: ` +
        activeAllocs.map((a) => {
          const hrs = Math.round((a.pct / 100) * getBusinessRules().workWeekHours);
          /* If name resolved, show "Name (ID) ~Xh/wk"; else just "ID ~Xh/wk" */
          return a.name !== a.projectId
            ? `${a.name} (${a.projectId}) — ~${hrs}h/wk at ${a.pct}%`
            : `${a.projectId} — ~${hrs}h/wk at ${a.pct}%`;
        }).join("; ") + "."
      : `No project allocations on record for ${name} during ${selectedQ}.`;

    /* Build Gantt data — merge weekly rows per project into min-start → max-end span */
    const ganttMap = new Map<string, { startMs: number; endMs: number; pct: number; bestName: string }>();
    for (const a of qAllocs) {
      const s = new Date(a.startDate).getTime();
      const e = new Date(a.endDate).getTime();
      if (isNaN(s) || isNaN(e)) continue;
      const resolvedName = (a.projectName && a.projectName !== a.projectId) ? a.projectName : pName(a.projectId);
      const cur = ganttMap.get(a.projectId);
      if (!cur) {
        ganttMap.set(a.projectId, { startMs: s, endMs: e, pct: a.pct, bestName: resolvedName });
      } else {
        ganttMap.set(a.projectId, {
          startMs: Math.min(cur.startMs, s),
          endMs: Math.max(cur.endMs, e),
          pct: Math.max(cur.pct, a.pct),
          /* keep the best name: prefer one that isn't just the project ID */
          bestName: (cur.bestName && cur.bestName !== a.projectId) ? cur.bestName : resolvedName,
        });
      }
    }
    const ganttProjects = Array.from(ganttMap.entries())
      .map(([projectId, v]) => ({
        projectId,
        name: v.bestName,
        startDate: new Date(v.startMs).toISOString().split("T")[0],
        endDate: new Date(v.endMs).toISOString().split("T")[0],
        pct: v.pct,
      }))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    const subtitle = allWeeks.length > 0
      ? `${selectedQ} · avg ${avgPct}% · ${totalHrs}h total · ${allWeeks.length} active week${allWeeks.length === 1 ? "" : "s"}`
      : `${selectedQ} · no active allocation`;
    const clickedWeekData = clickedPeriod ? allWeeks.find(w => w.period === clickedPeriod) : null;
    const clickedLabel = clickedPeriod
      ? (() => { const m = clickedPeriod.match(/^([A-Z][a-z]{2})-(\d{1,2})-/); const months: Record<string,string> = { Jan:"1",Feb:"2",Mar:"3",Apr:"4",May:"5",Jun:"6",Jul:"7",Aug:"8",Sep:"9",Oct:"10",Nov:"11",Dec:"12" }; return m ? `${months[m[1]] ?? m[1]}/${m[2]}` : clickedPeriod; })()
      : null;

    const clickedContext = clickedWeekData
      ? `The user specifically clicked on week ${clickedLabel} (${clickedWeekData.p}%, ${clickedWeekData.h}h). Lead your analysis by explaining what is happening THAT specific week first, then provide the broader quarter context.\n`
      : clickedPeriod
        ? `The user specifically clicked on week ${clickedLabel} which shows 0h (idle). Lead by noting this week is idle, then explain the broader pattern.\n`
        : "";

    const peakLabel = peakWeek ? fmtPeriod(peakWeek.period) : "TBD";
    const driverInstruction = clickedWeekData
      ? `DRIVER: <one sentence: say which project caused the ${clickedWeekData.h}h (${clickedWeekData.p}%) on ${clickedLabel} — use the project's real name from the list above, not its ID>`
      : clickedPeriod && !clickedWeekData
        ? `DRIVER: <one sentence: explain why ${clickedLabel} is 0h — is this person not scheduled during this period? Reference the project dates above>`
        : `DRIVER: <one sentence: name which project drove the peak of ${peakWeek?.p ?? 0}% (${peakWeek?.h ?? 0}h) on ${peakLabel} — use the project's real name, not its ID>`;

    /* ── Zero-allocation case: build profile + history context for project suggestions ── */
    const isZeroAlloc = totalHrs === 0;
    const personBU   = (staffRow?.businessUnit  || "").trim();
    const personDiv  = (staffRow?.divisionName  || "").trim();
    const personRole = (staffRow?.roleName      || "").trim();
    const personDept = (staffRow?.departmentName|| "").trim();
    const personTitle= (staffRow?.role          || "").trim();

    /* Historical projects — all allocations ever, not just this quarter */
    const histAllocIds = new Set<string>();
    const histAllocs: string[] = [];
    for (const a of (staffRow?.allAllocations ?? staffRow?.activeAllocations ?? [])) {
      if (!histAllocIds.has(a.projectId)) {
        histAllocIds.add(a.projectId);
        const rn = (a.projectName && a.projectName !== a.projectId) ? a.projectName : pName(a.projectId);
        if (rn && rn !== a.projectId) histAllocs.push(rn);
      }
    }
    /* Also try allProjectIds as fallback */
    for (const pid of (staffRow?.allProjectIds ?? [])) {
      if (!histAllocIds.has(pid)) {
        histAllocIds.add(pid);
        const rn = pName(pid);
        if (rn && rn !== pid) histAllocs.push(rn);
      }
    }
    const histLine = histAllocs.length > 0
      ? `Historical projects ${name} has worked on: ${histAllocs.slice(0, 8).join("; ")}.`
      : `No historical project records found for ${name}.`;

    const profileLine = [
      personBU   && `BU: ${personBU}`,
      personDiv  && getBusinessRules().showDivision && `Division: ${personDiv}`,
      personDept && `Dept: ${personDept}`,
      personRole && `Role: ${personRole}`,
      personTitle && personTitle !== personRole && `Job Title: ${personTitle}`,
    ].filter(Boolean).join(" | ");

    const zeroAllocPrompt =
      `Analyze ${name}'s bench status in ${selectedQ} and return EXACTLY 7 labeled lines — no extra text, no markdown, no blank lines between them.\n\n` +
      `DATA for ${name}:\n` +
      `- Active weeks: 0 of ${utilPeriods.length} — completely unallocated this quarter\n` +
      `- ${profileLine || "No org profile found"}\n` +
      `- ${histLine}\n` +
      `- No project allocations on record for ${name} during ${selectedQ}.\n\n` +
      `TASK: Based on this person's BU, role, and historical project experience, identify 2–3 CURRENTLY ACTIVE projects (In Progress, Pre-Construction, Active status) from the PMM/OPM project data you already have that would be a good fit. Match on BU, sector, role type, or prior similar work. List each with its real project name (not just the ID) and one short reason for the match. If BU or role are blank, use historical project names as context clues.\n\n` +
      `RULES:\n` +
      `• Write every line as a natural, complete English sentence.\n` +
      `• Always use the project's real name, never just the raw ID.\n` +
      `• Every line below STATUS must include at least one specific number or project name.\n` +
      `• Do not call any tools. Use only the data above and the active project list already in your context.\n\n` +
      `OUTPUT FORMAT (copy labels exactly, one line each):\n` +
      `STATUS: under\n` +
      `HEADLINE: <one sentence — state that ${name} has 0 hours across all ${utilPeriods.length} weeks and is fully available>\n` +
      `DRIVER: <one sentence — describe this person's profile: their role/BU/division and what type of work they typically do>\n` +
      `TREND: <one sentence — summarize their historical project experience from the list above, e.g. what sectors or project types they've worked on>\n` +
      `INSIGHT: <one sentence — note that ${name} is 100% available this quarter and could absorb roughly ${aiRules.workWeekHours}h/week (${Math.round(aiRules.workWeekHours * utilPeriods.length)}h total capacity)>\n` +
      `REC: <one sentence — recommend the single best project match from the active list and why, using the project's real name>\n` +
      `SUGGEST: <list 2–3 additional suitable active projects separated by " | " — for each give: "Project Name (ID if known) — reason for match">`;

    const prompt = isZeroAlloc ? zeroAllocPrompt : (
      `Analyze ${name}'s workload in ${selectedQ} and return EXACTLY 6 labeled lines — no extra text, no markdown, no blank lines between them.\n\n` +
      `${clickedContext}` +
      `DATA for ${name}:\n` +
      `- Active weeks: ${allWeeks.length} of ${utilPeriods.length} (${idleWeeks} idle at 0h)\n` +
      `- Avg utilization: ${avgPct}% | Total hours: ${totalHrs}h\n` +
      `- Over-allocated weeks (≥${aiRules.overCapacityPct}%): ${overWeeks} | Under-utilized weeks (≤${aiRules.underAllocatedPct}%): ${underWeeks}\n` +
      (peakWeek ? `- Peak: ${peakWeek.p}% (${peakWeek.h}h) on ${peakLabel}\n` : "") +
      (recent ? `- Recent week data: ${recent}\n` : "") +
      `- ${projectsLine}\n\n` +
      `RULES:\n` +
      `• Write every line as a natural, complete English sentence a manager reads in one go — no code-style fragments like "Peak 30% on Apr-20-26 driven by ID".\n` +
      `• Always use the project's real name (e.g. "JAB Parking Garage"), never the raw project ID.\n` +
      `• Format dates as "Month Day" (e.g. "Apr 20"), never "Apr-20-26" or "4/20".\n` +
      `• Every line below STATUS must include at least one specific number (%, hours, or week count).\n` +
      `• Never use vague phrases — every claim must be backed by a figure from the data.\n` +
      `• Do not call any tools. Analyze only from the data above.\n\n` +
      `OUTPUT FORMAT (copy labels exactly, one line each):\n` +
      `STATUS: over | under | healthy\n` +
      `HEADLINE: <one sentence ≤22 words — state avg %, total hours, and active week count naturally>\n` +
      `${driverInstruction}\n` +
      `TREND: <one sentence describing direction with 2–3 specific data points from recent weeks — e.g. "Workload peaked at 30% in late April, then fell to 10% by early May">\n` +
      `INSIGHT: <one sentence with a number — e.g. "${idleWeeks} of ${utilPeriods.length} weeks have no hours at all" or "${name} is averaging ${avgPct}%, well below the ${aiRules.targetUtilizationPct}% target">\n` +
      `REC: <one sentence with a specific hour figure — e.g. "Assigning roughly ${Math.max(0, Math.round(totalHrs * gapVsTarget / Math.max(1, avgPct)))} more hours to ${name} this quarter would bring them to a ${aiRules.targetUtilizationPct}% load">`
    );
    setAiAnalysis({ name, subtitle, prompt, clickedPeriod, ganttProjects, qRange: { sd: selectedQuarter.sd, ed: selectedQuarter.ed } });
  };

  /* ── Per-project AI analysis (opened from CellDetailModal project rows) ── */
  const openProjectAnalysis = (
    personName: string,
    personUserId: string | undefined,
    pid: string,
    projectName: string,
    allocPct: number,
    startDate: string,
    endDate: string,
  ) => {
    const aiRules = getBusinessRules();
    const uid = personUserId?.trim().toLowerCase();
    const staffRow = uid
      ? (staffResources.find((r) => (r.id || "").toLowerCase() === uid)
          ?? staffResources.find((r) => r.name.toLowerCase().trim() === personName.toLowerCase().trim()))
      : staffResources.find((r) => r.name.toLowerCase().trim() === personName.toLowerCase().trim());

    const hoursPerWeek = Math.round((allocPct / 100) * aiRules.workWeekHours);
    const totalWeeks = startDate && endDate
      ? Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (7 * 24 * 3600 * 1000)))
      : null;
    const totalHours = totalWeeks ? Math.round((allocPct / 100) * aiRules.workWeekHours * totalWeeks) : null;
    const isOngoing = !startDate || startDate === endDate;
    const dateRange = isOngoing ? "Ongoing (no fixed end date)" : `${startDate} → ${endDate}${totalWeeks ? ` (${totalWeeks} weeks)` : ""}`;

    const personRole  = (staffRow?.roleName || staffRow?.role || "").trim();
    const personBU    = (staffRow?.businessUnit || "").trim();
    const personDiv   = (staffRow?.divisionName || "").trim();
    const profileParts = [
      personBU  && `BU: ${personBU}`,
      personDiv && getBusinessRules().showDivision && `Division: ${personDiv}`,
      personRole && `Role: ${personRole}`,
    ].filter(Boolean).join(" | ");

    const allocStatus = allocPct > aiRules.overCapacityPct ? "over"
      : allocPct >= aiRules.targetUtilizationPct ? "healthy"
      : "under";

    const subtitle = `${selectedQ} · ${projectName} · ${allocPct}% · ~${hoursPerWeek}h/wk`;

    const prompt =
      `Analyze ${personName}'s allocation to "${projectName}" (${pid}) and return EXACTLY 6 labeled lines — no extra text, no markdown, no blank lines between them.\n\n` +
      `DATA:\n` +
      `- Person: ${personName}${profileParts ? ` — ${profileParts}` : ""}\n` +
      `- Project: ${projectName} (${pid})\n` +
      `- Allocation: ${allocPct}% → ~${hoursPerWeek}h/week\n` +
      `- Schedule: ${dateRange}${totalHours ? ` · ~${totalHours}h total commitment` : ""}\n` +
      `- Quarter context: ${selectedQ}\n\n` +
      `RULES:\n` +
      `• Write every line as a natural, complete English sentence.\n` +
      `• Use the project's real name ("${projectName}"), never just its ID.\n` +
      `• Every line below STATUS must include at least one specific number (%, hours, weeks).\n` +
      `• Do not call any tools. Analyze only from the data above and the project context you already have.\n\n` +
      `OUTPUT FORMAT (copy labels exactly, one line each):\n` +
      `STATUS: ${allocStatus}\n` +
      `HEADLINE: <one sentence ≤22 words — state ${personName}'s role on ${projectName}, their ${allocPct}% allocation, and ~${hoursPerWeek}h/week commitment>\n` +
      `DRIVER: <one sentence — what type of work ${personName} is likely doing on this project given their role, and why this allocation level makes sense or doesn't>\n` +
      `TREND: <one sentence — comment on the project timeline: ${dateRange}${totalWeeks ? `, ${totalWeeks} weeks long` : ""}; is this short-term, long-term, ending soon?>\n` +
      `INSIGHT: <one sentence with a number — e.g. "${totalHours ? `${personName} will contribute roughly ${totalHours}h to this project over its full span` : `At ${allocPct}%, ${personName} is committing ~${hoursPerWeek}h every week to this project`}">\n` +
      `REC: <one sentence — one specific actionable suggestion: e.g. increase/decrease allocation, add a supporting resource, check if ${hoursPerWeek}h/wk aligns with project phase needs, or note if ${personName} is over-committed across projects>`;

    setAiAnalysis({ name: personName, subtitle, prompt, clickedPeriod: undefined, ganttProjects: [], qRange: { sd: selectedQuarter.sd, ed: selectedQuarter.ed } });
  };

  /* ── Staff-grid metric AI analysis (Allocation / Active / Conflict / Total cells) ── */
  const openStaffMetricAnalysis = (
    r: LiveResourceProxy,
    metric: "allocation" | "active" | "conflict" | "total",
  ) => {
    const aiRules = getBusinessRules();
    const funded = (r.activeAllocations ?? []).filter(a => (a.pct ?? 0) > 0 || (a.hours ?? 0) > 0);
    const conflicts = staffConflictCount(r);
    const activeCount = new Set(r.activeProjects).size;
    const pct = Number(r.currentPct.toFixed(2));

    const profileLine = [
      r.businessUnit && `BU: ${r.businessUnit}`,
      r.divisionName && getBusinessRules().showDivision && `Division: ${r.divisionName}`,
      r.departmentName && `Dept: ${r.departmentName}`,
      r.roleName && `Role: ${r.roleName}`,
      r.role && r.role !== r.roleName && `Job Title: ${r.role}`,
    ].filter(Boolean).join(" | ");

    const allocLines = (r.activeAllocations ?? []).map(a => {
      const nm = pName(a.projectId);
      return `${nm !== a.projectId ? `${nm} (${a.projectId})` : a.projectId} — ${+a.pct.toFixed(1)}%${a.hours ? ` / ${a.hours}h` : ""}, ${a.startDate} → ${a.endDate}`;
    });

    // Gantt for the popup — one bar per active allocation, same rendering the
    // Timeline analysis modal already uses. Range over the person's own
    // allocation window so bars are always visible; fall back to the selected
    // quarter when allocation dates are absent/unparseable.
    const ganttProjects = (r.activeAllocations ?? []).map(a => ({
      projectId: a.projectId,
      name: pName(a.projectId),
      startDate: a.startDate,
      endDate: a.endDate,
      pct: a.pct,
    }));
    const times = (r.activeAllocations ?? [])
      .flatMap(a => [new Date(a.startDate).getTime(), new Date(a.endDate).getTime()])
      .filter(t => !isNaN(t));
    const qRange = times.length >= 2 && Math.min(...times) < Math.max(...times)
      ? {
          sd: new Date(Math.min(...times)).toISOString().slice(0, 10),
          ed: new Date(Math.max(...times)).toISOString().slice(0, 10),
        }
      : { sd: selectedQuarter.sd, ed: selectedQuarter.ed };

    const allocStatus = pct > aiRules.overCapacityPct ? "over"
      : pct >= aiRules.targetUtilizationPct ? "healthy" : "under";
    const status = metric === "conflict" && conflicts > 0 ? "over" : allocStatus;

    const focus =
      metric === "allocation"
        ? `FOCUS: ${r.name}'s overall allocation of ${pct}% and how it splits across their projects.`
      : metric === "active"
        ? `FOCUS: the ${activeCount} active project${activeCount === 1 ? "" : "s"} ${r.name} is currently assigned to — spread, balance, and fit.`
      : metric === "conflict"
        ? `FOCUS: cross-project conflict risk — ${r.name} is carrying real load on ${funded.length} concurrent project${funded.length === 1 ? "" : "s"}. Assess competing deadlines, split attention, and which project is most exposed.`
      : `FOCUS: ${r.name}'s overall project portfolio — ${r.totalProjects} total project${r.totalProjects === 1 ? "" : "s"} all-time, ${activeCount} currently active.`;

    // Quarter totals attached by the staffResources enrichment memo — mirror the
    // Timeline analysis header ("Q3 2026 · avg 100% · 520h total · 13 active weeks").
    const qHrs = (r as unknown as { qTotalHrs?: number }).qTotalHrs ?? 0;
    const qWks = (r as unknown as { qActiveWeeks?: number }).qActiveWeeks ?? 0;
    const subtitle =
      metric === "allocation"
        ? (qWks > 0
            ? `${selectedQuarter.label} · avg ${pct}% · ${qHrs}h total · ${qWks} active week${qWks === 1 ? "" : "s"}`
            : `Allocation · ${pct}% across ${activeCount} active project${activeCount === 1 ? "" : "s"}`)
      : metric === "active" ? `Active Projects · ${activeCount} in flight`
      : metric === "conflict" ? (conflicts > 0 ? `Conflict · ${conflicts} concurrent funded projects` : "Conflict · none detected")
      : `Total Projects · ${r.totalProjects} all-time`;

    const metricLabel =
      metric === "allocation" ? "workload allocation"
      : metric === "active" ? "active project assignments"
      : metric === "conflict" ? "cross-project conflict risk"
      : "project portfolio history";

    const prompt =
      `Analyze ${r.name}'s ${metricLabel} and return EXACTLY 6 labeled lines — no extra text, no markdown, no blank lines between them.\n\n` +
      `${focus}\n\n` +
      `DATA for ${r.name}:\n` +
      `- ${profileLine || "No org profile found"}\n` +
      `- Overall allocation: ${pct}% (target ${aiRules.targetUtilizationPct}%, over-capacity ≥${aiRules.overCapacityPct}%)\n` +
      (qWks > 0 ? `- Quarter window ${selectedQuarter.label}: ${qHrs}h booked across ${qWks} active week${qWks === 1 ? "" : "s"}\n` : "") +
      `- Active projects: ${activeCount} | Carrying real load on: ${funded.length} | Conflicts: ${conflicts > 0 ? `YES — ${conflicts} concurrent funded projects` : "none"}\n` +
      `- Total projects (all-time): ${r.totalProjects}\n` +
      (allocLines.length
        ? `- Current allocations:\n${allocLines.map(l => `  · ${l}`).join("\n")}\n`
        : `- No current project allocations on record.\n`) +
      (r.lastActiveDate ? `- Last active: ${r.lastActiveDate}\n` : "") +
      `\nRULES:\n` +
      `• Write every line as a natural, complete English sentence a manager reads in one go.\n` +
      `• Always use the project's real name, never just the raw ID.\n` +
      `• Format dates as "Month Day" (e.g. "Apr 20").\n` +
      `• Every line below STATUS must include at least one specific number (%, hours, or project count).\n` +
      `• Do not call any tools. Analyze only from the data above.\n\n` +
      `OUTPUT FORMAT (copy labels exactly, one line each):\n` +
      `STATUS: ${status}\n` +
      `HEADLINE: <one sentence ≤22 words summarizing the ${metricLabel} picture with its key number>\n` +
      `DRIVER: <one sentence — what is driving this: which projects carry the load and how it splits>\n` +
      `TREND: <one sentence about the allocation windows — what starts or ends when, using real dates>\n` +
      `INSIGHT: <one sentence with a number — the most useful non-obvious observation from the data>\n` +
      `REC: <one sentence — one specific, actionable recommendation for a resource manager>`;

    setAiAnalysis({ name: r.name, subtitle, prompt, clickedPeriod: undefined, ganttProjects, qRange });
  };

  /* ── Staff-grid Conflict cell → Projects-tab style AI conflict analysis ── */
  const openStaffConflictAnalysis = (r: LiveResourceProxy) => {
    // Funded allocations only (mirrors staffConflictCount); heaviest first so
    // the primary project matches what the Projects tab treats as "this project".
    const funded = (r.activeAllocations ?? [])
      .filter(a => (a.pct ?? 0) > 0 || (a.hours ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const list = funded.length > 0 ? funded : (r.activeAllocations ?? []);
    if (list.length === 0) {
      // No allocation data at all — fall back to the generic metric analysis.
      openStaffMetricAnalysis(r, "conflict");
      return;
    }
    const [first, ...rest] = list;
    setConflictModal({
      memberName: r.name,
      role: r.role || r.roleName || "",
      projectName: pName(first.projectId),
      projectId: first.projectId,
      thisPct: +Number(first.pct ?? 0).toFixed(1),
      thisHrs: allocEntryTotalHrs(first),
      otherProjects: rest.map(a => ({
        id: a.projectId,
        name: pName(a.projectId),
        pct: +Number(a.pct ?? 0).toFixed(1),
        hrs: allocEntryTotalHrs(a),
      })),
    });
  };

  const allStaffRoles = useMemo(() => {
    const s = new Set<string>();
    for (const r of staffResources) { const v = (r.roleName || "").trim(); if (v) s.add(v); }
    return Array.from(s).sort();
  }, [staffResources]);

  const allStaffTitles = useMemo(() => {
    const s = new Set<string>();
    for (const r of staffResources) { const v = (r.role || "").trim(); if (v) s.add(v); }
    return Array.from(s).sort();
  }, [staffResources]);

  // Cascading BU → Division → Department options (mirrors Projects page).
  const staffOrgOptions = useMemo(
    () => buildOrgFilterOptions(
      staffResources.map(r => ({ bu: r.businessUnit || "", division: r.divisionName || "", dept: r.departmentName || "" })),
      staffBuFilter, staffDivFilter,
    ),
    [staffResources, staffBuFilter, staffDivFilter],
  );

  const staffOrgFiltersActive = staffBuFilter !== "All" || staffDivFilter !== "All" || staffDeptFilter !== "All" || staffRoleFilter !== "All" || staffTitleFilter !== "All" || staffProjectFilter !== "All" || staffAccessFilter !== "All";

  // All unique projects/opps that have any allocation — sourced from projectNameMap
  // which covers every allocation record (not just the current quarter's active slice).
  const allProjectOptions = useMemo(() => {
    return Object.entries(projectNameMap)
      .filter(([, name]) => name && name.trim().length > 0)
      .map(([id, name]) => ({ id, name: name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectNameMap]);

  const filteredUtilRowsOrg = useMemo(() => {
    if (!staffOrgFiltersActive) return filteredUtilRows;
    // Match by person GUID (UserId on the util row, id on the staff resource) —
    // NOT by name/username. ResourceUser on the util row is the display Name,
    // but username is often a distinct login/email, so matching name-vs-username
    // silently dropped every person whose username != display name (e.g. Kevin
    // Park showing "No utilization data" for an org filter he actually matches).
    const allowed = new Set(
      staffResources
        .filter(r => {
          if (staffBuFilter !== "All" && (r.businessUnit || "").trim() !== staffBuFilter) return false;
          if (staffDivFilter !== "All" && (r.divisionName || "").trim() !== staffDivFilter) return false;
          if (staffDeptFilter !== "All" && (r.departmentName || "").trim() !== staffDeptFilter) return false;
          if (staffRoleFilter !== "All" && (r.roleName || "").trim() !== staffRoleFilter) return false;
          if (staffTitleFilter !== "All" && (r.role || "").trim() !== staffTitleFilter) return false;
          if (staffProjectFilter !== "All" && !r.activeProjects.includes(staffProjectFilter)) return false;
          if (staffAccessFilter !== "All" && accessDisplayOf(r.accessLevel) !== staffAccessFilter) return false;
          return true;
        })
        .map(r => (r.id || "").toLowerCase())
    );
    return filteredUtilRows.filter(r => {
      const uid = String((r as Record<string, unknown>).UserId ?? "").toLowerCase();
      if (uid) return allowed.has(uid);
      // Fallback for rows without a UserId (shouldn't normally happen) — match by name.
      return staffResources.some(sr => allowed.has((sr.id || "").toLowerCase()) && (sr.name || "").toLowerCase() === String(r.ResourceUser ?? "").toLowerCase());
    });
  }, [filteredUtilRows, staffResources, staffOrgFiltersActive, staffBuFilter, staffDivFilter, staffDeptFilter, staffRoleFilter, staffTitleFilter, staffProjectFilter, staffAccessFilter]);

  // Business rules version — declared BEFORE the memos below so they can list
  // it as a dependency (re-sort/re-render live when an admin changes rules).
  const rulesVersion = useBusinessRulesVersion();

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Role fields match through the shared abbreviation-aware matcher
    // ("PM" ⇄ "Project Manager"); name/username stay plain substring.
    const roleMatch = roleQueryMatcher(q);
    const brRules = getBusinessRules();
    return staffResources
      // When a tier pill is active it IS the allocation filter — skip the
      // threshold slider so overloaded (>threshold) staff are still visible.
      .filter(r => staffTierFilter ? true : r.currentPct <= threshold)
      .filter(r => {
        // Manager filter: only show staff in the manager's direct/project groups.
        if (managerFilterIds !== null) {
          if (!managerFilterIds.has((r.id || "").toLowerCase())) return false;
        }
        if (staffTierFilter) {
          const pct = r.currentPct;
          // "Active" = anyone with ANY allocation (cross-tier convenience filter).
          if (staffTierFilter === "Active")  { if (pct <= 0) return false; }
          // "On Bench" = zero allocation.
          else if (staffTierFilter === "On Bench") { if (pct > 0) return false; }
          // Tier-band filters (Overloaded / Optimal / Partial / Under-used).
          else {
            const tier =
              pct >= brRules.overCapacityPct        ? "Overloaded"
              : pct >= brRules.targetUtilizationPct ? "Optimal"
              : pct >  brRules.underAllocatedPct    ? "Partial"
              : pct >  0                            ? "Under-used"
              :                                       "Bench";
            if (tier !== staffTierFilter) return false;
          }
        }
        if (staffBuFilter !== "All" && (r.businessUnit || "").trim() !== staffBuFilter) return false;
        if (staffDivFilter !== "All" && (r.divisionName || "").trim() !== staffDivFilter) return false;
        if (staffDeptFilter !== "All" && (r.departmentName || "").trim() !== staffDeptFilter) return false;
        if (staffRoleFilter !== "All" && (r.roleName || "").trim() !== staffRoleFilter) return false;
        if (staffTitleFilter !== "All" && (r.role || "").trim() !== staffTitleFilter) return false;
        if (staffProjectFilter !== "All" && !r.activeProjects.includes(staffProjectFilter)) return false;
        // Access-level filtering removed from the Staff view (pill was cut to
        // unclutter the row — a Timeline-set access filter must NOT invisibly
        // filter Staff). The grid's ACCESS column was removed too.
        if (staffEmpTypeFilter) {
          const { empTypeKey: etk } = (() => {
            const k = (r.employeeType || "").toLowerCase().replace(/[^a-z]/g, "");
            if (k.includes("sca") || k.includes("contingen")) return { empTypeKey: "SCA Contingency" };
            if (k.includes("part")) return { empTypeKey: "Part-Time" };
            if (k.includes("needed") || k === "asneeded") return { empTypeKey: "As Needed" };
            if (k.includes("temp")) return { empTypeKey: "Temporary" };
            if (k.includes("full")) return { empTypeKey: "Full-Time" };
            return { empTypeKey: null };
          })();
          if (etk !== staffEmpTypeFilter) return false;
        }
        if (!q) return true;
        // Search matches PERSON fields only (name, role, title, username).
        // Project IDs/names are deliberately excluded — searching "coo" used
        // to also surface everyone staffed on any "…Coordination…" project,
        // which read as random noise next to the one real COO.
        if (r.name.toLowerCase().includes(q)) return true;
        if (r.role && roleMatch(r.role)) return true;
        if (r.roleName && roleMatch(r.roleName)) return true;
        if (r.username && r.username.toLowerCase().includes(q)) return true;
        return false;
      })
      // Concentration-risk people always float to the top of the list so they
      // are never buried below the fold. Mirrors StaffCard's chip rule:
      // a single active project above the admin-configured threshold.
      // Within each group: highest allocation first, then most active
      // projects, then most total projects — same order in cards AND grid.
      .sort((a, b) => {
        // When manager filter is active, sort direct reports before project-team members.
        if (managerFilterIds !== null && managerStaffData) {
          const directIds = new Set((managerStaffData.direct ?? []).map(d => d.id.toLowerCase()));
          const aIsDirect = directIds.has((a.id || "").toLowerCase()) ? 0 : 1;
          const bIsDirect = directIds.has((b.id || "").toLowerCase()) ? 0 : 1;
          if (aIsDirect !== bIsDirect) return aIsDirect - bIsDirect;
        }
        const risk = (r: typeof a) => staffConcentrationRisk(r, brRules.concentrationPct) ? 0 : 1;
        const riskDiff = risk(a) - risk(b);
        if (riskDiff !== 0) return riskDiff;
        if (b.currentPct !== a.currentPct) return b.currentPct - a.currentPct;
        const activeDiff = b.activeProjects.length - a.activeProjects.length;
        if (activeDiff !== 0) return activeDiff;
        return b.totalProjects - a.totalProjects;
      });
  }, [staffResources, search, threshold, projectNameMap, staffBuFilter, staffDivFilter, staffDeptFilter, staffRoleFilter, staffTitleFilter, staffTierFilter, staffProjectFilter, staffEmpTypeFilter, rulesVersion, managerFilterIds, managerStaffData]);

  const totalAll = allocResp?.total ?? staffResources.length;
  // Header stats follow the threshold slider so the numbers always match what's shown below.
  // Bands are driven by the admin-tuned business rules (Onboarding → Settings) so
  // "optimal" / "over" here always match the allocation legend below and the rest
  // of the app (home risks, AI insights). rulesVersion (declared above the staff
  // memo) forces a re-render once the async rules load resolves or an admin
  // saves new thresholds.
  const br = getBusinessRules();
  void rulesVersion;
  const total = filteredStaff.length;
  const healthy = filteredStaff.filter(r => r.currentPct >= br.targetUtilizationPct && r.currentPct < br.overCapacityPct).length;
  const overAllocated = filteredStaff.filter(r => r.currentPct >= br.overCapacityPct).length;

  const demandItems = demandQ.data?.data ?? [];
  // Position-level counts for the header + Demand ticker — must match the
  // Weekly Demand popup and Daily Briefing (see lib/demandPositions.ts):
  // count unique (TicketId, Role) positions, never raw one-per-week rows.
  const allDemandPositions = useMemo(
    () => collapseDemandsToPositions(demandItems),
    [demandItems],
  );
  const filteredDemand = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Roles match through the shared abbreviation-aware matcher so shortcut
    // queries work both ways ("PM" ⇄ "Project Manager"); title/ID stay substring.
    const roleMatch = roleQueryMatcher(q);
    const base = !q ? demandItems : demandItems.filter(d =>
      d.Title?.toLowerCase().includes(q) || roleMatch(d.Role) || d.TicketId?.toLowerCase().includes(q)
    );
    // Urgency-first ordering: cards flagged OVERDUE (start date already passed)
    // or URGENT (starts within the admin-configured window) always sort to the
    // top; within the flagged group the most overdue/imminent comes first.
    // sort() is stable, so unflagged cards keep their original order.
    const urgencyDays = getBusinessRules().demandUrgencyDays;
    return base.slice().sort((a, b) => {
      const da = demandDaysUntil(a.AllocationStartDate);
      const db = demandDaysUntil(b.AllocationStartDate);
      const fa = da !== null && da <= urgencyDays;
      const fb = db !== null && db <= urgencyDays;
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && fb) return (da ?? 0) - (db ?? 0);
      return 0;
    });
  }, [demandItems, search, rulesVersion]);

  // Demand: "Positions" — deduplicate weekly rows into unique (TicketId, Role) cards.
  type DemandPosition = {
    TicketId: string; Title: string; Role: string;
    PctAllocation: number; AllocationStartDate: string; AllocationEndDate: string;
    SoftAllocation: boolean; ApproxContractValue?: number; weekCount: number;
  };
  const demandPositions = useMemo((): DemandPosition[] => {
    const map = new Map<string, DemandPosition>();
    for (const d of filteredDemand) {
      const key = `${d.TicketId}||${d.Role ?? ""}`;
      const ex = map.get(key);
      if (!ex) {
        map.set(key, { ...d, weekCount: 1 });
      } else {
        ex.weekCount++;
        if (d.AllocationStartDate && (!ex.AllocationStartDate || d.AllocationStartDate < ex.AllocationStartDate))
          ex.AllocationStartDate = d.AllocationStartDate;
        if (d.AllocationEndDate && (!ex.AllocationEndDate || d.AllocationEndDate > ex.AllocationEndDate))
          ex.AllocationEndDate = d.AllocationEndDate;
        ex.PctAllocation = Math.max(ex.PctAllocation, d.PctAllocation ?? 0);
        if (d.SoftAllocation) ex.SoftAllocation = true;
      }
    }
    // Same urgency-first ordering as the weekly list (positions merge to the
    // earliest week's start date, so a position is flagged if ANY week is).
    const urgencyDays = getBusinessRules().demandUrgencyDays;
    return Array.from(map.values()).sort((a, b) => {
      const da = demandDaysUntil(a.AllocationStartDate);
      const db = demandDaysUntil(b.AllocationStartDate);
      const fa = da !== null && da <= urgencyDays;
      const fb = db !== null && db <= urgencyDays;
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && fb) return (da ?? 0) - (db ?? 0);
      return 0;
    });
  }, [filteredDemand, rulesVersion]);

  // Demand: "Project" grouping
  type DemandByProject = {
    TicketId: string; Title: string; weekCount: number;
    positions: { role: string; start: string; end: string; pct: number }[];
  };
  const demandByProject = useMemo((): DemandByProject[] => {
    const map = new Map<string, DemandByProject>();
    for (const d of filteredDemand) {
      const key = d.TicketId;
      if (!map.has(key)) map.set(key, { TicketId: d.TicketId, Title: d.Title, weekCount: 0, positions: [] });
      const grp = map.get(key)!;
      grp.weekCount++;
      const role = d.Role ?? "—";
      const ex = grp.positions.find(p => p.role === role);
      if (!ex) {
        grp.positions.push({ role, start: d.AllocationStartDate, end: d.AllocationEndDate, pct: d.PctAllocation ?? 0 });
      } else {
        if (d.AllocationStartDate && (!ex.start || d.AllocationStartDate < ex.start)) ex.start = d.AllocationStartDate;
        if (d.AllocationEndDate && (!ex.end || d.AllocationEndDate > ex.end)) ex.end = d.AllocationEndDate;
        ex.pct = Math.max(ex.pct, d.PctAllocation ?? 0);
      }
    }
    // Urgency-first: a project group is flagged when ANY of its positions is
    // overdue or starts within the urgency window; flagged groups sort first.
    const urgencyDays = getBusinessRules().demandUrgencyDays;
    const minDays = (g: DemandByProject): number | null => {
      let m: number | null = null;
      for (const p of g.positions) {
        const d = demandDaysUntil(p.start);
        if (d !== null && (m === null || d < m)) m = d;
      }
      return m;
    };
    return Array.from(map.values()).sort((a, b) => {
      const da = minDays(a), db = minDays(b);
      const fa = da !== null && da <= urgencyDays;
      const fb = db !== null && db <= urgencyDays;
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && fb) return (da ?? 0) - (db ?? 0);
      return 0;
    });
  }, [filteredDemand, rulesVersion]);

  // Demand: "Role" grouping
  type DemandByRole = {
    role: string; weekCount: number;
    projects: { TicketId: string; Title: string; start: string; end: string; pct: number }[];
  };
  const demandByRole = useMemo((): DemandByRole[] => {
    const map = new Map<string, DemandByRole>();
    for (const d of filteredDemand) {
      const key = d.Role ?? "—";
      if (!map.has(key)) map.set(key, { role: key, weekCount: 0, projects: [] });
      const grp = map.get(key)!;
      grp.weekCount++;
      const ex = grp.projects.find(p => p.TicketId === d.TicketId);
      if (!ex) {
        grp.projects.push({ TicketId: d.TicketId, Title: d.Title, start: d.AllocationStartDate, end: d.AllocationEndDate, pct: d.PctAllocation ?? 0 });
      } else {
        if (d.AllocationStartDate && (!ex.start || d.AllocationStartDate < ex.start)) ex.start = d.AllocationStartDate;
        if (d.AllocationEndDate && (!ex.end || d.AllocationEndDate > ex.end)) ex.end = d.AllocationEndDate;
        ex.pct = Math.max(ex.pct, d.PctAllocation ?? 0);
      }
    }
    // Urgency-first: a role group is flagged when ANY of its projects is
    // overdue or starts within the urgency window; flagged groups sort first.
    const urgencyDays = getBusinessRules().demandUrgencyDays;
    const minDays = (g: DemandByRole): number | null => {
      let m: number | null = null;
      for (const p of g.projects) {
        const d = demandDaysUntil(p.start);
        if (d !== null && (m === null || d < m)) m = d;
      }
      return m;
    };
    return Array.from(map.values()).sort((a, b) => {
      const da = minDays(a), db = minDays(b);
      const fa = da !== null && da <= urgencyDays;
      const fb = db !== null && db <= urgencyDays;
      if (fa !== fb) return fa ? -1 : 1;
      if (fa && fb) return (da ?? 0) - (db ?? 0);
      return 0;
    });
  }, [filteredDemand, rulesVersion]);

  // Demand tab count varies by group mode
  const demandTabCount = demandGroup === "positions" ? demandPositions.length
    : demandGroup === "project" ? demandByProject.length
    : demandGroup === "role" ? demandByRole.length
    : filteredDemand.length;

  // Shared "Load more" footer for all four Demand group views.
  const renderDemandLoadMore = (totalLen: number) =>
    totalLen > demandVisible ? (
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <button
          onClick={() => setDemandVisible(v => v + DEMAND_PAGE_SIZE)}
          style={{
            padding: "10px 26px", borderRadius: 8, border: `1px solid ${BRAND.cardBorder}`,
            backgroundColor: BRAND.card, color: BRAND.white,
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          Load more ({(totalLen - demandVisible).toLocaleString()} more)
        </button>
      </div>
    ) : null;

  const contacts = useMemo(() => {
    return (conQ.data?.data ?? []).map(mapContact)
      .filter(c => c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [conQ.data]);
  const filteredContacts = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q));
  }, [contacts, search]);

  const isRefreshing = utilQ.isFetching || allocQ.isFetching || demandQ.isFetching || conQ.isFetching;

  async function handleRefresh() {
    bustCache();
    await Promise.allSettled([utilQ.refetch(), allocQ.refetch(), demandQ.refetch(), conQ.refetch()]);
  }

  // "Has the backing query ever delivered data?" — placeholder seeds count,
  // so warm revisits skip the loading state entirely.
  const allocLoaded = allocQ.data !== undefined;
  const demandLoaded = demandQ.data !== undefined;

  // Per-tab ticker. 3 bite-sized items: pulse, top concern, next action.
  const tickerItems: InfoTickerItem[] = useMemo(() => {
    const items: InfoTickerItem[] = [];

    if (view === "Timeline" || view === "Staff") {
      // Pending-aware: never push "0 staff · 0 optimal · 0 over" while the
      // roster query has not delivered data yet (cold load, no session seed).
      if (!allocLoaded) {
        items.push({ label: "Capacity", value: "loading…", tone: "info" });
        return items;
      }
      const benchCount = staffResources.filter(r => r.currentPct > 0 && r.currentPct <= br.underAllocatedPct).length;
      items.push({
        label: "Capacity",
        value: `${total} staff · ${healthy} optimal · ${overAllocated} over`,
        tone: overAllocated > 0 ? "warn" : "good",
        detail: {
          title: "Capacity snapshot",
          body: [
            `${total} staff tracked.`,
            `${healthy} at optimal load · ${overAllocated} overloaded.`,
            `${benchCount} under-utilized (≤${br.underAllocatedPct}%).`,
          ],
        },
      });
      const overTop = [...staffResources]
        .filter(r => r.currentPct >= br.overCapacityPct)
        .sort((a, b) => b.currentPct - a.currentPct)[0];
      if (overTop) {
        items.push({
          label: "Most loaded",
          value: `${overTop.name} · ${Math.round(overTop.currentPct)}%`,
          tone: overTop.currentPct >= br.overCapacityPct + 20 ? "bad" : "warn",
          detail: {
            title: overTop.name,
            body: [
              `${overTop.role || "—"} · loaded at ${Math.round(overTop.currentPct)}%.`,
              `Active on ${overTop.activeProjects.length} project${overTop.activeProjects.length === 1 ? "" : "s"} (${overTop.totalProjects} total).`,
              overTop.lastActiveDate ? `Last active: ${overTop.lastActiveDate}.` : `No recent activity on file.`,
            ],
            openLabel: "Open profile",
            onOpen: () => setProfileResource(overTop),
          },
        });
      }
      const benchTop = [...staffResources]
        .filter(r => r.currentPct <= br.underAllocatedPct)
        .sort((a, b) => a.currentPct - b.currentPct)[0];
      if (benchTop) {
        items.push({
          label: "Available",
          value: `${benchTop.name} · ${Math.round(benchTop.currentPct)}% loaded`,
          tone: "info",
          detail: {
            title: benchTop.name,
            body: [
              `${benchTop.role || "—"} · loaded at ${Math.round(benchTop.currentPct)}%.`,
              `On ${benchTop.activeProjects.length} active project${benchTop.activeProjects.length === 1 ? "" : "s"}.`,
              `Has bandwidth for new assignments.`,
            ],
            openLabel: "Open profile",
            onOpen: () => setProfileResource(benchTop),
          },
        });
      }
    } else if (view === "Demand") {
      // Pending-aware: never push "0 open · 0 soft" while the demand query
      // has not delivered data yet.
      if (!demandLoaded) {
        items.push({ label: "Demand", value: "loading…", tone: "info" });
        return items;
      }
      const open = allDemandPositions.filter(d => !d.IsLocked);
      const soft = allDemandPositions.filter(d => d.SoftAllocation).length;
      items.push({
        label: "Demand",
        value: `${allDemandPositions.length} open · ${soft} soft`,
        tone: open.length > 0 ? "warn" : "good",
        detail: {
          title: "Open demand",
          body: [
            `${allDemandPositions.length} open position${allDemandPositions.length === 1 ? "" : "s"}.`,
            `${open.length} unlocked · ${soft} flagged as soft allocations.`,
          ],
        },
      });
      const top = [...allDemandPositions]
        .sort((a, b) => (b.PctAllocation || 0) - (a.PctAllocation || 0))[0];
      if (top) {
        items.push({
          label: "Largest ask",
          value: `${top.Title} · ${top.Role || "—"} · ${Math.round(top.PctAllocation || 0)}%`,
          tone: "warn",
          detail: {
            title: top.Title,
            body: [
              `Role needed: ${top.Role || "—"}.`,
              `Allocation: ${Math.round(top.PctAllocation || 0)}%${top.SoftAllocation ? " (soft)" : ""}.`,
              top.AllocationStartDate ? `Window: ${top.AllocationStartDate}${top.AllocationEndDate ? ` → ${top.AllocationEndDate}` : ""}.` : `No date window set.`,
            ],
            openLabel: "Open project",
            onOpen: () => navigate(`/project/${top.TicketId}`),
          },
        });
      }
      const softList = allDemandPositions.filter(d => d.SoftAllocation);
      if (softList.length > 0) {
        items.push({
          label: "Next action",
          value: `Confirm ${softList.length} soft allocation${softList.length === 1 ? "" : "s"}`,
          tone: "warn",
          detail: {
            title: "Soft allocations to confirm",
            body: [
              `${softList.length} position${softList.length === 1 ? " is" : "s are"} flagged soft.`,
              `Top one: ${softList[0].Title} · ${softList[0].Role || "—"} (${Math.round(softList[0].PctAllocation || 0)}%).`,
            ],
            openLabel: "Open top",
            onOpen: () => navigate(`/project/${softList[0].TicketId}`),
          },
        });
      }
    }
    return items;
  }, [view, total, healthy, overAllocated, staffResources, allDemandPositions, contacts, navigate, allocLoaded, demandLoaded]);

  function handoff(prompt: string) {
    setChatPrompt(prompt, { newSession: true, autoSend: true });
    navigate("/chat");
  }

  // Quarter dropdown — shared by every grid body that shows the Q switcher
  // (Timeline tab AND Manager tab). Each grid renders it inside its own
  // Q-button container, so position:absolute anchors correctly in both.
  const quarterMenuNode = showQDropdown ? (
    <>
      <div onClick={() => setShowQDropdown(false)}
        style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 40 }} />
      <div style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
        backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`,
        borderRadius: 12, width: 268, overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      }}>
        <style>{`
          .rm-resource-quarter-scroll { scrollbar-width: thin; scrollbar-color: ${BRAND.greenBg} ${BRAND.card}; }
          .rm-resource-quarter-scroll::-webkit-scrollbar { width: 8px; }
          .rm-resource-quarter-scroll::-webkit-scrollbar-track { background: ${BRAND.card}; }
          .rm-resource-quarter-scroll::-webkit-scrollbar-thumb { background: ${BRAND.greenBg}; border-radius: 999px; border: 2px solid ${BRAND.card}; }
        `}</style>
        <div style={{ padding: "11px 14px 9px", borderBottom: `1px solid ${BRAND.cardBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Select quarter</div>
            <div style={{ marginTop: 2, fontSize: 9, color: BRAND.textMuted }}>Scroll to view past and upcoming quarters</div>
          </div>
          <span style={{ flexShrink: 0, padding: "3px 6px", borderRadius: 999, background: BRAND.greenBg + "22", color: BRAND.green, fontSize: 9, fontWeight: 800 }}>CURRENT</span>
        </div>
        <div className="rm-resource-quarter-scroll" role="listbox" aria-label="Select quarter"
          style={{ maxHeight: 252, overflowY: "auto", padding: "6px", overscrollBehavior: "contain" }}>
          {[...allQuarters].reverse().map(q => {
            const sel = q.label === selectedQ;
            const cur = q.label === currentQ;
            return (
              <button key={q.label}
                onClick={() => { setSelectedQ(q.label); setShowQDropdown(false); }}
                style={{
                  display: "flex", alignItems: "center", width: "100%",
                  padding: "9px 10px", borderRadius: 8,
                  background: sel ? BRAND.greenBg + "26" : "transparent",
                  border: `1px solid ${sel ? BRAND.greenBg + "88" : "transparent"}`,
                  color: sel ? BRAND.green : BRAND.white,
                  fontSize: 13, fontWeight: sel ? 800 : 500, cursor: "pointer", textAlign: "left",
                }}>
                {sel && <Check size={13} style={{ marginRight: 8 }} />}
                <span style={{ flex: 1 }}>{q.label}</span>
                {cur && <span style={{ fontSize: 9, color: cur && sel ? BRAND.green : BRAND.textMuted }}>current</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  ) : null;

  const managerSearchPicker = (
    <ManagerSearchPicker
      people={staffResources}
      teamMemberCounts={managerTeamCounts}
      loading={allocQ.isLoading}
      onSelect={(id) => { setManagerSelectedId(id); setManagerSearch(""); }}
      onQueryChange={setManagerSearch}
    />
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: BRAND.bg, color: BRAND.white }}>
      {/* Header */}
      {/* AvatarMenu now lives only on Home, so the header can hug the right
          edge — no need to reserve space for a floating profile circle. */}
      <div style={{
        backgroundColor: BRAND.bgDeep, padding: "8px 24px 6px 24px",
        position: "relative",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{standaloneManager ? "Manager" : "Resources"}</h1>
          <div style={{ fontSize: 12, color: BRAND.textSecondary }}>
            {view === "Staff" ? (
              allocQ.data ? (
                <><strong style={{ color: BRAND.white }}>{total}</strong>{" staff"}
                  {healthy > 0 && <> · <span style={{ color: BRAND.green }}>{healthy} optimal</span></>}
                  {overAllocated > 0 && <> · <span style={{ color: BRAND.orange }}>{overAllocated} overloaded</span></>}
                </>
              ) : (
                <span>… loading staff</span>
              )
            ) : view === "Demand" ? (
              demandQ.data ? (
                <><strong style={{ color: BRAND.white }}>{allDemandPositions.length}</strong>{` open position${allDemandPositions.length === 1 ? "" : "s"} · ${allDemandPositions.filter(d => d.SoftAllocation).length} soft`}</>
              ) : (
                <span>… loading positions</span>
              )
            ) : utilQ.data ? (() => {
              const activeCount = utilRows.filter(r => getDateColumns(r).some(c => (parseUtilCell(r[c])?.p ?? 0) > 0)).length;
              const totalCount = totalAll > 0 ? totalAll : utilRows.length;
              return (
                <><strong style={{ color: BRAND.white }}>{activeCount}</strong>
                  {` active of ${totalCount} · ${utilPeriods.length} ${utilMode === "Monthly" ? "months" : "weeks"} · `}
                  <button
                    onClick={() => setShowQDropdown(v => !v)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: "none", border: "none", padding: "0 2px",
                      color: BRAND.green, fontWeight: 700, fontSize: "inherit",
                      cursor: "pointer", borderBottom: `1px dashed ${BRAND.green}`,
                      lineHeight: "inherit",
                    }}
                  >
                    {selectedQ}
                    <ChevronDown size={11} />
                  </button>
                  {activeFilterCount > 0 && <span style={{ color: BRAND.green }}>{` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}`}</span>}
                </>
              );
            })() : `${utilMode} allocation grid`}
          </div>
        </div>
        {/* Per-tab live ticker — inline second row, replaces extra
            standalone band so the header stays compact. */}
        <div style={{ marginTop: 4 }}>
          <InfoTicker items={tickerItems} compact />
        </div>
        <div style={{ position: "absolute", top: 8, right: 12, display: "flex", gap: 8 }}>
          {view === "Staff" && canManageStaff && (
            <button
              onClick={() => setShowStaffChoice(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                backgroundColor: BRAND.green, borderRadius: 10, border: `1px solid ${BRAND.green}`,
                color: "#fff", cursor: "pointer",
              }}
            >
              <UserPlus size={14} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Add Staff</span>
            </button>
          )}
          {view === "Staff" && canManageStaff && (
            <button
              onClick={() => setShowInvite(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                backgroundColor: BRAND.card, borderRadius: 10, border: `1px solid ${BRAND.cardBorder}`,
                color: BRAND.white, cursor: "pointer",
              }}
            >
              <UserCheck size={14} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Manage Staff</span>
            </button>
          )}
          <button
            disabled={isRefreshing}
            onClick={handleRefresh}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
              backgroundColor: BRAND.card, borderRadius: 10, border: `1px solid ${BRAND.cardBorder}`,
              color: BRAND.white, cursor: isRefreshing ? "default" : "pointer", opacity: isRefreshing ? 0.7 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: isRefreshing ? "spin 0.8s linear infinite" : undefined }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      <CreateChoiceModal
        open={showStaffChoice}
        entityLabel="Staff Member"
        onManual={() => { setShowStaffChoice(false); setShowAddStaff(true); }}
        onBulk={() => { setShowStaffChoice(false); navigate("/import?module=team"); }}
        onClose={() => setShowStaffChoice(false)}
      />

      <BulkUploadModal
        open={showStaffBulk}
        entity="staff"
        onClose={() => setShowStaffBulk(false)}
        onCreated={() => { bustCache(); allocQ.refetch(); utilQ.refetch(); }}
      />

      <AddStaffModal
        open={showAddStaff}
        onClose={() => setShowAddStaff(false)}
        onCreated={() => { bustCache(); allocQ.refetch(); utilQ.refetch(); }}
      />

      <EditStaffModal
        open={!!editResource}
        resource={editResource}
        onClose={() => {
          setEditResource(null);
          // Skill/tag chips save instantly inside the modal (not on Save), so
          // bump on EVERY close — including Cancel — or the card shows stale
          // chips. Save also closes, so this single bump covers both paths.
          setStaffPgVersion(v => v + 1);
        }}
        onSaved={() => { bustCache(); allocQ.refetch(); utilQ.refetch(); setAvailRefreshKey(k => k + 1); }}
        tenantId={getStoredUser()?.tenant ?? ""}
      />

      {staffAssignmentAction && (
        <StaffRecordAssignmentModal
          key={`${staffAssignmentAction.resource.id}:${staffAssignmentAction.target}`}
          target={staffAssignmentAction.target}
          resource={staffAssignmentAction.resource}
          onClose={() => setStaffAssignmentAction(null)}
          onAssigned={() => {
            bustCache();
            void allocQ.refetch();
            void utilQ.refetch();
          }}
        />
      )}

      {/* Staff-grid three-dots → person-filtered audit trail (same wide popup
          format as the Quick Actions staff view). */}
      {auditResource && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setAuditResource(null); }}
          style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(10,22,32,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Audit trail for ${auditResource.name}`}
            data-testid="staff-grid-audit-popup"
            style={{ width: "min(1340px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 18, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", boxShadow: "0 24px 64px rgba(0,0,0,.35)", overflow: "hidden" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--rm-panel-border)", background: "var(--rm-panel)" }}>
              <Activity size={20} color="var(--rm-green)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 15, color: "var(--rm-text)" }}>Audit Trail — {auditResource.name}</strong>
                <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--rm-text-muted)" }}>Everything this person did across projects, opportunities, and leads</span>
              </div>
              <button
                type="button"
                onClick={() => setAuditResource(null)}
                aria-label="Close audit trail"
                data-testid="staff-grid-audit-close"
                className="rounded-full p-2 text-[var(--rm-text-muted)] hover:bg-[var(--rm-bg)] hover:text-[var(--rm-text)] transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div style={{ overflowY: "auto" }}>
              <AuditTrailCard
                title="Audit Trail"
                subjectId={auditResource.id}
                subjectEmail={auditResource.username && auditResource.username.includes("@") ? auditResource.username : undefined}
                defaultOpen
                defaultActivity="data"
                recordsOnly
                hideHeader
              />
            </div>
          </div>
        </div>
      )}

      {/* Self-revert confirm: shown when the user self-changed their own level
          and clicks the pencil on their own row in the staff grid. */}
      {selfRevertConfirm && staffSelfRevert && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: Z.POPUP_CHILD,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => { if (!selfRevertLoading) setSelfRevertConfirm(false); }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--rm-card, #1a1a2e)", borderRadius: 14,
              border: "1px solid var(--rm-panel-border)",
              padding: "28px 32px", maxWidth: 400, width: "90%",
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <ShieldCheck size={20} color="var(--rm-green)" />
              <span style={{ fontWeight: 700, fontSize: 15 }}>Change your access level back?</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--rm-muted-text)", marginBottom: 20, lineHeight: 1.5 }}>
              You changed your own access level. You can restore it to{" "}
              <strong style={{ color: "var(--rm-white)" }}>{staffSelfRevert.label}</strong> yourself.
            </p>
            {selfRevertErr && (
              <p style={{ fontSize: 12, color: "var(--rm-red, #ef4444)", marginBottom: 12 }}>
                {selfRevertErr}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                disabled={selfRevertLoading}
                onClick={() => setSelfRevertConfirm(false)}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "1px solid var(--rm-panel-border)",
                  background: "transparent", color: "var(--rm-muted-text)", cursor: "pointer",
                  fontSize: 13, fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                disabled={selfRevertLoading}
                onClick={doSelfRevert}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "none",
                  background: "var(--rm-green)", color: "#fff", cursor: selfRevertLoading ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: selfRevertLoading ? 0.7 : 1,
                }}
              >
                {selfRevertLoading
                  ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Changing…</>
                  : <><RotateCcw size={14} /> Change back to {staffSelfRevert.label}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      <InviteMembersDialog
        tenantId={getStoredUser()?.tenant ?? ""}
        open={showInvite}
        onOpenChange={setShowInvite}
      />

      <div style={{ height: 1, backgroundColor: BRAND.cardBorder, margin: "0 24px" }} />
      {/* Resources tabs. Manager is a standalone top-level surface now. */}
      {!standaloneManager && <div style={{ display: "flex", gap: 6, padding: "6px 24px" }}>
        {(["Demand", "Timeline", "Staff"] as ResView[]).map(v => {
          const active = view === v;
          // Pending-aware counts: show "…" only while the backing query has
          // never delivered data. A genuine zero (data present, empty list)
          // still renders as 0.
          const label =
            v === "Staff" ? `Staff (${allocQ.data ? totalAll : "…"})` :
            v === "Demand" ? `Demand (${demandQ.data ? demandTabCount : "…"})` :
            "Timeline";
          return (
            <button key={v} onClick={() => { setView(v); setSearch(""); }}
              style={{
                flex: 1, padding: "8px 10px", borderRadius: 999,
                backgroundColor: active ? BRAND.greenBg : BRAND.card,
                color: active ? BRAND.white : BRAND.textSecondary,
                border: `1px solid ${active ? BRAND.greenBg : BRAND.cardBorder}`,
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>
              {label}
            </button>
          );
        })}
      </div>}

      {/* Timeline controls — keep the Grid/Gantt and Weekly/Monthly controls,
          while using the former quarter-picker space for search and filters. */}
      {view === "Timeline" && (
        <div style={{ position: "relative", padding: "8px 16px 6px",
           display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <SearchInput value={utilSearch} onChange={setUtilSearch} placeholder="Filter by name…" />
            </div>
            <ResOrgFilterBar
              bus={staffOrgOptions.bus} divs={staffOrgOptions.divs} depts={staffOrgOptions.depts}
              allRoles={allStaffRoles} allTitles={allStaffTitles}
              allProjects={allProjectOptions}
              buFilter={staffBuFilter} divFilter={staffDivFilter} deptFilter={staffDeptFilter}
              roleFilter={staffRoleFilter} titleFilter={staffTitleFilter}
              projectFilter={staffProjectFilter} accessFilter={staffAccessFilter}
              setBuFilter={setStaffBuFilter} setDivFilter={setStaffDivFilter} setDeptFilter={setStaffDeptFilter}
              setRoleFilter={setStaffRoleFilter} setTitleFilter={setStaffTitleFilter}
              setProjectFilter={setStaffProjectFilter} setAccessFilter={setStaffAccessFilter}
              openMenu={staffOpenMenu} setOpenMenu={setStaffOpenMenu}
              startAligned
              customAccessLevels={accessLevelDefs.map(l => l.name)}
              compact
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Grid | Gantt sub-view toggle */}
            <div style={{
              display: "flex", backgroundColor: BRAND.card, borderRadius: 10,
              border: `1px solid ${BRAND.cardBorder}`, overflow: "hidden",
            }}>
              {(["Grid", "Gantt"] as TimelineSubView[]).map(sv => {
                const active = timelineSubView === sv;
                return (
                  <button key={sv} onClick={() => setTimelineSubView(sv)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "7px 13px", border: "none",
                      backgroundColor: active ? BRAND.greenBg : "transparent",
                      color: active ? BRAND.white : BRAND.textSecondary,
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>
                    {sv === "Grid" ? <LayoutGrid size={13} /> : <BarChart2 size={13} />}
                    {sv}
                  </button>
                );
              })}
            </div>

            {/* Weekly | Monthly toggle */}
            <div style={{
              display: "flex", backgroundColor: BRAND.card, borderRadius: 10,
              border: `1px solid ${BRAND.cardBorder}`, overflow: "hidden",
            }}>
              {(["Weekly", "Monthly"] as UtilMode[]).map(m => {
                const active = utilMode === m;
                return (
                  <button key={m} onClick={() => setUtilMode(m)}
                    style={{
                      padding: "7px 14px", border: "none",
                      backgroundColor: active ? BRAND.greenBg : "transparent",
                      color: active ? BRAND.white : BRAND.textSecondary,
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>{m}</button>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {showFilters && view === "Timeline" && (
        <div style={{
          margin: "0 16px 8px", padding: 12,
          backgroundColor: BRAND.card, borderRadius: 12, border: `1px solid ${BRAND.cardBorder}`,
        }}>
          {([
            { key: "includeClosedProject" as const, label: "Closed Projects" },
            { key: "includeSoftAllocations" as const, label: "Include Soft Allocations" },
            { key: "onlyNCO" as const, label: "Only NCO" },
            { key: "showActuals" as const, label: "Show Actuals" },
          ]).map(opt => {
            const sel = filters[opt.key];
            return (
              <button key={opt.key}
                onClick={() => setFilters(prev => ({ ...prev, [opt.key]: !prev[opt.key] }))}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "10px 0", background: "transparent", border: "none",
                  borderBottom: opt.key === "showActuals" ? "none" : "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer", color: BRAND.white, fontSize: 13, fontWeight: 500,
                }}>
                <span>{opt.label}</span>
                <span style={{
                  width: 22, height: 22, borderRadius: 6,
                  border: `2px solid ${sel ? BRAND.greenBg : BRAND.textSecondary}`,
                  backgroundColor: sel ? BRAND.greenBg : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {sel && <Check size={14} color={BRAND.white} />}
                </span>
              </button>
            );
          })}
        </div>
      )}


      {/* Search for Staff */}
      {view === "Staff" && (
        <>
          {/* Row 1: search bar + right-side controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px" }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, role, or title…" />
            </div>
            {/* Keep the compact organization filter control in the main toolbar
                so Staff does not create a second row just for Filters. */}
            <ResOrgFilterBar
              bus={staffOrgOptions.bus} divs={staffOrgOptions.divs} depts={staffOrgOptions.depts}
              allRoles={allStaffRoles} allTitles={allStaffTitles}
              allProjects={allProjectOptions}
              buFilter={staffBuFilter} divFilter={staffDivFilter} deptFilter={staffDeptFilter}
              roleFilter={staffRoleFilter} titleFilter={staffTitleFilter} projectFilter={staffProjectFilter}
              setBuFilter={setStaffBuFilter} setDivFilter={setStaffDivFilter} setDeptFilter={setStaffDeptFilter}
              setRoleFilter={setStaffRoleFilter} setTitleFilter={setStaffTitleFilter}
              setProjectFilter={setStaffProjectFilter}
              openMenu={staffOpenMenu} setOpenMenu={setStaffOpenMenu}
              startAligned compact
            />
            {/* Manager filter dropdown */}
            {managersList.length > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setStaffOpenMenu(staffOpenMenu === "manager" ? null : "manager")}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
                    borderRadius: 10, backgroundColor: BRAND.card, cursor: "pointer",
                    border: `1px solid ${staffManagerFilter ? BRAND.green : BRAND.cardBorder}`,
                    color: staffManagerFilter ? BRAND.green : BRAND.textSecondary,
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                  }}
                >
                  <Users size={12} />
                  <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {staffManagerFilter
                      ? (managersList.find(m => m.id === staffManagerFilter)?.name ?? "Manager")
                      : "Manager"}
                  </span>
                  <ChevronDown size={10} />
                </button>
                {staffOpenMenu === "manager" && (
                  <>
                    <div onClick={() => setStaffOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                    <div style={{
                      position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30,
                      backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`,
                      borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", minWidth: 220,
                      maxHeight: 320, overflowY: "auto",
                    }}>
                      <button onClick={() => { setStaffManagerFilter(null); setShowManagerOrgChart(false); setStaffOpenMenu(null); }}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: !staffManagerFilter ? BRAND.green : BRAND.white, fontSize: 13, cursor: "pointer" }}>
                        <span>All Staff</span>
                        {!staffManagerFilter && <Check size={14} />}
                      </button>
                      <div style={{ height: 1, background: BRAND.cardBorder, margin: "0 14px 4px" }} />
                      {managersList.map(m => (
                        <button key={m.id} onClick={() => {
                          const next = staffManagerFilter === m.id ? null : m.id;
                          setStaffManagerFilter(next);
                          // Picking a manager filters the grid AND opens the org-chart
                          // popup right away; the chart button re-opens it after close.
                          setShowManagerOrgChart(next !== null);
                          setStaffOpenMenu(null);
                        }}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 14px 8px 22px", background: "transparent", border: "none", color: staffManagerFilter === m.id ? BRAND.green : BRAND.white, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
                          <span>{m.name}</span>
                          {staffManagerFilter === m.id && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Org chart popup button — only shown when a manager is selected */}
            {staffManagerFilter && (
              <button
                onClick={() => setShowManagerOrgChart(true)}
                title="View org chart for this manager"
                style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "7px 10px",
                  borderRadius: 10, backgroundColor: BRAND.card, cursor: "pointer",
                  border: `1px solid ${BRAND.cardBorder}`, color: BRAND.textSecondary,
                  fontSize: 12, fontWeight: 600,
                }}
              >
                <BarChart2 size={13} style={{ transform: "rotate(90deg)" }} />
              </button>
            )}
            {/* Utilization tier dropdown — after Access */}
            {(() => {
              const tierOpts = [
                { label: "Overloaded",  color: BRAND.orange,     range: `≥${br.overCapacityPct}%` },
                { label: "Optimal",     color: BRAND.green,      range: `${br.targetUtilizationPct}–${br.overCapacityPct - 1}%` },
                { label: "Partial",     color: BRAND.greenLight, range: `${br.underAllocatedPct + 1}–${br.targetUtilizationPct - 1}%` },
                { label: "Under-used",  color: BRAND.red,        range: `0–${br.underAllocatedPct}%` },
                { label: "Active",      color: "#4B9CD3",        range: ">0%" },
                { label: "On Bench",    color: "#6B7280",        range: "0%" },
              ];
              const activeTier = tierOpts.find(t => t.label === staffTierFilter);
              const pillSt: React.CSSProperties = {
                display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
                borderRadius: 10, backgroundColor: BRAND.card, cursor: "pointer",
                border: `1px solid ${activeTier ? activeTier.color : BRAND.cardBorder}`,
                color: activeTier ? activeTier.color : BRAND.textSecondary,
                fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
              };
              return (
                <div style={{ position: "relative" }}>
                  <button onClick={() => setStaffOpenMenu(staffOpenMenu === "tier" ? null : "tier")} style={pillSt}>
                    {activeTier && <span style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: activeTier.color, flexShrink: 0 }} />}
                    <span>{activeTier ? activeTier.label : "Utilization"}</span>
                    <ChevronDown size={10} />
                  </button>
                  {staffOpenMenu === "tier" && (
                    <>
                      <div onClick={() => setStaffOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                      <div style={{
                        position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30,
                        backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`,
                        borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", minWidth: 210,
                      }}>
                        <button onClick={() => { setStaffTierFilter(null); setStaffOpenMenu(null); }}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: staffTierFilter === null ? BRAND.green : BRAND.white, fontSize: 13, cursor: "pointer" }}>
                          <span>All Utilization Levels</span>
                          {staffTierFilter === null && <Check size={14} />}
                        </button>
                        <div style={{ height: 1, background: BRAND.cardBorder, margin: "0 14px 4px" }} />
                        {tierOpts.map(t => (
                          <button key={t.label} onClick={() => { setStaffTierFilter(staffTierFilter === t.label ? null : t.label); setStaffOpenMenu(null); }}
                            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: staffTierFilter === t.label ? t.color : BRAND.white, fontSize: 13, cursor: "pointer" }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: t.color, flexShrink: 0 }} />
                            <span style={{ flex: 1, textAlign: "left" }}>{t.label}</span>
                            <span style={{ fontSize: 11, color: BRAND.textSecondary }}>{t.range}</span>
                            {staffTierFilter === t.label && <Check size={14} color={t.color} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            <ViewModeToggle
              mode={staffViewMode}
              onChange={setStaffViewMode}
              options={[
                { value: "grid", label: "Data Grid", icon: <Table2 size={12} /> },
                { value: "cards", label: "Cards", icon: <LayoutGrid size={12} /> },
              ]}
            />
          </div>
        </>
      )}

      {/* Demand overview — merged Skyline (weekly bars) + Breakdown command
          center charts, computed from the same real demand rows as the list
          below. Every chart element (week bar, donut slice, project row,
          role row/chip) opens the SAME in-place drill-down panel listing the
          open positions behind that number; navigation to a project happens
          only via the explicit "View project" link inside that panel. */}
      {view === "Demand" && !demandQ.isLoading && !demandQ.isError && demandItems.length > 0 && (
        <div style={{ padding: "10px 24px 2px" }}>
          <DemandOverview
            items={demandItems}
            // Land on the project's Team section with the open-position
            // rows highlighted (matches lib/issueLink TEAM_FOCUS_PARAMS).
            onProjectClick={(pid) => openProjectTeam(pid, undefined, true)}
            onAddMember={(pos) => staffingQA.openAddMember({
              projectId: pos.ticketId,
              projectName: pos.title,
              role: pos.role,
              consumeRaIds: pos.raIds,
            })}
          />
        </div>
      )}
      {staffingQA.modals}


      {/* TIMELINE BODY — Grid sub-view (graduated Gantt: phase-colored project
          sub-rows + utilization-band person rows + demand FTE footer) */}
      {view === "Timeline" && timelineSubView === "Grid" && (
        <ResourcesTimelineGrid
          rows={filteredUtilRowsOrg}
          periods={utilPeriods}
          mode={utilMode}
          selectedQ={selectedQ}
          loading={utilQ.isLoading}
          error={utilQ.isError ? "Failed to load utilization" : null}
          onRetry={() => utilQ.refetch()}
          staffResources={staffResources}
          demandItems={demandItems}
          onPersonClick={(name, userId) => openWeeklyHoursByName(name, userId)}
          onCellClick={(name, period, cell, row, userId, staffResource) => openCellModal(
            name,
            period,
            cell,
            userId || String((row as Record<string,unknown>).UserId ?? ""),
            staffResource,
          )}
          onColumnClick={(period) => setWeekColModal({ period })}
          onStatusBadgeClick={(name, userId) => openWeeklyHoursByName(name, userId)}
          onProjectClick={openProjectTeam}
          canEditProjectWeeks={canEdit}
          canManageStaff={canManageStaff}
          onSaveProjectWeek={coalescedTimelineWeekSave}
          onQClick={() => setShowQDropdown(v => !v)}
          onQuarterNavigate={navigateTimelineQuarter}
          quarterMenu={quarterMenuNode}
          pName={pName}
        />
      )}

      {/* TIMELINE BODY — Gantt sub-view */}
      {view === "Timeline" && timelineSubView === "Gantt" && (
        <GanttBody
          rows={filteredUtilRowsOrg}
          periods={utilPeriods}
          mode={utilMode}
          loading={utilQ.isLoading}
          error={utilQ.isError ? "Failed to load utilization" : null}
          onRetry={() => utilQ.refetch()}
          selectedPeriod={ganttPeriod}
          onSelectPeriod={setGanttPeriod}
          selectedQ={selectedQ}
          onPersonClick={(name, userId) => openWeeklyHoursByName(name, userId)}
          onQClick={() => setShowQDropdown(v => !v)}
          br={br}
        />
      )}

      {/* MANAGER BODY — the Timeline grid + a person search on top. Default
          shows EVERYONE (exact Timeline copy); picking a person from the
          search swaps the rows for their hierarchy: their row first, then per
          record (led OR member) everyone whose role ranks below theirs,
          grouped per record with section dividers. */}
      {view === "Manager" && !managerSelectedId && (
        <div style={{ margin: "10px 24px 2px", display: "flex", justifyContent: "flex-start", position: "relative", zIndex: 60 }}>
          {managerSearchPicker}
        </div>
      )}
      {view === "Manager" && !managerSelectedId && (
        <ResourcesTimelineGrid
          rows={managerDefaultRows}
          periods={utilPeriods}
          mode={utilMode}
          selectedQ={selectedQ}
          loading={utilQ.isLoading}
          error={utilQ.isError ? "Failed to load utilization" : null}
          onRetry={() => utilQ.refetch()}
          staffResources={staffResources}
          demandItems={demandItems}
          onPersonClick={(name, userId) => openWeeklyHoursByName(name, userId)}
          onCellClick={(name, period, cell, row, userId, staffResource) => openCellModal(
            name,
            period,
            cell,
            userId || String((row as Record<string, unknown>).UserId ?? ""),
            staffResource,
          )}
          onColumnClick={(period) => setWeekColModal({ period })}
          onStatusBadgeClick={(name, userId) => openWeeklyHoursByName(name, userId)}
          onProjectClick={openProjectTeam}
          canEditProjectWeeks={canEdit}
          canManageStaff={canManageStaff}
          onSaveProjectWeek={coalescedTimelineWeekSave}
          onQClick={() => setShowQDropdown(v => !v)}
          onQuarterNavigate={navigateTimelineQuarter}
          quarterMenu={quarterMenuNode}
          pName={pName}
           personSort="firstName"
        />
      )}
      {view === "Manager" && managerSelectedId && (
        <div style={{ padding: "12px 24px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Context strip: selected person + hierarchy counts */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0, flex: "1 1 auto" }}>
              <button
                onClick={() => { setManagerSelectedId(null); setShowManagerOrgChart(false); }}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  gap: 6, width: "fit-content", height: 30, padding: "0 12px",
                  boxSizing: "border-box", lineHeight: 1,
                  borderRadius: 8, border: `1px solid ${BRAND.cardBorder}`, background: BRAND.card,
                  color: BRAND.textMuted, fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}
              >
                <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>←</span> All staff
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, minHeight: 30 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", background: BRAND.greenBg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 11, fontWeight: 800, flexShrink: 0,
                }}>
                  {(managerGrid?.self?.name ?? "?").trim().split(/\s+/).map(p => p[0] ?? "").slice(0, 2).join("").toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {managerGrid?.self?.name ?? "…"}
                  </div>
                  {managerGrid?.self?.title ? (
                    <div style={{ color: BRAND.textMuted, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {managerGrid.self.title}
                    </div>
                  ) : null}
                </div>
            <button
              type="button"
              onClick={() => setShowManagerOrgChart(true)}
              title="View visual chart for this manager"
              aria-label="View visual chart for this manager"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                 justifyContent: "center", width: "fit-content", height: 30,
                 padding: "0 12px", boxSizing: "border-box", lineHeight: 1,
                 borderRadius: 9,
                border: `1px solid ${BRAND.green}88`, background: `${BRAND.green}18`,
                color: BRAND.green, fontSize: 12, fontWeight: 800,
                cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              <BarChart2 size={14} style={{ transform: "rotate(90deg)" }} />
              Visual chart
            </button>
              </div>
              {managerCtxQ.isLoading ? (
                <span style={{ color: BRAND.textMuted, fontSize: 11 }}>Scanning team structure…</span>
              ) : managerCtxQ.data ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { n: managerGrid?.recordCount ?? 0, label: (managerGrid?.recordCount ?? 0) === 1 ? "record" : "records" },
                    { n: managerGrid?.peopleShown ?? 0, label: "shared teammates" },
                  ].map(c => (
                    <span key={c.label} style={{
                      padding: "4px 10px", borderRadius: 999, background: BRAND.card,
                      border: `1px solid ${BRAND.cardBorder}`, color: BRAND.textMuted,
                      fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap",
                    }}>
                      <strong style={{ color: BRAND.white, fontWeight: 800 }}>{c.n}</strong> {c.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {managerSearchPicker}
          </div>
          {/* Honesty rule: a failed scan must never read as "no team". */}
          {(managerCtxQ.data?.teamError || managerCtxQ.data?.membershipError || managerCtxQ.data?.partial) && (
            <div style={{
              padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(232,119,34,0.45)",
              background: "rgba(232,119,34,0.10)", color: "#E87722", fontSize: 11.5, fontWeight: 600,
            }}>
              Part of the team scan failed — some records or people may be missing from this view. Try again in a moment.
            </div>
          )}
          {managerCtxQ.data?.truncated && (
            <div style={{ color: BRAND.textMuted, fontSize: 11, fontWeight: 600 }}>
              This person is on a very large number of records — showing the first batch only.
            </div>
          )}
          {managerCtxQ.data && !managerCtxQ.isLoading
            && !(managerCtxQ.data.teamError || managerCtxQ.data.membershipError || managerCtxQ.data.partial)
            && (managerGrid?.peopleShown ?? 0) === 0 && (
            <div style={{
              padding: "8px 12px", borderRadius: 8, border: `1px solid ${BRAND.cardBorder}`,
              background: BRAND.card, color: BRAND.textMuted, fontSize: 11.5, fontWeight: 600,
            }}>
              No other active teammates were found on records shared with {managerGrid?.self?.name ?? "this person"} — showing their own timeline.
            </div>
          )}
          <ResourcesTimelineGrid
            key={managerSelectedId}
            rows={managerGrid?.rows ?? []}
            sections={managerGrid?.sections}
            defaultExpandedUserIds={[managerSelectedId]}
            projectScopeByUserId={managerGrid?.projectIdsByPerson}
            periods={utilPeriods}
            mode={utilMode}
            selectedQ={selectedQ}
            loading={utilQ.isLoading || managerCtxQ.isLoading}
            error={utilQ.isError
              ? "Failed to load utilization"
              : managerCtxQ.isError ? "Failed to load this person's team structure." : null}
            onRetry={() => { if (utilQ.isError) void utilQ.refetch(); if (managerCtxQ.isError) void managerCtxQ.refetch(); }}
            staffResources={staffResources}
            demandItems={[]}
            onPersonClick={(name, userId) => openWeeklyHoursByName(
              name,
              userId,
              /* No shared-record entry = NOTHING shared. Pass an EMPTY scope
                 so the popup fails closed instead of leaking full history. */
              managerGrid?.projectIdsByPerson[
                String(userId || "").trim().toLowerCase()
              ] ?? [],
              managerGrid?.self?.name,
            )}
            onCellClick={(name, period, cell, row, userId, staffResource) => openCellModal(
              name,
              period,
              cell,
              userId || String((row as Record<string, unknown>).UserId ?? ""),
              staffResource,
              managerGrid?.projectIdsByPerson[
                String(userId || (row as Record<string, unknown>).UserId || "").trim().toLowerCase()
              ] ?? [],
            )}
            onColumnClick={(period) => setWeekColModal({ period })}
            onStatusBadgeClick={(name, userId) => openWeeklyHoursByName(
              name,
              userId,
              managerGrid?.projectIdsByPerson[
                String(userId || "").trim().toLowerCase()
              ] ?? [],
              managerGrid?.self?.name,
            )}
            onProjectClick={openProjectTeam}
            canEditProjectWeeks={canEdit}
            canManageStaff={canManageStaff}
            onSaveProjectWeek={coalescedTimelineWeekSave}
            onQuarterNavigate={navigateTimelineQuarter}
            onQClick={() => setShowQDropdown(v => !v)}
            quarterMenu={quarterMenuNode}
            pName={pName}
            personSort="firstName"
          />
        </div>
      )}

      {/* ── Duplicate login identity banner (admin + Staff view only) ───────
          Display-name matches are valid. This is shown only when enabled
          accounts share the same normalized email/login identity. */}
      {view === "Staff" && canManageStaff && dupNames.length > 0 && !dupNamesDismissed && (
        <div style={{
          margin: "0 24px 8px",
          padding: "12px 14px",
          borderRadius: 10,
          backgroundColor: "#7C3AED18",
          border: "1px solid #7C3AED55",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}>
          <AlertTriangle size={16} color="#7C3AED" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED", marginBottom: 4 }}>
              {dupNames.length === 1
                ? "1 duplicate staff account needs attention"
                : `${dupNames.length} duplicate staff accounts need attention`}
            </div>
            <div style={{ fontSize: 12, color: BRAND.white, lineHeight: 1.5, marginBottom: 6 }}>
              A duplicate staff account means the same email/login identity is used by multiple
              enabled accounts. Review the accounts below and disable the one that should no
              longer be active.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {dupNames.map(g => (
                <div key={g.name} style={{
                  fontSize: 12, color: BRAND.textSecondary,
                  display: "flex", flexWrap: "wrap", gap: "2px 8px",
                  alignItems: "baseline",
                }}>
                  <span style={{ fontWeight: 700, color: BRAND.white }}>{g.name}</span>
                  <span style={{ color: BRAND.textMuted }}>—</span>
                  {g.accounts.map((a, i) => (
                    <span key={a.id}>
                      {a.name ? `${a.name} · ` : ""}{a.email || a.username || a.id}
                      {i < g.accounts.length - 1 ? <span style={{ color: BRAND.textMuted }}>,</span> : null}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setDupNamesDismissed(true)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: BRAND.textMuted, padding: 2, flexShrink: 0,
              display: "flex", alignItems: "center",
            }}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* STAFF BODY */}
      {view === "Staff" && (
        <div style={{ padding: staffViewMode === "grid" ? "0 24px 16px" : "0 24px 80px" }}>
          {allocQ.isLoading && staffResources.length === 0 ? (
            <CenterLoader text="Loading resource data…" />
          ) : allocQ.isError && staffResources.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
              padding: "60px 20px", gap: 12 }}>
              <AlertCircle size={32} color={BRAND.red} />
              <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>Failed to load resources</div>
              <button onClick={() => allocQ.refetch()} style={{
                padding: "8px 18px", borderRadius: 8, border: "none",
                backgroundColor: BRAND.greenBg, color: BRAND.white, fontWeight: 700, cursor: "pointer",
              }}>Retry</button>
            </div>
          ) : filteredStaff.length === 0 ? (
            <Empty icon={<Users size={32} color={BRAND.textMuted} />}
              title="No results found" subtitle={search ? `No matches for "${search}"` : "All staff are above threshold"} />
          ) : staffViewMode === "grid" ? (
            <>
            {(() => {
              const legend = empTypeLegend();
              if (!legend.length) return null;
              return (
                <div style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "6px 4px 8px",
                  flexWrap: "wrap",
                }}>
                  <span style={{ fontSize: 10, color: BRAND.textMuted, fontWeight: 600, letterSpacing: 0.3 }}>NAME COLOR</span>
                  {legend.map(({ label, color }) => (
                    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: color, flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 10.5, color: BRAND.textMuted, fontWeight: 500 }}>{label}</span>
                    </span>
                  ))}
                </div>
              );
            })()}
            <RecordDataGrid
              columnPreferenceKey="resources-staff"
              rows={filteredStaff}
              rowKey={(r, i) => r.id || `${r.username || r.name}-${i}`}
              onRowClick={r => setProfileResource(r)}
              emptyText={search ? `No matches for "${search}"` : "No staff found"}
              maxBodyHeight="65vh"
              initialSort={{ key: "alloc", dir: "desc" }}
              columns={[
                { key: "name", label: "Name", minWidth: 200, maxAuto: 300, hoverTitle: r => r.name || undefined, sortValue: r => r.name, render: r => {
                  const empColor = empTypeColor(r.employeeType) ?? undefined;
                  const leave = activeAvailabilityWindow(windowsForResource(r.id)) as AvailWindow | null;
                  return (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0, width: "100%" }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: 999, backgroundColor: "var(--rm-green)", color: "#fff",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9.5, fontWeight: 800, flexShrink: 0,
                      }}>
                        {r.name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                        <span style={{
                          fontWeight: 600, color: empColor,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{r.name}</span>
                        <DisabledMemberStatus enabled={r.enabled} userGuid={r.id} tenantId={r.tenantId}
                          canManageStaff={canManageStaff} onReactivated={() => { void allocQ.refetch(); }} />
                        {r.employeeType && (
                          <span style={{
                            fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap",
                            color: empColor ?? BRAND.textMuted,
                          }}>{r.employeeType}</span>
                        )}
                        {leave && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setAvailabilityDetail({ resource: r, availability: leave });
                            }}
                            title={`${fmtAvailRange(leave.startDate, leave.endDate)}${leave.reason ? ` · ${leave.reason}` : ""}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 3, alignSelf: "flex-start",
                              marginTop: 1, padding: "0px 6px", borderRadius: 999,
                              backgroundColor: leave.availabilityPct === 0 ? BRAND.orange + "1F" : "rgba(107,126,138,0.15)",
                              border: `1px solid ${leave.availabilityPct === 0 ? BRAND.orange + "55" : "rgba(107,126,138,0.35)"}`,
                              color: leave.availabilityPct === 0 ? BRAND.orange : "#6B7E8A",
                              fontSize: 9, fontWeight: 700, whiteSpace: "nowrap",
                              cursor: "pointer",
                            }}>
                            <Calendar size={9} />
                            {(leave as any).leaveType || availPctLabel(leave.availabilityPct)}
                          </button>
                        )}
                      </span>
                    </span>
                  );
                } },
                { key: "roleName", label: "Role", width: 118, sortValue: r => r.roleName || null,
                  render: r => <OrgCell value={r.roleName} kind="role" /> },
                { key: "role", label: "Title", width: 118, sortValue: r => r.role || null,
                  render: r => <OrgCell value={r.role} kind="title" /> },
                { key: "businessUnit", label: "BU", width: 104, sortValue: r => r.businessUnit || null,
                  render: r => <OrgCell value={r.businessUnit} kind="bu" /> },
                // Division column hidden when the tier is toggled off — the stored
                // values are bridge divisions mirror-named after the BU.
                ...(getBusinessRules().showDivision ? [{ key: "divisionName", label: "Division", width: 116, sortValue: (r: LiveResourceProxy) => r.divisionName || null,
                  render: (r: LiveResourceProxy) => <OrgCell value={r.divisionName} kind="division" /> }] : []),
                { key: "departmentName", label: "Department", width: 116, sortValue: r => r.departmentName || null,
                  render: r => <OrgCell value={r.departmentName} kind="department" /> },
                { key: "alloc", label: "Allocation", align: "center", width: 160,
                  // Default view sorts by this column desc — most allocated first,
                  // ties broken by active-project count, then total projects.
                  sortValue: r => r.currentPct * 100000 + Math.min(99, r.activeProjects.length) * 100 + Math.min(99, r.totalProjects),
                  render: r => {
                    const pct = Number(r.currentPct.toFixed(2));
                    const color = pct >= br.overCapacityPct ? "#F87171"
                      : pct >= br.targetUtilizationPct ? "#6BA539"
                      : pct > br.underAllocatedPct ? "#A9C23F"
                      : pct > 0 ? "#E87722" : "#6B7280";
                    const segs = hoursWinFilter(r.activeAllocations ?? []).filter(a => (a.pct ?? 0) > 0);
                    const SEG_COLORS = ["#6BA539", "#4B9CD3", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];
                    const scale = Math.max(100, pct) || 1;
                    const active = r.activeProjects.length;
                    const total = r.totalProjects;
                    return (
                      <span
                        onClick={e => { e.stopPropagation(); openWeeklyHours(r, "allocation"); }}
                        title={segs.length
                          ? segs.map(a => `${pName(a.projectId)}: ${+a.pct.toFixed(1)}%`).join("  ·  ") + " — click for weekly hours"
                          : `${pct}% allocated — click for weekly hours`}
                        style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", cursor: "pointer" }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, width: "100%" }}>
                          <span style={{
                            flex: 1, height: 9, borderRadius: 5, minWidth: 40,
                            backgroundColor: "rgba(128,128,128,0.16)",
                            overflow: "hidden", display: "flex",
                          }}>
                            {segs.length > 0 ? segs.map((a, i) => (
                              <span key={`${a.projectId}-${i}`} style={{
                                width: `${Math.max(2, (Math.min(a.pct, scale) / scale) * 100)}%`,
                                height: "100%",
                                backgroundColor: SEG_COLORS[i % SEG_COLORS.length],
                                borderRight: i < segs.length - 1 ? "1px solid rgba(0,0,0,0.25)" : "none",
                              }} />
                            )) : pct > 0 ? (
                              <span style={{ width: `${(Math.min(pct, scale) / scale) * 100}%`, height: "100%", backgroundColor: color }} />
                            ) : null}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 800, color, minWidth: 38, textAlign: "right", flexShrink: 0 }}>
                            {pct}%
                          </span>
                        </span>
                        {total > 0 && (
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              backgroundColor: active > 0 ? `${color}22` : "rgba(107,126,138,0.15)",
                              border: `1px solid ${active > 0 ? color + "55" : "rgba(107,126,138,0.3)"}`,
                              borderRadius: 999, padding: "1px 6px",
                              fontSize: 9.5, fontWeight: 800,
                              color: active > 0 ? color : "#6B7E8A",
                              whiteSpace: "nowrap",
                            }}>{active}/{total}</span>
                            <span style={{ fontSize: 9, color: "#6B7E8A", fontWeight: 600 }}>active/total</span>
                          </span>
                        )}
                      </span>
                    );
                  } },
                { key: "projects", label: "Total Projects", align: "center", width: 116,
                  // Keep the previous active-first ordering while the cell now
                  // presents active and all-time project counts together.
                  sortValue: r => r.activeProjects.length * 1000 + r.totalProjects,
                  render: r => {
                    const active = r.activeProjects.length;
                    const total = r.totalProjects;
                    return (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setStaffListModal({ r, mode: "all" }); }}
                        title={`${active} active / ${total} total project${total === 1 ? "" : "s"} — click to see the full project list`}
                        aria-label={`${active} active of ${total} total projects`}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          background: "transparent", border: "none", padding: 0,
                          cursor: total > 0 ? "pointer" : "default",
                        }}
                      >
                        <AllocBadge count={active} total={total} />
                      </button>
                    );
                  } },
                { key: "conflict", label: "Conflict", align: "center", width: 104,
                  sortValue: r => staffConflictCount(r),
                  render: r => {
                    const c = staffConflictCount(r);
                    const color = c > 0 ? "#F59E0B" : "#6B7280";
                    return (
                      <span
                        onClick={e => { e.stopPropagation(); openStaffConflictAnalysis(r); }}
                        title={c > 0 ? `On ${c} concurrent funded projects — click for AI conflict analysis` : "No cross-project conflict — click for AI conflict analysis"}
                        style={{ cursor: "pointer", display: "inline-flex" }}
                      >
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          minWidth: 34, padding: "3px 8px", borderRadius: 999,
                          border: `1.5px solid ${color}`, color, fontSize: 11, fontWeight: 800,
                          justifyContent: "center", whiteSpace: "nowrap",
                        }}>
                          {c > 0 && <AlertTriangle size={10} />}
                          {c}
                        </span>
                      </span>
                    );
                  } },
                { key: "totalProjects", label: "Total Projects", align: "center", width: 120,
                  sortValue: r => r.totalProjects,
                  render: r => (
                    <CountPill
                      count={r.totalProjects}
                      color="#4B9CD3"
                      onClick={() => setStaffListModal({ r, mode: "all" })}
                      title={`${r.totalProjects} project${r.totalProjects === 1 ? "" : "s"} all-time — click to see the full list`}
                    />
                  ) },
                { key: "ai", label: "AI", width: 56, align: "center", noSort: true, stickyRight: true, render: r => (
                  <AiAnalyzeButton onClick={() => setAiStaffTarget(r)} title={`AI analysis for ${r.name}`} />
                ) },
                // Three-dots row menu. Every action stays on Resources and
                // opens an in-place popup; no detour through Quick Actions.
                // Staff editing is intentionally consolidated here rather than
                // rendered as a separate pencil column.
                { key: "dots", label: "", width: 44, align: "center" as const, noSort: true, stickyRight: true,
                  render: (r: typeof filteredStaff[0]) => {
                    if (!(canManageStaff || r.username === currentUsername)) return null;
                    return (
                      <StaffDotsMenu
                         onAction={(action) => handleStaffDotsAction(r, action)}
                      />
                    );
                  },
                },
              ]}
            />
            </>
          ) : (
            // When manager filter is active, show cards grouped by "Direct Reports"
            // and "Project Team" with a section header between the two groups.
            (() => {
              const renderCard = (r: typeof filteredStaff[0]) => {
                const uid = r.id || r.username || r.name;
                const isSelected = selectedStaff === uid;
                return (
                  <StaffCard
                    key={uid}
                    r={r}
                    windows={windowsForResource(r.id)}
                    resolveAccess={accessDisplayOf}
                    pgVersion={staffPgVersion}
                    expanded={isSelected}
                    onToggle={() => setSelectedStaff(isSelected ? null : uid)}
                    pName={pName}
                    canEdit={
                      (canManageStaff && (r.username !== currentUsername || isCurrentUserAdmin)) ||
                      (!canManageStaff && !!staffSelfRevert && r.username === currentUsername)
                    }
                    canEditHours={canManageStaff}
                    canManageStaff={canManageStaff}
                    onReactivated={() => { void allocQ.refetch(); }}
                    onProjectClick={openProjectTeam}
                    onSaveProjectWeek={saveResourceProjectWeek}
                    onSaveProjectWeeks={saveResourceProjectWeeks}
                     onStaffAction={
                       canManageStaff || r.username === currentUsername
                         ? (action) => handleStaffDotsAction(r, action)
                         : undefined
                     }
                    onShowProfile={() => setProfileResource(r)}
                    onAvailabilityClick={(availability) => setAvailabilityDetail({ resource: r, availability })}
                    onEdit={() => {
                      if (!canManageStaff && staffSelfRevert && r.username === currentUsername) {
                        setSelfRevertConfirm(true); setSelfRevertErr(null);
                      } else {
                        setEditResource(r);
                      }
                    }}
                    onReallocateAI={() => {
                      const pctInfo = r.currentPct === 0
                        ? "on bench with 0% project utilization"
                        : `at ${r.currentPct}% overall allocation`;
                      handoff(
                        `I want to assign ${r.name}${r.role ? ` (${r.role})` : ""}, who is ${pctInfo}${r.activeProjects.length ? `, ${r.activeProjects.length} currently active` : ""}${r.totalProjects ? `, ${r.totalProjects} total past projects` : ""}. First, look through the PMM active projects data you already have to find 3-5 projects that are currently active (In Progress, Construction, or similar active status). Match them based on the person's job title, past project experience, sector expertise, and location. List each recommended project with its full PMM ID, name, status, value, and why it's a good fit. Do NOT say there are no active projects — there are hundreds of active PMM projects in the data.`,
                      );
                    }}
                    onConcentrationAI={() => {
                      const activePids = Array.from(new Set(r.activeProjects));
                      const topProject = activePids.length > 0 ? pName(activePids[0]) : "unknown";
                      const otherProjects = activePids.slice(1).map(pid => pName(pid));
                      handoff(
                        `Analyze concentration risk for ${r.name}${r.role ? ` (${r.role})` : ""} who is at ${r.currentPct}% allocation${activePids.length === 1 ? ` concentrated entirely on "${topProject}"` : ` with ${activePids.length} active projects, primarily "${topProject}"${otherProjects.length ? ` and also on ${otherProjects.map(n => `"${n}"`).join(", ")}` : ""}`}. Fetch their full project allocations and assess: 1) What is the risk to delivery if this person is unavailable? 2) Is this level of concentration appropriate for their role? 3) Which project is most exposed? 4) Give 2-3 specific actionable recommendations to reduce the risk — such as cross-training a backup, splitting responsibilities, or adjusting allocation. Be direct and specific.`,
                      );
                    }}
                  />
                );
              };

              if (managerFilterIds !== null && managerStaffData) {
                const directIdSet = new Set((managerStaffData.direct ?? []).map(d => d.id.toLowerCase()));
                const directCards = filteredStaff.filter(r => directIdSet.has((r.id || "").toLowerCase()));
                const teamCards   = filteredStaff.filter(r => !directIdSet.has((r.id || "").toLowerCase()));
                const sectionHeader = (label: string, count: number) => (
                  <div style={{ gridColumn: "1 / -1", paddingTop: 8, paddingBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: BRAND.textSecondary }}>{label}</span>
                    <span style={{ fontSize: 11, color: BRAND.textMuted, marginLeft: 8 }}>{count}</span>
                  </div>
                );
                return (
                  <div style={{ display: "grid", gap: 10,
                    gridTemplateColumns: "repeat(auto-fill, minmax(max(340px, calc(25% - 8px)), 1fr))", alignItems: "stretch" }}>
                    {directCards.length > 0 && (
                      <>{sectionHeader("Direct Reports", directCards.length)}{directCards.map(renderCard)}</>
                    )}
                    {teamCards.length > 0 && (
                      <>{sectionHeader("Project Team", teamCards.length)}{teamCards.map(renderCard)}</>
                    )}
                  </div>
                );
              }

              return (
                <div style={{ display: "grid", gap: 10,
                  gridTemplateColumns: "repeat(auto-fill, minmax(max(340px, calc(25% - 8px)), 1fr))", alignItems: "stretch" }}>
                  {filteredStaff.map(renderCard)}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* DEMAND BODY — loading/error/empty states only; data is shown via DemandOverview above */}
      {view === "Demand" && (demandQ.isLoading || demandQ.isError || demandItems.length === 0) && (
        <div style={{ padding: "0 24px 80px" }}>
          {demandQ.isLoading ? (
            <CenterLoader text="Loading demand…" />
          ) : demandQ.isError ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
              <AlertCircle size={32} color={BRAND.red} />
              <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>Failed to load demand</div>
              <button onClick={() => demandQ.refetch()} style={{ padding: "8px 18px", borderRadius: 8, border: "none", backgroundColor: BRAND.greenBg, color: BRAND.white, fontWeight: 700, cursor: "pointer" }}>Retry</button>
            </div>
          ) : (
            <Empty icon={<AlertCircle size={32} color={BRAND.textMuted} />}
              title="No open demand" subtitle="No unfilled positions found" />
          )}
        </div>
      )}


      {/* Manager org-chart popup — shared by Staff's manager filter and the
          standalone Manager view's Visual chart button. */}
      {showManagerOrgChart && (staffManagerFilter || managerSelectedId) && createPortal(
        <ManagerOrgChartPopup
          managerId={staffManagerFilter ?? managerSelectedId!}
          managerName={
            staffManagerFilter
              ? (managersList.find(m => m.id === staffManagerFilter)?.name ?? "Manager")
              : (managerGrid?.self?.name ?? managerCtxQ.data?.person.name ?? "Manager")
          }
          staffResources={staffResources}
          managerStaffData={staffManagerFilter ? managerStaffData : managerChartData}
          // isPlaceholderData guard: the query keeps the PREVIOUS manager's
          // payload as placeholder on manager switch (isLoading stays false),
          // so without it the popup would open showing manager A's tree under
          // manager B's name. Spinner must show until the new payload lands.
          loading={
            staffManagerFilter
              ? managerStaffQ.isLoading || managerStaffQ.isPlaceholderData
              : managerCtxQ.isLoading
          }
          onClose={() => setShowManagerOrgChart(false)}
        />,
        document.body,
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes rmonePulseDot {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50%      { opacity: 1;   transform: scale(1.25); }
        }
        @keyframes rmoneAgentIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes rmoneSheen {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes rmoneDotsBlink {
          0%, 20%   { opacity: 0.2; }
          50%       { opacity: 1; }
          80%, 100% { opacity: 0.2; }
        }
        .rmone-pulse { animation: rmonePulseDot 1.2s ease-in-out infinite; }
        .rmone-agent-row {
          animation: rmoneAgentIn 0.35s ease-out both;
          background-image: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%);
          background-size: 200% 100%;
          background-position: -200% 0;
          background-repeat: no-repeat;
          animation-name: rmoneAgentIn, rmoneSheen;
          animation-duration: 0.35s, 2.4s;
          animation-timing-function: ease-out, ease-in-out;
          animation-iteration-count: 1, infinite;
          animation-fill-mode: both, none;
        }
        .rmone-agent-dot { animation: rmonePulseDot 1s ease-in-out infinite; }
        .rmone-dots span { animation: rmoneDotsBlink 1.4s infinite; display: inline-block; }
        .rmone-dots span:nth-child(2) { animation-delay: 0.2s; }
        .rmone-dots span:nth-child(3) { animation-delay: 0.4s; }
      `}</style>

      {aiAnalysis && (
        <AIAnalysisModal
          name={aiAnalysis.name}
          subtitle={aiAnalysis.subtitle}
          prompt={aiAnalysis.prompt}
          clickedPeriod={aiAnalysis.clickedPeriod}
          ganttProjects={aiAnalysis.ganttProjects}
          qRange={aiAnalysis.qRange}
          onClose={() => setAiAnalysis(null)}
        />
      )}

      {ganttModal && (
        <StaffGanttModal
          name={ganttModal.name}
          subtitle={ganttModal.subtitle}
          ganttProjects={ganttModal.ganttProjects}
          qRange={ganttModal.qRange}
          onClose={() => setGanttModal(null)}
        />
      )}

      {conflictModal && (
        <ConflictAnalysisModal
          memberName={conflictModal.memberName}
          role={conflictModal.role}
          projectName={conflictModal.projectName}
          projectId={conflictModal.projectId}
          thisPct={conflictModal.thisPct}
          thisHrs={conflictModal.thisHrs}
          otherProjects={conflictModal.otherProjects}
          onClose={() => setConflictModal(null)}
        />
      )}

      {aiStaffTarget && (() => {
        const r = aiStaffTarget;
        const pct = Number(r.currentPct.toFixed(1));
        const segs = hoursWinFilter(r.activeAllocations ?? []).filter(a => (a.pct ?? 0) > 0);
        const SEG_COLORS = ["#6BA539", "#4B9CD3", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];
        const hrsWk = Math.round(hoursWinFilter(r.activeAllocations ?? []).reduce((s, a) => s + allocEntryHrsPerWeek(a, getBusinessRules().workWeekHours), 0));
        const conflicts = staffConflictCount(r);
        const headroom = Math.max(0, Math.round((100 - pct) * 10) / 10);

        const utilization = pct >= br.overCapacityPct
          ? `At ${pct}% allocation — over the ${br.overCapacityPct}% capacity threshold. Rebalance work before quality or burnout become issues.`
          : pct >= br.targetUtilizationPct
            ? `At ${pct}% allocation — inside the healthy ${br.targetUtilizationPct}-${br.overCapacityPct}% utilization band. Keep assignments steady.`
            : pct > br.underAllocatedPct
              ? `At ${pct}% allocation — below the ${br.targetUtilizationPct}% target. Room for another assignment without overloading.`
              : pct > 0
                ? `At ${pct}% allocation — significantly under-utilized. Consider staffing on upcoming or pipeline work.`
                : "No current allocation — fully available for new project assignments.";
        const conflictText = conflicts > 0
          ? `On ${conflicts} concurrent funded project${conflicts === 1 ? "" : "s"} — watch for competing deadlines and split focus across engagements.`
          : segs.length > 1
            ? `Split across ${segs.length} active projects with no funded-capacity conflict detected.`
            : "No cross-project conflict — focus is consolidated.";
        const capacity = `${hrsWk > 0 ? `Currently delivering about ${hrsWk}h/week across active work.` : "No active weekly hours recorded."}${
          headroom > 0 ? ` Roughly ${headroom}% of capacity remains open.` : " No spare capacity at current load."}`;

        const prompt = `Analyze the workload of ${r.name}${r.roleName ? ` (${r.roleName})` : ""}. They are at ${pct}% allocation across ${r.activeProjects.length} active project${r.activeProjects.length === 1 ? "" : "s"}${hrsWk > 0 ? `, about ${hrsWk}h/week` : ""}. First fetch their assignments, then assess utilization, conflicts and fit, and recommend specific rebalancing or staffing actions.`;

        return (
          <AiInsightPanel
            open
            onClose={() => setAiStaffTarget(null)}
            title={r.name}
            subtitle={`AI Intelligence · ${r.roleName || r.role || "Staff"}`}
            accent="#4B9CD3"
            badgeText="AI Staff Intelligence — Live Data"
            stats={[
              { icon: <Activity size={11} />, label: "Allocation", value: `${pct}%` },
              { icon: <Layers size={11} />, label: "Active Projects", value: String(r.activeProjects.length) },
              { icon: <TrendingUp size={11} />, label: "Hours / Week", value: hrsWk > 0 ? `${hrsWk}h` : "—" },
              { icon: <Briefcase size={11} />, label: "Total Projects", value: String(r.totalProjects) },
            ]}
            mixLabel="Allocation by project"
            mix={segs.map((a, i) => ({
              label: pName(a.projectId),
              val: Math.max(0.1, Number((a.pct ?? 0).toFixed(1))),
              color: SEG_COLORS[i % SEG_COLORS.length],
            }))}
            analysisTags={["Utilization", "Conflicts", "Capacity"]}
            bullets={[
              { icon: <Target size={13} />, tone: "#6BA539", text: utilization },
              { icon: <AlertTriangle size={13} />, tone: "#F59E0B", text: conflictText },
              { icon: <Zap size={13} />, tone: "#4B9CD3", text: capacity },
            ]}
            onAskAI={() => { setAiStaffTarget(null); handoff(prompt); }}
            askLabel="Ask AI"
          >
            <button
              onClick={() => { setAiStaffTarget(null); setProfileResource(r); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "11px 14px", borderRadius: 12, cursor: "pointer",
                border: "1px solid var(--rm-panel-border)", background: "transparent",
                color: "var(--rm-text)", fontSize: 12.5, fontWeight: 700,
              }}
            >
              Open full profile
              <ChevronRight size={14} style={{ color: "var(--rm-text-muted)" }} />
            </button>
          </AiInsightPanel>
        );
      })()}

      {staffListModal && (() => {
        const liveResource = staffResources.find(resource =>
          resource.id.toLowerCase() === staffListModal.r.id.toLowerCase()
        ) ?? staffListModal.r;
        return (
          <StaffUtilModal
            r={liveResource}
            windows={windowsForResource(liveResource.id)}
            status={statusInfo(liveResource.currentPct)}
            pName={pName}
            mode={staffListModal.mode}
            projectScope={staffListModal.projectScope}
            scopeOwnerName={staffListModal.scopeOwnerName}
            onClose={() => setStaffListModal(null)}
            onProjectClick={openProjectTeam}
            canEditHours={canManageStaff}
            onSaveProjectWeek={saveResourceProjectWeek}
            onSaveProjectWeeks={saveResourceProjectWeeks}
          />
        );
      })()}

      {weekColModal && (
        <WeekColumnModal
          period={weekColModal.period}
          rows={filteredUtilRowsOrg}
          periods={utilPeriods}
          mode={utilMode}
          onClose={() => setWeekColModal(null)}
        />
      )}

      {liveCellModal && (
        <CellDetailModal
          name={liveCellModal.name}
          period={liveCellModal.period}
          pct={liveCellModal.pct}
          hours={liveCellModal.hours}
          projects={liveCellModal.projects}
          weeks={liveCellModal.weeks}
          projList={liveCellModal.projList}
          projectAllocs={liveCellModal.projectAllocs}
          personId={liveCellModal.userId ?? ""}
          role={liveCellModal.role}
          canEditHours={canManageStaff}
          onSaveProjectWeek={saveResourceProjectWeek}
           onSaveProjectWeeks={saveResourceProjectWeeks}
          onClose={() => setCellModal(null)}
          onFullAnalysis={() => { const p = liveCellModal.period; const uid = liveCellModal.userId; setCellModal(null); openAnalysis(liveCellModal.name, p, uid); }}
          onOpenProjectRecord={openProjectRecord}
        />
      )}

      {weeklyHours && (
        <WeeklyHoursModal
          name={weeklyHours.name}
          role={weeklyHours.role}
          focus={weeklyHours.focus}
          pct={weeklyHours.pct}
          activeCount={weeklyHours.activeCount}
          weeks={weeklyHours.weeks}
          projList={weeklyHours.projList}
          onClose={() => setWeeklyHours(null)}
        />
      )}

      {profileResource && (
        <ProfileModal
          r={profileResource}
          pName={pName}
          onClose={() => setProfileResource(null)}
          onProjectClick={(pid) => { setProfileResource(null); navigate(`/project/${pid}`); }}
          onAssignMember={() => {
            const res = profileResource;
            setProfileResource(null);
            const params = new URLSearchParams({
              assignStaff: "1",
              staffId: res.id || res.username || res.name,
              staffName: res.name,
            });
            if (res.username) params.set("staffEmail", res.username);
            if (res.roleName || res.role) params.set("staffRole", res.roleName || res.role);
            navigate(`/quick-actions?${params.toString()}`);
          }}
        />
      )}

      {availabilityDetail && (
        <AvailabilityDetailModal
          resource={availabilityDetail.resource}
          availability={availabilityDetail.availability}
          onClose={() => setAvailabilityDetail(null)}
        />
      )}
    </div>
  );
}

export function ManagerPage() {
  return <Resources initialView="Manager" standaloneManager />;
}

/* ─────────────  CELL DETAIL MODAL  ─────────────
 * Quick breakdown shown when a user clicks a cell in the utilisation grid.
 * Shows hours, utilisation %, project count for that week + Full Analysis CTA.
 */
/* Parse "Apr-15-26" → Date object for that Monday */
function parsePeriodToDate(period: string): Date | null {
  const MONTHS: Record<string, number> = {
    Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
    Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
  };
  const m = period.match(/^([A-Z][a-z]{2})-(\d{1,2})-(\d{2,4})$/);
  if (!m) return null;
  const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
  return new Date(yr, MONTHS[m[1]] ?? 0, parseInt(m[2]));
}

/* ── count-up helper ─────────────────────────────────── */
function useCountUp(target: number, duration = 700, start = false): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const t0 = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return val;
}

function WeekColumnModal({
  period, rows, periods, mode, onClose,
}: {
  period: string;
  rows: Record<string, unknown>[];
  periods: string[];
  mode: UtilMode;
  onClose: () => void;
}) {
  const { pos: dragPos, onDragStart } = useDraggable();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const weekLabel = fmtPeriodLabel(period, mode);

  const entries = useMemo(() => {
    return rows
      .map(r => {
        const name = String(r.ResourceUser ?? "");
        const cell = parseUtilCell(r[period]);
        const row = r;
        return { name, h: cell?.h ?? 0, p: cell?.p ?? 0, status: cell?.status ?? "", row };
      })
      .filter(e => e.h > 0)
      .sort((a, b) => b.h - a.h);
  }, [rows, period]);

  const maxH = entries.length > 0 ? entries[0].h : 1;

  const statusColor = (s: string) =>
    s === "Over" ? BRAND.orange : s === "Healthy" ? BRAND.green : BRAND.redDeep;

  const totalH = entries.reduce((s, e) => s + e.h, 0);
  const avgPct = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.p, 0) / entries.length) : 0;
  const idleCount = rows.length - entries.length;

  /* count-up values — start once mounted */
  const cuActive = useCountUp(entries.length, 600, mounted);
  const cuHours  = useCountUp(totalH,         750, mounted);
  const cuAvg    = useCountUp(avgPct,          700, mounted);
  const cuIdle   = useCountUp(idleCount,       550, mounted);

  const WK_KEYFRAMES = `
    @keyframes wkSlideRow { from { opacity:0; transform:translateX(-18px); } to { opacity:1; transform:translateX(0); } }
    @keyframes wkShimmer  { 0%{transform:translateX(-100%)} 100%{transform:translateX(500%)} }
    @keyframes wkGlow     { 0%,100%{opacity:0.7} 50%{opacity:1} }
    @keyframes wkDetailIn { from{opacity:0;transform:translateY(-8px) scaleY(0.92)} to{opacity:1;transform:translateY(0) scaleY(1)} }
    @keyframes wkBadgePop { 0%{transform:scale(0.6);opacity:0} 70%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
    @keyframes wkStatPop  { 0%{transform:translateY(8px);opacity:0} 100%{transform:translateY(0);opacity:1} }
  `;

  return (
    <>
      <style>{WK_KEYFRAMES}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex: Z.DRAWER,
        backgroundColor: mounted ? "rgba(0,0,0,0.60)" : "rgba(0,0,0,0)",
        backdropFilter: mounted ? "blur(7px)" : "blur(0px)",
        WebkitBackdropFilter: mounted ? "blur(7px)" : "blur(0px)",
        transition: "background-color 260ms ease, backdrop-filter 260ms ease",
        display: "flex", alignItems: "center", justifyContent: "center",
      }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{
          width: 750, maxHeight: "84vh",
          backgroundColor: BRAND.card,
          border: `1px solid ${BRAND.cardBorder}`,
          borderRadius: 22,
          boxShadow: mounted
            ? "0 40px 100px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px rgba(0,0,0,0.4)"
            : "none",
          display: "flex", flexDirection: "column",
          overflow: "hidden", cursor: "default",
          transition: "transform 450ms cubic-bezier(0.34,1.56,0.64,1), opacity 240ms ease, box-shadow 400ms ease",
          opacity: mounted ? 1 : 0,
          transform: `translate(${dragPos.x}px, ${dragPos.y}px) scale(${mounted ? 1 : 0.82}) translateY(${mounted ? 0 : 28}px)`,
        }}>

          {/* Header — drag handle */}
          <div onMouseDown={onDragStart} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 22px 14px", borderBottom: `1px solid ${BRAND.cardBorder}`,
            background: `linear-gradient(135deg, ${BRAND.bgDeep} 0%, ${BRAND.bg} 100%)`,
            cursor: "grab", userSelect: "none", flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* Animated badge */}
              <div style={{
                backgroundColor: BRAND.green + "22", border: `2px solid ${BRAND.green}`,
                borderRadius: 10, padding: "4px 14px", textAlign: "center",
                animation: mounted ? "wkBadgePop 420ms cubic-bezier(0.34,1.6,0.64,1) both" : "none",
              }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.green, lineHeight: 1 }}>{weekLabel}</div>
                <div style={{ fontSize: 9, color: BRAND.green, fontWeight: 700, opacity: 0.8, marginTop: 1 }}>
                  {mode === "Monthly" ? "month" : "week"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.white, letterSpacing: 0.2 }}>All Resources</div>
                <div style={{ fontSize: 10, color: BRAND.textMuted, marginTop: 2 }}>Click any bar for details · drag to move</div>
              </div>
            </div>
            <button onMouseDown={e => e.stopPropagation()} onClick={onClose} style={{
              background: "none", border: `1px solid ${BRAND.cardBorder}`, borderRadius: 8,
              color: BRAND.textMuted, fontSize: 18, cursor: "pointer",
              lineHeight: 1, padding: "4px 8px",
            }}>×</button>
          </div>

          {/* Summary strip — count-up numbers */}
          <div style={{
            display: "flex", borderBottom: `1px solid ${BRAND.cardBorder}`,
            backgroundColor: BRAND.bg, flexShrink: 0,
          }}>
            {[
              { val: cuActive, suffix: "",  label: "ACTIVE PEOPLE",    color: BRAND.white,         delay: "0ms"   },
              { val: cuHours,  suffix: "h", label: "TOTAL HOURS",      color: BRAND.white,         delay: "80ms"  },
              { val: cuAvg,    suffix: "%", label: "AVG UTILISATION",  color: avgPct > getBusinessRules().underAllocatedPct ? BRAND.green : BRAND.orange, delay: "160ms" },
              { val: cuIdle,   suffix: "",  label: "IDLE PEOPLE",      color: BRAND.textSecondary, delay: "240ms" },
            ].map(({ val, suffix, label, color, delay }, i, arr) => (
              <div key={label} style={{
                flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center",
                padding: "14px 0", gap: 4,
                borderRight: i < arr.length - 1 ? `1px solid ${BRAND.cardBorder}` : "none",
                animation: `wkStatPop 320ms ease both`,
                animationDelay: delay,
              }}>
                <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {val}{suffix}
                </div>
                <div style={{ fontSize: 9, color: BRAND.textSecondary, fontWeight: 700, letterSpacing: 0.8 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Gantt bars */}
          <div style={{ overflowY: "auto", flex: 1, padding: "6px 14px 10px" }}>
            {entries.length === 0 ? (
              <div style={{ textAlign: "center", color: BRAND.textMuted, padding: "40px 0", fontSize: 13 }}>
                No active allocations for this {mode === "Monthly" ? "month" : "week"}.
              </div>
            ) : (
              entries.map((e, i) => {
                const barW = Math.max(2, Math.round((e.h / maxH) * 100));
                const c = statusColor(e.status);
                const isSelected = selectedIdx === i;
                const barDelay = `${Math.min(i * 28, 400)}ms`;
                const rowDelay = `${Math.min(i * 22, 350)}ms`;
                return (
                  <div key={e.name + i} style={{
                    animation: `wkSlideRow 320ms ease both`,
                    animationDelay: rowDelay,
                  }}>
                    {/* Row button */}
                    <button
                      onClick={() => setSelectedIdx(isSelected ? null : i)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "5px 8px", border: "none", borderRadius: 8,
                        backgroundColor: isSelected ? BRAND.bgDeep : "transparent",
                        cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: "inherit",
                        transition: "background-color 150ms, transform 120ms",
                        borderBottom: !isSelected && i < entries.length - 1 ? `1px solid ${BRAND.cardBorder}28` : "none",
                      }}
                      onMouseEnter={e2 => {
                        const btn = e2.currentTarget as HTMLButtonElement;
                        if (!isSelected) btn.style.backgroundColor = BRAND.bgDeep + "99";
                        btn.style.transform = "translateX(2px)";
                      }}
                      onMouseLeave={e2 => {
                        const btn = e2.currentTarget as HTMLButtonElement;
                        if (!isSelected) btn.style.backgroundColor = "transparent";
                        btn.style.transform = "translateX(0)";
                      }}
                    >
                      {/* Rank */}
                      <div style={{ width: 22, fontSize: 10, color: BRAND.textMuted, fontWeight: 800, textAlign: "right", flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      {/* Name */}
                      <div style={{ width: 148, fontSize: 12, fontWeight: 700, color: isSelected ? BRAND.green : BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0, transition: "color 150ms" }} title={e.name}>
                        {e.name}
                      </div>
                      {/* Bar track */}
                      <div style={{ flex: 1, height: 22, backgroundColor: BRAND.bgDeep, borderRadius: 6, overflow: "hidden", position: "relative" }}>
                        {/* Fill bar */}
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0,
                          width: mounted ? `${barW}%` : "0%",
                          background: `linear-gradient(90deg, ${c}bb, ${c}, ${c}dd)`,
                          borderRadius: 6,
                          transition: `width 650ms cubic-bezier(0.34,1.15,0.64,1) ${barDelay}`,
                          boxShadow: isSelected ? `0 0 10px ${c}99, 0 0 3px ${c}66` : "none",
                          animation: isSelected ? `wkGlow 1.6s ease infinite` : "none",
                        }} />
                        {/* Shimmer glint — sweeps once after bar loads */}
                        <div style={{
                          position: "absolute", top: 0, bottom: 0, width: "30%",
                          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
                          animation: `wkShimmer 900ms ease ${barDelay} 1 both`,
                          pointerEvents: "none",
                        }} />
                      </div>
                      {/* Labels */}
                      <div style={{ width: 78, display: "flex", gap: 4, alignItems: "center", flexShrink: 0, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: c }}>{e.p}%</span>
                        <span style={{ fontSize: 11, color: BRAND.textSecondary }}>{e.h}h</span>
                      </div>
                      {/* Badge */}
                      <div style={{
                        flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                        padding: "3px 7px", borderRadius: 5,
                        backgroundColor: c + "25", color: c, border: `1px solid ${c}50`,
                        width: 52, textAlign: "center",
                      }}>
                        {e.status || "—"}
                      </div>
                    </button>

                    {/* Expanded detail panel */}
                    {isSelected && (() => {
                      const allPeriods = periods.map(p => {
                        const cell = parseUtilCell(e.row[p]);
                        return { p, h: cell?.h ?? 0, pct: cell?.p ?? 0, status: cell?.status ?? "" };
                      }).filter(x => x.h > 0);
                      const peakWeek = allPeriods.reduce((best, w) => w.pct > best.pct ? w : best, allPeriods[0] ?? { p: "—", h: 0, pct: 0, status: "" });
                      const avgAllPct = allPeriods.length > 0 ? Math.round(allPeriods.reduce((s, w) => s + w.pct, 0) / allPeriods.length) : 0;
                      return (
                        <div style={{
                          margin: "0 0 4px 32px",
                          backgroundColor: BRAND.bgDeep, borderRadius: 10,
                          border: `1px solid ${c}45`, padding: "10px 16px",
                          transformOrigin: "top center",
                          animation: "wkDetailIn 240ms cubic-bezier(0.34,1.4,0.64,1) both",
                        }}>
                          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                            {[
                              { v: `${e.h}h`, lbl: "THIS WEEK",    col: c },
                              { v: `${e.p}%`, lbl: "UTILISATION",  col: c },
                              { v: allPeriods.length, lbl: "ACTIVE WEEKS", col: BRAND.white },
                              { v: `${avgAllPct}%`, lbl: "AVG ALL WEEKS", col: BRAND.green },
                              ...(peakWeek.h > 0 ? [{ v: fmtPeriodLabel(peakWeek.p, mode), lbl: "PEAK WEEK", col: statusColor(peakWeek.status) }] : []),
                            ].map(({ v, lbl, col }, di) => (
                              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                {di > 0 && <div style={{ width: 1, height: 28, backgroundColor: BRAND.cardBorder }} />}
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                                  animation: `wkStatPop 280ms ease both`, animationDelay: `${di * 50}ms` }}>
                                  <div style={{ fontSize: 18, fontWeight: 900, color: col as string, lineHeight: 1 }}>{v}</div>
                                  <div style={{ fontSize: 8, color: BRAND.textSecondary, fontWeight: 700, letterSpacing: 0.6 }}>{lbl}</div>
                                </div>
                              </div>
                            ))}
                            <div style={{ marginLeft: "auto" }}>
                              <div style={{
                                padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 800,
                                backgroundColor: c + "22", color: c, border: `1px solid ${c}40`,
                              }}>{e.status}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>

          {/* Legend */}
          <div style={{
            display: "flex", gap: 16, padding: "8px 22px",
            borderTop: `1px solid ${BRAND.cardBorder}`,
            background: `linear-gradient(135deg, ${BRAND.bgDeep} 0%, ${BRAND.bg} 100%)`,
            alignItems: "center", flexShrink: 0,
          }}>
            {(() => { const wr = weekBandRanges(); return [{ c: BRAND.green, label: `Healthy (${wr.healthy})` }, { c: BRAND.redDeep, label: `Under (${wr.under})` }, { c: BRAND.orange, label: `Over (${wr.over})` }]; })().map(({ c, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: c }} />
                <span style={{ fontSize: 10, color: BRAND.textMuted }}>{label}</span>
              </div>
            ))}
            <div style={{ marginLeft: "auto", fontSize: 10, color: BRAND.textMuted }}>
              Bars sized by hours · sorted desc · click row for details
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Cell detail modal — approved Gantt design (mockup 2) ────────────────
   Per-project × per-week hours grid for one person: capacity bars per week
   (utilization-band colored), phase-colored hour cells via the nearest-match
   phase system, and a band-colored Total/week row. Preserves the existing
   contracts: draggable card, Full AI Analysis, per-project AI analysis. */
function CellDetailModal({
  name,
  period,
  pct,
  hours,
  projects,
  weeks,
  projList,
  projectAllocs,
  personId,
  role,
  canEditHours = false,
  onSaveProjectWeek,
   onSaveProjectWeeks,
  onClose,
  onFullAnalysis,
  onOpenProjectRecord,
}: {
  name: string;
  period: string;
  pct: number;
  hours: number;
  projects: number;
  weeks: CellWeek[];
  projList: { pid: string; name: string; color: string; module?: "PMM" | "OPM" | "LEM" }[];
  projectAllocs: { projectId: string; projectName: string; module?: "PMM" | "OPM" | "LEM"; pct: number; startDate: string; endDate: string }[];
  personId: string;
  role: string;
  canEditHours?: boolean;
  onSaveProjectWeek?: (edit: ResourceProjectWeekEdit) => Promise<void>;
  onSaveProjectWeeks?: (edit: ResourceProjectWeeksEdit) => Promise<void>;
  onClose: () => void;
  onFullAnalysis: () => void;
  onOpenProjectRecord: (projectId: string, module?: "PMM" | "OPM" | "LEM") => void;
}) {
  const { pos: dragPos, onDragStart } = useDraggable();
  const [phaseMap, setPhaseMap] = useState<ProjectPhaseMap | null>(null);
  const [editingCell, setEditingCell] = useState<{ key: string; projectId: string; weekStart: number; draft: string } | null>(null);
  const [editedHours, setEditedHours] = useState<Record<string, number>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  // Multiple project/week cells can be in flight at once. The shared
  // coalescer resolves each folded cell independently, so a single "current"
  // key would re-enable a sibling cell before its batch has settled.
  const [savingCellKeys, setSavingCellKeys] = useState<Set<string>>(() => new Set());
  const savingCellKeysRef = useRef<Set<string>>(new Set());
  const coalescedSaveProjectWeek = useMemo(
    () => (onSaveProjectWeeks ? createWeeklyCellSaveCoalescer(onSaveProjectWeeks) : onSaveProjectWeek),
    [onSaveProjectWeek, onSaveProjectWeeks, personId],
  );
  useEffect(() => {
    let alive = true;
    loadProjectPhaseMap().then(m => { if (alive) setPhaseMap(m); });
    return () => { alive = false; };
  }, []);

  const br = getBusinessRules();
  const wkHours = br.workWeekHours || 40;
  const bandOf = (p: number) =>
    p > br.overCapacityPct ? UTIL_COLORS.over
    : p >= br.targetUtilizationPct ? UTIL_COLORS.good
    : UTIL_COLORS.under;

  const _si = statusInfo(pct);
  const label = pct === 0 ? "Idle" : _si.label;

  /* Selected week = the grid cell that was clicked; match by Monday ms */
  const selStart = mondayOf(parsePeriodKey(period));
  const selIdxAll = weeks.findIndex((w) => w.start === selStart);
  const nowIdxAll = weeks.findIndex((w) => w.start === mondayOf(Date.now()));
  // Workload cells are already weekly allocation values. Open the richer
  // multi-week schedule immediately so Timeline and Manager share the same
  // one-click path; the selected-week day split remains available via Back.
  const [showSchedule, setShowSchedule] = useState(true);

  /* 6-week pages; open on the page containing the clicked week */
  const VIS = 6;
  const pageCount = Math.max(1, Math.ceil(weeks.length / VIS));
  const [page, setPage] = useState(() => {
    const t = selIdxAll >= 0 ? selIdxAll : nowIdxAll >= 0 ? nowIdxAll : 0;
    return Math.min(Math.floor(t / VIS), Math.max(0, pageCount - 1));
  });
  const visWeeks = weeks.slice(page * VIS, page * VIS + VIS);

  const wkLabel = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleDateString("en-US", { month: "short" })}`;
  };
  const rangeLabel = visWeeks.length > 0
    ? (() => {
        const a = new Date(visWeeks[0].start);
        const b = new Date(visWeeks[visWeeks.length - 1].start);
        const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `${f(a)} – ${f(b)}, ${b.getFullYear()}`;
      })()
    : period;
  // Keep the selected-week cue visible over phase-colored project cells.
  // An inset ring highlights the clicked week without replacing the phase
  // background that communicates each project's current stage.
  const selectedWeekCellShadow = `inset 0 0 0 2px ${GANTT_HIGHLIGHT.headerText}`;

  /* Per-project rows from the weekly segs; quarter total keeps ordering
     stable while paging through week windows */
  const allocByPid = useMemo(() => {
    const m = new Map<string, { projectId: string; projectName: string; module?: "PMM" | "OPM" | "LEM"; pct: number; startDate: string; endDate: string }>();
    for (const a of projectAllocs) m.set(a.projectId, a);
    return m;
  }, [projectAllocs]);
  const projRows = useMemo(() => projList.map(p => {
    const hrsAll = weeks.map(w => w.segs.find(s => s.pid === p.pid)?.hrs ?? 0);
    const totalAll = Math.round(hrsAll.reduce((a, b) => a + b, 0) * 10) / 10;
    return { pid: p.pid, name: p.name, module: p.module, hrsAll, totalAll, alloc: allocByPid.get(p.pid) };
  }).sort((a, b) => b.totalAll - a.totalAll), [projList, weeks, allocByPid]);

  const fmtH = (h: number) => fmtHours(h);
  const selectedWeekStart = Number.isFinite(selStart) ? selStart : mondayOf(Date.now());
  const selectedWeekIndex = selIdxAll >= 0 ? selIdxAll : weeks.findIndex(w => w.start === selectedWeekStart);
  const selectedDays = selectedWeekDays(selectedWeekStart, br.nonWorkingDays, br.holidayDates);
  const selectedWeekHasWorkingDays = selectedDays.some(day => day.isWorkingDay);
  const selectedRangeLabel = (() => {
    const first = new Date(selectedDays[0].start);
    const last = new Date(selectedDays[6].start);
    const firstLabel = first.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const lastLabel = last.toLocaleDateString("en-US", {
      month: first.getMonth() === last.getMonth() ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });
    return `${firstLabel} – ${lastLabel}`;
  })();
  const phaseAtMs = isNaN(selStart) ? Date.now() : selStart;
  const cellBorder = `1px solid ${BRAND.cardBorder}`;
  const cellKey = (projectId: string, weekStart: number) => `${projectId}|${weekStart}`;
  const hourAt = (projectId: string, weekIndex: number): number => {
    const weekStart = weeks[weekIndex]?.start;
    const original = projRows.find(row => row.pid === projectId)?.hrsAll[weekIndex] ?? 0;
    return Number.isFinite(weekStart)
      ? editedHours[cellKey(projectId, weekStart)] ?? original
      : original;
  };
  const weekHoursAt = (weekIndex: number): number => {
    const original = weeks[weekIndex]?.hrs ?? 0;
    const total = original + projRows.reduce((delta, row) => {
      const base = row.hrsAll[weekIndex] ?? 0;
      return delta + hourAt(row.pid, weekIndex) - base;
    }, 0);
    return Math.round((total + Number.EPSILON) * 100) / 100;
  };
  const selectedProjRows = selectedWeekIndex >= 0
    ? projRows
        .map(row => ({ ...row, selectedHours: hourAt(row.pid, selectedWeekIndex) }))
        .filter(row => row.selectedHours > 0)
    : [];
  const selectedWeekTotal = selectedWeekIndex >= 0
    ? weekHoursAt(selectedWeekIndex)
    : Math.round((hours + Number.EPSILON) * 100) / 100;
  const selectedDailyTotals = selectedDays.map((_day, dayIndex) =>
    Math.round(selectedProjRows.reduce((sum, row) =>
      sum + splitWeeklyHoursAcrossDays(row.selectedHours, selectedDays)[dayIndex], 0) * 10) / 10
  );
  const pastWeekLocked = (projectId: string, weekStart: number): boolean =>
    getPastWeekEditStateFor(localIsoDay(weekStart), projectId.split("-")[0]).locked;
  const editableCell = (projectId: string, weekStart: number) =>
    canEditHours && Boolean(coalescedSaveProjectWeek) && Boolean(personId) && !pastWeekLocked(projectId, weekStart);
  const localIsoDay = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const commitCellEdit = async () => {
    if (!editingCell || !coalescedSaveProjectWeek || savingCellKeysRef.current.has(editingCell.key)) return;
    const edit = editingCell;
    const nextHours = parseWeeklyHoursDraft(edit.draft);
    if (nextHours === null || nextHours < 0 || nextHours > MAX_WEEK_HOURS) {
      setEditError(`Use 0–${MAX_WEEK_HOURS} hours`);
      setEditErrors(current => ({ ...current, [edit.key]: `Use 0–${MAX_WEEK_HOURS} hours` }));
      return;
    }
    const key = edit.key;
    const previous = editedHours[key];
    const weekIndex = weeks.findIndex(week => week.start === edit.weekStart);
    const original = projRows.find(row => row.pid === edit.projectId)?.hrsAll[weekIndex] ?? 0;
    if (nextHours === (previous ?? original)) {
      setEditingCell(null);
      setEditError(null);
      setEditErrors(current => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    savingCellKeysRef.current.add(key);
    setSavingCellKeys(current => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setEditError(null);
    setEditErrors(current => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    // Paint the entered number immediately. The verified write continues in
    // the background and restores the previous value if it fails.
    setEditedHours(prevHours => ({ ...prevHours, [key]: nextHours }));
    setEditingCell(null);
    try {
      const project = projRows.find(row => row.pid === edit.projectId);
      await coalescedSaveProjectWeek({
        personId,
        personName: name,
        role,
        projectId: edit.projectId,
        projectName: project?.name ?? edit.projectId,
        week: localIsoDay(edit.weekStart),
        hours: nextHours,
        onAccepted: () => {
          setEditedHours(prevHours => {
            if (prevHours[key] !== nextHours) return prevHours;
            const next = { ...prevHours };
            delete next[key];
            return next;
          });
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setEditedHours(prevHours => {
        const next = { ...prevHours };
        if (previous === undefined) delete next[key];
        else next[key] = previous;
        return next;
      });
      // Keep failures attached to their exact project/week. A coalesced batch
      // can reject several promises, and one shared error/editor would hide
      // all but the last failure.
      setEditErrors(current => ({ ...current, [key]: message }));
      setEditingCell(current => current ?? edit);
      setEditError(message);
    } finally {
      savingCellKeysRef.current.delete(key);
      setSavingCellKeys(current => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: Z.MODAL_MENU, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
    >
      <div
        data-testid="resource-cell-detail"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: BRAND.card, borderRadius: 12,
          border: `1px solid ${BRAND.cardBorder}`,
          width: "100%", maxWidth: 880,
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden",
          transform: `translate(${dragPos.x}px, ${dragPos.y}px)`,
        }}
      >
        {/* ── HEADER: avatar + name | selected-week label / schedule pager + close ── */}
        <div onMouseDown={onDragStart} style={{ backgroundColor: BRAND.bg, padding: "14px 20px", borderBottom: cellBorder, display: "flex", alignItems: "center", gap: 12, cursor: "grab", userSelect: "none", flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: _si.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
            {initialsOf(name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: BRAND.white, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
            <div style={{ color: BRAND.textSecondary, fontSize: 12 }}>
              {Number(pct.toFixed(2))}% · {fmtHours(hours)}h booked · {projects} project{projects === 1 ? "" : "s"} · <span style={{ color: _si.color, fontWeight: 700 }}>{label}</span>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} onMouseDown={e => e.stopPropagation()}>
            {showSchedule ? (
              <div style={{ backgroundColor: BRAND.card, border: cellBorder, borderRadius: 8, padding: "5px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{ background: "none", border: "none", padding: 0, cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.3 : 1, display: "flex" }}
                ><ChevronLeft size={14} color={BRAND.textSecondary} /></button>
                <span style={{ color: BRAND.textSecondary, fontSize: 12, minWidth: 130, textAlign: "center" }}>{rangeLabel}</span>
                <button
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  style={{ background: "none", border: "none", padding: 0, cursor: page >= pageCount - 1 ? "default" : "pointer", opacity: page >= pageCount - 1 ? 0.3 : 1, display: "flex" }}
                ><ChevronRight size={14} color={BRAND.textSecondary} /></button>
              </div>
            ) : (
              <div style={{
                backgroundColor: GANTT_HIGHLIGHT.header, border: `1px solid ${GANTT_HIGHLIGHT.headerText}55`,
                borderRadius: 8, padding: "5px 10px", textAlign: "center",
              }}>
                <div style={{ color: GANTT_HIGHLIGHT.headerText, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.7 }}>Selected week</div>
                <div style={{ color: BRAND.white, fontSize: 12, fontWeight: 700, marginTop: 1 }}>{selectedRangeLabel}</div>
              </div>
            )}
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 6, border: cellBorder, background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: BRAND.textSecondary, fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        </div>

        {showSchedule ? (
          <>
        {/* ── CAPACITY BARS: booked vs work-week hours per visible week ── */}
        <div style={{ backgroundColor: BRAND.bg, padding: "10px 20px", borderBottom: cellBorder, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <span style={{ color: BRAND.textSecondary, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, paddingBottom: 2 }}>Capacity</span>
            {visWeeks.map((w, i) => {
              const t = weekHoursAt(page * VIS + i);
              const band = bandOf((t / Math.max(wkHours, 1)) * 100);
              const fillPct = Math.min((t / Math.max(wkHours, 1)) * 100, 100);
              const isSel = page * VIS + i === selIdxAll;
              return (
                  <div key={w.start} style={{ flex: 1, textAlign: "center" }}>
                   <div style={{ fontSize: 10, color: isSel ? GANTT_HIGHLIGHT.headerText : BRAND.textMuted, fontWeight: isSel ? 800 : 400, marginBottom: 4, backgroundColor: isSel ? GANTT_HIGHLIGHT.header : "transparent", borderRadius: 4 }}>{wkLabel(w.start)}</div>
                  <div style={{ height: 8, background: BRAND.cardBorder, borderRadius: 4, overflow: "hidden" }}>
                    {t > 0 && <div style={{ width: `${fillPct}%`, height: "100%", background: band.bg, borderRadius: 4 }} />}
                  </div>
                  <div style={{ fontSize: 10, color: t > 0 ? band.bg : BRAND.textMuted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{fmtH(t)}h / {wkHours}h</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PER-PROJECT × WEEK GRID (phase-colored) ── */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 250 }} />
              {visWeeks.map((w) => <col key={w.start} style={{ width: 88 }} />)}
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: BRAND.bg }}>
                <th style={{ border: cellBorder, padding: "6px 12px", color: BRAND.textSecondary, fontSize: 11, textAlign: "left" }}>Project</th>
                {visWeeks.map((w, i) => {
                  const isSel = page * VIS + i === selIdxAll;
                  return (
                    <th key={w.start} style={{
                      border: cellBorder, fontSize: 10, fontWeight: isSel ? 800 : 600, textAlign: "center", padding: "6px 0",
                      color: isSel ? GANTT_HIGHLIGHT.headerText : BRAND.textSecondary,
                      backgroundColor: isSel ? GANTT_HIGHLIGHT.header : undefined,
                      boxShadow: isSel ? selectedWeekCellShadow : undefined,
                    }} title={isSel ? "Selected week" : undefined}>{wkLabel(w.start)}</th>
                  );
                })}
                <th style={{ border: cellBorder, color: BRAND.textSecondary, fontSize: 10, textAlign: "center", padding: "6px 0" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {projRows.length === 0 && (
                <tr>
                  <td colSpan={visWeeks.length + 2} style={{ border: cellBorder, padding: "16px 12px", color: BRAND.textSecondary, fontSize: 12, textAlign: "center" }}>
                    No project allocations on record for this period.
                  </td>
                </tr>
              )}
              {projRows.map(proj => {
                const visHrs = visWeeks.map((_, i) => hourAt(proj.pid, page * VIS + i));
                const rowTotal = Math.round(visHrs.reduce((a, b) => a + b, 0) * 10) / 10;
                const projectModule = proj.alloc?.module || proj.module;
                const ph = phaseMap ? projectPhaseColor(phaseMap, proj.pid, phaseAtMs) : null;
                const lead = isLeadProject(projectModule, proj.pid);
                const phaseLabel = ph
                  ? projectPhaseDisplayName(projectModule, proj.pid, ph.phaseName)
                  : lead ? "Lead" : "";
                const dot = lead
                  ? PHASE_COLORS["Lead"]
                  : ph?.color ?? { bg: BRAND.textMuted, text: "#fff" as string, outline: undefined as string | undefined };
                return (
                  <tr key={proj.pid}>
                    <td
                      onClick={() => { onClose(); onOpenProjectRecord(proj.pid, projectModule); }}
                      title={`Open ${proj.name} record`}
                      style={{ border: cellBorder, padding: "6px 12px", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: dot.bg, border: dot.outline ? `1px solid ${dot.outline}` : "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ color: BRAND.textMuted, fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {proj.pid || "—"}
                          </div>
                          <div style={{ color: BRAND.white, fontSize: 12, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.name}</div>
                        </div>
                        {phaseLabel && (
                          <span style={{
                            background: dot.bg,
                            border: dot.outline ? `1px solid ${dot.outline}` : "none",
                            color: dot.text, fontSize: 9, padding: "1px 7px", borderRadius: 8,
                            fontWeight: 700, flexShrink: 0, maxWidth: 90,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }} title={lead ? "Lead record" : ph?.phaseName}>{phaseLabel}</span>
                        )}
                        <button
                          type="button"
                          title={`Open ${proj.name} record`}
                          aria-label={`Open ${proj.name} record`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onClose();
                            onOpenProjectRecord(proj.pid, projectModule);
                          }}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                            padding: "4px 5px", borderRadius: 5, border: `1px solid ${BRAND.cardBorder}`,
                            background: BRAND.bg, color: "#60A5FA", fontSize: 9, fontWeight: 800, cursor: "pointer",
                          }}
                        >
                          Open <ExternalLink size={10} />
                        </button>
                      </div>
                    </td>
                    {visWeeks.map((w, i) => {
                      const h = visHrs[i];
                      const isSel = page * VIS + i === selIdxAll;
                      const key = cellKey(proj.pid, w.start);
                      const editing = editingCell?.key === key;
                      const saving = savingCellKeys.has(key);
                      const cellError = editErrors[key] ?? (editing ? editError : null);
                      const editable = editableCell(proj.pid, w.start);
                      const pc = phaseMap ? projectPhaseColor(phaseMap, proj.pid, w.start).color : null;
                      const background = pc?.bg ?? BRAND.green + "33";
                      const textColor = pc?.text ?? BRAND.white;
                      return (
                        <td key={w.start} style={{ border: cellBorder, padding: 0, boxShadow: isSel ? selectedWeekCellShadow : undefined }}>
                          {editing ? (
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              step={0.01}
                              value={editingCell.draft}
                              aria-label={`${proj.name}, week of ${localIsoDay(w.start)}, hours`}
                              onClick={event => event.stopPropagation()}
                              onChange={event => {
                                setEditingCell(current => current ? { ...current, draft: event.target.value } : current);
                                setEditError(null);
                                 setEditErrors(current => {
                                   if (!current[key]) return current;
                                   const next = { ...current };
                                   delete next[key];
                                   return next;
                                 });
                              }}
                              onBlur={() => { void commitCellEdit(); }}
                              onKeyDown={event => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitCellEdit();
                                } else if (event.key === "Escape") {
                                  setEditingCell(null);
                                  setEditError(null);
                                }
                              }}
                              style={{
                                width: "calc(100% - 4px)", height: 26, margin: 2, boxSizing: "border-box",
                                 padding: "0 2px", border: cellError ? "2px solid #F87171" : "2px solid #fff",
                                borderRadius: 3, outline: "none", background: "#fff", color: "#253746",
                                fontSize: 12, fontWeight: 900, textAlign: "center",
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              disabled={!editable || saving}
                              title={editable
                                ? `Week of ${localIsoDay(w.start)}: ${fmtH(h)} hours. Click to edit.`
                                : pastWeekLocked(proj.pid, w.start) ? "Past-week editing is disabled by your business rules" : "Read-only"}
                              onClick={event => {
                                event.stopPropagation();
                                if (!editable) return;
                                setEditingCell({ key, projectId: proj.pid, weekStart: w.start, draft: fmtH(h) });
                                setEditError(null);
                              }}
                              style={{
                                width: "100%", height: 30, padding: 0,
                                background: h > 0 ? background : "transparent",
                                border: h > 0 && pc?.outline ? `1px solid ${pc.outline}` : "none",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                                color: h > 0 ? textColor : BRAND.textMuted,
                                fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                                cursor: editable ? "text" : "default",
                              }}
                            >
                              {fmtH(h)}h
                              {saving
                                ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} aria-label="Saving" />
                                : editable && <Pencil size={8} aria-hidden="true" />}
                            </button>
                          )}
                          {cellError && (
                            <span role="alert" style={{
                              position: "relative", zIndex: 5, display: "block", marginTop: -1,
                              padding: "2px 4px", background: "#FEF2F2", color: "#B91C1C",
                              border: "1px solid #F87171", borderRadius: 3, fontSize: 8, fontWeight: 800,
                              whiteSpace: "nowrap",
                            }}>{cellError}</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ border: cellBorder, padding: 0 }}>
                      <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: BRAND.textSecondary, fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtH(rowTotal)}h</div>
                    </td>
                  </tr>
                );
              })}
              {/* TOTAL / WEEK — utilization-band colored */}
              {projRows.length > 0 && (
                <tr style={{ backgroundColor: BRAND.bg }}>
                  <td style={{ border: cellBorder, padding: "6px 12px", color: BRAND.textSecondary, fontSize: 11, fontWeight: 700 }}>Total / week</td>
                  {visWeeks.map((w, i) => {
                    const totalHours = weekHoursAt(page * VIS + i);
                    const band = bandOf((totalHours / Math.max(wkHours, 1)) * 100);
                     const isSel = page * VIS + i === selIdxAll;
                     if (totalHours <= 0) return (
                       <td key={w.start} style={{ border: cellBorder, padding: 0, boxShadow: isSel ? selectedWeekCellShadow : undefined }}>
                        <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: BRAND.textMuted, fontSize: 11 }}>0</div>
                      </td>
                    );
                    return (
                       <td key={w.start} style={{ border: cellBorder, padding: 0, boxShadow: isSel ? selectedWeekCellShadow : undefined }}>
                        <div style={{ height: 30, background: band.bg, display: "flex", alignItems: "center", justifyContent: "center", color: band.text, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtH(totalHours)}h</div>
                      </td>
                    );
                  })}
                  <td style={{ border: cellBorder, padding: 0 }}>
                    <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: BRAND.white, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtH(visWeeks.reduce((sum, _week, i) => sum + weekHoursAt(page * VIS + i), 0))}h
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </>
        ) : (
          <>
            {/* ── SELECTED MONDAY–SUNDAY WEEK ── */}
            <div style={{
              backgroundColor: BRAND.bg, padding: "12px 20px", borderBottom: cellBorder,
              display: "flex", alignItems: "center", gap: 18, flexShrink: 0,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 800 }}>
                  Week of {selectedRangeLabel}
                </div>
                <div style={{ color: BRAND.textSecondary, fontSize: 10.5, marginTop: 3, lineHeight: 1.4 }}>
                  {selectedWeekHasWorkingDays
                    ? "Weekly allocation only · day columns are a read-only display split. Use Edit week in the purple total cell to change the saved weekly hours."
                    : "Weekly allocation only · this week has no working days, so the day columns remain 0h. Use Edit week to change the saved weekly hours."}
                </div>
              </div>
              <div style={{ minWidth: 190 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: BRAND.textSecondary, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.7 }}>
                    Weekly total
                  </span>
                  <span style={{ color: bandOf((selectedWeekTotal / Math.max(wkHours, 1)) * 100).bg, fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
                    {fmtH(selectedWeekTotal)}h
                  </span>
                </div>
                <div style={{ height: 8, marginTop: 5, background: BRAND.cardBorder, borderRadius: 5, overflow: "hidden" }}>
                  {selectedWeekTotal > 0 && (
                    <div style={{
                      width: `${Math.min((selectedWeekTotal / Math.max(wkHours, 1)) * 100, 100)}%`,
                      height: "100%", borderRadius: 5,
                      background: bandOf((selectedWeekTotal / Math.max(wkHours, 1)) * 100).bg,
                    }} />
                  )}
                </div>
                <div style={{ color: BRAND.textMuted, fontSize: 9.5, textAlign: "right", marginTop: 3 }}>
                  {fmtH(selectedWeekTotal)}h booked / {wkHours}h capacity
                </div>
              </div>
            </div>
            {!selectedWeekHasWorkingDays && selectedWeekTotal > 0 && (
              <div role="status" style={{
                padding: "8px 20px", borderBottom: `1px solid ${BRAND.orange}55`,
                backgroundColor: `${BRAND.orange}18`, color: BRAND.orange,
                fontSize: 10.5, fontWeight: 700, flexShrink: 0,
              }}>
                {fmtH(selectedWeekTotal)}h are booked for this week but are not assigned to individual days because every day is non-working or a company holiday.
              </div>
            )}

            {/* ── PROJECT × DAY BREAKDOWN FOR THE CLICKED WEEK ── */}
            <div style={{ flex: 1, overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 230 }} />
                  {selectedDays.map(day => <col key={day.isoDay} style={{ width: 70 }} />)}
                  <col style={{ width: 104 }} />
                </colgroup>
                <thead>
                  <tr style={{ backgroundColor: BRAND.bg }}>
                    <th style={{ border: cellBorder, padding: "7px 12px", color: BRAND.textSecondary, fontSize: 11, textAlign: "left" }}>Project</th>
                    {selectedDays.map(day => (
                      <th key={day.isoDay} style={{
                        border: cellBorder, padding: "5px 2px", textAlign: "center",
                        backgroundColor: day.isWorkingDay ? undefined : BRAND.card,
                      }} title={day.holidayLabel ? `${day.shortLabel}: ${day.holidayLabel}` : day.isWorkingDay ? day.shortLabel : `${day.shortLabel}: non-working day`}>
                        <div style={{ color: day.isWorkingDay ? BRAND.textSecondary : BRAND.textMuted, fontSize: 10, fontWeight: 800 }}>{day.weekday}</div>
                        <div style={{ color: day.isWorkingDay ? BRAND.white : BRAND.textMuted, fontSize: 9.5, marginTop: 2 }}>{day.shortLabel}</div>
                        {day.holidayLabel && (
                          <div style={{ color: BRAND.orange, fontSize: 7.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Holiday</div>
                        )}
                      </th>
                    ))}
                    <th style={{
                      border: cellBorder, padding: "5px 2px", textAlign: "center",
                      color: GANTT_HIGHLIGHT.headerText, backgroundColor: GANTT_HIGHLIGHT.header, fontSize: 10, fontWeight: 800,
                    }}>Weekly total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProjRows.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ border: cellBorder, padding: "20px 12px", color: BRAND.textSecondary, fontSize: 12, textAlign: "center" }}>
                        No project allocations are recorded for this selected week.
                      </td>
                    </tr>
                  )}
                  {selectedProjRows.map(proj => {
                    const dailyHours = splitWeeklyHoursAcrossDays(proj.selectedHours, selectedDays);
                    const projectModule = proj.alloc?.module || proj.module;
                    const ph = phaseMap ? projectPhaseColor(phaseMap, proj.pid, selectedWeekStart) : null;
                    const lead = isLeadProject(projectModule, proj.pid);
                    const phaseLabel = ph
                      ? projectPhaseDisplayName(projectModule, proj.pid, ph.phaseName)
                      : lead ? "Lead" : "";
                    const dot = lead
                      ? PHASE_COLORS["Lead"]
                      : ph?.color ?? { bg: BRAND.textMuted, text: "#fff" as string, outline: undefined as string | undefined };
                    const key = cellKey(proj.pid, selectedWeekStart);
                    const editing = editingCell?.key === key;
                     const saving = savingCellKeys.has(key);
                     const cellError = editErrors[key] ?? (editing ? editError : null);
                    const editable = editableCell(proj.pid, selectedWeekStart);
                    return (
                      <tr key={proj.pid}>
                        <td
                          onClick={() => { onClose(); onOpenProjectRecord(proj.pid, projectModule); }}
                          title={`Open ${proj.name} record`}
                          style={{ border: cellBorder, padding: "7px 12px", cursor: "pointer" }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: dot.bg, border: dot.outline ? `1px solid ${dot.outline}` : "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ color: BRAND.textMuted, fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.pid || "—"}</div>
                              <div style={{ color: BRAND.white, fontSize: 12, fontWeight: 600, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.name}</div>
                              {phaseLabel && (
                                <span style={{ display: "inline-block", marginTop: 3, background: dot.bg, border: dot.outline ? `1px solid ${dot.outline}` : "none", color: dot.text, fontSize: 8.5, padding: "1px 6px", borderRadius: 8, fontWeight: 700 }}>{phaseLabel}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              title={`Open ${proj.name} record`}
                              aria-label={`Open ${proj.name} record`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onClose();
                                onOpenProjectRecord(proj.pid, projectModule);
                              }}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                                padding: "4px 5px", borderRadius: 5, border: `1px solid ${BRAND.cardBorder}`,
                                background: BRAND.bg, color: "#60A5FA", fontSize: 9, fontWeight: 800, cursor: "pointer",
                              }}
                            >
                              Open <ExternalLink size={10} />
                            </button>
                          </div>
                        </td>
                        {selectedDays.map((day, dayIndex) => (
                          <td key={day.isoDay} style={{
                            border: cellBorder, padding: 0, backgroundColor: day.isWorkingDay ? undefined : BRAND.card,
                          }}>
                            <div style={{
                              height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                              color: dailyHours[dayIndex] > 0 ? BRAND.white : BRAND.textMuted,
                              fontSize: 11, fontWeight: dailyHours[dayIndex] > 0 ? 700 : 500, fontVariantNumeric: "tabular-nums",
                            }}>
                              {fmtH(dailyHours[dayIndex])}h
                            </div>
                          </td>
                        ))}
                        <td style={{ border: cellBorder, padding: 0, backgroundColor: GANTT_HIGHLIGHT.header }}>
                          {editing ? (
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              step={0.01}
                              value={editingCell.draft}
                              aria-label={`Edit ${proj.name}, week of ${localIsoDay(selectedWeekStart)}, weekly hours`}
                              onClick={event => event.stopPropagation()}
                              onChange={event => {
                                setEditingCell(current => current ? { ...current, draft: event.target.value } : current);
                                setEditError(null);
                                 setEditErrors(current => {
                                   if (!current[key]) return current;
                                   const next = { ...current };
                                   delete next[key];
                                   return next;
                                 });
                              }}
                              onBlur={() => { void commitCellEdit(); }}
                              onKeyDown={event => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitCellEdit();
                                } else if (event.key === "Escape") {
                                  setEditingCell(null);
                                  setEditError(null);
                                }
                              }}
                              style={{
                                width: "calc(100% - 4px)", height: 30, margin: 2, boxSizing: "border-box",
                                 padding: "0 2px", border: cellError ? "2px solid #F87171" : "2px solid #fff",
                                borderRadius: 3, outline: "none", background: "#fff", color: "#253746",
                                fontSize: 12, fontWeight: 900, textAlign: "center",
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                               disabled={!editable || saving}
                              aria-label={editable
                                ? `Edit ${proj.name}, week of ${localIsoDay(selectedWeekStart)}, currently ${fmtH(proj.selectedHours)} hours`
                                : undefined}
                              title={editable
                                ? `Edit week of ${localIsoDay(selectedWeekStart)}: ${fmtH(proj.selectedHours)} hours`
                                : pastWeekLocked(proj.pid, selectedWeekStart) ? "Past-week editing is disabled by your business rules" : "Read-only"}
                              onClick={event => {
                                event.stopPropagation();
                                if (!editable) return;
                                setEditingCell({ key, projectId: proj.pid, weekStart: selectedWeekStart, draft: fmtH(proj.selectedHours) });
                                setEditError(null);
                              }}
                              style={{
                                width: "100%", height: 34, padding: 0, border: "none",
                                background: "transparent", color: GANTT_HIGHLIGHT.headerText,
                                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                                fontSize: 12, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                                cursor: editable ? "pointer" : "default",
                              }}
                            >
                               <span>{fmtH(proj.selectedHours)}h</span>
                               {saving ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} aria-label="Saving" /> : editable && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.35 }}>
                                  <Pencil size={8} aria-hidden="true" /> Edit week
                                </span>
                               )}
                            </button>
                          )}
                           {cellError && (
                            <span role="alert" style={{
                              position: "relative", zIndex: 5, display: "block", marginTop: -1,
                              padding: "2px 4px", background: "#FEF2F2", color: "#B91C1C",
                              border: "1px solid #F87171", borderRadius: 3, fontSize: 8, fontWeight: 800,
                              whiteSpace: "nowrap",
                            }}>{cellError}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {selectedProjRows.length > 0 && (
                    <tr style={{ backgroundColor: BRAND.bg }}>
                      <td style={{ border: cellBorder, padding: "7px 12px", color: BRAND.textSecondary, fontSize: 11, fontWeight: 800 }}>
                        Daily total
                      </td>
                      {selectedDays.map((day, index) => (
                        <td key={day.isoDay} style={{ border: cellBorder, padding: 0, backgroundColor: day.isWorkingDay ? BRAND.bg : BRAND.card }}>
                          <div style={{
                            height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                            color: selectedDailyTotals[index] > 0 ? BRAND.white : BRAND.textMuted,
                            fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                          }}>{fmtH(selectedDailyTotals[index])}h</div>
                        </td>
                      ))}
                      <td style={{ border: cellBorder, padding: 0, backgroundColor: bandOf((selectedWeekTotal / Math.max(wkHours, 1)) * 100).bg }}>
                        <div style={{
                          height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                          color: bandOf((selectedWeekTotal / Math.max(wkHours, 1)) * 100).text,
                          fontSize: 12, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                        }}>{fmtH(selectedWeekTotal)}h</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── FOOTER ── */}
        <div style={{ backgroundColor: BRAND.bg, borderTop: cellBorder, padding: "10px 20px", display: "flex", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setShowSchedule(value => !value)}
            style={{ background: "transparent", border: cellBorder, color: "#60A5FA", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            {showSchedule ? <ChevronLeft size={13} /> : <Calendar size={13} />}
            {showSchedule ? "Back to selected week" : "View full allocation schedule"}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{ background: "transparent", border: cellBorder, color: BRAND.textSecondary, borderRadius: 8, padding: "6px 18px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
            >Close</button>
            <button
              onClick={onFullAnalysis}
              style={{ background: "#44A2B1", border: "none", color: "#fff", borderRadius: 8, padding: "6px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >Full AI Analysis</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Weekly Hours modal ─────────────────────────────────────────────────
   Pure data view (no AI): hours allocated per week for one person, stacked
   by project, plus per-project totals and share of total hours. Opened from
   the staff grid Allocation / Active Projects cells and Timeline person
   clicks. */
function WeeklyHoursModal({
  name, role, focus, pct, activeCount, weeks, projList, onClose,
}: {
  name: string;
  role: string;
  focus: "allocation" | "active";
  pct: number;
  activeCount: number;
  weeks: CellWeek[];
  projList: { pid: string; name: string; color: string }[];
  onClose: () => void;
}) {
  const { pos: dragPos, onDragStart } = useDraggable();
  const [barTip, setBarTip] = useState<{ w: CellWeek; shortLabel: string; x: number; y: number } | null>(null);

  const wkHours = getBusinessRules().workWeekHours || 40;
  const activeWeeks = weeks.filter((w) => w.hrs > 0);
  const totalHrs = Math.round((activeWeeks.reduce((s, w) => s + w.hrs, 0) + Number.EPSILON) * 100) / 100;
  const avgHrs = activeWeeks.length > 0 ? Math.round(((totalHrs / activeWeeks.length) + Number.EPSILON) * 100) / 100 : 0;
  const avgPct = activeWeeks.length > 0
    ? Math.round(activeWeeks.reduce((s, w) => s + w.pct, 0) / activeWeeks.length)
    : 0;
  const peak = activeWeeks.reduce<CellWeek | null>((m, w) => (!m || w.hrs > m.hrs ? w : m), null);

  const headerPct = pct > 0 ? pct : avgPct;
  const _si = statusInfo(headerPct);
  const color = headerPct === 0 ? BRAND.textMuted : _si.color;
  const label = headerPct === 0 ? "Idle" : _si.label;

  const BAR_MAX_H = 72; /* px — max bar height */
  const COL_W = 46;     /* px — fixed week column width inside the scroller */
  const maxWeekHrs = weeks.reduce((m, w) => Math.max(m, w.hrs), 0);
  const scaleHrs = Math.max(maxWeekHrs, wkHours, 1);

  const colorByPid = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projList) m.set(p.pid, p.color);
    return m;
  }, [projList]);
  const nameByPid = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projList) m.set(p.pid, p.name);
    return m;
  }, [projList]);

  /* Per-project rollup: total hours, weeks on the project, avg hours/week,
     share of the person's total booked hours. */
  const projStats = useMemo(() => {
    const agg = new Map<string, { hrs: number; wks: number }>();
    for (const w of weeks) for (const s of w.segs) {
      if (s.hrs <= 0) continue;
      const e = agg.get(s.pid) ?? { hrs: 0, wks: 0 };
      e.hrs += s.hrs; e.wks += 1;
      agg.set(s.pid, e);
    }
    return projList
      .map((p) => {
        const e = agg.get(p.pid) ?? { hrs: 0, wks: 0 };
        const tot = Math.round((e.hrs + Number.EPSILON) * 100) / 100;
        return {
          ...p,
          totalHrs: tot,
          wks: e.wks,
          avgHrsWk: e.wks > 0 ? Math.round(((e.hrs / e.wks) + Number.EPSILON) * 100) / 100 : 0,
          share: totalHrs > 0 ? Math.round((tot / totalHrs) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.totalHrs - a.totalHrs);
  }, [weeks, projList, totalHrs]);

  const nowStart = mondayOf(Date.now());
  const nowIdx = weeks.findIndex((w) => w.start === nowStart);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    /* Auto-centre on the current week (fallback: first week with hours) */
    const el = chartScrollRef.current;
    if (!el) return;
    const firstActive = weeks.findIndex((w) => w.hrs > 0);
    const target = nowIdx >= 0 ? nowIdx : firstActive >= 0 ? firstActive : 0;
    el.scrollLeft = Math.max(0, target * COL_W - el.clientWidth / 2 + COL_W / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const fmtWk = (ms: number) => {
    const d = new Date(ms);
    return `${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()}`;
  };
  const hasData = weeks.length > 0 && totalHrs > 0;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: Z.MODAL_MENU, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: BRAND.card, borderRadius: 16,
          width: "100%", maxWidth: 780,
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden",
          transform: `translate(${dragPos.x}px, ${dragPos.y}px)`,
        }}
      >
        {/* Header */}
        <div onMouseDown={onDragStart} style={{ padding: "14px 20px 12px", borderBottom: `1px solid ${BRAND.cardBorder}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "grab", userSelect: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
              <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {role ? `${role} · ` : ""}{focus === "active" ? `${activeCount} active project${activeCount === 1 ? "" : "s"} · hours per week` : "Allocation · hours per week"}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color, backgroundColor: color + "22", padding: "4px 10px", borderRadius: 8, flexShrink: 0 }}>{label}</span>
          </div>
          <button onMouseDown={e => e.stopPropagation()} onClick={onClose} style={{ background: "none", border: "none", color: BRAND.textSecondary, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

          {/* ── STAT TILES ── */}
          <div style={{ padding: "14px 20px 0", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 110, backgroundColor: BRAND.bg, borderRadius: 10, padding: "10px 14px", border: `1px solid ${BRAND.cardBorder}` }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.white, lineHeight: 1 }}>{fmtHours(totalHrs)}h</div>
              <div style={{ fontSize: 10, color: BRAND.textSecondary, marginTop: 2 }}>Total hours booked</div>
            </div>
            <div style={{ flex: 1, minWidth: 110, backgroundColor: BRAND.bg, borderRadius: 10, padding: "10px 14px", border: `1px solid ${BRAND.cardBorder}` }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.white, lineHeight: 1 }}>{fmtHours(avgHrs)}h</div>
              <div style={{ fontSize: 10, color: BRAND.textSecondary, marginTop: 2 }}>Avg per active week</div>
            </div>
            <div style={{ flex: 1, minWidth: 110, backgroundColor: BRAND.bg, borderRadius: 10, padding: "10px 14px", border: `1px solid ${BRAND.cardBorder}` }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.white, lineHeight: 1 }}>{peak ? `${fmtHours(peak.hrs)}h` : "—"}</div>
              <div style={{ fontSize: 10, color: BRAND.textSecondary, marginTop: 2 }}>{peak ? `Peak week · ${fmtWk(peak.start)}` : "Peak week"}</div>
            </div>
            <div style={{ flex: 1, minWidth: 110, backgroundColor: BRAND.bg, borderRadius: 10, padding: "10px 14px", border: `1px solid ${BRAND.cardBorder}` }}>
              <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{Number(headerPct.toFixed(1))}%</div>
              <div style={{ fontSize: 10, color: BRAND.textSecondary, marginTop: 2 }}>Current allocation</div>
            </div>
          </div>

          {/* ── WEEKLY HOURS CHART — stacked by project ── */}
          {hasData ? (
            <div style={{ margin: "14px 20px 0", backgroundColor: BRAND.bg, borderRadius: 12, border: `1px solid ${BRAND.cardBorder}`, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.textSecondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Hours per Week
                </div>
                <div style={{ fontSize: 10, color: BRAND.textMuted }}>stacked by project · dashed line = {wkHours}h capacity · scroll for more weeks · click a bar for detail</div>
              </div>

              <div ref={chartScrollRef} style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 8 }}>
                <div style={{ display: "flex", paddingLeft: 10, paddingRight: 10, width: "max-content" }}>
                  {weeks.map((w, i) => {
                    const isNow = i === nowIdx;
                    const d = new Date(w.start);
                    const shortLabel = `${d.getMonth() + 1}/${d.getDate()}`;
                    const prev = i > 0 ? new Date(weeks[i - 1].start) : null;
                    const monthStart = !prev || prev.getMonth() !== d.getMonth() || prev.getFullYear() !== d.getFullYear();
                    const moLabel = monthStart
                      ? `${d.toLocaleDateString("en-US", { month: "short" })}${!prev || prev.getFullYear() !== d.getFullYear() ? ` '${String(d.getFullYear()).slice(2)}` : ""}`
                      : "";
                    const pctColor = weekBandColor(w.pct, true);
                    return (
                      <div
                        key={w.start}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center",
                          width: COL_W, minWidth: COL_W, boxSizing: "border-box",
                          cursor: w.hrs > 0 ? "pointer" : "default",
                          backgroundColor: isNow ? BRAND.white + "0a" : "transparent",
                          borderLeft: monthStart && i > 0 ? `1px solid ${BRAND.cardBorder}` : "1px solid transparent",
                          borderRadius: isNow ? 6 : 0,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (w.hrs === 0) { setBarTip(null); return; }
                          if (barTip?.w.start === w.start) { setBarTip(null); return; }
                          setBarTip({ w, shortLabel, x: e.clientX, y: e.clientY });
                        }}
                      >
                        {/* Month / NOW label row */}
                        <div style={{ height: 14, fontSize: 9, fontWeight: 700, color: isNow ? BRAND.green : BRAND.textSecondary, whiteSpace: "nowrap", lineHeight: "14px" }}>
                          {isNow ? "NOW" : moLabel}
                        </div>
                        {/* Bar area — stacked project segments grow from bottom */}
                        <div style={{
                          width: "100%", height: BAR_MAX_H, padding: "0 5px", boxSizing: "border-box",
                          display: "flex", flexDirection: "column", justifyContent: "flex-end",
                          position: "relative",
                        }}>
                          {/* capacity reference line (work-week hours) */}
                          <div style={{ position: "absolute", bottom: Math.round((wkHours / scaleHrs) * BAR_MAX_H), left: 0, right: 0, borderTop: `1px dashed ${BRAND.cardBorder}`, opacity: 0.6 }} />
                          <div style={{
                            display: "flex", flexDirection: "column-reverse",
                            borderRadius: "3px 3px 0 0", overflow: "hidden",
                          }}>
                            {w.segs.map((s) => {
                              const segH = Math.max(2, Math.round((s.hrs / scaleHrs) * BAR_MAX_H));
                              return (
                                <div
                                  key={s.pid || "other"}
                                    title={`${nameByPid.get(s.pid) ?? s.pid ?? "Project"} — ${fmtHours(s.hrs)}h`}
                                  style={{
                                    width: "100%", height: segH,
                                    backgroundColor: (colorByPid.get(s.pid) ?? BRAND.textMuted) + "cc",
                                    borderTop: `1px solid ${BRAND.bg}`,
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                        {/* total hours label */}
                        <div style={{ fontSize: 9, fontWeight: 600, color: BRAND.white, marginTop: 3, lineHeight: 1 }}>
                          {w.hrs > 0 ? `${fmtHours(w.hrs)}h` : "—"}
                        </div>
                        {/* utilisation % label (band-colored) */}
                        <div style={{ fontSize: 8, fontWeight: 400, color: w.pct > 0 ? pctColor : BRAND.textMuted, opacity: 0.8, lineHeight: 1, marginTop: 2 }}>
                          {w.pct > 0 ? `${+w.pct.toFixed(0)}%` : ""}
                        </div>
                        {/* Week label */}
                        <div style={{ fontSize: 8.5, color: BRAND.textMuted, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap" }}>
                          {shortLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Project legend */}
              <div style={{ display: "flex", gap: 12, padding: "6px 14px 10px", flexWrap: "wrap", alignItems: "center" }}>
                {projList.slice(0, 8).map((p) => (
                  <div key={p.pid} style={{ display: "flex", alignItems: "center", gap: 4, maxWidth: 200 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 9, color: BRAND.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${p.name} (${p.pid})`}>{p.name}</span>
                  </div>
                ))}
                {projList.length > 8 && <span style={{ fontSize: 9, color: BRAND.textMuted }}>+{projList.length - 8} more</span>}
                {nowIdx >= 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                    <div style={{ width: 8, height: 8, borderRadius: 1, backgroundColor: BRAND.white + "22", border: `1px solid ${BRAND.green}` }} />
                    <span style={{ fontSize: 9, color: BRAND.green }}>Current week</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ margin: "14px 20px 0", backgroundColor: BRAND.bg, borderRadius: 12, border: `1px solid ${BRAND.cardBorder}`, padding: "24px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.white }}>No allocation hours on record</div>
              <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 4 }}>{name} has no booked hours in any week — fully available for new assignments.</div>
            </div>
          )}

          {/* ── HOURS BY PROJECT ── */}
          <div style={{ padding: "14px 20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.textSecondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                Hours by Project
              </div>
              <div style={{ fontSize: 10, color: BRAND.textMuted }}>{projStats.length} project{projStats.length === 1 ? "" : "s"} · share of {fmtHours(totalHrs)}h total</div>
            </div>

            {projStats.length === 0 ? (
              <div style={{ fontSize: 12, color: BRAND.textSecondary }}>No project allocations on record.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {projStats.map((p) => (
                  <div key={p.pid} style={{ backgroundColor: BRAND.bg, borderRadius: 10, padding: "10px 12px", border: `1px solid ${BRAND.cardBorder}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color, flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: 10, color: BRAND.textMuted, marginTop: 1 }}>{p.pid}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 12, color: BRAND.textSecondary }}>{fmtHours(p.avgHrsWk)}h/wk</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: BRAND.white }}>{fmtHours(p.totalHrs)}h</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: p.color, borderLeft: `1px solid ${BRAND.cardBorder}`, paddingLeft: 8 }}>{p.share}%</span>
                      </div>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, backgroundColor: BRAND.cardBorder, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, p.share)}%`, backgroundColor: p.color, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "12px 20px 16px", borderTop: `1px solid ${BRAND.cardBorder}`, display: "flex" }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${BRAND.cardBorder}`, backgroundColor: "transparent", color: BRAND.textSecondary, cursor: "pointer", fontWeight: 600, fontSize: 13 }}
          >Close</button>
        </div>
      </div>

      {/* Bar tooltip popup — per-project breakdown for the clicked week */}
      {barTip && (() => {
        const tipColor = weekBandColor(barTip.w.pct, true);
        const segsSorted = [...barTip.w.segs].sort((a, b) => b.hrs - a.hrs);
        return (
        <div
          onClick={(e) => { e.stopPropagation(); setBarTip(null); }}
          style={{
            position: "fixed",
            top: Math.max(8, barTip.y - 150),
            left: Math.min(window.innerWidth - 240, Math.max(8, barTip.x - 110)),
            zIndex: Z.MODAL_CHILD_2,
            backgroundColor: BRAND.card,
            border: `1.5px solid ${tipColor}`,
            borderRadius: 10,
            padding: "10px 14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            minWidth: 220,
            maxWidth: 300,
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.white }}>Week {barTip.shortLabel}</div>
            <div style={{ fontSize: 10, color: tipColor, fontWeight: 700, backgroundColor: tipColor + "22", padding: "2px 7px", borderRadius: 5 }}>
              {weekBandLabel(barTip.w.pct)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: BRAND.white, lineHeight: 1 }}>{fmtHours(barTip.w.hrs)}h</div>
              <div style={{ fontSize: 9, color: BRAND.textMuted, marginTop: 2 }}>hours booked</div>
            </div>
            <div style={{ width: 1, backgroundColor: BRAND.cardBorder }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: tipColor, lineHeight: 1 }}>{+barTip.w.pct.toFixed(0)}%</div>
              <div style={{ fontSize: 9, color: BRAND.textMuted, marginTop: 2 }}>of capacity</div>
            </div>
          </div>
          {segsSorted.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BRAND.cardBorder}` }}>
              <div style={{ fontSize: 9, color: BRAND.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hours by project</div>
              {segsSorted.map((s) => (
                <div key={s.pid || "other"} style={{ display: "flex", alignItems: "center", gap: 6, lineHeight: 1.7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colorByPid.get(s.pid) ?? BRAND.textMuted, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: BRAND.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nameByPid.get(s.pid) ?? s.pid}>
                    {nameByPid.get(s.pid) ?? s.pid ?? "Project"}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: BRAND.white, flexShrink: 0 }}>{fmtHours(s.hrs)}h</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 9, color: BRAND.textMuted, marginTop: 8, textAlign: "center" }}>click to dismiss</div>
        </div>
        );
      })()}
    </div>
  );
}

/** Search box that keeps keystrokes local — same fix as ManagerSearchPicker
 *  (below). Typing updates ONLY this tiny component; the page-level filter
 *  state behind `onChange` updates after a short debounce, so the heavy
 *  Staff/Demand/Timeline bodies re-filter once per pause instead of
 *  re-rendering the whole 12k-line page synchronously on every keypress
 *  (that made typing feel stuck on large rosters). Clearing — the X button
 *  or backspacing to empty — flushes immediately so the full list snaps
 *  back without the debounce wait. Filtering semantics are unchanged: the
 *  parent still owns the committed value (?q= deep-link seeds, tab-switch
 *  clears, demand paging resets all still key off it). */
function SearchInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  // Local echo of the committed page-level value; seeded from it on mount
  // (deep links land ?q= in the page state before first render).
  const [text, setText] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last value THIS input pushed via onChange — tells the parent echoing our
  // own debounced push apart from a genuine external reset (e.g. the tab
  // strip clearing search). Without it, a commit landing mid-typing would
  // clobber newer keystrokes.
  const lastPushedRef = useRef(value);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);
  useEffect(() => {
    if (value !== lastPushedRef.current) {
      // External change: adopt it and drop any pending push so stale
      // keystrokes can't resurrect the old query afterwards.
      lastPushedRef.current = value;
      setText(value);
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    }
  }, [value]);
  const push = (v: string) => {
    setText(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Clearing restores the full list instantly; typing re-filters the page
    // only after a short pause instead of on every keystroke.
    if (!v.trim()) {
      lastPushedRef.current = v;
      onChange(v);
      return;
    }
    debounceRef.current = setTimeout(() => { lastPushedRef.current = v; onChange(v); }, 180);
  };
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", gap: 8,
      backgroundColor: BRAND.card, borderRadius: 10, padding: "0 12px",
      border: `1px solid ${BRAND.cardBorder}`,
    }}>
      <Search size={14} color={text ? BRAND.green : BRAND.textSecondary} />
      <input
        value={text}
        onChange={e => push(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, padding: "10px 0", background: "transparent", border: "none",
          color: BRAND.white, fontSize: 13, outline: "none",
        }}
      />
      {text && (
        <button onClick={() => push("")}
          style={{ background: "none", border: "none", color: BRAND.textSecondary, cursor: "pointer" }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function CenterLoader({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "60px 20px", gap: 12 }}>
      <Loader2 size={32} color={BRAND.green} className="animate-spin" />
      <div style={{ color: BRAND.textSecondary, fontSize: 13 }}>{text}</div>
    </div>
  );
}

function Empty({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "60px 20px", gap: 12 }}>
      {icon}
      <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>{title}</div>
      <div style={{ color: BRAND.textSecondary, fontSize: 12, textAlign: "center" }}>{subtitle}</div>
    </div>
  );
}

function GanttBody({
  rows, periods, mode, loading, error, onRetry,
  selectedPeriod, onSelectPeriod, selectedQ, onPersonClick, onQClick, br,
}: {
  rows: Record<string, unknown>[];
  periods: string[];
  mode: UtilMode;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedPeriod: string | null;
  onSelectPeriod: (p: string) => void;
  selectedQ: string;
  onPersonClick: (name: string, userId?: string) => void;
  onQClick?: () => void;
  br: { targetUtilizationPct: number; underAllocatedPct: number; overCapacityPct: number };
}) {
  const activePeriod = selectedPeriod && periods.includes(selectedPeriod) ? selectedPeriod : (periods[0] ?? null);

  const rowData = useMemo(() => {
    if (!activePeriod) return [];
    return rows
      .map(r => {
        const name = String(r.ResourceUser ?? "");
        const cell = parseUtilCell(r[activePeriod]);
        const userId = String((r as Record<string,unknown>).UserId ?? "");
        return { name, userId, p: cell?.p ?? 0, h: cell?.h ?? 0 };
      })
      .filter(r => r.name)
      .sort((a, b) => b.p - a.p);
  }, [rows, activePeriod]);

  const activeRows   = rowData.filter(r => r.h > 0);
  const idleRows     = rowData.filter(r => r.h === 0);
  const totalPeople  = rowData.length;
  const activePeople = activeRows.length;
  const totalHours   = rowData.reduce((s, r) => s + r.h, 0);
  const idlePeople   = idleRows.length;

  const [idleOpen, setIdleOpen] = useState(false);

  // Bars are sized by hours (not %)
  const maxH = Math.max(...activeRows.map(r => r.h), 1);

  const border = BRAND.cardBorder;

  function barColor(p: number): string {
    if (p > br.overCapacityPct)       return "#e87c3e";
    if (p >= br.targetUtilizationPct) return "#22a552";
    if (p >= br.underAllocatedPct)    return "#e03c3c";
    return "#9ca3af";
  }

  function statusInfo(p: number): { label: string; bg: string; text: string } {
    if (p > br.overCapacityPct)      return { label: "Over",  bg: "#e87c3e", text: "#fff" };
    if (p >= br.targetUtilizationPct) return { label: "Good",  bg: "#22a552", text: "#fff" };
    if (p >= br.underAllocatedPct)   return { label: "Under", bg: "#e03c3c", text: "#fff" };
    return                                  { label: "Idle",  bg: "#6b7280", text: "#fff" };
  }

  if (loading) return <CenterLoader text="Loading utilization…" />;
  if (error) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
      <AlertCircle size={32} color={BRAND.red} />
      <div style={{ color: BRAND.white, fontSize: 14, fontWeight: 600 }}>{error}</div>
      <button onClick={onRetry} style={{ padding: "8px 18px", borderRadius: 8, border: "none",
        backgroundColor: BRAND.greenBg, color: BRAND.white, fontWeight: 700, cursor: "pointer" }}>Retry</button>
    </div>
  );
  if (!periods.length) return (
    <Empty icon={<BarChart2 size={32} color={BRAND.textMuted} />}
      title="No data" subtitle="No utilisation data for this quarter" />
  );

  return (
    <div style={{
      marginBottom: 80, marginLeft: 12, marginRight: 12, marginTop: 4,
      backgroundColor: "var(--rm-card)", borderRadius: 12,
      border: `1px solid ${border}`,
      overflow: "hidden",
    }}>

      {/* ── Card header: badge + title  |  week chips + legend ────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px 10px",
        borderBottom: `1px solid ${border}`,
        flexWrap: "wrap",
      }}>
        {/* Left: badge + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{
            backgroundColor: BRAND.green + "20",
            border: `2px solid ${BRAND.green}`,
            borderRadius: 8, padding: "4px 8px", textAlign: "center", minWidth: 44,
          }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.green, lineHeight: 1 }}>
              {activePeriod ? fmtPeriodLabel(activePeriod, mode) : "—"}
            </div>
            <div style={{ fontSize: 7.5, color: BRAND.green, fontWeight: 700, opacity: 0.8, marginTop: 1, textTransform: "uppercase" }}>
              {mode === "Monthly" ? "month" : "week"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--rm-text)" }}>{selectedQ} · All Resources</div>
            <div style={{ fontSize: 10, color: BRAND.textMuted }}>Click any bar for details</div>
          </div>
        </div>

        {/* Right: compact summary metrics + week chips + legend dots */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
          {/* Keep the high-value counts in the title row instead of spending
              a full extra band on large number cards. Avg utilisation is
              intentionally omitted; the row bars and status legend show the
              actionable utilisation detail directly. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {([
              { val: String(totalPeople), label: "TOTAL PEOPLE", color: "var(--rm-text)", clickable: false },
              { val: fmtStatHours(totalHours), label: "TOTAL HOURS", color: "var(--rm-text)", clickable: false },
              { val: String(activePeople), label: "ACTIVE PEOPLE", color: "var(--rm-text)", clickable: false },
              { val: String(idlePeople), label: "IDLE PEOPLE", color: idlePeople > 0 ? "#e87c3e" : "var(--rm-text)", clickable: true },
            ] as { val: string; label: string; color: string; clickable: boolean }[]).map((stat) => (
              stat.clickable ? (
                <button
                  key={stat.label}
                  onClick={() => setIdleOpen(o => !o)}
                  style={{
                    display: "flex", alignItems: "baseline", gap: 4,
                    padding: "2px 0", border: "none", borderBottom: idleOpen ? `2px solid #e87c3e` : "2px solid transparent",
                    background: "transparent", color: stat.color, cursor: "pointer",
                  }}
                  title="Show idle people"
                >
                  <span style={{ fontSize: 16, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{stat.val}</span>
                  <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.55, whiteSpace: "nowrap" }}>{stat.label}</span>
                </button>
              ) : (
                <div key={stat.label} style={{ display: "flex", alignItems: "baseline", gap: 4, padding: "2px 0" }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: stat.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{stat.val}</span>
                  <span style={{ fontSize: 8, color: BRAND.textMuted, fontWeight: 800, letterSpacing: 0.55, whiteSpace: "nowrap" }}>{stat.label}</span>
                </div>
              )
            ))}
          </div>
          {/* Week chip row */}
          <div style={{ display: "flex", gap: 3, flexWrap: "nowrap", overflowX: "auto" }}>
            {periods.map(p => {
              const active = p === activePeriod;
              return (
                <button key={p} onClick={() => onSelectPeriod(p)} style={{
                  padding: "3px 9px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${active ? BRAND.green : border}`,
                  backgroundColor: active ? BRAND.green : "transparent",
                  color: active ? "#fff" : BRAND.textSecondary,
                  fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                }}>
                  {fmtPeriodLabel(p, mode)}
                </button>
              );
            })}
          </div>
          {/* Legend dots */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {([
              { color: "#22a552", label: "Good" },
              { color: "#e03c3c", label: "Under" },
              { color: "#e87c3e", label: "Over" },
            ]).map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: l.color }} />
                <span style={{ fontSize: 10, color: BRAND.textSecondary, fontWeight: 600 }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Idle people panel (toggled by clicking IDLE PEOPLE stat) ── */}
      {idleOpen && idleRows.length > 0 && (
        <div style={{ borderBottom: `1px solid ${border}`, backgroundColor: "rgba(232,124,62,0.04)" }}>
          <div style={{
            padding: "8px 14px 6px",
            display: "flex", alignItems: "center", gap: 6,
            borderBottom: `1px solid ${border}`,
          }}>
            <UserX size={13} color="#e87c3e" />
            <span style={{ fontSize: 10, fontWeight: 800, color: "#e87c3e", letterSpacing: 0.6, textTransform: "uppercase" }}>
              {idleRows.length} Idle This Week — click a name for AI suggestions
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 14px 12px" }}>
            {idleRows.map(r => (
              <button
                key={r.userId || r.name}
                onClick={() => onPersonClick(r.name, r.userId)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: "var(--rm-card)",
                  cursor: "pointer",
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#e87c3e";
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#e87c3e12";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = border;
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--rm-card)";
                }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: 13,
                  backgroundColor: "#e87c3e22",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <User size={13} color="#e87c3e" />
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--rm-text)", whiteSpace: "nowrap" }}>
                  {r.name}
                </span>
                <Sparkles size={11} color="#8B5CF6" style={{ marginLeft: 2, opacity: 0.7 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Bar rows (active people only — idle panel above) ────────── */}
      <div style={{ overflowY: "auto", maxHeight: 480 }}>
        {activeRows.length === 0 ? (
          <Empty icon={<Users size={32} color={BRAND.textMuted} />}
            title="No active people this period" subtitle="All resources are idle — click IDLE PEOPLE above to see them" />
        ) : activeRows.map((r, i) => {
          const barW = maxH > 0 ? Math.min(100, (r.h / maxH) * 100) : 0;
          const color  = barColor(r.p);
          const st     = statusInfo(r.p);
          return (
            <div
              key={r.name}
              onClick={() => onPersonClick(r.name, r.userId)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px 6px 10px",
                borderBottom: `1px solid ${border}`,
                backgroundColor: i % 2 === 0 ? "transparent" : "var(--rm-card-alt, rgba(0,0,0,0.02))",
                cursor: "pointer",
              }}
            >
              {/* Row # */}
              <div style={{ width: 20, textAlign: "right", fontSize: 10.5, color: BRAND.textMuted, fontWeight: 600, flexShrink: 0 }}>
                {i + 1}
              </div>

              {/* Name */}
              <div style={{
                width: 168, fontSize: 12.5, fontWeight: 700,
                color: "var(--rm-text)",
                flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {r.name}
              </div>

              {/* Bar track */}
              <div style={{
                flex: 1, height: 18,
                backgroundColor: "var(--rm-card-alt, rgba(0,0,0,0.06))",
                borderRadius: 4, overflow: "hidden", position: "relative",
              }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${barW}%`, borderRadius: 4,
                  background: r.p > br.overCapacityPct
                    ? "linear-gradient(90deg,#e03c3c,#e8613e)"
                    : "linear-gradient(90deg,#e87c3e,#f0a040)",
                  transition: "width 0.4s ease",
                }} />
              </div>

              {/* % bold + hours muted */}
              <div style={{ width: 64, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontSize: 13, fontWeight: 900, color }}>{r.p}%</span>
                <span style={{ fontSize: 10.5, color: BRAND.textMuted, marginLeft: 4 }}>{r.h}h</span>
              </div>

              {/* Status badge */}
              <div style={{
                width: 40, textAlign: "center", flexShrink: 0,
                padding: "2px 0", borderRadius: 5,
                backgroundColor: st.bg,
                fontSize: 9.5, fontWeight: 800, color: st.text,
              }}>
                {st.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer legend ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px",
        borderTop: `1px solid ${border}`,
        backgroundColor: "var(--rm-card-alt, rgba(0,0,0,0.02))",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {([
            { color: "#22a552", label: `Healthy (${br.targetUtilizationPct}–${br.overCapacityPct}%)` },
            { color: "#e03c3c", label: `Under (<${br.underAllocatedPct}%)` },
            { color: "#e87c3e", label: `Over (>${br.overCapacityPct}%)` },
          ]).map(l => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: l.color }} />
              <span style={{ fontSize: 10, color: BRAND.textSecondary, fontWeight: 600 }}>{l.label}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: BRAND.textMuted, fontStyle: "italic" }}>
          Bars sized by hours · sorted desc · click row for details
        </div>
      </div>
    </div>
  );
}

function StaffRatesRow({ roleId, roleName, departmentId, cardSubtleBorder, cardMuted, cardText }: {
  roleId?: string; roleName?: string; departmentId?: string;
  cardSubtleBorder: string; cardMuted: string; cardText: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["role-billing-rates", departmentId ?? ""],
    queryFn: () => getRoleBillingRates(departmentId || undefined),
    staleTime: 5 * 60 * 1000,
    enabled: !!(roleId || roleName),
  });
  const rate = useMemo(() => {
    if (!data?.rates) return null;
    const id = (roleId ?? "").trim().toLowerCase();
    const name = (roleName ?? "").trim().toLowerCase();
    return data.rates.find(r =>
      (id && r.id.toLowerCase() === id) ||
      (name && r.name.toLowerCase() === name)
    ) ?? null;
  }, [data, roleId, roleName]);

  if (isLoading) return null;
  if (!rate) return null;
  const billingVal = rate.billingRate ?? rate.defaultRate ?? null;
  const hasBilling = billingVal != null;
  const hasLabor = rate.laborRate != null;
  const hasCost = rate.costRate != null;
  if (!hasBilling && !hasLabor && !hasCost) return null;

  const fmtRate = (v: number | null | undefined) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/hr` : "—";
  const billingIsFallback = hasBilling && rate.billingRate == null;
  const cols: { label: string; value: string; note?: string }[] = [
    ...(hasBilling ? [{ label: "Billing Rate", value: fmtRate(billingVal), note: billingIsFallback ? "Company-wide rate — no dept override set" : undefined }] : []),
    ...(hasLabor   ? [{ label: "Labor Rate",   value: fmtRate(rate.laborRate)   }] : []),
    ...(hasCost    ? [{ label: "Cost Rate",    value: fmtRate(rate.costRate)    }] : []),
  ];
  return (
    <div style={{ borderTop: `1px solid ${cardSubtleBorder}`, paddingTop: 8, marginTop: 4, display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, gap: "2px 8px" }}>
      {cols.map(c => (
        <div key={c.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: cardMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: cardText }}>{c.value}</span>
          {c.note && (
            <span style={{ fontSize: 9, color: cardMuted, fontStyle: "italic", marginTop: 1 }}>
              {c.note}{" "}
              <Link href="/billing-rates" style={{ color: "#6BA539", fontStyle: "normal", fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>
                Set rate →
              </Link>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function StaffCard({
  r, pgVersion, expanded, onToggle, pName, canEdit, canEditHours, canManageStaff, onReactivated, onProjectClick, onSaveProjectWeek, onSaveProjectWeeks, onReallocateAI, onConcentrationAI, onStaffAction, onShowProfile, onEdit, onAvailabilityClick, windows, resolveAccess,
}: {
  r: LiveResourceProxy;
  /** Bumped by the parent after an Edit Staff save — forces a skills/tags refetch. */
  pgVersion: number;
  expanded: boolean;
  onToggle: () => void;
  pName: (pid: string) => string;
  canEdit: boolean;
  canEditHours: boolean;
  canManageStaff: boolean;
  onReactivated: () => void;
  onProjectClick: (pid: string) => void;
  onSaveProjectWeek: (edit: ResourceProjectWeekEdit) => Promise<void>;
  /** Atomic multi-week save — enables month-total editing in the popup's Monthly view. */
  onSaveProjectWeeks?: (edit: ResourceProjectWeeksEdit) => Promise<void>;
  onReallocateAI: () => void;
  onConcentrationAI: () => void;
  /** Same staff action menu used by the Data Grid row. */
  onStaffAction?: (action: StaffQuickAction) => void;
  onShowProfile: () => void;
  onEdit: () => void;
  onAvailabilityClick: (availability: AvailWindow) => void;
  /** Leave / partial-availability windows for this person (may be undefined). */
  windows?: AvailWindow[];
  /** Resolves stored access levels (incl. "custom:<id>" markers) to display names. */
  resolveAccess?: (v?: string | null) => string;
}) {
  // Active leave/partial-availability window covering today, if any.
  const activeLeave = activeAvailabilityWindow(windows) as AvailWindow | null;
  const status = statusInfo(r.currentPct);
  const isOver = isOverloaded(r.currentPct);
  const isBench = r.currentPct === 0;
  // Dedupe so the count on the stat tile matches what the popup shows.
  // The raw activeProjects array can have duplicate IDs when a person has
  // multiple allocation rows on the same project.
  const projectCount = new Set(r.activeProjects).size;
  const projectLabel = projectCount > 0
    ? Array.from(new Set(r.activeProjects)).slice(0, 2).map(pid => pName(pid)).join(", ")
      + (projectCount > 2 ? ` +${projectCount - 2}` : "")
    : "— Bench";
  const [showDetail, setShowDetail] = useState(false);
  const [gaugeOpen, setGaugeOpen] = useState(false);
  const [modalMode, setModalMode] = useState<StaffModalMode>("active");
  const [initialProjectId, setInitialProjectId] = useState<string | null>(null);
  const openModal = (m: StaffModalMode) => {
    setInitialProjectId(null);
    setModalMode(m);
    setGaugeOpen(true);
  };
  const openProjectWeeklyHours = (projectId: string) => {
    setInitialProjectId(projectId);
    setModalMode("active");
    setGaugeOpen(true);
  };
  const [concentrationModalOpen, setConcentrationModalOpen] = useState(false);

  const [pgSkills, setPgSkills] = useState<{ id: number; skillName: string; proficiency: number | null; isPrimary: boolean }[]>([]);
  const [pgTags,   setPgTags]   = useState<{ id: number; tagName: string }[]>([]);
  // Fetch once per (person, version) — the version bumps when the Edit Staff
  // modal saves, so chips edited there show up without a page reload.
  const pgFetchedKey = useRef("");
  useEffect(() => {
    if (!showDetail || !r.id) return;
    const key = `${r.id}:${pgVersion}`;
    if (pgFetchedKey.current === key) return;
    pgFetchedKey.current = key;
    getUserSkills(r.id).then(setPgSkills).catch(() => {});
    getUserExperienceTags(r.id).then(setPgTags).catch(() => {});
  }, [showDetail, r.id, pgVersion]);

  // All editing is now done via the popup modal (onEdit).
  // Read values directly from the resource prop (refreshed by onSaved).
  const displayEmpType = r.employeeType ?? null;
  const displayPhone   = r.phoneNumber  ?? null;

  const accessLevelDisplay = resolveAccess ? resolveAccess(r.accessLevel) : normAccessDisplay(r.accessLevel);
  const accessColor = ACCESS_LEVEL_COLORS[accessLevelDisplay] || "#6B7280";

  // Concentration risk: a person carrying a single active project above the
  // admin-configured "Single-project risk (%)" threshold. Deterministic mirror
  // of the backend severity rule so the chip flips live as the admin changes
  // the threshold (useBusinessRulesVersion re-renders on a rule change).
  const rulesVersion = useBusinessRulesVersion();
  const concentrationPct = useMemo(() => getBusinessRules().concentrationPct, [rulesVersion]);
  // Shared rule (staffConcentrationRisk): only projects that actually carry
  // load (>0% / >0h) count, so a 0% placeholder assignment on a second
  // project doesn't hide the risk.
  const concentrationRisk = staffConcentrationRisk(r, concentrationPct);

  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";
  // Explicit false only — legacy/imported people (no flag) are treated as verified.
  const unverified = r.emailVerified === false;

  // Concentration-risk cards get an amber-tinted surface (matching the chip)
  // so they stand out from regular white cards in both dark and light mode.
  // Takes precedence over the unverified red tint — the "Email not verified"
  // inline warning row still communicates that state.
  const { mode } = useTheme();
  const riskBg     = mode === "light" ? "#FFF7EB" : "#FDF0DC";
  const riskBorder = mode === "light" ? "#F59E0B" : "#D97706";

  return (
    <div style={{
      backgroundColor: concentrationRisk ? riskBg : unverified ? "#FFF6F6" : "#FFFFFF", borderRadius: 14,
      border: concentrationRisk
        ? `1.5px solid ${riskBorder}99`
        : `1px solid ${unverified ? BRAND.red + "66" : isOver ? status.color + "55" : isBench ? status.color + "30" : cardSubtleBorder}`,
      overflow: "hidden", position: "relative",
      boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
    }}>
      {/* Left accent strip */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        backgroundColor: status.color,
      }} />

      {/* Main row */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px 12px 18px",
        }}>

        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: status.color + "18",
          border: `1px solid ${status.color}50`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: status.color, fontSize: 14, fontWeight: 700,
          flexShrink: 0,
        }}>
          {initialsOf(r.name)}
        </div>

        {/* Identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 600,
              color: empTypeColor(r.employeeType) ?? cardText,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </div>
            <DisabledMemberStatus enabled={r.enabled} userGuid={r.id} tenantId={r.tenantId}
              canManageStaff={canManageStaff} onReactivated={onReactivated} />
            {canEdit && (
              <button
                title="Edit details"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: "transparent",
                  border: `1px solid ${cardSubtleBorder}`,
                  cursor: "pointer", color: BRAND.green, padding: 0,
                }}
              >
                <Pencil size={11} />
              </button>
            )}
            {accessLevelDisplay && (
              <span style={{
                fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase",
                padding: "1.5px 7px", borderRadius: 999, flexShrink: 0,
                backgroundColor: accessColor + "16", color: accessColor,
                border: `1px solid ${accessColor}45`,
              }}>
                {accessLevelDisplay}
              </span>
            )}
            {isOver && <AlertTriangle size={13} color={BRAND.orange} />}
            {isBench && <TrendingDown size={13} color={BRAND.red} />}
          </div>
          {r.role && (
            <div style={{ fontSize: 10, color: cardMuted, marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.role}
            </div>
          )}
          {unverified && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              <AlertTriangle size={11} color={BRAND.red} />
              <span style={{ fontSize: 10, fontWeight: 700, color: BRAND.red }}>
                Email not verified
              </span>
            </div>
          )}
          {r.username && (
            <div style={{ fontSize: 10, color: cardMuted, marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontStyle: "italic", opacity: 0.8 }}>
              {r.username}
            </div>
          )}
          {/* Employee ID — display-only, shown on the card face when set */}
          {r.employeeId && (
            <div style={{ fontSize: 10, color: cardMuted, marginTop: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              ID: {r.employeeId}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              // One project opens its weekly panel inside the person popup;
              // several still open the workload list first.
              if (projectCount === 1) openProjectWeeklyHours(r.activeProjects[0]);
              else if (projectCount > 1) openModal("active");
            }}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "transparent", border: "none", padding: 0,
              marginTop: 3, cursor: projectCount > 0 ? "pointer" : "default",
              maxWidth: "100%", overflow: "hidden",
            }}
          >
            <Briefcase size={10} color={projectCount > 0 ? BRAND.green : cardMuted} />
            <span style={{
              fontSize: 11, color: projectCount > 0 ? BRAND.green : cardMuted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontWeight: 500,
            }}>{projectLabel}</span>
          </button>
          {concentrationRisk && (
            <div style={{ marginTop: 4 }}>
              <button
                onClick={(e) => { e.stopPropagation(); onConcentrationAI(); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 999,
                  backgroundColor: BRAND.orange + "1F",
                  border: `1px solid ${BRAND.orange}55`,
                  color: BRAND.orange,
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                  cursor: "pointer", userSelect: "none",
                }}
              >
                <AlertTriangle size={10} color={BRAND.orange} />
                Concentration risk
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2, marginLeft: 2, opacity: 0.85 }}>
                  · <Sparkles size={9} color={BRAND.orange} style={{ marginLeft: 2 }} /> Ask AI
                </span>
              </button>
            </div>
          )}
          {activeLeave && (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAvailabilityClick(activeLeave);
                }}
                title={`${fmtAvailRange(activeLeave.startDate, activeLeave.endDate)}${(activeLeave as any).leaveType ? ` · ${(activeLeave as any).leaveType}` : ""}${activeLeave.reason ? ` · ${activeLeave.reason}` : ""}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 999,
                  backgroundColor: activeLeave.availabilityPct === 0 ? BRAND.orange + "1F" : "rgba(107,126,138,0.15)",
                  border: `1px solid ${activeLeave.availabilityPct === 0 ? BRAND.orange + "55" : "rgba(107,126,138,0.35)"}`,
                  color: activeLeave.availabilityPct === 0 ? BRAND.orange : "#6B7E8A",
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                  userSelect: "none", cursor: "pointer",
                }}
              >
                <Calendar size={10} color={activeLeave.availabilityPct === 0 ? BRAND.orange : "#6B7E8A"} />
                {availPctLabel(activeLeave.availabilityPct)}
              </button>
            </div>
          )}
        </div>

        {/* Right: same three-dots staff actions as the Data Grid, beside the
            utilization gauge so Cards and Grid expose one consistent menu. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {onStaffAction && <StaffDotsMenu onAction={onStaffAction} />}
          <div onClick={(e) => e.stopPropagation()}>
            <UtilGauge pct={r.currentPct} color={status.color} label={status.label}
              onClick={() => openModal("active")} />
          </div>
        </div>
      </div>

      {gaugeOpen && (
        <StaffUtilModal r={r} status={status} pName={pName} mode={modalMode} windows={windows}
          initialProjectId={initialProjectId}
          onClose={() => { setGaugeOpen(false); setInitialProjectId(null); }}
          onProjectClick={onProjectClick}
          canEditHours={canEditHours}
          onSaveProjectWeek={onSaveProjectWeek}
          onSaveProjectWeeks={onSaveProjectWeeks} />
      )}
      {concentrationModalOpen && (
        <ConcentrationRiskModal
          name={r.name}
          pct={Math.round(r.currentPct)}
          threshold={concentrationPct}
          projectName={(() => {
            // Name the project actually carrying the load, not just the first
            // list entry (which could be a 0% placeholder assignment).
            const loaded = (r.activeAllocations ?? []).find(a => (a.pct ?? 0) > 0 || (a.hours ?? 0) > 0);
            if (loaded) return loaded.projectName || pName(loaded.projectId);
            return r.activeProjects.length > 0 ? pName(r.activeProjects[0]) : undefined;
          })()}
          onClose={() => setConcentrationModalOpen(false)}
        />
      )}

      {/* AI insight strip */}
      <div style={{ padding: "0 14px" }}>
        <CardInsight
          kind="staff"
          id={r.id || r.username || r.name}
          fields={{
            name: r.name,
            role: r.role || null,
            currentAllocPct: r.currentPct,
            activeProjectCount: r.activeProjects.length,
            totalProjects: r.totalProjects,
            lastActiveDate: r.lastActiveDate,
          }}
        />
      </div>

      {/* Action row: View Details · Assign · Profile
          Solid filled buttons (status-colored View Details, brand-green Assign,
          slate Profile) with white text and larger type so the row reads
          clearly against the white card background instead of looking washed
          out. Each button also gets a subtle drop-shadow tinted with its own
          color to lift it off the card. */}
      <div style={{
        display: "flex", gap: 8,
        margin: "12px 14px 14px",
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDetail(true); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "10px 0", borderRadius: 10,
            backgroundColor: "transparent",
            border: "2px solid #253746",
            color: "#253746", fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
            cursor: "pointer",
          }}
        >
          <ChevronRight size={15} />
          View Details
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onReallocateAI(); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "11px 0", borderRadius: 10,
            backgroundColor: BRAND.greenBg,
            border: `1px solid ${BRAND.greenBg}`,
            color: "#FFFFFF",
            fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
            boxShadow: `0 2px 6px ${BRAND.green}40`,
            cursor: "pointer",
          }}
        >
          <UserCheck size={15} />
          Assign
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onShowProfile(); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "11px 0", borderRadius: 10,
            backgroundColor: "var(--rm-slate-action)",
            border: "1px solid var(--rm-slate-action)",
            color: "#FFFFFF",
            fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
            boxShadow: "0 2px 6px var(--rm-slate-action-shadow)",
            cursor: "pointer",
          }}
        >
          <Eye size={15} />
          Profile
        </button>
      </div>

      {/* Detail popup — rendered via portal so it overlays the grid cleanly */}
      {showDetail && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setShowDetail(false)}
        >
          {/* Backdrop */}
          <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)" }} />

          {/* Modal panel */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "relative", zIndex: 1,
              width: 480, maxWidth: "100%", maxHeight: "calc(100vh - 64px)",
              background: "#FFFFFF", borderRadius: 16,
              boxShadow: "0 24px 64px rgba(0,0,0,0.30)",
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 18px",
              borderBottom: `1px solid ${cardSubtleBorder}`,
              flexShrink: 0,
              background: concentrationRisk ? "#FFF7EB" : unverified ? "#FFF6F6" : "#FAFBFC",
            }}>
              {/* Left accent */}
              <div style={{ width: 4, height: 44, borderRadius: 2, backgroundColor: status.color, flexShrink: 0 }} />
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: status.color + "18",
                border: `1px solid ${status.color}50`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: status.color, fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>
                {initialsOf(r.name)}
              </div>
              {/* Identity */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: cardText,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </div>
                {r.role && (
                  <div style={{ fontSize: 11, color: cardMuted, marginTop: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.role}
                  </div>
                )}
              </div>
              {/* Status badge */}
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                padding: "3px 9px", borderRadius: 999,
                backgroundColor: status.color + "16", color: status.color,
                border: `1px solid ${status.color}45`, flexShrink: 0,
              }}>
                {Number(r.currentPct.toFixed(1))}%
              </div>
              {/* Close button */}
              <button
                onClick={() => setShowDetail(false)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "transparent", border: `1px solid ${cardSubtleBorder}`,
                  cursor: "pointer", color: cardMuted,
                }}
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Scrollable body — same content as before */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              <div style={{ borderTop: `1px solid ${cardSubtleBorder}` }}>
          {/* Status callout (over) — clickable → opens utilisation detail popup */}
          {isOver && (
            <button
              onClick={(e) => { e.stopPropagation(); openModal("active"); }}
              style={{
                width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "8px 14px",
                backgroundColor: BRAND.orange + "0E",
                borderTop: `1px solid ${BRAND.orange}20`,
                transition: "background 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = BRAND.orange + "18")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = BRAND.orange + "0E")}
              >
                <AlertTriangle size={12} color={BRAND.orange} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.orange, marginBottom: 1 }}>
                    Overallocated — {r.currentPct - 100}% over capacity
                  </div>
                  <div style={{ fontSize: 10, color: cardMuted, lineHeight: 1.4 }}>
                    {projectCount} active project{projectCount !== 1 ? "s" : ""} · tap to see allocation breakdown
                  </div>
                </div>
                <ChevronRight size={12} color={BRAND.orange} style={{ flexShrink: 0, marginTop: 2, opacity: 0.7 }} />
              </div>
            </button>
          )}
          {/* Status callout (bench) — clickable → opens utilisation detail popup */}
          {isBench && (
            <button
              onClick={(e) => { e.stopPropagation(); openModal("all"); }}
              style={{
                width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "8px 14px",
                backgroundColor: BRAND.orange + "0E",
                borderTop: `1px solid ${BRAND.orange}20`,
                transition: "background 0.15s",
              }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = BRAND.orange + "18")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = BRAND.orange + "0E")}
              >
                <TrendingDown size={12} color={BRAND.orange} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.orange, marginBottom: 1 }}>
                    No active allocation
                  </div>
                  <div style={{ fontSize: 10, color: cardMuted, lineHeight: 1.4 }}>
                    {r.totalProjects} project{r.totalProjects !== 1 ? "s" : ""} total history · tap to review
                  </div>
                </div>
                <ChevronRight size={12} color={BRAND.orange} style={{ flexShrink: 0, marginTop: 2, opacity: 0.7 }} />
              </div>
            </button>
          )}

          {/* ACTIVE PROJECTS block */}
          {projectCount > 0 && (
            <div style={{ borderBottom: `1px solid ${cardSubtleBorder}` }}>
              {/* Block header */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px 6px",
                backgroundColor: BRAND.green + "08",
              }}>
                <Layers size={11} color={BRAND.green} />
                <span style={{
                  fontSize: 9, fontWeight: 700, color: BRAND.green, letterSpacing: 1.1,
                }}>ACTIVE PROJECTS</span>
              </div>
              {/* Project items */}
              {Array.from(new Set(r.activeProjects)).map((pid, idx) => (
                <button
                  key={pid}
                  onClick={(e) => { e.stopPropagation(); openProjectWeeklyHours(pid); }}
                  style={{
                    width: "100%",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 14px",
                    borderTop: idx === 0 ? "none" : `1px solid #F0F3F6`,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                    <Briefcase size={11} color={BRAND.green} style={{ flexShrink: 0 }} />
                    <span style={{
                      fontSize: 11, color: BRAND.green, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left",
                    }}>{pName(pid)}</span>
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 3,
                    padding: "4px 8px",
                    backgroundColor: BRAND.green + "15",
                    border: `1px solid ${BRAND.green}30`,
                    borderRadius: 6,
                    flexShrink: 0,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: BRAND.green }}>Details</span>
                    <ChevronRight size={10} color={BRAND.green} />
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Organization & employment — imported from the Staff file, editable here. */}
          {(() => {
            const bu = (r.businessUnit || "").trim();
            const div = (r.divisionName || "").trim();
            const fields: { label: string; value: string }[] = [
              { label: "Business Unit", value: bu },
              // Hide Division when it duplicates the BU (i.e. tenant has no real BU
              // and BU falls back to the division name) to avoid a redundant row.
              // Also hidden entirely when the Division tier is toggled off —
              // stored values are hidden bridge divisions.
              { label: "Division", value: getBusinessRules().showDivision && div && div !== bu ? div : "" },
              { label: "Department", value: (r.departmentName || "").trim() },
              { label: "Role", value: (r.roleName || "").trim() },
              { label: "Job Title", value: (r.role || "").trim() },
              { label: "Start Date", value: fmtStaffDate(r.startDate) },
              { label: "End Date", value: fmtStaffDate(r.endDate) },
              { label: "Employee ID", value: (r.employeeId || "").trim() },
              // Always visible so admins can tell "not set" apart from hidden.
              { label: "Access Level", value: accessLevelDisplay || "Not set" },
            ];
            const shown = fields.filter(f => f.value);
            return (
              <div style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${cardSubtleBorder}`,
                display: "flex", flexDirection: "column", gap: 7,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: cardMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>
                    Organization &amp; Employment
                  </span>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "transparent", border: `1px solid ${cardSubtleBorder}`,
                        borderRadius: 7, padding: "3px 8px", cursor: "pointer",
                        color: BRAND.green, fontSize: 10.5, fontWeight: 700,
                      }}
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  )}
                </div>
                {shown.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {shown.map(f => (
                      <div key={f.label} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 10.5, color: cardMuted, minWidth: 84, flexShrink: 0 }}>{f.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: cardText,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.value}</span>
                      </div>
                    ))}
                    <StaffRatesRow
                      roleId={r.roleId} roleName={r.roleName}
                      departmentId={r.departmentId}
                      cardSubtleBorder={cardSubtleBorder} cardMuted={cardMuted} cardText={cardText}
                    />
                  </div>
                ) : (
                  <span style={{ fontSize: 11, color: cardMuted, fontStyle: "italic" }}>
                    {canEdit ? "Not set — tap Edit to assign." : "Not set."}
                  </span>
                )}
              </div>
            );
          })()}

          {/* Email row */}
          {r.username && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px",
              borderBottom: `1px solid ${cardSubtleBorder}`,
            }}>
              <Mail size={11} color={cardMuted} />
              <span style={{ fontSize: 11, color: cardMuted }}>{r.username}</span>
            </div>
          )}

          {/* Extra staff fields — Employee Type, Phone (read-only; edit via pencil popup) */}
          {(displayEmpType || displayPhone || r.employeeId) && (
            <div style={{ padding: "6px 14px", borderBottom: `1px solid ${cardSubtleBorder}` }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {displayEmpType && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: cardMuted,
                    background: cardSubtleBorder, borderRadius: 4,
                    padding: "2px 7px", textTransform: "uppercase", letterSpacing: 0.4,
                  }}>{displayEmpType}</span>
                )}
                {displayPhone && (
                  <span style={{ fontSize: 11, color: cardMuted, display: "flex", alignItems: "center", gap: 4 }}>
                    <Phone size={11} color={cardMuted} />{displayPhone}
                  </span>
                )}
                {r.employeeId && (
                  <span style={{ fontSize: 11, color: cardMuted }}>ID: {r.employeeId}</span>
                )}
              </div>
            </div>
          )}

          {/* Skills & Experience Tags — read-only; edit via pencil popup */}
          {(pgSkills.length > 0 || pgTags.length > 0) && (
            <div
              style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${cardSubtleBorder}`,
                display: "flex", flexDirection: "column", gap: 12,
              }}>
              {/* ── Skills ── */}
              {pgSkills.length > 0 && (
                <div>
                  <div style={{ marginBottom: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: cardMuted,
                      letterSpacing: 1.1, textTransform: "uppercase",
                    }}>Skills</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {pgSkills.map(s => (
                      <div key={s.id} style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 9px", borderRadius: 999,
                        border: `1px solid ${cardSubtleBorder}`,
                        backgroundColor: "#F5F7FA",
                      }}>
                        {s.isPrimary && <span style={{ fontSize: 9, color: BRAND.green, fontWeight: 900 }}>★</span>}
                        <span style={{ fontSize: 11, fontWeight: 600, color: cardText }}>{s.skillName}</span>
                        {s.proficiency != null && (
                          <span style={{ fontSize: 10, color: cardMuted }}>· {s.proficiency}/5</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Experience Tags ── */}
              {pgTags.length > 0 && (
                <div>
                  <div style={{ marginBottom: 6 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: cardMuted,
                      letterSpacing: 1.1, textTransform: "uppercase",
                    }}>Experience Tags</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {pgTags.map(t => (
                      <span key={t.id} style={{
                        fontSize: 11, fontWeight: 600,
                        padding: "3px 9px", borderRadius: 999,
                        backgroundColor: BRAND.green + "18",
                        color: BRAND.green,
                        border: `1px solid ${BRAND.green}30`,
                      }}>
                        {t.tagName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stats row — each tile is its own button. Clicking opens the
              StaffUtilModal in the matching mode (all projects / active
              only / allocation breakdown). */}
          <div style={{
            display: "flex", gap: 6,
            padding: "10px 14px",
            borderBottom: `1px solid ${cardSubtleBorder}`,
          }}>
            <button
              onClick={(e) => { e.stopPropagation(); openModal("all"); }}
              aria-label={`Show all ${r.totalProjects} projects`}
              style={{
                flex: 1, backgroundColor: "#F5F7FA", borderRadius: 4,
                padding: "8px 4px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, border: "none", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: cardText, lineHeight: 1 }}>{r.totalProjects}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: cardMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>Total Projects</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openModal("active"); }}
              aria-label={`Show ${projectCount} currently active projects`}
              style={{
                flex: 1, backgroundColor: "#F5F7FA", borderRadius: 4,
                padding: "8px 4px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, border: "none", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: cardText, lineHeight: 1 }}>{projectCount}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: cardMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>Currently Active</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openModal("allocation"); }}
              aria-label={`Show allocation breakdown · ${r.currentPct}%`}
              style={{
                flex: 1, backgroundColor: "#F5F7FA", borderRadius: 4,
                padding: "8px 4px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, border: "none", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: status.color, lineHeight: 1 }}>{Number(r.currentPct.toFixed(2))}%</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: cardMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>Allocated</div>
            </button>
          </div>

        </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

function AvailabilityDetailModal({
  resource,
  availability,
  onClose,
}: {
  resource: LiveResourceProxy;
  availability: AvailWindow;
  onClose: () => void;
}) {
  const isOut = availability.availabilityPct <= 0;
  const leaveType = availability.leaveType?.trim() || (isOut ? "PTO / Leave" : "Reduced availability");
  const availabilityLabel = availPctLabel(availability.availabilityPct);
  const detailRows = [
    { label: "Person", value: resource.name },
    { label: "Dates", value: fmtAvailRange(availability.startDate, availability.endDate) },
    { label: "Leave type", value: leaveType },
    { label: "Availability", value: availabilityLabel },
    ...(availability.reason?.trim() ? [{ label: "Reason", value: availability.reason.trim() }] : []),
  ];

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 18, background: "rgba(15,23,42,0.55)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="availability-detail-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)", borderRadius: 16,
          background: "#FFFFFF", boxShadow: "0 24px 64px rgba(0,0,0,0.30)",
          overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "15px 18px", borderBottom: "1px solid #E5EAEF",
          background: isOut ? "#FFF7ED" : "#F8FAFC",
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isOut ? "#FDE9D9" : "#E2E8F0",
            color: isOut ? "#C2410C" : "#64748B",
          }}>
            <Calendar size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="availability-detail-title" style={{ color: "#253746", fontSize: 16, fontWeight: 800 }}>
              {leaveType} details
            </div>
            <div style={{ color: "#6B7E8A", fontSize: 12, marginTop: 2 }}>
              Availability record for {resource.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close availability details"
            style={{
              width: 30, height: 30, borderRadius: 15, border: "none",
              background: "#EEF2F5", color: "#6B7E8A",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: "16px 18px 18px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "6px 10px", borderRadius: 999, marginBottom: 14,
            background: isOut ? "#FEE2E2" : "#FFF7ED",
            color: isOut ? "#B91C1C" : "#C2410C",
            fontSize: 12, fontWeight: 800,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor" }} />
            {availabilityLabel}
          </div>
          <div style={{ border: "1px solid #E5EAEF", borderRadius: 12, overflow: "hidden" }}>
            {detailRows.map((row, index) => (
              <div
                key={row.label}
                style={{
                  display: "flex", alignItems: "baseline", gap: 12,
                  padding: "11px 13px",
                  borderTop: index === 0 ? "none" : "1px solid #E5EAEF",
                  background: index % 2 === 0 ? "#FFFFFF" : "#F9FAFB",
                }}
              >
                <span style={{ minWidth: 94, flexShrink: 0, color: "#6B7E8A", fontSize: 11, fontWeight: 700 }}>
                  {row.label}
                </span>
                <span style={{ color: "#253746", fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%", marginTop: 16, padding: "10px 14px",
              borderRadius: 9, border: "1px solid #CBD5E1",
              background: "#FFFFFF", color: "#253746",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProfileModal({
  r, pName, onClose, onProjectClick, onAssignMember,
}: {
  r: LiveResourceProxy;
  pName: (pid: string) => string;
  onClose: () => void;
  onProjectClick: (pid: string) => void;
  onAssignMember: () => void;
}) {
  const { pos: dragPos, onDragStart } = useDraggable();
  const { user } = useAuth();
  const status = statusInfo(r.currentPct);
  const ini = initialsOf(r.name);
  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";

  // Fetch Postgres-stored skills and experience tags when the modal opens
  const [pgSkills, setPgSkills] = useState<{ id: number; skillName: string; proficiency: number | null; isPrimary: boolean }[]>([]);
  const [pgTags, setPgTags] = useState<{ id: number; tagName: string }[]>([]);
  useEffect(() => {
    if (!r.id) return;
    getUserSkills(r.id).then(setPgSkills).catch(() => {});
    getUserExperienceTags(r.id).then(setPgTags).catch(() => {});
  }, [r.id]);

  const resumeExtraSummary: ResumeExtraSummary = {
    role: (r.roleName || "").trim() || null,
    jobTitle: (r.role || "").trim() || null,
    businessUnit: (r.businessUnit || "").trim() || null,
    division: (r.divisionName || "").trim() || null,
    department: (r.departmentName || "").trim() || null,
    startDate: fmtStaffDate(r.startDate) || null,
    endDate: fmtStaffDate(r.endDate) || null,
    lastActiveDate: r.lastActiveDate || null,
    currentCapacityPct: r.currentPct,
    tenantName: user?.tenant || null,
    activeAllocations: r.activeAllocations.map(a => ({
      projectId: a.projectId,
      projectName: pName(a.projectId),
      pct: a.pct,
      startDate: a.startDate,
      endDate: a.endDate,
    })),
    employeeType: r.employeeType || null,
    employeeId: r.employeeId || null,
    phoneNumber: r.phoneNumber || null,
    skills: pgSkills.map(s => ({ skillName: s.skillName, proficiency: s.proficiency })),
    experienceTags: pgTags.map(t => t.tagName),
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 780,
          backgroundColor: "#FFFFFF",
          borderRadius: 20,
          maxHeight: "92vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
          transform: `translate(${dragPos.x}px, ${dragPos.y}px)`,
        }}
      >

        {/* Header */}
        <div onMouseDown={onDragStart} style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "14px 18px 12px",
          cursor: "grab", userSelect: "none",
          borderBottom: `1px solid ${cardSubtleBorder}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: cardText }}>
              Resource Profile
            </div>
            <div style={{ fontSize: 12, color: cardMuted, marginTop: 2 }}>
              {r.name}{r.role ? ` · ${r.role}` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 14, border: "none",
              backgroundColor: "#F0F3F6",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={14} color={cardMuted} />
          </button>
        </div>

        {/* Scrollable body — two-column layout: identity/stats left, detail right */}
        <div style={{
          overflow: "auto", padding: "18px 20px 22px",
          display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
          columnGap: 22, alignItems: "start",
        }}>
          {/* LEFT column — identity, actions, stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>

          {/* Hero block */}
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          }}>
            <div style={{ position: "relative", marginBottom: 4 }}>
              <div style={{
                width: 84, height: 84, borderRadius: 42,
                backgroundColor: status.color + "20",
                border: `2px solid ${status.color}60`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: status.color, fontSize: 26, fontWeight: 700,
              }}>{ini}</div>
              {r.id && (
                <div style={{ position: "absolute", top: -4, right: -4 }}>
                  <ResumeDownloadButton
                    guid={r.id}
                    fallbackName={r.name}
                    fallbackEmail={r.username}
                    resumeExtraSummary={resumeExtraSummary}
                  />
                </div>
              )}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: cardText, textAlign: "center" }}>
              {r.name}
            </div>
            {r.role && (
              <div style={{ fontSize: 13, color: cardMuted, textAlign: "center" }}>{r.role}</div>
            )}
            {r.username && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                <Mail size={12} color={cardMuted} />
                <span style={{ fontSize: 12, color: cardMuted, wordBreak: "break-all", textAlign: "center" }}>
                  {r.username}
                </span>
              </div>
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              backgroundColor: status.color + "18",
              padding: "4px 10px", borderRadius: 999,
              marginTop: 6,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status.color }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: status.color, letterSpacing: 0.6 }}>
                {status.label}
              </span>
            </div>
            {r.id && (
              <div style={{ marginTop: 10 }}>
                <ResumeDownloadButton
                  guid={r.id}
                  fallbackName={r.name}
                  fallbackEmail={r.username}
                  resumeExtraSummary={resumeExtraSummary}
                  variant="labeled"
                />
              </div>
            )}
          </div>

          {/* Reuses the Quick Actions "Add to project" flow with this person seeded. */}
          <button
            onClick={onAssignMember}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%",
              padding: "11px 0", borderRadius: 10, border: "none",
              backgroundColor: BRAND.greenBg, color: BRAND.white,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            <UserPlus size={14} />
            Assign {r.name}
          </button>

          {/* Stats row */}
          <div style={{
            display: "flex", alignItems: "stretch",
            border: `1px solid ${cardSubtleBorder}`, borderRadius: 12,
            backgroundColor: "#F9FAFB",
          }}>
            <div style={{ flex: 1, padding: "12px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: status.color }}>{Number(r.currentPct.toFixed(2))}%</div>
              <div style={{ fontSize: 10, color: cardMuted }}>Current Load</div>
            </div>
            <div style={{ width: 1, backgroundColor: cardSubtleBorder }} />
            <div style={{ flex: 1, padding: "12px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: cardText }}>{r.totalProjects}</div>
              <div style={{ fontSize: 10, color: cardMuted }}>Total Projects</div>
            </div>
            <div style={{ width: 1, backgroundColor: cardSubtleBorder }} />
            <div style={{ flex: 1, padding: "12px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: cardText }}>{r.activeProjects.length}</div>
              <div style={{ fontSize: 10, color: cardMuted }}>Active Now</div>
            </div>
          </div>

          </div>{/* /LEFT column */}

          {/* RIGHT column — org, capacity, personal, skills, allocations */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>

          {/* Organization & employment — every field imported from the Staff file. */}
          {(() => {
            const bu = (r.businessUnit || "").trim();
            const div = (r.divisionName || "").trim();
            const rows: { label: string; value: string }[] = [
              { label: "Business Unit", value: bu },
              { label: "Division", value: getBusinessRules().showDivision && div && div !== bu ? div : "" },
              { label: "Department", value: (r.departmentName || "").trim() },
              { label: "Role", value: (r.roleName || "").trim() },
              { label: "Job Title", value: (r.role || "").trim() },
              { label: "Start Date", value: fmtStaffDate(r.startDate) },
              { label: "End Date", value: fmtStaffDate(r.endDate) },
            ].filter(f => f.value);
            if (rows.length === 0) return null;
            return (
              <div>
                <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                  ORGANIZATION &amp; EMPLOYMENT
                </div>
                <div style={{
                  border: `1px solid ${cardSubtleBorder}`, borderRadius: 12, overflow: "hidden",
                }}>
                  {rows.map((f, i) => (
                    <div key={f.label} style={{
                      display: "flex", alignItems: "baseline", gap: 10,
                      padding: "9px 12px",
                      borderTop: i === 0 ? "none" : `1px solid ${cardSubtleBorder}`,
                      backgroundColor: i % 2 === 0 ? "#FFFFFF" : "#F9FAFB",
                    }}>
                      <span style={{ fontSize: 11, color: cardMuted, minWidth: 96, flexShrink: 0 }}>{f.label}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: cardText, wordBreak: "break-word" }}>{f.value}</span>
                    </div>
                  ))}
                  <div style={{ padding: "6px 12px 10px", borderTop: `1px solid ${cardSubtleBorder}` }}>
                    <StaffRatesRow
                      roleId={r.roleId} roleName={r.roleName}
                      departmentId={r.departmentId}
                      cardSubtleBorder={cardSubtleBorder} cardMuted={cardMuted} cardText={cardText}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Capacity */}
          <div>
            <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
              CAPACITY
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                flex: 1, height: 8, borderRadius: 4,
                backgroundColor: "#F0F3F6", overflow: "hidden", display: "flex",
              }}>
                <div style={{
                  width: `${Math.min(r.currentPct, 100)}%`, height: "100%",
                  backgroundColor: status.color,
                }} />
                {r.currentPct > 100 && (
                  <div style={{
                    width: `${Math.min(r.currentPct - 100, 20)}%`, height: "100%",
                    backgroundColor: BRAND.red,
                  }} />
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: status.color, minWidth: 42, textAlign: "right" }}>
                {Number(r.currentPct.toFixed(2))}%
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 9, color: cardMuted }}>0%</span>
              <span style={{ fontSize: 9, color: cardMuted }}>50%</span>
              <span style={{ fontSize: 9, color: cardMuted }}>100%</span>
            </div>
          </div>

          {/* Personal details — Employee Type / ID / Phone */}
          {(r.employeeType || r.employeeId || r.phoneNumber) && (
            <div>
              <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                PERSONAL DETAILS
              </div>
              <div style={{ border: `1px solid ${cardSubtleBorder}`, borderRadius: 12, overflow: "hidden" }}>
                {[
                  { label: "Employee Type", value: r.employeeType },
                  { label: "Employee ID",   value: r.employeeId },
                  { label: "Phone",         value: r.phoneNumber },
                ].filter(f => f.value).map((f, i) => (
                  <div key={f.label} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px",
                    borderTop: i === 0 ? "none" : `1px solid ${cardSubtleBorder}`,
                    backgroundColor: i % 2 === 0 ? "#FFFFFF" : "#F9FAFB",
                  }}>
                    <span style={{ fontSize: 11, color: cardMuted, minWidth: 96, flexShrink: 0 }}>{f.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: cardText }}>{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills from Postgres */}
          {pgSkills.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                SKILLS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pgSkills.map(s => (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 999,
                    border: `1px solid ${cardSubtleBorder}`,
                    backgroundColor: "#F5F7FA",
                  }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: cardText }}>{s.skillName}</span>
                    {s.proficiency != null && (
                      <span style={{ fontSize: 10, color: cardMuted }}>· {s.proficiency}/5</span>
                    )}
                    {s.isPrimary && (
                      <span style={{ fontSize: 9, fontWeight: 900, color: BRAND.green }}>★</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Experience tags from Postgres */}
          {pgTags.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                EXPERIENCE TAGS
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pgTags.map(t => (
                  <span key={t.id} style={{
                    fontSize: 11, fontWeight: 600,
                    padding: "3px 10px", borderRadius: 999,
                    backgroundColor: BRAND.green + "18",
                    color: BRAND.green,
                    border: `1px solid ${BRAND.green}30`,
                  }}>{t.tagName}</span>
                ))}
              </div>
            </div>
          )}

          {/* Active allocations */}
          {r.activeAllocations.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                ACTIVE ALLOCATIONS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {r.activeAllocations.map((a) => {
                  const prefix = a.projectId.split("-")[0];
                  const prefixColor = prefix === "PMM" ? BRAND.green
                    : prefix === "OPM" ? BRAND.orange
                    : prefix === "LEM" ? BRAND.greenLight
                    : cardMuted;
                  const name = pName(a.projectId);
                  return (
                    <button
                      key={a.projectId}
                      onClick={() => onProjectClick(a.projectId)}
                      style={{
                        textAlign: "left", padding: "10px 12px", borderRadius: 10,
                        backgroundColor: "#F9FAFB",
                        border: `1px solid ${cardSubtleBorder}`,
                        cursor: "pointer",
                        display: "flex", flexDirection: "column", gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: prefixColor,
                          backgroundColor: prefixColor + "18",
                          padding: "2px 6px", borderRadius: 4, letterSpacing: 0.5,
                        }}>{prefix}</span>
                        <span style={{
                          flex: 1, fontSize: 12, color: cardText, fontWeight: 600,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{name !== a.projectId ? name : a.projectId}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.green }}>{+a.pct.toFixed(2)}%</span>
                      </div>
                      <div style={{ fontSize: 10, color: cardMuted }}>
                        {name !== a.projectId ? `${a.projectId} · ` : ""}{a.startDate} → {a.endDate}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* History */}
          {r.lastActiveDate && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                HISTORY
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 12px", borderRadius: 10,
                backgroundColor: "#F9FAFB",
                border: `1px solid ${cardSubtleBorder}`,
              }}>
                <Calendar size={13} color={cardMuted} />
                <span style={{ fontSize: 12, color: cardText }}>
                  Last active: {r.lastActiveDate}
                </span>
              </div>
            </div>
          )}

          </div>{/* /RIGHT column */}

        </div>
      </div>
    </div>
  );
}

function AIAnalysisModal({
  name, subtitle, prompt, clickedPeriod, ganttProjects = [], qRange, onClose,
}: {
  name: string;
  subtitle: string;
  prompt: string;
  clickedPeriod?: string;
  ganttProjects?: { projectId: string; name: string; startDate: string; endDate: string; pct: number }[];
  qRange?: { sd: string; ed: string };
  onClose: () => void;
}) {
  /* Format "Apr-20-26" → "4/20" */
  const weekShort = (() => {
    if (!clickedPeriod) return null;
    const m = clickedPeriod.match(/^([A-Z][a-z]{2})-(\d{1,2})-/);
    if (!m) return clickedPeriod;
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(m[1]) + 1;
    return mo ? `${mo}/${m[2]}` : clickedPeriod;
  })();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";
  const accentColor = BRAND.green;

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setText("");
    setError(null);
    setLoading(true);
    (async () => {
      try {
        await chatStream(
          [{ role: "user", content: prompt }],
          (e) => {
            if (e.type === "token" || e.type === "content") {
              setText((t) => t + e.text);
              setLoading(false);
            } else if (e.type === "error") {
              setError(e.message);
              setLoading(false);
            } else if (e.type === "done") {
              setLoading(false);
            }
          },
          ctrl.signal,
        );
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to analyze");
          setLoading(false);
        }
      }
    })();
    return () => { ctrl.abort(); };
  }, [prompt]);

  // Strip widget tags the AI may emit.
  const clean = text
    .replace(/\[(?:WEEKLY_ALLOC|BUTTONS|ROSTER_TABLE|LIFECYCLE_PICKER|SCHEDULE_TABLE|PROJECT_DATES|SELECT_PROJECT|PMM_TABLE|OPP_TABLE|PERSON_PROFILE|PROJECT_PROFILE|FORECAST_TABLE|CAPACITY_HEATMAP)[^\]]*\]/g, "")
    .replace(/^\s*\[[A-Z_]+\]\s*$/gm, "");

  // Parse structured STATUS / HEADLINE / DRIVER / TREND / INSIGHT / REC / SUGGEST lines.
  const parsed = useMemo(() => {
    const fields: Record<string, string> = {};
    for (const raw of clean.split("\n")) {
      const m = raw.match(/^\s*(STATUS|HEADLINE|DRIVER|TREND|INSIGHT|REC|SUGGEST)\s*:\s*(.*)$/i);
      if (m) {
        const key = m[1].toUpperCase();
        const val = m[2].trim().replace(/^[-*•]\s*/, "").replace(/\*\*/g, "");
        if (val) fields[key] = val;
      }
    }
    const statusRaw = (fields.STATUS || "").toLowerCase();
    const status: "over" | "under" | "healthy" | null =
      statusRaw.startsWith("over") ? "over"
      : statusRaw.startsWith("under") ? "under"
      : statusRaw.startsWith("healthy") || statusRaw.startsWith("balanced") || statusRaw.startsWith("ok") ? "healthy"
      : null;
    return { status, ...fields } as {
      status: "over" | "under" | "healthy" | null;
      HEADLINE?: string; DRIVER?: string; TREND?: string; INSIGHT?: string; REC?: string; SUGGEST?: string;
    };
  }, [clean]);

  const statusTheme =
    parsed.status === "over"
      ? { bg: "#FFEDD5", fg: "#C2410C", label: "OVER-ALLOCATED", icon: <Flame size={14} /> }
      : parsed.status === "under"
      ? { bg: "#FEE2E2", fg: BRAND.redDeep, label: "UNDER-UTILIZED", icon: <TrendingDown size={14} /> }
      : parsed.status === "healthy"
      ? { bg: "#DCFCE7", fg: "#15803D", label: "HEALTHY", icon: <Check size={14} /> }
      : null;
  const headerAccent = statusTheme?.fg ?? accentColor;

  const sectionRows: { key: string; icon: React.ReactNode; tint: string; label: string; value: string | undefined }[] = [
    { key: "DRIVER", icon: <Zap size={14} />, tint: "#F59E0B", label: "What's driving it", value: parsed.DRIVER },
    { key: "TREND", icon: <Activity size={14} />, tint: "#3B82F6", label: "Trend", value: parsed.TREND },
    { key: "INSIGHT", icon: <Sparkles size={14} />, tint: "#8B5CF6", label: "Insight", value: parsed.INSIGHT },
  ];
  const anyParsed = parsed.HEADLINE || parsed.DRIVER || parsed.TREND || parsed.INSIGHT || parsed.REC || statusTheme;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "14px 18px 12px",
          borderBottom: `1px solid ${cardSubtleBorder}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, color: headerAccent, letterSpacing: 0.8,
              textTransform: "uppercase", marginBottom: 4,
            }}>AI Allocation Analysis</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: cardText, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {name}
              {weekShort && (
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", backgroundColor: headerAccent, borderRadius: 6, padding: "2px 8px" }}>
                  Week {weekShort}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: cardMuted, marginTop: 2 }}>
              {subtitle}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 14, border: "none",
              backgroundColor: "#F0F3F6",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <X size={14} color={cardMuted} />
          </button>
        </div>

        {/* Gantt chart — project timeline for the quarter */}
        {ganttProjects.length > 0 && qRange && (() => {
          const qStartMs = new Date(qRange.sd).getTime();
          const qEndMs   = new Date(qRange.ed).getTime();
          const span     = qEndMs - qStartMs || 1;
          const BAR_COLORS = [BRAND.green, "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];

          /* Month tick marks */
          const monthTicks: { label: string; pct: number }[] = [];
          const cursor = new Date(qRange.sd);
          cursor.setDate(1);
          if (cursor.getTime() < qStartMs) cursor.setMonth(cursor.getMonth() + 1);
          while (cursor.getTime() <= qEndMs) {
            const pct = ((cursor.getTime() - qStartMs) / span) * 100;
            if (pct >= 0 && pct <= 100) monthTicks.push({ label: cursor.toLocaleString("en-US", { month: "short" }), pct });
            cursor.setMonth(cursor.getMonth() + 1);
          }

          return (
            <div style={{ padding: "10px 20px 12px", borderBottom: `1px solid ${cardSubtleBorder}` }}>
              <style>{`
                @keyframes rmoneGanttGrow {
                  from { transform: scaleX(0); opacity: 0; }
                  to   { transform: scaleX(1); opacity: 1; }
                }
                @keyframes rmoneGanttShimmer {
                  0%   { background-position: -200% 0; }
                  100% { background-position:  200% 0; }
                }
              `}</style>
              <div style={{
                fontSize: 10, fontWeight: 800, color: cardMuted,
                letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 5,
              }}>Project Timeline</div>

              {/* Month ruler */}
              <div style={{ position: "relative", marginLeft: 148, height: 14, marginBottom: 3 }}>
                {monthTicks.map(t => (
                  <div key={t.label} style={{
                    position: "absolute", left: `${t.pct}%`,
                    transform: "translateX(-50%)",
                    fontSize: 10, fontWeight: 700, color: cardMuted,
                  }}>{t.label}</div>
                ))}
              </div>

              {/* Rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ganttProjects.map((proj, i) => {
                  const s   = new Date(proj.startDate).getTime();
                  const e   = new Date(proj.endDate).getTime();
                  const l   = Math.max(0, Math.min(100, ((s - qStartMs) / span) * 100));
                  const w   = Math.max(3, Math.min(100 - l, ((e - s) / span) * 100));
                  const col = BAR_COLORS[i % BAR_COLORS.length];
                  /* Prefer the real name; only show ID as fallback */
                  const nameIsId = !proj.name || proj.name === proj.projectId;
                  const displayName = nameIsId ? proj.projectId : proj.name;
                  const shortName = displayName.length > 22 ? displayName.slice(0, 20) + "…" : displayName;
                  /* Date label: "Apr 20 – Jun 30" */
                  const fmtD = (d: string) => {
                    const dt = new Date(d);
                    return dt.toLocaleString("en-US", { month: "short", day: "numeric" });
                  };
                  const barStart = s < qStartMs ? qRange.sd : proj.startDate;
                  const barEnd   = e > qEndMs   ? qRange.ed : proj.endDate;
                  return (
                    <div key={proj.projectId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Name label */}
                      <div style={{
                        width: 140, flexShrink: 0,
                        display: "flex", flexDirection: "column", alignItems: "flex-end",
                      }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: col,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }} title={displayName}>{shortName}</div>
                        {!nameIsId && (
                          <div style={{ fontSize: 9.5, color: cardMuted, whiteSpace: "nowrap" }}>
                            {proj.projectId}
                          </div>
                        )}
                      </div>

                      {/* Track */}
                      <div style={{
                        flex: 1, height: 20, borderRadius: 5,
                        backgroundColor: "#EEF1F5",
                        position: "relative", overflow: "hidden",
                      }}>
                        {/* Background grid lines at month boundaries */}
                        {monthTicks.slice(1).map(t => (
                          <div key={t.label} style={{
                            position: "absolute", left: `${t.pct}%`, top: 0, bottom: 0,
                            width: 1, backgroundColor: "rgba(0,0,0,0.06)",
                          }} />
                        ))}
                        {/* Bar — grows from transform-origin left */}
                        <div style={{
                          position: "absolute",
                          left: `${l}%`, width: `${w}%`,
                          top: 2, bottom: 2,
                          transformOrigin: "left center",
                          animation: `rmoneGanttGrow 0.55s cubic-bezier(0.22,1,0.36,1) ${i * 0.08}s both`,
                          borderRadius: 4,
                          background: `linear-gradient(90deg, ${col} 0%, ${col}cc 60%, ${col}ee 100%)`,
                          backgroundSize: "200% 100%",
                          display: "flex", alignItems: "center",
                          paddingLeft: 7, gap: 4, overflow: "hidden",
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 800, color: "#fff",
                            whiteSpace: "nowrap", flexShrink: 0,
                          }}>{+proj.pct.toFixed(2)}%</span>
                          <span style={{
                            fontSize: 9.5, color: "rgba(255,255,255,0.8)",
                            whiteSpace: "nowrap", overflow: "hidden",
                          }}>{fmtD(barStart)} – {fmtD(barEnd)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Body — structured streaming analysis */}
        <div style={{
          overflow: "auto",
          padding: "16px 20px 18px",
          fontSize: 14,
          lineHeight: 1.5,
          color: cardText,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          {error ? (
            <div style={{
              padding: "10px 12px", borderRadius: 8,
              backgroundColor: "#FEE2E2", color: BRAND.redDeep,
              fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <AlertTriangle size={16} /> {error}
            </div>
          ) : !anyParsed && loading ? (
            <div style={{ padding: "4px 0 2px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
                color: BRAND.green, textTransform: "uppercase",
              }}>
                <Sparkles size={14} className="rmone-pulse" />
                <span>RM ONE agents are evaluating</span>
                <span className="rmone-dots" style={{ color: BRAND.green, fontSize: 16, fontWeight: 900, letterSpacing: 1 }}>
                  <span>.</span><span>.</span><span>.</span>
                </span>
              </div>
              {[
                { color: "#F59E0B", icon: <Zap size={12} />, label: "Allocation Agent", task: "scanning weekly load…" },
                { color: "#3B82F6", icon: <Activity size={12} />, label: "Trend Agent", task: "detecting patterns…" },
                { color: "#8B5CF6", icon: <Sparkles size={12} />, label: "Insight Agent", task: "finding capacity gaps…" },
                { color: BRAND.green, icon: <Lightbulb size={12} />, label: "Recommendation Agent", task: "drafting next moves…" },
              ].map((a, i) => (
                <div
                  key={a.label}
                  className="rmone-agent-row"
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 11px",
                    borderRadius: 10,
                    backgroundColor: "#F8FAFC",
                    border: `1px solid ${a.color}33`,
                    animationDelay: `${i * 0.15}s`,
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: `${a.color}22`,
                    color: a.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>{a.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 800, color: a.color,
                      letterSpacing: 0.5,
                    }}>{a.label}</div>
                    <div style={{ fontSize: 12, color: cardMuted, marginTop: 1 }}>{a.task}</div>
                  </div>
                  <div
                    className="rmone-agent-dot"
                    style={{
                      width: 8, height: 8, borderRadius: 4,
                      backgroundColor: a.color,
                      flexShrink: 0,
                      animationDelay: `${i * 0.2}s`,
                    }}
                  />
                </div>
              ))}
            </div>
          ) : !anyParsed ? (
            <span style={{ color: cardMuted }}>No analysis available.</span>
          ) : (
            <>
              {/* Status pill */}
              {statusTheme && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  alignSelf: "flex-start",
                  padding: "5px 11px",
                  borderRadius: 999,
                  backgroundColor: statusTheme.bg,
                  color: statusTheme.fg,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                }}>
                  {statusTheme.icon} {statusTheme.label}
                </div>
              )}

              {/* Headline */}
              {parsed.HEADLINE && (
                <div style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: cardText,
                  lineHeight: 1.4,
                }}>
                  {parsed.HEADLINE}
                </div>
              )}

              {/* Bullet rows */}
              {sectionRows.filter(r => r.value).map(r => (
                <div key={r.key} style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "9px 11px",
                  borderRadius: 10,
                  backgroundColor: "#F8FAFC",
                  border: `1px solid ${cardSubtleBorder}`,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 13,
                    backgroundColor: `${r.tint}22`,
                    color: r.tint,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>{r.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, color: r.tint,
                      letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 2,
                    }}>{r.label}</div>
                    <div style={{ fontSize: 13.5, color: cardText, lineHeight: 1.45 }}>
                      {r.value}
                    </div>
                  </div>
                </div>
              ))}

              {/* Recommendation — highlighted */}
              {parsed.REC && (
                <div style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "11px 13px",
                  borderRadius: 10,
                  background: `linear-gradient(135deg, ${headerAccent}18 0%, ${headerAccent}08 100%)`,
                  border: `1px solid ${headerAccent}55`,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: headerAccent,
                    color: "#FFFFFF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Lightbulb size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, color: headerAccent,
                      letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 2,
                    }}>Recommendation</div>
                    <div style={{ fontSize: 13.5, color: cardText, lineHeight: 1.45, fontWeight: 600 }}>
                      {parsed.REC}
                    </div>
                  </div>
                </div>
              )}

              {/* Suggested Projects (zero-alloc bench case) */}
              {parsed.SUGGEST && (
                <div style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  padding: "11px 13px",
                  borderRadius: 10,
                  background: "linear-gradient(135deg, #DCFCE718 0%, #DCFCE708 100%)",
                  border: "1px solid #16A34A44",
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: "#16A34A",
                    color: "#FFFFFF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Briefcase size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 800, color: "#16A34A",
                      letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 6,
                    }}>Also Suited For</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {parsed.SUGGEST.split(/\s*\|\s*/).map((proj, i) => (
                        <div key={i} style={{
                          fontSize: 12.5, color: cardText, lineHeight: 1.4,
                          paddingLeft: 8, borderLeft: "2px solid #16A34A55",
                        }}>{proj.trim()}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Streaming spinner footer while still loading */}
              {loading && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  color: cardMuted, fontSize: 12, marginTop: 2,
                }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: 6,
                    border: `2px solid ${headerAccent}`, borderTopColor: "transparent",
                    animation: "spin 0.8s linear infinite",
                  }} />
                  <span>Generating…</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 18px 14px",
          borderTop: `1px solid ${cardSubtleBorder}`,
          display: "flex", justifyContent: "flex-end",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              backgroundColor: headerAccent, color: "#FFFFFF",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >Close</button>
        </div>
      </div>
    </div>
  );
}

/* ── Lightweight gantt-only modal (no AI) used by staff-grid Allocation clicks ── */
function StaffGanttModal({
  name,
  subtitle,
  ganttProjects = [],
  qRange,
  onClose,
}: {
  name: string;
  subtitle: string;
  ganttProjects?: { projectId: string; name: string; startDate: string; endDate: string; pct: number }[];
  qRange?: { sd: string; ed: string };
  onClose: () => void;
}) {
  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 640,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "14px 18px 12px",
          borderBottom: `1px solid ${cardSubtleBorder}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, color: BRAND.green, letterSpacing: 0.8,
              textTransform: "uppercase", marginBottom: 4,
            }}>Project Allocation Timeline</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: cardText, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {name}
            </div>
            <div style={{ fontSize: 12, color: cardMuted, marginTop: 2 }}>{subtitle}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 14, border: "none",
              backgroundColor: "#F0F3F6",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <X size={14} color={cardMuted} />
          </button>
        </div>

        {/* Gantt chart — project timeline for the quarter */}
        {ganttProjects.length > 0 && qRange && (() => {
          const qStartMs = new Date(qRange.sd).getTime();
          const qEndMs   = new Date(qRange.ed).getTime();
          const span     = qEndMs - qStartMs || 1;
          const BAR_COLORS = [BRAND.green, "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];

          /* Month tick marks */
          const monthTicks: { label: string; pct: number }[] = [];
          const cursor = new Date(qRange.sd);
          cursor.setDate(1);
          if (cursor.getTime() < qStartMs) cursor.setMonth(cursor.getMonth() + 1);
          while (cursor.getTime() <= qEndMs) {
            const pct = ((cursor.getTime() - qStartMs) / span) * 100;
            if (pct >= 0 && pct <= 100) monthTicks.push({ label: cursor.toLocaleString("en-US", { month: "short" }), pct });
            cursor.setMonth(cursor.getMonth() + 1);
          }

          return (
            <div style={{ padding: "14px 20px 18px" }}>
              <style>{`
                @keyframes rmoneGanttGrow {
                  from { transform: scaleX(0); opacity: 0; }
                  to   { transform: scaleX(1); opacity: 1; }
                }
                @keyframes rmoneGanttShimmer {
                  0%   { background-position: -200% 0; }
                  100% { background-position:  200% 0; }
                }
              `}</style>
              <div style={{
                fontSize: 10, fontWeight: 800, color: cardMuted,
                letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 5,
              }}>Project Timeline</div>

              {/* Month ruler */}
              <div style={{ position: "relative", marginLeft: 148, height: 14, marginBottom: 3 }}>
                {monthTicks.map(t => (
                  <div key={t.label} style={{
                    position: "absolute", left: `${t.pct}%`,
                    transform: "translateX(-50%)",
                    fontSize: 10, fontWeight: 700, color: cardMuted,
                  }}>{t.label}</div>
                ))}
              </div>

              {/* Rows */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ganttProjects.map((proj, i) => {
                  const s   = new Date(proj.startDate).getTime();
                  const e   = new Date(proj.endDate).getTime();
                  const l   = Math.max(0, Math.min(100, ((s - qStartMs) / span) * 100));
                  const w   = Math.max(3, Math.min(100 - l, ((e - s) / span) * 100));
                  const col = BAR_COLORS[i % BAR_COLORS.length];
                  /* Prefer the real name; only show ID as fallback */
                  const nameIsId = !proj.name || proj.name === proj.projectId;
                  const displayName = nameIsId ? proj.projectId : proj.name;
                  const shortName = displayName.length > 22 ? displayName.slice(0, 20) + "…" : displayName;
                  /* Date label: "Apr 20 – Jun 30" */
                  const fmtD = (d: string) => {
                    const dt = new Date(d);
                    return dt.toLocaleString("en-US", { month: "short", day: "numeric" });
                  };
                  const barStart = s < qStartMs ? qRange.sd : proj.startDate;
                  const barEnd   = e > qEndMs   ? qRange.ed : proj.endDate;
                  return (
                    <div key={proj.projectId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Name label */}
                      <div style={{
                        width: 140, flexShrink: 0,
                        display: "flex", flexDirection: "column", alignItems: "flex-end",
                      }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: col,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }} title={displayName}>{shortName}</div>
                        {!nameIsId && (
                          <div style={{ fontSize: 9.5, color: cardMuted, whiteSpace: "nowrap" }}>
                            {proj.projectId}
                          </div>
                        )}
                      </div>

                      {/* Track */}
                      <div style={{
                        flex: 1, height: 20, borderRadius: 5,
                        backgroundColor: "#EEF1F5",
                        position: "relative", overflow: "hidden",
                      }}>
                        {/* Background grid lines at month boundaries */}
                        {monthTicks.slice(1).map(t => (
                          <div key={t.label} style={{
                            position: "absolute", left: `${t.pct}%`, top: 0, bottom: 0,
                            width: 1, backgroundColor: "rgba(0,0,0,0.06)",
                          }} />
                        ))}
                        {/* Bar — grows from transform-origin left */}
                        <div style={{
                          position: "absolute",
                          left: `${l}%`, width: `${w}%`,
                          top: 2, bottom: 2,
                          transformOrigin: "left center",
                          animation: `rmoneGanttGrow 0.55s cubic-bezier(0.22,1,0.36,1) ${i * 0.08}s both`,
                          borderRadius: 4,
                          background: `linear-gradient(90deg, ${col} 0%, ${col}cc 60%, ${col}ee 100%)`,
                          backgroundSize: "200% 100%",
                          display: "flex", alignItems: "center",
                          paddingLeft: 7, gap: 4, overflow: "hidden",
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 800, color: "#fff",
                            whiteSpace: "nowrap", flexShrink: 0,
                          }}>{+proj.pct.toFixed(2)}%</span>
                          <span style={{
                            fontSize: 9.5, color: "rgba(255,255,255,0.8)",
                            whiteSpace: "nowrap", overflow: "hidden",
                          }}>{fmtD(barStart)} – {fmtD(barEnd)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {ganttProjects.length === 0 && (
          <div style={{ padding: "30px 20px", textAlign: "center", color: cardMuted, fontSize: 13 }}>
            No active allocations to display.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color, icon }: {
  label: string; value: string; color: string; icon?: React.ReactNode;
}) {
  return (
    <div style={{
      flex: 1, padding: "8px 6px", borderRadius: 8,
      backgroundColor: "rgba(255,255,255,0.04)",
      border: `1px solid ${BRAND.cardBorder}`,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, display: "flex",
        alignItems: "center", gap: 3 }}>
        {icon}{value}
      </div>
      <div style={{ fontSize: 9, color: BRAND.textMuted, fontWeight: 700, letterSpacing: 0.6 }}>
        {label}
      </div>
    </div>
  );
}

function ConcentrationRiskModal({ name, pct, threshold, projectName, onClose }: {
  name: string; pct: number; threshold: number; projectName?: string; onClose: () => void;
}) {
  const excess = pct - threshold;
  const severity: "critical" | "high" | "moderate" = excess >= 50 ? "critical" : excess >= 20 ? "high" : "moderate";
  const accentColor = severity === "critical" ? "#EF4444" : severity === "high" ? BRAND.orange : "#F59E0B";
  const proj = projectName || "this project";

  const analysis = severity === "critical"
    ? `${name} is running ${pct}% of their capacity on a single engagement — ${excess}% above the ${threshold}% threshold. This is a critical single-point-of-failure. If ${proj} is paused, descoped, or delayed, the entire ${pct}% becomes instantly unallocated with no fallback engagement. At this concentration level, even a one-week hold creates measurable bench cost and delivery risk. Immediate diversification is recommended.`
    : severity === "high"
    ? `${name}'s ${pct}% allocation on ${proj} is ${excess}% above the ${threshold}% threshold. This level of concentration creates meaningful pipeline risk — a disruption to this single project leaves no active engagement to absorb their capacity. Securing a second allocation now, even a soft one, significantly reduces exposure.`
    : `${name} is at ${pct}% on ${proj}, ${excess}% above the ${threshold}% threshold. This is within a manageable range but warrants monitoring. A follow-on engagement or pipeline booking would de-risk the current concentration before it becomes critical.`;

  const actions = severity === "critical" ? [
    { icon: "🚨", title: "Assign a second project immediately", detail: `At ${pct}% concentration, a second billable engagement is not optional — prioritise a pipeline opportunity or internal project now to create a fallback.` },
    { icon: "🔄", title: `Reduce allocation below ${threshold}%`, detail: `Work with the project team to cap ${name}'s commitment and redirect the freed capacity to a second engagement, spreading risk across two projects.` },
    { icon: "📞", title: "Soft-allocate to next pipeline project", detail: "Create a forward soft-allocation today so the follow-on engagement is tracked, management is aligned, and the transition is planned." },
    { icon: "⚠️", title: "Escalate to leadership", detail: `A ${pct}% single-project concentration is a critical exposure — flag for management awareness and agree a contingency plan if the project pauses.` },
  ] : severity === "high" ? [
    { icon: "📋", title: "Book a second engagement", detail: `Target a pipeline opportunity or internal project to absorb ${excess}% of ${name}'s capacity as a buffer against this project's risk.` },
    { icon: "🔄", title: "Spread hours across two roles", detail: `Reduce commitment on ${proj} below the ${threshold}% threshold and redirect remaining capacity to a second engagement.` },
    { icon: "📞", title: "Confirm a pipeline booking", detail: "If a follow-on project is expected, make a soft allocation now so the dependency is tracked before it becomes urgent." },
    { icon: "⚠️", title: "Flag for management review", detail: `${name} is a single-project dependency — ensure leadership has a contingency plan if ${proj} pauses or reduces scope.` },
  ] : [
    { icon: "📋", title: "Plan a follow-on engagement", detail: `Track ${proj}'s timeline and identify a follow-on before the concentration grows — acting early keeps options open.` },
    { icon: "🔄", title: "Consider distributing hours", detail: `If capacity allows, spreading ${name}'s hours across two projects reduces concentration and keeps the portfolio healthier.` },
    { icon: "📞", title: "Soft-allocate to pipeline", detail: "A soft allocation on an upcoming opportunity locks in the next engagement and prevents a bench gap at project close." },
  ];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: Z.POPUP_CHILD,
      backgroundColor: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: "#FFFFFF", borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
        width: "100%", maxWidth: 480,
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${accentColor}18, ${accentColor}06)`,
          borderBottom: `1px solid ${accentColor}28`,
          padding: "18px 20px 14px",
          display: "flex", alignItems: "flex-start", gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            backgroundColor: accentColor + "22",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <AlertTriangle size={20} color={accentColor} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#253746" }}>Concentration Risk</div>
            <div style={{ fontSize: 12, color: "#6B7E8A", marginTop: 2 }}>
              <strong style={{ color: "#253746" }}>{name}</strong> is at <strong style={{ color: accentColor }}>{pct}%</strong> on a single project
              {projectName ? <> (<em>{projectName}</em>)</> : ""} — above the <strong>{threshold}%</strong> threshold.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#6B7E8A", lineHeight: 1 }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* AI Analysis */}
          <div style={{ padding: "14px 20px 0" }}>
            <div style={{
              background: "linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 100%)",
              border: "1px solid #BFDBFE", borderRadius: 10, padding: "11px 13px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: "#1D4ED8" }}>✦</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1D4ED8", letterSpacing: 0.7 }}>AI ANALYSIS</span>
                <span style={{
                  padding: "1px 7px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                  backgroundColor: accentColor + "1A", color: accentColor,
                  letterSpacing: 0.4, textTransform: "uppercase",
                }}>{severity}</span>
              </div>
              <div style={{ fontSize: 12, color: "#1E3A5F", lineHeight: 1.65 }}>{analysis}</div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: "12px 20px 4px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7E8A", letterSpacing: 0.5, marginBottom: 8 }}>RECOMMENDED ACTIONS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {actions.map((a) => (
                <div key={a.title} style={{
                  display: "flex", gap: 10, padding: "9px 12px", borderRadius: 10,
                  backgroundColor: "#F5F7FA", border: "1px solid #E5EAEF",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.3 }}>{a.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#253746" }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: "#6B7E8A", marginTop: 2, lineHeight: 1.4 }}>{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px 16px", display: "flex", justifyContent: "flex-end",
          flexShrink: 0, borderTop: "1px solid #F1F4F7",
        }}>
          <button onClick={onClose} style={{
            padding: "9px 22px", borderRadius: 8, border: "none",
            backgroundColor: accentColor, color: "#FFFFFF",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function UrgentDemandModal({ role, projectName, daysUntilStart, urgencyDays, allocation, isSoft, onClose }: {
  role: string; projectName: string; daysUntilStart: number | null;
  urgencyDays: number; allocation: number; isSoft: boolean; onClose: () => void;
}) {
  const isOverdue = daysUntilStart !== null && daysUntilStart < 0;
  const overdueDays = isOverdue ? Math.abs(daysUntilStart!) : 0;
  const timeLabel = isOverdue
    ? `Started ${overdueDays} day(s) ago`
    : daysUntilStart !== null
      ? `Starts in ${daysUntilStart} day(s)`
      : "Start date unknown";

  const severity: "critical" | "high" | "moderate" =
    (isOverdue && allocation > 100) || overdueDays > 60 ? "critical"
    : isOverdue || (daysUntilStart !== null && daysUntilStart <= Math.round(urgencyDays / 2)) ? "high"
    : "moderate";

  const accentColor = severity === "critical" ? "#EF4444" : severity === "high" ? BRAND.redDeep : BRAND.orange;

  const analysis = severity === "critical"
    ? `This ${role} position on ${projectName} started ${overdueDays} day(s) ago at ${allocation}% ${isSoft ? "soft " : ""}allocation — the project has been operating without this resource for over ${overdueDays > 60 ? "two months" : "a month"}. The critical path is almost certainly compressed, and the team is absorbing the gap through workarounds or overtime. Without immediate action, delivery risk escalates with every passing day. Emergency staffing or scope negotiation is required now.`
    : severity === "high"
    ? `This ${role} is needed on ${projectName} ${isOverdue ? `and the start date passed ${overdueDays} day(s) ago` : `within the next ${daysUntilStart} day(s)`} at ${allocation}% ${isSoft ? "soft " : ""}allocation. The window to fill this role without impacting the project is closing fast. Internal sourcing should be running in parallel with external options today — waiting for a single hire path is too slow given the timeline.`
    : `A ${role} is needed on ${projectName} within the ${urgencyDays}-day urgency window at ${allocation}% ${isSoft ? "soft " : ""}allocation. There is still time to fill this through standard channels, but the clock is running. Begin internal sourcing now — waiting until the deadline risks converting this from a manageable gap into a critical one.`;

  const actions = severity === "critical" ? [
    { icon: "🚨", title: "Emergency internal sourcing", detail: `Immediately scan the Staff roster for ${role} capacity — any partial match available now reduces risk while a full hire is sourced.` },
    { icon: "🤖", title: "Run Find Staff AI now", detail: "Use the 'Find Staff AI' button on this card to surface AI-matched candidates by role, availability, and project fit — fastest path to a shortlist." },
    { icon: "📣", title: "Expedite external hire", detail: `With ${overdueDays} days already past, open an external posting immediately — lead time for recruitment must be factored into the project recovery plan.` },
    { icon: "📋", title: "Negotiate scope or timeline", detail: `Engage the project team now: at ${allocation}% allocation overdue by ${overdueDays} days, a scope or schedule adjustment may be the most pragmatic risk mitigation.` },
  ] : severity === "high" ? [
    { icon: "🔍", title: "Scan Staff roster for available capacity", detail: `Filter Staff by ${role} and look for people under-allocated who can be redeployed — this is the fastest path to filling the gap.` },
    { icon: "🤖", title: "Use Find Staff AI", detail: "Click the 'Find Staff AI' button on this demand card to get AI-matched candidates based on role, availability, and skills." },
    { icon: "📣", title: "Open an external posting in parallel", detail: `Don't wait for internal sourcing to close — with ${daysUntilStart !== null ? `${daysUntilStart} days` : "limited time"} remaining, run both paths simultaneously.` },
    { icon: "📋", title: "Review the project timeline", detail: `If staffing cannot be confirmed in the next few days, work with the project team on a contingency start date to protect delivery.` },
  ] : [
    { icon: "🔍", title: "Search the Staff roster", detail: `Filter Staff by role and capacity to identify people currently under-allocated who could fill this ${role} need.` },
    { icon: "🤖", title: "Use Find Staff AI", detail: "Click the 'Find Staff AI' button on this demand card to get AI-matched candidates based on role, availability, and skills." },
    { icon: "📣", title: "Post an open position", detail: "If no internal match exists, initiate a recruitment request now — allowing lead time before the start date." },
    { icon: "📋", title: "Confirm the project timeline", detail: `Verify the ${allocation}% allocation start date with the project team to ensure it reflects the current schedule.` },
  ];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: Z.POPUP_CHILD,
      backgroundColor: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: "#FFFFFF", borderRadius: 16,
        boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
        width: "100%", maxWidth: 480,
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${accentColor}14, ${accentColor}05)`,
          borderBottom: `1px solid ${accentColor}28`,
          padding: "18px 20px 14px",
          display: "flex", alignItems: "flex-start", gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            backgroundColor: accentColor + "1E",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <AlertTriangle size={20} color={accentColor} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#253746" }}>Urgent Unfilled Demand</div>
            <div style={{ fontSize: 12, color: "#6B7E8A", marginTop: 2 }}>
              <strong style={{ color: "#253746" }}>{role}</strong> needed on <em>{projectName}</em> — <strong style={{ color: accentColor }}>{timeLabel}</strong> ({isSoft ? "soft" : "hard"} allocation at {allocation}%).
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#6B7E8A", lineHeight: 1 }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* AI Analysis */}
          <div style={{ padding: "14px 20px 0" }}>
            <div style={{
              background: "linear-gradient(135deg, #EFF6FF 0%, #FFF7ED 100%)",
              border: "1px solid #BFDBFE", borderRadius: 10, padding: "11px 13px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: "#1D4ED8" }}>✦</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1D4ED8", letterSpacing: 0.7 }}>AI ANALYSIS</span>
                <span style={{
                  padding: "1px 7px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                  backgroundColor: accentColor + "1A", color: accentColor,
                  letterSpacing: 0.4, textTransform: "uppercase",
                }}>{severity}</span>
              </div>
              <div style={{ fontSize: 12, color: "#1E3A5F", lineHeight: 1.65 }}>{analysis}</div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: "12px 20px 4px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7E8A", letterSpacing: 0.5, marginBottom: 8 }}>RECOMMENDED ACTIONS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {actions.map((a) => (
                <div key={a.title} style={{
                  display: "flex", gap: 10, padding: "9px 12px", borderRadius: 10,
                  backgroundColor: "#F5F7FA", border: "1px solid #E5EAEF",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.3 }}>{a.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#253746" }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: "#6B7E8A", marginTop: 2, lineHeight: 1.4 }}>{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px 16px", display: "flex", justifyContent: "flex-end",
          flexShrink: 0, borderTop: "1px solid #F1F4F7",
        }}>
          <button onClick={onClose} style={{
            padding: "9px 22px", borderRadius: 8, border: "none",
            backgroundColor: accentColor, color: "#FFFFFF",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function DemandCard({ d, onClick, onAskAI }: {
  d: { TicketId: string; Title: string; Role: string; PctAllocation: number;
    AllocationStartDate: string; AllocationEndDate: string; SoftAllocation: boolean;
    ApproxContractValue?: number };
  onClick: () => void;
  onAskAI: () => void;
}) {
  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";

  const fmtD = (v: string | null | undefined) => {
    if (!v) return "—";
    const dt = new Date(v);
    return isNaN(dt.getTime())
      ? "—"
      : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };
  const valLabel =
    typeof d.ApproxContractValue === "number" && d.ApproxContractValue >= 1_000_000_000
      ? compactUsd(d.ApproxContractValue)
      : typeof d.ApproxContractValue === "number" && d.ApproxContractValue >= 1_000_000
      ? `$${(d.ApproxContractValue / 1_000_000).toFixed(1)}M`
      : typeof d.ApproxContractValue === "number" && d.ApproxContractValue > 0
        ? `$${(d.ApproxContractValue / 1_000).toFixed(0)}K`
        : "—";

  // Urgency labels for demand cards:
  //   OVERDUE  — role start date is already in the past (always shown, unaffected by window)
  //   URGENT   — role starts in the future but within the admin-configured window
  // Past items are NOT tagged URGENT so the urgency window setting has visible effect.
  const rulesVersion = useBusinessRulesVersion();
  const demandUrgencyDays = useMemo(() => getBusinessRules().demandUrgencyDays, [rulesVersion]);
  const daysUntilStart = useMemo(() => demandDaysUntil(d.AllocationStartDate), [d.AllocationStartDate]);
  const isOverdue = daysUntilStart !== null && daysUntilStart < 0;
  const isUrgent  = daysUntilStart !== null && daysUntilStart >= 0 && daysUntilStart <= demandUrgencyDays;
  const [urgentModalOpen, setUrgentModalOpen] = useState(false);

  // Only URGENT cards get the red-tinted surface (red edge + left accent
  // stripe). OVERDUE cards keep their badge but stay on the regular white
  // card — with many past-start rows the wall of red drowned out the
  // genuinely imminent ones.
  const { mode } = useTheme();
  const flagged = isUrgent;
  const flagBg     = mode === "light" ? "#FEF2F2" : "#FCE9E7";
  const flagBorder = mode === "light" ? "#F87171" : "#DC2626";

  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: flagged ? flagBg : "#FFFFFF", borderRadius: 12, padding: 14,
        border: flagged ? `1.5px solid ${flagBorder}99` : `1px solid ${cardSubtleBorder}`,
        boxShadow: flagged
          ? `inset 4px 0 0 ${flagBorder}, 0 2px 6px rgba(0,0,0,0.18)`
          : "0 2px 6px rgba(0,0,0,0.18)",
        cursor: "pointer",
        display: "flex", flexDirection: "column", height: "100%",
      }}
    >
      {/* Top row: ID + SOFT */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 10, color: BRAND.green, fontWeight: 500 }}>{d.TicketId}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {isOverdue && (
            <span style={{
              padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
              backgroundColor: "#78350f22", color: "#b45309",
              letterSpacing: 0.3, userSelect: "none",
            }}>OVERDUE</span>
          )}
          {isUrgent && (
            <span
              onClick={(e) => { e.stopPropagation(); setUrgentModalOpen(true); }}
              style={{
                padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                backgroundColor: BRAND.red + "22", color: BRAND.redDeep,
                letterSpacing: 0.3, cursor: "pointer", userSelect: "none",
              }}
            >URGENT</span>
          )}
          {d.SoftAllocation && (
            <span style={{
              padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600,
              backgroundColor: BRAND.orange + "20", color: BRAND.orange,
            }}>SOFT</span>
          )}
        </div>
      </div>

      {/* Title */}
      <div style={{
        fontSize: 13, fontWeight: 600, color: cardText, marginBottom: 6,
        overflow: "hidden", textOverflow: "ellipsis",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}>{d.Title}</div>

      {/* Role + Allocation row */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 4, gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: cardMuted }}>ROLE</div>
          <div style={{
            fontSize: 12, color: cardText, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{d.Role || "—"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: cardMuted, letterSpacing: 0.5 }}>ALLOCATION</div>
          <UtilGauge
            pct={d.PctAllocation}
            color={d.SoftAllocation ? BRAND.orange : BRAND.green}
            label={d.SoftAllocation ? "SOFT" : "HARD"}
            size={56}
          />
        </div>
      </div>

      {/* Start / End / Value row with top border */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        paddingTop: 6, borderTop: `1px solid ${cardSubtleBorder}`,
        gap: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: cardMuted }}>START</div>
          <div style={{ fontSize: 11, color: cardText }}>{fmtD(d.AllocationStartDate)}</div>
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: cardMuted }}>END</div>
          <div style={{ fontSize: 11, color: cardText }}>{fmtD(d.AllocationEndDate)}</div>
        </div>
        <div style={{ flex: 1, textAlign: "right" }}>
          <div style={{ fontSize: 10, color: cardMuted }}>VALUE</div>
          <div style={{ fontSize: 11, color: cardText, fontWeight: 600 }}>{valLabel}</div>
        </div>
      </div>

      {(() => {
        const now = Date.now();
        const start = d.AllocationStartDate ? new Date(d.AllocationStartDate).getTime() : NaN;
        const end = d.AllocationEndDate ? new Date(d.AllocationEndDate).getTime() : NaN;
        const daysToStart = isNaN(start) ? null : Math.round((start - now) / 86400000);
        const durationDays = isNaN(start) || isNaN(end) ? null : Math.round((end - start) / 86400000);
        return (
          <CardInsight
            kind="demand"
            id={`${d.TicketId}-${d.Role}-${d.AllocationStartDate}`}
            fields={{
              project: d.Title,
              ticketId: d.TicketId,
              role: d.Role || null,
              pctAllocation: d.PctAllocation,
              softAllocation: d.SoftAllocation,
              valueUSD: typeof d.ApproxContractValue === "number" ? d.ApproxContractValue : null,
              daysToStart,
              durationDays,
            }}
          />
        );
      })()}

      {/* Buttons row */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0 2px" }}>
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "10px 0", borderRadius: 10,
            backgroundColor: "transparent",
            border: "2px solid #253746",
            color: "#253746",
            fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
            cursor: "pointer",
          }}
        >
          <ExternalLink size={15} />
          View Details
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAskAI(); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "11px 0", borderRadius: 10,
            backgroundColor: BRAND.greenBg,
            border: `2px solid ${BRAND.green}`,
            color: "#FFFFFF",
            fontSize: 13, fontWeight: 700, letterSpacing: 0.2,
            boxShadow: `0 2px 6px ${BRAND.green}55`,
            cursor: "pointer",
          }}
        >
          <UserCheck size={15} />
          Find Staff AI
        </button>
      </div>
      {urgentModalOpen && (
        <UrgentDemandModal
          role={d.Role || "this role"}
          projectName={d.Title}
          daysUntilStart={daysUntilStart}
          urgencyDays={demandUrgencyDays}
          allocation={d.PctAllocation}
          isSoft={!!d.SoftAllocation}
          onClose={() => setUrgentModalOpen(false)}
        />
      )}
    </div>
  );
}

function ContactCard({ c }: { c: Contact }) {
  const cleanEmail = c.email && c.email !== "—" ? c.email : "";
  const cleanPhone = c.phone && c.phone !== "—" ? c.phone : "";
  const displayName = c.name || cleanEmail || c.id || "Unnamed contact";
  const hasInitials = c.name.trim().length > 0;

  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";

  return (
    <div style={{
      backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14,
      border: `1px solid ${cardSubtleBorder}`,
      boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
      display: "flex", flexDirection: "column", height: "100%",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: hasInitials ? BRAND.green + "26" : "#F1F4F7",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {hasInitials ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.green }}>{contactInitials(c.name)}</span>
          ) : (
            <User size={16} color={cardMuted} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: cardText,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{displayName}</div>
          {c.title && (
            <div style={{ fontSize: 12, color: cardMuted, marginTop: 1 }}>{c.title}</div>
          )}
          {c.company ? (
            <div style={{ fontSize: 12, color: BRAND.green, fontWeight: 600, marginTop: 2,
              display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Building2 size={11} /> {c.company}
            </div>
          ) : cleanEmail ? (
            <div style={{ fontSize: 11, color: cardMuted, marginTop: 2 }}>{cleanEmail}</div>
          ) : null}
        </div>
        {c.city && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0,
            fontSize: 10, color: cardMuted }}>
            <MapPin size={10} /> {c.city}
          </div>
        )}
      </div>
      {(cleanPhone || (cleanEmail && c.company)) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8,
          fontSize: 11, color: cardMuted }}>
          {cleanPhone && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Phone size={11} /> {cleanPhone}
            </span>
          )}
          {cleanEmail && c.company && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Mail size={11} /> {cleanEmail}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const RES_BRAND = {
  green: "#6BA539",
  orange: "#E87722",
  orangeWarm: "#FF9425",
  white: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  bgDeep: "var(--rm-bg)",
};

function ResOrgFilterBar({
  bus, divs, depts, allRoles, allTitles, allProjects,
  buFilter, divFilter, deptFilter, roleFilter, titleFilter, projectFilter, accessFilter,
  setBuFilter, setDivFilter, setDeptFilter, setRoleFilter, setTitleFilter, setProjectFilter, setAccessFilter,
  openMenu, setOpenMenu, startAligned, customAccessLevels, compact,
}: {
  bus: string[]; divs: string[]; depts: OrgFilterOption[]; allRoles: string[]; allTitles: string[];
  allProjects?: { id: string; name: string }[];
  buFilter: string; divFilter: string; deptFilter: string; roleFilter: string; titleFilter: string;
  projectFilter?: string;
  accessFilter?: string;
  setBuFilter: (v: string) => void; setDivFilter: (v: string) => void; setDeptFilter: (v: string) => void;
  setRoleFilter: (v: string) => void; setTitleFilter: (v: string) => void;
  setProjectFilter?: (v: string) => void;
  setAccessFilter?: (v: string) => void;
  openMenu: string | null; setOpenMenu: (v: string | null) => void;
  startAligned?: boolean;
  /** Collapse the controls into one Filters button and a popup. */
  compact?: boolean;
  /** Display names of admin-defined custom access levels (Settings → Access Levels). */
  customAccessLevels?: string[];
}) {
  const [popupOpen, setPopupOpen] = useState(false);
  const anyActive = buFilter !== "All" || divFilter !== "All" || deptFilter !== "All" || roleFilter !== "All" || titleFilter !== "All" || (projectFilter != null && projectFilter !== "All") || (accessFilter != null && accessFilter !== "All");
  const hasOrg = bus.length > 0 || divs.length > 0 || depts.length > 0;
  const dropdownStyle: React.CSSProperties = {
    position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30,
    backgroundColor: RES_BRAND.bgDeep, border: `1px solid ${RES_BRAND.cardBorder}`, borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.45)", maxHeight: 320, overflowY: "auto", minWidth: 220,
  };
  const pillStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
    borderRadius: 10, backgroundColor: RES_BRAND.card, cursor: "pointer",
    border: `1px solid ${active ? RES_BRAND.green : RES_BRAND.cardBorder}`,
    color: active ? RES_BRAND.green : RES_BRAND.textSecondary,
    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const,
    overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160,
  });
  const optRow = (label: string, sel: boolean, onClick: () => void, sub?: string) => (
    <button key={label} onClick={onClick}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 14px 8px 22px", background: "transparent", border: "none", color: sel ? RES_BRAND.green : RES_BRAND.white, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span>{label}</span>
        {sub && <span style={{ fontSize: 10, color: RES_BRAND.textSecondary, marginTop: 1 }}>{sub}</span>}
      </span>
      {sel && <Check size={14} />}
    </button>
  );

  if (!hasOrg && allRoles.length === 0 && allTitles.length === 0) return null;

  return (
    <div style={{ position: "relative" }}>
      {compact && (
        <>
          <button
            onClick={() => { setPopupOpen(open => !open); setOpenMenu(null); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
              borderRadius: 10, backgroundColor: RES_BRAND.card, cursor: "pointer",
              border: `1px solid ${anyActive ? RES_BRAND.green : RES_BRAND.cardBorder}`,
              color: anyActive ? RES_BRAND.green : RES_BRAND.textSecondary, fontSize: 12, fontWeight: 700,
            }}
          >
            <Sliders size={13} />
            Filters{anyActive ? " · Active" : ""}
          </button>
          {popupOpen && <div onClick={() => { setPopupOpen(false); setOpenMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 24, background: "transparent" }} />}
        </>
      )}
      <div style={{
        display: compact && !popupOpen ? "none" : "flex",
        flexWrap: compact ? "wrap" : "nowrap",
        gap: 6, justifyContent: startAligned ? "flex-start" : "flex-end",
        ...(compact ? {
          position: "absolute" as const, zIndex: 26, top: "calc(100% + 6px)", left: startAligned ? 0 : undefined, right: startAligned ? undefined : 0,
          width: 320, maxWidth: "calc(100vw - 32px)", padding: 12, borderRadius: 12,
          backgroundColor: RES_BRAND.bgDeep, border: `1px solid ${RES_BRAND.cardBorder}`,
          boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        } : {}),
      }}>
        {bus.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "bu" ? null : "bu")} style={pillStyle(buFilter !== "All")}>
              <Briefcase size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{buFilter !== "All" ? buFilter : "Business Unit"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "bu" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={dropdownStyle}>
                  {optRow("All Business Units", buFilter === "All", () => { setBuFilter("All"); setOpenMenu(null); })}
                  <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "0 14px 4px" }} />
                  {bus.map(bu => optRow(bu, buFilter === bu, () => { setBuFilter(buFilter === bu ? "All" : bu); setDivFilter("All"); setDeptFilter("All"); setOpenMenu(null); }))}
                </div>
              </>
            )}
          </div>
        )}

        {divs.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "div" ? null : "div")} style={pillStyle(divFilter !== "All")}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{divFilter !== "All" ? divFilter : "Division"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "div" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={dropdownStyle}>
                  {optRow("All Divisions", divFilter === "All", () => { setDivFilter("All"); setOpenMenu(null); })}
                  <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "0 14px 4px" }} />
                  {divs.map(div => optRow(div, divFilter === div, () => { setDivFilter(divFilter === div ? "All" : div); setDeptFilter("All"); setOpenMenu(null); }))}
                </div>
              </>
            )}
          </div>
        )}

        {depts.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "dept" ? null : "dept")} style={pillStyle(deptFilter !== "All")}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{deptFilter !== "All" ? deptFilter : "Department"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "dept" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={dropdownStyle}>
                  {optRow("All Departments", deptFilter === "All", () => { setDeptFilter("All"); setOpenMenu(null); })}
                  <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "0 14px 4px" }} />
                  {depts.map(d => optRow(d.label, deptFilter === d.value, () => { setDeptFilter(deptFilter === d.value ? "All" : d.value); setOpenMenu(null); }, d.sub))}
                </div>
              </>
            )}
          </div>
        )}

        {allRoles.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "role" ? null : "role")}
              style={pillStyle(roleFilter !== "All")}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{roleFilter !== "All" ? roleFilter : "Role"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "role" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={dropdownStyle}>
                  {["All", ...allRoles].map(v => optRow(v === "All" ? "All Roles" : v, v === roleFilter, () => { setRoleFilter(v); setOpenMenu(null); }))}
                </div>
              </>
            )}
          </div>
        )}

        {allTitles.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "title" ? null : "title")}
              style={pillStyle(titleFilter !== "All")}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{titleFilter !== "All" ? titleFilter : "Job Title"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "title" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={dropdownStyle}>
                  {["All", ...allTitles].map(v => optRow(v === "All" ? "All Job Titles" : v, v === titleFilter, () => { setTitleFilter(v); setOpenMenu(null); }))}
                </div>
              </>
            )}
          </div>
        )}

        {allProjects && allProjects.length > 0 && setProjectFilter && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "project" ? null : "project")}
              style={pillStyle(projectFilter != null && projectFilter !== "All")}>
              <FolderOpen size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>
                {projectFilter && projectFilter !== "All"
                  ? (allProjects.find(p => p.id === projectFilter)?.name ?? projectFilter)
                  : "Project"}
              </span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "project" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={{ ...dropdownStyle, right: 0, left: "auto", minWidth: 260 }}>
                  {optRow("All", !projectFilter || projectFilter === "All", () => { setProjectFilter("All"); setOpenMenu(null); })}
                  {(() => {
                    const pmm = allProjects.filter(p => /^PMM/i.test(p.id));
                    const opm = allProjects.filter(p => /^OPM/i.test(p.id));
                    const other = allProjects.filter(p => !/^(PMM|OPM)/i.test(p.id));
                    const sectionHeader = (label: string) => (
                      <div key={`hdr-${label}`} style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: RES_BRAND.textSecondary, opacity: 0.7 }}>
                        {label}
                      </div>
                    );
                    return (
                      <>
                        {pmm.length > 0 && (
                          <>
                            <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "4px 14px" }} />
                            {sectionHeader("Projects")}
                            {pmm.map(p => optRow(p.name, projectFilter === p.id, () => { setProjectFilter(projectFilter === p.id ? "All" : p.id); setOpenMenu(null); }))}
                          </>
                        )}
                        {opm.length > 0 && (
                          <>
                            <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "4px 14px" }} />
                            {sectionHeader("Opportunities")}
                            {opm.map(p => optRow(p.name, projectFilter === p.id, () => { setProjectFilter(projectFilter === p.id ? "All" : p.id); setOpenMenu(null); }))}
                          </>
                        )}
                        {other.length > 0 && (
                          <>
                            <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "4px 14px" }} />
                            {other.map(p => optRow(p.name, projectFilter === p.id, () => { setProjectFilter(projectFilter === p.id ? "All" : p.id); setOpenMenu(null); }))}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        )}

        {setAccessFilter && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "access" ? null : "access")} style={pillStyle(!!accessFilter && accessFilter !== "All")}>
              <ShieldCheck size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {accessFilter && accessFilter !== "All" ? accessFilter : "Access"}
              </span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "access" && (
              <>
                <div onClick={() => setOpenMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 25, backgroundColor: "transparent" }} />
                <div style={{ ...dropdownStyle, minWidth: 190 }}>
                  {optRow("All Access Levels", !accessFilter || accessFilter === "All", () => { setAccessFilter("All"); setOpenMenu(null); })}
                  <div style={{ height: 1, background: RES_BRAND.cardBorder, margin: "0 14px 4px" }} />
                  {["Admin", "Manager", "User", ...(customAccessLevels ?? [])].map(lvl =>
                    optRow(lvl, accessFilter === lvl, () => { setAccessFilter(accessFilter === lvl ? "All" : lvl); setOpenMenu(null); }))}
                </div>
              </>
            )}
          </div>
        )}

        {anyActive && (
          <button
            onClick={() => { setBuFilter("All"); setDivFilter("All"); setDeptFilter("All"); setRoleFilter("All"); setTitleFilter("All"); if (setProjectFilter) setProjectFilter("All"); if (setAccessFilter) setAccessFilter("All"); }}
            style={{ padding: "7px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", backgroundColor: "transparent", border: `1px solid ${RES_BRAND.cardBorder}`, color: RES_BRAND.textSecondary }}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
// ── Manager Org-Chart Popup ───────────────────────────────────────────────────
// Portal-rendered project-team visualisation: the selected manager is the
// single root, then each managed project gets its own independent flow with
// its project ID/name/role and the teammates belonging to that project.
// Do not group this view by company hierarchy — BU/Division/Department labels
// describe people, not the manager's project relationship.

// Positional project palette. Literal hex (never CSS vars) so "+40"-style
// alpha suffixes work.
const MGR_BU_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ec4899",
  "#06b6d4", "#8b5cf6", "#f97316", "#14b8a6", "#ef4444",
];

function ManagerOrgChartPopup({
  managerId,
  managerName,
  staffResources,
  managerStaffData,
  loading,
  onClose,
}: {
  managerId: string;
  managerName: string;
  staffResources: import("@/lib/api").LiveResourceProxy[];
  managerStaffData: import("@/lib/api").ManagerStaffResponse | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  // Build lookup maps
  const byId = useMemo(() => {
    const m = new Map<string, import("@/lib/api").LiveResourceProxy>();
    for (const r of staffResources) if (r.id) m.set(r.id.toLowerCase(), r);
    return m;
  }, [staffResources]);

  const projectTeamSet = useMemo(() => new Set(
    (managerStaffData?.projectTeam ?? []).map(pt => pt.id.toLowerCase()),
  ), [managerStaffData]);

  const managedProjects = managerStaffData?.managedProjects ?? [];

  // Theme-following tokens (light fallbacks). The old hardcoded white-RGBA
  // text was invisible on the light theme — every text/border color now rides
  // the --rm-* vars so the popup reads correctly in BOTH light and dark.
  // Literal hex colors (MGR_BU_COLORS etc.) are safe for hex-alpha suffixes
  // ("#6366f1" + "40"); never alpha-suffix a var(--…) token.
  const PANEL  = "var(--rm-panel, #ffffff)";
  const BORDER = "var(--rm-panel-border, #e2e8f0)";
  const TEXT   = "var(--rm-text, #1e293b)";
  const MUTED  = "var(--rm-text-muted, #64748b)";
  const ACCENT = "var(--rm-green, #22c55e)";
  const GREEN  = "#22c55e";
  const BLUE   = "#3b82f6";

  type Leaf = import("@/lib/api").LiveResourceProxy;
  const projectFlows = useMemo(() => {
    const fallbackIdsByProject = new Map<string, string[]>();
    for (const member of managerStaffData?.projectTeam ?? []) {
      const key = member.ticketId.trim().toLowerCase();
      if (!key) continue;
      const ids = fallbackIdsByProject.get(key) ?? [];
      ids.push(member.id);
      fallbackIdsByProject.set(key, ids);
    }
    return managedProjects.map((project, index) => {
      const projectKey = project.ticketId.trim().toLowerCase();
      const memberIds = project.teamMemberIds ?? fallbackIdsByProject.get(projectKey) ?? [];
      const members = Array.from(new Set(memberIds.map(id => id.trim().toLowerCase())))
        .map(id => byId.get(id))
        .filter((r): r is Leaf => Boolean(r))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        ...project,
        members,
        color: MGR_BU_COLORS[index % MGR_BU_COLORS.length],
      };
    });
  }, [byId, managedProjects, managerStaffData]);

  // ── Project-flow primitives ───────────────────────────────────────────────
  const VLine = ({ color, h = 14 }: { color: string; h?: number }) => (
    <div style={{ display: "flex", justifyContent: "center", height: h }}>
      <div style={{ width: 2, height: "100%", background: color + "60" }} />
    </div>
  );

  const ChartNode = ({ label, color, icon: Icon, badge, size = "md" }: {
    label: string; color: string; icon: React.ElementType; badge?: string; size?: "lg" | "md" | "sm";
  }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{
        padding: size === "lg" ? "11px 22px" : size === "sm" ? "6px 12px" : "8px 16px",
        borderRadius: 10, border: `2px solid ${color}60`, background: `${color}12`,
        display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
        minWidth: size === "lg" ? 160 : size === "sm" ? 90 : 110, maxWidth: 250,
      }}>
        <Icon size={size === "lg" ? 17 : size === "sm" ? 12 : 14} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize: size === "lg" ? 14.5 : size === "sm" ? 11 : 12.5, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      {badge && (
        <div style={{ marginTop: 3, fontSize: 8, fontWeight: 700, color, background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 10, padding: "1px 7px", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {badge}
        </div>
      )}
    </div>
  );

  const MemberNameGrid = ({ members, color }: {
    members: Leaf[];
    color: string;
  }) => (
    <div style={{
      width: "100%", display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 8, alignItems: "stretch",
    }}>
      {members.map(member => {
        const name = member.name?.trim() || "Unnamed member";
        const role = member.role?.trim();
        const initials = name.split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("");
        return (
        <div
          key={member.id}
          title={role || "Role not specified"}
          style={{
            minWidth: 0, minHeight: 58, boxSizing: "border-box",
            display: "flex", alignItems: "center", gap: 9,
            padding: "8px 12px", borderRadius: 10,
            border: `1.5px solid ${color}35`, background: PANEL,
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
          }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color, background: `${color}15`, border: `1px solid ${color}35`,
            fontSize: 10, fontWeight: 800,
          }}>
            {initials || "?"}
          </span>
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: TEXT, fontSize: 11.5, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
            <span style={{ color: MUTED, fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {role ? abbrevRole(role) : "Role not specified"}
            </span>
          </span>
        </div>
        );
      })}
    </div>
  );

  const ProjectFlow = ({ project, color }: {
    project: (typeof projectFlows)[number];
    color: string;
  }) => {
    return (
      <div style={{
        minWidth: 280, flex: "1 1 360px", maxWidth: 520,
        borderRadius: 16, border: `1.5px solid ${color}45`, background: `${color}07`,
        padding: "14px 14px 16px", display: "flex", flexDirection: "column", alignItems: "stretch",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChartNode label={project.ticketId} color={color} icon={FolderOpen} badge="Project" />
          <div style={{ minWidth: 0, flex: 1, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: TEXT, fontSize: 12.5, fontWeight: 750, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={project.title}>
              {project.title}
            </div>
            <div style={{ color: MUTED, fontSize: 10.5, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={project.leadRole}>
              {project.leadRole || "Project team"}
            </div>
          </div>
        </div>
        <VLine color={color} h={14} />
        <div style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>
          Team members · {project.members.length} {project.members.length === 1 ? "member" : "members"}
        </div>
        {project.members.length > 0
          ? <MemberNameGrid members={project.members} color={color} />
          : <div style={{ fontSize: 11, color: MUTED, padding: "10px 4px 2px" }}>No other project-team members</div>}
      </div>
    );
  };

  const teamCount = projectTeamSet.size;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
      backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        backgroundColor: PANEL, border: `1px solid ${BORDER}`,
        borderRadius: 18, boxShadow: "0 24px 60px rgba(15,23,42,0.35)",
        width: "min(1020px, 96vw)", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "flex-start", gap: 12, flexShrink: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 999, backgroundColor: "rgba(34,197,94,0.15)",
            border: `1.5px solid ${ACCENT}`, color: ACCENT,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 800, flexShrink: 0,
          }}>
            {managerName.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("")}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{managerName}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
              {teamCount} project team member{teamCount !== 1 ? "s" : ""}
              {managedProjects.length > 0 ? ` across ${managedProjects.length} project${managedProjects.length !== 1 ? "s" : ""}` : ""}
            </div>
          </div>
          <button aria-label="Close visual chart" title="Close" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body — org-chart sections stacked vertically (scrolls both ways for wide trees) */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: "16px 20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, gap: 10, color: MUTED }}>
              <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 13 }}>Loading org data…</span>
            </div>
          ) : (
            <>
              {/* Project Team */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <FolderOpen size={13} color={BLUE} />
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: BLUE }}>Project Team</span>
                  <span style={{ fontSize: 11, color: MUTED }}>· {teamCount}</span>
                </div>
                {managerStaffData?.projectTeamError && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "6px 10px", borderRadius: 8, backgroundColor: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", color: "#d97706", fontSize: 11 }}>
                    <AlertTriangle size={12} />
                    <span>Project team data is temporarily unavailable because the database request timed out.</span>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "min-content" }}>
                  <ChartNode label={managerName} color={GREEN} icon={Users} badge="Manager" size="lg" />
                  <VLine color={GREEN} h={18} />
                  {projectFlows.length > 0 ? (
                    <div style={{ width: "100%", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center", alignItems: "flex-start" }}>
                      {projectFlows.map(project => <ProjectFlow key={project.ticketId} project={project} color={project.color} />)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: MUTED, padding: "4px 0" }}>No managed projects found</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
