// TeamScheduleGrid — inline schedule matrix for the Project Team section.
// Phases as column-group headers, team members as rows, weekly hours in cells.
// Direct in-grid editing (canEdit only): click any week cell to edit its hours
// inline (✓ saves, ✗ cancels) — saves via updateHoursAllocation, exactly like
// EditAllocationModal. Past weeks stay locked per business rules.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { AlertTriangle, Edit2, X, Check, Calendar as CalIcon, CalendarClock, Plus, ChevronLeft, ChevronRight, Sparkles, Layers, Search, Lock, LockOpen, GripVertical } from "lucide-react";
import {
  getProjectTeam, getTaskData, getFullProjectAllocations,
  updateHoursAllocation, bustCache, peekCache, tenantScopedKey, getStoredUser,
  type ProjectTeamMember,
} from "@/lib/api";
import {
  matchMemberAlloc, buildWeeklyAllocations, fmtWeekKey,
  type AllocationsResponse,
} from "@/lib/phaseHours";
import { getBusinessRules, getPastWeekEditStateFor, useBusinessRulesVersion } from "@/lib/businessRules";
import { useEditFinancialsCap } from "@/lib/permissions";
import { MAX_WEEK_HOURS, MAX_WEEK_HOURS_HINT } from "@/lib/utilGrid";
import { empTypeColor } from "@/lib/employmentColor";
import { InlineAddMemberRow } from "@/components/InlineAddMemberRow";
import DateField from "@/components/DateField";
import type { ExistingAllocationRef } from "@/hooks/useAssignMemberCascade";

import { RemoveMemberConfirm } from "@/components/RemoveMemberConfirm";
import { MemberActionMenu } from "@/components/MemberActionMenu";
import { Z } from "@/lib/zLayers";
import { queueProjectMemberWrite, pendingProjectWrites, subscribeMemberWrites } from "@/lib/memberWriteQueue";
import { fmtHours } from "@/lib/utils";
import { DisabledMemberStatus } from "@/components/DisabledMemberStatus";

const C = {
  bg:         "var(--rm-bg)",
  panel:      "var(--rm-panel)",
  soft:       "var(--rm-panel-soft)",
  border:     "var(--rm-panel-border)",
  text:       "var(--rm-text)",
  muted:      "var(--rm-text-muted)",
  faint:      "var(--rm-text-faint)",
  green:      "var(--rm-green)",
  greenSoft:  "var(--rm-green-soft)",
  nowBg:      "var(--rm-now-bg)",
  nowText:    "var(--rm-now-text)",
  nowHead:    "var(--rm-now-head-text)",
  colSep:     "var(--rm-sched-col-sep)",
  cellBorder: "var(--rm-sched-cell-border)",
};

const PHASE_COLORS = [
  "#38BDF8", "#818CF8", "#34D399", "#FB923C", "#A78BFA",
  "#F472B6", "#FBBF24", "#2DD4BF", "#84CC16", "#F87171",
];
function phaseColor(idx: number) { return PHASE_COLORS[idx % PHASE_COLORS.length]; }

// The frozen summary columns take their accents from the SAME palette as the
// phase cards (client request: one matching color family across the table —
// FLAGS, ETC HRS, EAC HRS, ETC COST, EAC COST each own a palette hue).
const COL_ACCENT: Record<string, string> = {
  flags:   PHASE_COLORS[0], // sky
  etcHrs:  PHASE_COLORS[1], // indigo
  eacHrs:  PHASE_COLORS[2], // emerald
  etcCost: PHASE_COLORS[3], // orange
  eacCost: PHASE_COLORS[4], // violet
};

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function parseISODate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("0001")) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

function formatWeeklyTotal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function fmtShortDate(v: unknown): string {
  const d = parseISODate(v);
  if (!d) return "";
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
}

function initials(n: string): string {
  return (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("") || "?";
}
const AVATAR_PAL = ["#6BA539","#3B82F6","#8B5CF6","#F59E0B","#EC4899","#14B8A6","#F97316","#EF4444"];
function avatarColor(n: string) { return AVATAR_PAL[n.charCodeAt(0) % AVATAR_PAL.length]; }

/** Format an ISO "YYYY-MM-DD" week key → "DD-Mon" (e.g. "04-May") for display. */
function fmtWeekColLabel(wk: string): string {
  const d = parseISODate(wk);
  if (!d) return wk.slice(5, 10);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTH_ABBR[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

/** Compact header label — "23 FEB 26". The 2-digit year is ALWAYS shown
    (user mandate: omitting it is confusing on multi-year projects). Full
    DD-MMM-YY also stays available via the header cell's hover tooltip. */
function fmtWeekColShort(wk: string): string {
  const d = parseISODate(wk);
  if (!d) return wk.slice(5, 10);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

/** First word of a member's name — used for the conversational flag-popup
    copy ("Lock Adam's allocation?"). The grid's NAME column shows the FULL
    name (user request — first-name-only read like the wrong/unknown person);
    very long names ellipsize there with the full name on hover. */
function firstNameOf(full: string): string {
  const t = String(full || "").trim();
  const sp = t.indexOf(" ");
  return sp > 0 ? t.slice(0, sp) : t;
}

/** Short secondary label used to tell apart two team members who share the
 *  same display name.  Returns "" when the member's name is unique on this
 *  team (the common case — no visual clutter).
 *  Priority: job title → last-4 of resourceId → "". */
function disambiguatorFor(m: ProjectTeamMember, dupNames: ReadonlySet<string>): string {
  if (!dupNames.has(m.name)) return "";
  if (m.title) return m.title;
  if (m.resourceId) return `…${m.resourceId.slice(-4)}`;
  return "";
}

interface ScheduleTask {
  Title?: string;
  StartDate?: string;
  DueDate?: string;
  PercentComplete?: number;
  ItemOrder?: number;
  StageStep?: number;
  [key: string]: unknown;
}

export interface TeamScheduleGridProps {
  projectId: string;
  /** One-shot cache-bypassing read used after Billing Rates returns here.
      The grid owns an independent team fetch, so it must honour the same
      freshness guarantee as its Project Detail parent. */
  forceFreshTeam?: boolean;
  /** Record module (PMM/OPM/LEM) — OPM/LEM follow the opportunity-side past-edit rules. */
  module?: string | null;
  reloadKey?: number;
  canEdit?: boolean;
  onReload?: (silent?: boolean) => void;
  /** When true (settings hide the schedule), suppress all phase UI —
      phase cards, phase detail, phase header row and phase colouring —
      and show only the hours chart + weekly grid. */
  hideSchedule?: boolean;
  // ── Inline "Add member" row (Excel-style last row under the grid). All of
  // these are optional; the row renders only when canEdit AND onMemberAdded
  // are provided. Values mirror what project-detail passes to AddTeamMemberModal.
  projectName?: string;
  projectStartDate?: string;
  projectEndDate?: string;
  scheduleStart?: string;
  scheduleEnd?: string;
  existingAllocations?: ExistingAllocationRef[];
  onMemberAdded?: (personName: string, optimistic?: { id: string; role: string; bu: string; title: string; startDate: string; endDate: string; pct: number; hours?: number }) => void;
  /** When provided, "Add member" and the toolbar member search open the
      host's Add Team Member POPUP (the same modal as the open-position
      Assign flow) instead of the inline grid row. `seed` carries the person
      picked from the toolbar search so the modal opens with them
      pre-selected (org auto-fills from their staff profile). */
  onAddMember?: (seed?: { personId: string; personName: string; title: string }) => void;
  onManageAI?: () => void;
  onApplyTemplate?: () => void;
  onAddOpenPosition?: () => void;
  /** Allocation-flag controls. canUnlock = the viewer may change flags
      (admin or manage-staff capability). onToggleFlag persists ONE flag
      (soft / nc / locked) and resolves true on success; onToggleLock is the
      legacy lock-only fallback. The FLAGS column renders when any member
      carries a flag — and always for manage-staff viewers, whose three
      sub-slots (S | NC | lock) toggle on click. */
  canUnlock?: boolean;
  onToggleLock?: (m: ProjectTeamMember, locked: boolean) => Promise<boolean>;
  /** costRate is passed for flag="nc" so the server can write ra.CostRate in
   *  the same operation — the Financial page picks it up immediately. */
  onToggleFlag?: (m: ProjectTeamMember, flag: "soft" | "nc" | "locked", value: boolean, costRate?: number) => Promise<boolean>;
  /** Overview mode (Gantt view header): render ONLY the phase cards +
      selected-phase detail panel + charts — no stats bar, no weekly grid,
      no edit affordances. Loading/error/empty states render nothing so the
      Gantt list below stands alone. */
  overviewOnly?: boolean;
  /** Single-member mode (Gantt row expansion): filter the grid to just this
      member and hide team-level chrome (stats bar, phase cards, weekly team
      total row). Everything else — columns, inline cell editing, saves —
      behaves exactly like the full Schedule view. Matches by resourceId when
      available, falling back to an exact case-insensitive name match. */
  soloMember?: { id?: string; name: string };
  /** ISO "YYYY-MM-DD". When set, the initial auto-scroll brings the week
      containing this date into view (instead of the default today-window) —
      used by the Gantt popup so clicking a month on a member's bar opens
      the grid already positioned at that month. */
  focusDate?: string;
  /** Open positions on this project — forwarded to the inline add-member row
      so it can show one-click "this project needs …" suggestion chips, and
      rendered as amber rows at the bottom of the member list. */
  openRoles?: import("@/lib/api").OpenRole[];
  /** Member / open-position removal (manage-staff only). Presence of the
      handler IS the UI gate — the page passes it only when the viewer holds
      the manage-staff capability, and the server enforces the capability
      again on its side. Confirmation happens in the shared
      RemoveMemberConfirm popup (with the mandated audit-log notice). */
  onRemoveMember?: (m: ProjectTeamMember) => Promise<void> | void;
  onRemoveOpenPosition?: (r: import("@/lib/api").OpenRole) => Promise<void> | void;
  /** Change resource (manage-staff only, same gate as removal): hands the
      member's remaining weeks to another person — offered from the ⋯ menu
      next to the member's name. */
  onChangeResource?: (m: ProjectTeamMember) => void;
  /** The surrounding dialog owns vertical scrolling. The grid still owns the
      weekly horizontal viewport and its dedicated mirror scrollbar. */
  modalScrollOwner?: boolean;
}

const COL_W   = 58;   // minimum week column width (px) — fits "23 FEB 26" header label
const PHASE_H = 26;   // phase group header row height (px) — drives cascading sticky tops

// Frozen (left) column widths. BU / DIVISION / DEPT are conditional — see frozenCols.
// W_EAC / W_ETC are MINIMUMS for the four hour/cost columns (ETC HRS / EAC HRS /
// ETC COST / EAC COST) — the actual widths grow with the longest rendered value
// so 5-digit numbers are never clipped (see hourCostColW).
const W_BU = 46, W_DIV = 54, W_DEPT = 62, W_ROLE = 78, W_NAME = 180, W_EAC = 50, W_ETC = 40, W_ACT = 38;
// FLAGS column — three fixed sub-slots (S | NC | lock) so the badges line up
// as mini-columns. Rendered when any member carries a flag, and always for
// manage-staff viewers (they click a slot to set or clear it).
const W_FLAGS = 88;
// Only these frozen metadata columns are user-orderable. Financial summaries,
// actions, and (most importantly) the weekly timeline deliberately stay out of
// this preference.
const ORDERABLE_METADATA_KEYS = ["bu", "division", "dept", "role", "name", "flags", "start", "end"] as const;
const SCHEDULE_COLUMN_ORDER_EVENT = "rmone:teamScheduleColumnOrderChanged";

function teamScheduleColumnOrderKey(): string {
  const user = getStoredUser();
  const tenant = encodeURIComponent((user?.tenant ?? "signed-out").trim().toLowerCase());
  const username = encodeURIComponent((user?.username ?? "anonymous").trim().toLowerCase());
  // One stable product-table identity: the chosen order follows the user
  // between projects and every view that renders the team schedule.
  return `rmone:team-schedule-column-order:${tenant}:${username}:shared`;
}

function readScheduleColumnOrder(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}

// Flag palette + copy — the ONE source for the chips, the row tint, the
// legend strip and the confirm popup. The three hues are drawn from the SAME
// palette as the phase cards (client request: one color family table-wide)
// while staying distinct from each other:
// sky blue = Soft (pencilled-in), violet = Non-chargeable (doesn't bill),
// amber = Locked (frozen — still reads as a warning color).
const FLAG_META = {
  soft: {
    short: "S", name: "Soft", tintWord: "blue",
    color: "#38BDF8", chipBg: "rgba(56,189,248,0.52)", chipBd: "rgba(56,189,248,1)", rowTint: "rgba(56,189,248,0.09)",
    legend: "tentative booking", what: "a tentative (pencilled-in) booking — the hours are planned but not confirmed yet",
  },
  nc: {
    short: "NC", name: "Non-chargeable", tintWord: "violet",
    color: "#A78BFA", chipBg: "rgba(167,139,250,0.50)", chipBd: "rgba(167,139,250,1)", rowTint: "rgba(167,139,250,0.09)",
    legend: "hours don't bill", what: "these hours don't bill the client",
  },
  locked: {
    short: "L", name: "Locked", tintWord: "amber",
    color: "#FBBF24", chipBg: "rgba(251,191,36,0.52)", chipBd: "rgba(251,191,36,1)", rowTint: "rgba(251,191,36,0.11)",
    legend: "frozen against changes", what: "imports, schedule moves and hour edits can't change this member until unlocked",
  },
} as const;
type FlagKind = keyof typeof FLAG_META;

/** Whole-row tint for a flagged member — strongest flag wins: locked > NC > soft. */
function rowFlagTint(m: { softAllocation?: boolean; nonChargeable?: boolean; isLocked?: boolean }): string | null {
  if (m.isLocked) return FLAG_META.locked.rowTint;
  if (m.nonChargeable) return FLAG_META.nc.rowTint;
  if (m.softAllocation) return FLAG_META.soft.rowTint;
  return null;
}
// START / END date columns — shown only in no-schedule display mode, where
// member assignment dates are first-class grid data (and the inline add-member
// row picks its dates directly in these columns instead of a floating card).
const W_DATE = 96;
// Drag-to-resize bounds for the frozen columns (see colOverrides below).
const COL_MIN = 40, COL_MAX = 400;
// v2: compact org-column defaults (Feb 2026 redesign) — new key so previously
// persisted wide defaults don't override the tighter layout.
const COLW_LS_BASE = "rmone_tsg_colw2";

/** ETC cost display used by both the row cells and the width calculation. */
function fmtEtcCost(v?: number): string {
  if (!v || v <= 0) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(v)}`;
}

// ── ETC / EAC hover tooltips ────────────────────────────────────────────────
// Definitions + formulas surfaced on hover over the four estimate columns.
// The cost math mirrors the backend exactly: cost = hours × member billing
// rate (per-allocation rate → Billing Rates role/title rate → tenant default).
type CostTipKind = "etcHrs" | "eacHrs" | "etcCost" | "eacCost";
const COST_TIP_META: Record<CostTipKind, { label: string; full: string; accent: string }> = {
  etcHrs:  { label: "ETC Hours", full: "Estimate to Complete", accent: COL_ACCENT.etcHrs },
  eacHrs:  { label: "EAC Hours", full: "Estimate at Completion", accent: COL_ACCENT.eacHrs },
  etcCost: { label: "ETC Cost",  full: "Estimate to Complete — Cost", accent: COL_ACCENT.etcCost },
  eacCost: { label: "EAC Cost",  full: "Estimate at Completion — Cost", accent: COL_ACCENT.eacCost },
};
// Short native-title hints on the column headers (rich card appears on cells).
const HEADER_TIPS: Record<string, string> = {
  etcHrs:  "ETC — Estimate to Complete: remaining planned hours from this week forward",
  eacHrs:  "EAC — Estimate at Completion: total planned hours (delivered + remaining)",
  etcCost: "ETC Cost = ETC hours × billing rate. For non-chargeable work, it uses the internal NC cost rate instead.",
  eacCost: "EAC Cost = EAC hours × billing rate. For non-chargeable work, it uses the internal NC cost rate instead.",
};
function fmtMoneyFull(v: number): string { return `$${Math.round(v).toLocaleString("en-US")}`; }
function fmtRateStr(rate: number): string {
  return `$${rate % 1 === 0 ? rate.toLocaleString("en-US") : rate.toFixed(2)}/hr`;
}

/** NC rows can arrive from older/cached team payloads without the flag bit,
 * while their split hours/cost or explicit NC rate is still present. Keep the
 * cost tooltip honest in that case instead of describing the amount as billing
 * rate based. */
function hasInternalNcCost(m: ProjectTeamMember): boolean {
  return !!m.nonChargeable
    || (m.ncRate ?? 0) > 0
    || ((m.ncCost ?? 0) > 0 && (m.ncHrs ?? 0) > 0);
}


// ISO "YYYY-MM-DD" → "DD-Mon-YY" via pure string split — no Date object, no
// timezone drift. new Date("YYYY-MM-DD") parses as UTC midnight and
// getDate()/getMonth() then return the LOCAL date, which is one day behind
// UTC for users in negative-offset timezones.
function isoToWeekKey(iso: string): string {
  const p = iso.split("-");
  if (p.length < 3) return iso;
  const mo = parseInt(p[1], 10) - 1;
  return `${p[2].padStart(2, "0")}-${MONTH_ABBR[mo] ?? p[1]}-${p[0].slice(-2)}`;
}

/** Local ISO "YYYY-MM-DD" of a Date (no UTC conversion). */
function isoOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Single-member mode: keep only the matching member. Applied at every point
    team state is set from a server/cache payload so ALL downstream logic
    (rows, totals, edit + save paths) sees a consistent one-member team. */
function filterSoloTeam(arr: ProjectTeamMember[], solo?: { id?: string; name: string }): ProjectTeamMember[] {
  if (!solo) return arr;
  // Prefer an exclusive resourceId match; fall back to the name only when the
  // id yields nothing (e.g. optimistic rows) so a same-named second member
  // can never ride along with an id-matched one.
  const id = (solo.id ?? "").trim().toLowerCase();
  if (id !== "") {
    const byId = arr.filter(m => String(m.resourceId ?? "").trim().toLowerCase() === id);
    if (byId.length > 0) return byId;
  }
  const nm = solo.name.trim().toLowerCase();
  return arr.filter(m => m.name.trim().toLowerCase() === nm);
}

export function TeamScheduleGrid({
  projectId, forceFreshTeam, module, reloadKey, canEdit, onReload, hideSchedule,
  projectName, projectStartDate, projectEndDate, scheduleStart, scheduleEnd,
  existingAllocations, onMemberAdded, onAddMember, onManageAI, onApplyTemplate, onAddOpenPosition,
  overviewOnly, soloMember, focusDate, openRoles, canUnlock, onToggleLock, onToggleFlag,
  onRemoveMember, onRemoveOpenPosition, onChangeResource, modalScrollOwner = false,
}: TeamScheduleGridProps) {
  // Router navigation — used by the "Set" rate shortcut in the cost columns to
  // deep-link into the Billing Rates page focused on the member's role row.
  // The current location is passed along as ?returnTo= so the Billing Rates
  // page can bring the user straight back here after they save the rate.
  const [location, navigate] = useLocation();
  // Seed from the client-side cache populated by project-detail's parallel load.
  // When the parent already fetched team+tasks (the common case), the component
  // renders the chart and phase cards immediately — no loading spinner.
  const [team, setTeam] = useState<ProjectTeamMember[]>(() => {
    const cached = peekCache<{ team?: ProjectTeamMember[] }>(`project:team:${projectId}`);
    return filterSoloTeam(cached?.team ?? [], soloMember);
  });
  const [tasks, setTasks] = useState<ScheduleTask[]>(() => {
    const cached = peekCache<unknown>(`project:tasks:${projectId}:0:0`);
    return Array.isArray(cached) ? (cached as ScheduleTask[]) : [];
  });
  // True once we KNOW the project's phase-schedule state (cache hit or fetch
  // settled) — gates the "add a schedule first" notice so it never flashes
  // while the task-data call is still in flight.
  const [tasksLoaded, setTasksLoaded] = useState<boolean>(() =>
    Array.isArray(peekCache<unknown>(`project:tasks:${projectId}:0:0`)));
  // A FAILED schedule fetch must not masquerade as "this project has no
  // schedule" — when true, the needsSchedule notice is suppressed and the
  // neutral no-hours message shows instead.
  const [tasksFailed, setTasksFailed] = useState(false);
  // Only show the loading spinner when the cache had nothing — a background
  // refresh still runs in every case to keep the data fresh. The spinner is
  // gated on TEAM data only: the grid renders member rows + weekly hours the
  // moment the team arrives, and phase headers pop in when tasks land.
  const [loading, setLoading] = useState<boolean>(() => {
    const hasTeam  = (peekCache<{ team?: ProjectTeamMember[] }>(`project:team:${projectId}`)?.team?.length ?? 0) > 0;
    return !hasTeam;
  });
  const [error,    setError]    = useState<string | null>(null);
  const [selPhase,    setSelPhase]    = useState<number | null>(0);
  const [chartHover,  setChartHover]  = useState<number | null>(null);

  const [editMode,  setEditMode]  = useState(false);
  const [editHours, setEditHours] = useState<Record<string, Record<string, number>>>({});
  const [rawAllocs, setRawAllocs] = useState<AllocationsResponse | null>(null);
  // Approach-A save verification: after every save, compare what was sent to
  // what the DB returned. If any week's value doesn't match, surface a banner
  // on that member's row so the user can one-click fix it.
  type WeekMismatch = { week: string; intended: number; got: number };
  const [mismatches,   setMismatches]   = useState<Record<string, WeekMismatch[]>>({});
  const [saveIntended, setSaveIntended] = useState<Record<string, Record<string, number>>>({});
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState<string | null>(null);
  // ── Per-member quick "Schedule Hours" popup ──────────────────────────────
  // Same three options as the member card's Schedule Hours button (Uniform
  // Weekly Hours / date range / distribute total hours). Saves go through the SAME
  // path as saveEdits: matchMemberAlloc → buildWeeklyAllocations →
  // updateHoursAllocation.
  // top OR bottom is set depending on available space, so the menu opens
  // upward when the row is near the bottom of the screen instead of being cut off.
  // maxH caps the menu to the room on the chosen side (scrolls if tighter) so
  // rows near the very top or bottom of the screen never clip the options.
  const [actMenu,   setActMenu]   = useState<{ memberId: string; top?: number; bottom?: number; left: number; maxH?: number } | null>(null);
  const [flatFor,   setFlatFor]   = useState<ProjectTeamMember | null>(null);
  const [flatVal,   setFlatVal]   = useState("");
  const [distFor,   setDistFor]   = useState<ProjectTeamMember | null>(null);
  const [distVal,   setDistVal]   = useState("");
  const [distRate,  setDistRate]  = useState("");
  const [rangeFor,  setRangeFor]  = useState<ProjectTeamMember | null>(null);
  const [rangeRows, setRangeRows] = useState<{ id: number; from: string; to: string; hours: string }[]>([]);
  // Members with a save in flight — a Set so overlapping saves for DIFFERENT
  // members can't clobber each other's busy state (single-slot state would let
  // save B's finish clear save A's gate while A is still running).
  const [quickBusy, setQuickBusy] = useState<Set<string>>(new Set());
  // ── Direct in-grid cell editing ───────────────────────────────────────────
  // Click any editable week cell → it becomes an input with ✓ / ✗ buttons.
  // ✓ shows the number INSTANTLY and queues a background save; ✗ (or Escape)
  // cancels. Edits are coalesced per member: rapid entry across several weeks
  // rides one save chain (never two concurrent full-map POSTs for the same
  // person, which could resurrect older values server-side).
  const [cellEdit,   setCellEdit]   = useState<{ memberId: string; wk: string; val: string } | null>(null);
  // Per-key inline error state: keyed by the same hint key as the input
  // (e.g. `${memberId}|${wk}`, "flat", "range"). A truthy value means the
  // input currently holds an over-168 number — the value stays VISIBLE so
  // the user can correct it, and every save path checks this set to block.
  const [weekInputErrors, setWeekInputErrors] = useState<Set<string>>(new Set());
  // Backwards-compat alias: some render paths still check capHintCell for the
  // small tooltip; we keep it as a transient visual-only overlay (not a gate).
  const [capHintCell, setCapHintCell] = useState<string | null>(null);
  const capHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCapHint = (key: string) => {
    setCapHintCell(key);
    if (capHintTimerRef.current) clearTimeout(capHintTimerRef.current);
    capHintTimerRef.current = setTimeout(() => setCapHintCell(null), 2600);
  };
  /** Validate a typed weekly-hours string against the 168h ceiling.
      Values ABOVE the limit: the raw string is returned UNCHANGED (stays
      visible), the key is added to weekInputErrors (blocks saves), and the
      cap hint flashes.  Values in range: the key is cleared from errors.
      Returns the string to store in the input state. */
  const validateWeeklyInput = (raw: string, hintKey: string): string => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > MAX_WEEK_HOURS) {
      flashCapHint(hintKey);
      setWeekInputErrors(prev => { const s = new Set(prev); s.add(hintKey); return s; });
    } else {
      setWeekInputErrors(prev => { if (!prev.has(hintKey)) return prev; const s = new Set(prev); s.delete(hintKey); return s; });
    }
    return raw;
  };
  /** @deprecated Use validateWeeklyInput — kept for call-sites that haven't
   *  been updated yet. Clamps as before but also sets the error flag so saves
   *  are still blocked if somehow this path is used. */
  const clampWeeklyInput = validateWeeklyInput;
  // Cells with a background save in flight, keyed `${memberId}|${wk}` — a Set
  // so two cells saving at once each keep their own spinner.
  // (No per-cell "saving" spinner: the user asked for edits to look saved
  // INSTANTLY. Failures still revert the cells + show the banner.)
  const cellInputRef = useRef<HTMLInputElement | null>(null);
  // One-shot commit guard for the current cell editor: Enter, Esc and
  // click-away (blur) can each end the edit — whichever fires first wins,
  // the rest become no-ops. Reset every time an editor opens.
  const cellDoneRef = useRef(false);
  // Save-queue bookkeeping (refs — updated synchronously, unlike state):
  //   teamRef      mirror of `team` for reads inside async save code
  //   cellValRef   cellKey → pending value (overlay onto the base map)
  //   cellPrevRef  cellKey → ORIGINAL value before the first edit (for revert)
  //   cellDirtyRef memberIds with cell edits not yet POSTed
  //   (write queue) memberId → tail of the member's WRITE QUEUE — every hours
  //                writer (cell drain, quick actions, EditAllocationModal)
  //                chains onto it so two full-map POSTs for one person can
  //                never race. Lives in lib/memberWriteQueue (module scope).
  //   cellBaseRef  memberId → last full week map a successful POST confirmed;
  //                advanced synchronously, so later queued writes never
  //                rebuild from a stale background refetch
  const teamRef      = useRef<ProjectTeamMember[]>([]);
  const cellValRef   = useRef<Map<string, number>>(new Map());
  const cellPrevRef  = useRef<Map<string, number>>(new Map());
  const cellDirtyRef = useRef<Set<string>>(new Set());
  const cellBaseRef  = useRef<Map<string, Record<string, number>>>(new Map());
  // Per-member save generation — bumped on EVERY new write intent (cell commit
  // or bulk Save). A post-save verification captures the generation once its
  // own writes finish; if a NEWER intent bumped it before the verify fetch
  // returned, that verification is obsolete — comparing against its outdated
  // values is what produced the false "server stored different hours" warning
  // on rapid back-to-back edits. Obsolete verifies are discarded: the newer
  // chain runs its own verification against its own values.
  const saveGenRef = useRef<Map<string, number>>(new Map());
  const bumpSaveGen = (id: string) =>
    saveGenRef.current.set(id, (saveGenRef.current.get(id) ?? 0) + 1);
  // Members whose last write FAILED — server state is ambiguous (it may or
  // may not have applied), so the next queued write must re-read server
  // truth before building its payload. The confirmed base is KEPT meanwhile:
  // falling back to the screen row could resurrect stale refetched values.
  const cellRebaseRef = useRef<Set<string>>(new Set());
  useEffect(() => { teamRef.current = team; }, [team]);
  const [selWeek,      setSelWeek]      = useState<string | null>(null);
  const [popupMounted, setPopupMounted] = useState(false);
  // Bumped after the inline add-member row saves, so the grid refetches its
  // own team data even when the parent's reloadKey doesn't change in time.
  const [localReload, setLocalReload] = useState(0);

  // ── ETC/EAC hover tooltip ─────────────────────────────────────────────────
  // Anchored under (or above, near the bottom edge) the hovered estimate cell.
  const [costTip, setCostTip] = useState<{ kind: CostTipKind; m: ProjectTeamMember; x: number; top: number; bottom: number } | null>(null);
  const showCostTip = (kind: CostTipKind, m: ProjectTeamMember) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setCostTip({ kind, m, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };
  const hideCostTip = () => setCostTip(null);
  // Dismiss on any scroll — the tooltip is fixed-positioned, so its coords go
  // stale the moment the grid (or page) scrolls under the cursor.
  useEffect(() => {
    if (!costTip) return;
    const onScroll = () => setCostTip(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [costTip]);

  // ── Toolbar member search / filter ──────────────────────────────────────
  // Typing in the search box filters the visible team rows directly; no popup.
  const [mSearch, setMSearch] = useState("");
  // Person seed for the inline add row (set by a search pick, cleared on close).
  const [addSeed, setAddSeed] = useState<{ personId: string; personName: string; title: string } | null>(null);
  // ── Frozen metadata column order ─────────────────────────────────────────
  // Kept separately from widths: a user can reorder labels without changing
  // any of the existing resize semantics.
  const dragInstructionsId = useId();
  const [columnOrderKey, setColumnOrderKey] = useState(teamScheduleColumnOrderKey);
  const [savedMetadataOrder, setSavedMetadataOrder] = useState<string[] | null>(() => readScheduleColumnOrder(teamScheduleColumnOrderKey()));
  const [draggedMetadataKey, setDraggedMetadataKey] = useState<string | null>(null);
  const [dropMetadataKey, setDropMetadataKey] = useState<string | null>(null);
  const [columnMoveAnnouncement, setColumnMoveAnnouncement] = useState("");

  useEffect(() => {
    const syncAuth = () => {
      const key = teamScheduleColumnOrderKey();
      setColumnOrderKey(key);
      setSavedMetadataOrder(readScheduleColumnOrder(key));
    };
    syncAuth();
    window.addEventListener("rmone:authChanged", syncAuth);
    return () => window.removeEventListener("rmone:authChanged", syncAuth);
  }, []);

  useEffect(() => {
    const load = () => setSavedMetadataOrder(readScheduleColumnOrder(columnOrderKey));
    const onStorage = (event: StorageEvent) => { if (event.key === columnOrderKey) load(); };
    const onChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
      if (!key || key === columnOrderKey) load();
    };
    load();
    window.addEventListener("storage", onStorage);
    window.addEventListener(SCHEDULE_COLUMN_ORDER_EVENT, onChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SCHEDULE_COLUMN_ORDER_EVENT, onChanged);
    };
  }, [columnOrderKey]);

  const orderedMetadataKeys = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    // Sanitise corrupted/stale values while retaining keys currently hidden by
    // business rules, so a temporarily hidden column returns in its old place.
    for (const key of savedMetadataOrder ?? []) {
      if ((ORDERABLE_METADATA_KEYS as readonly string[]).includes(key) && !seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
    for (const key of ORDERABLE_METADATA_KEYS) if (!seen.has(key)) result.push(key);
    return result;
  }, [savedMetadataOrder]);

  const persistMetadataOrder = (next: string[]) => {
    setSavedMetadataOrder(next);
    try {
      localStorage.setItem(columnOrderKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(SCHEDULE_COLUMN_ORDER_EVENT, { detail: { key: columnOrderKey } }));
    } catch {
      // Keep the changed order for this session when browser storage is blocked.
    }
  };

  const moveMetadataColumn = (from: string, to: string) => {
    if (from === to) return;
    const fromIndex = orderedMetadataKeys.indexOf(from);
    const toIndex = orderedMetadataKeys.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...orderedMetadataKeys];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    persistMetadataOrder(next);
    setColumnMoveAnnouncement(`${from === "name" ? "Name / Title" : from.toUpperCase()} column moved to position ${next.indexOf(from) + 1} of ${ORDERABLE_METADATA_KEYS.length}.`);
  };

  // ── Drag-to-resize frozen columns ─────────────────────────────────────────
  // Per-column width overrides keyed by frozenCols key, persisted per tenant
  // in localStorage. Dragging the right edge of a frozen sub-header resizes
  // that column live (rAF-throttled); double-clicking the handle resets it
  // back to the automatic width.
  const [colOverrides, setColOverrides] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(tenantScopedKey(COLW_LS_BASE));
      const parsed = raw ? JSON.parse(raw) as unknown : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          const n = Number(v);
          if (isFinite(n) && n > 0) out[k] = Math.min(COL_MAX, Math.max(COL_MIN, Math.round(n)));
        }
        return out;
      }
    } catch { /* corrupted saved entry — fall back to automatic widths */ }
    return {};
  });
  // Ref mirror so mouse handlers (bound once per drag) always read the
  // freshest overrides without re-binding on every render.
  const colOverridesRef = useRef(colOverrides);
  useEffect(() => { colOverridesRef.current = colOverrides; }, [colOverrides]);
  const persistColW = (next: Record<string, number>) => {
    try { localStorage.setItem(tenantScopedKey(COLW_LS_BASE), JSON.stringify(next)); }
    catch { /* storage blocked/full — widths still apply for this session */ }
  };

  // ── Show / hide the four ETC/EAC columns ──────────────────────────────────
  // Client-requested declutter toggle: hides ETC HRS / EAC HRS / ETC COST /
  // EAC COST in the frozen pane (the totals tiles above the grid stay).
  // Choice persists per tenant, default = visible.
  // EAC HRS always visible; the other 3 cost/hrs columns expand on demand.
  // Always starts collapsed — not persisted so every grid open is a clean slate.
  const [costColsExpanded, setCostColsExpanded] = useState<boolean>(false);
  const toggleCostCols = () => setCostColsExpanded(prev => !prev);
  const startColDrag = (e: React.MouseEvent, key: string, startW: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let raf: number | null = null;
    let lastX = startX;
    // A plain click (no real movement) must NOT write an override — some
    // columns auto-grow with content, and freezing them on an accidental
    // click would silently disable that until a double-click reset.
    const hadOverride = key in colOverridesRef.current;
    const clampW = (w: number) => Math.min(COL_MAX, Math.max(COL_MIN, Math.round(w)));
    const apply = () => {
      raf = null;
      const nw = clampW(startW + (lastX - startX));
      setColOverrides(prev => (prev[key] === nw ? prev : { ...prev, [key]: nw }));
    };
    const onMove = (ev: MouseEvent) => {
      lastX = ev.clientX;
      if (raf == null) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      const moved = Math.abs(lastX - startX) >= 3;
      let next: Record<string, number>;
      if (!moved && !hadOverride) {
        // No-op click: drop any override a stray 1–2px rAF tick may have set.
        next = { ...colOverridesRef.current };
        delete next[key];
      } else {
        next = { ...colOverridesRef.current, [key]: clampW(startW + (lastX - startX)) };
      }
      setColOverrides(next);
      persistColW(next);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const resetColW = (key: string) => {
    const cur = colOverridesRef.current;
    if (!(key in cur)) return;
    const next = { ...cur };
    delete next[key];
    setColOverrides(next);
    persistColW(next);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const mirrorScrollRef = useRef<HTMLDivElement>(null);
  const [scrollEdge, setScrollEdge] = useState<{ left: boolean; right: boolean }>({ left: false, right: true });

  // ── Load team + tasks ────────────────────────────────────────────────────
  // Always fetches fresh data in the background. When peekCache already seeded
  // team + tasks on mount (loading = false), this runs silently and updates the
  // view once the fetch completes. When the cache was cold (loading = true) this
  // is the primary load and shows a spinner until data arrives.
  useEffect(() => {
    let cancelled = false;
    // Only show the spinner when we have nothing to display yet.
    const hasPreseeded = team.length > 0;
    if (!hasPreseeded) { setLoading(true); setError(null); }
    // Team-first rendering: the two fetches run in parallel, but the grid
    // paints as soon as the TEAM call resolves — it must not wait for the
    // (often slower, phases-only) task-data call. Each promise updates its
    // own slice of state independently.
    void getProjectTeam(projectId, forceFreshTeam)
      .then((teamRes) => {
        if (cancelled) return;
        const freshTeam = filterSoloTeam(teamRes.team, soloMember);
        setTeam(prev => {
          // Initial load (grid was empty) — adopt server order directly.
          if (prev.length === 0) return freshTeam;
          // Reload after a mutation (e.g. hours save bumped reloadKey): preserve
          // the user-visible row order so members don't jump around just because
          // the DB happened to return them in a different order after the update.
          // 1. Keep existing rows in their current positions (updated with fresh data).
          // 2. Drop members the server no longer returns (removed from team).
          // 3. Append genuinely new members at the end.
          const freshMap = new Map(freshTeam.map(m => [(m.resourceId ?? m.name), m]));
          const existingIds = new Set(prev.map(p => p.resourceId ?? p.name));
          const preserved = prev
            .filter(p => freshMap.has(p.resourceId ?? p.name))
            .map(p => freshMap.get(p.resourceId ?? p.name)!);
          const added = freshTeam.filter(f => !existingIds.has(f.resourceId ?? f.name));
          return [...preserved, ...added];
        });
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (!hasPreseeded) setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    void getTaskData(projectId, "0")
      .then((taskRes) => {
        if (cancelled) return;
        const rawTasks = Array.isArray(taskRes) ? (taskRes as ScheduleTask[]) : [];
        setTasks(rawTasks.sort((a, b) =>
          Number(a.ItemOrder ?? a.StageStep ?? 0) - Number(b.ItemOrder ?? b.StageStep ?? 0)));
        setTasksLoaded(true);
        setTasksFailed(false);
      })
      .catch(() => {
        // Phases are additive — keep whatever we had, but mark the check as
        // settled so the UI doesn't wait forever on a failed schedule fetch.
        // tasksFailed prevents a transient fetch error from being read as
        // "this project has no schedule".
        if (!cancelled) { setTasksLoaded(true); setTasksFailed(true); }
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey, localReload, forceFreshTeam]);

  // ── Derived: sorted unique week keys + phase-per-week mapping ────────────
  const { allWeeks, phaseForWeek } = useMemo(() => {
    const weekSet = new Set<string>();
    for (const m of team) {
      for (const wh of (m.weeklyHours ?? [])) {
        if (wh.week) weekSet.add(wh.week);
      }
    }
    const isoOf = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // Phase-schedule tenants: always include EVERY week of the schedule span,
    // even weeks nobody has hours in yet, so hours can be added later right up
    // to the schedule end. Weeks with existing hours outside the span (legacy
    // data) are kept too via the union above.
    if (!hideSchedule && tasks.length > 0 && team.length > 0) {
      let sLo: Date | null = null, sHi: Date | null = null;
      for (const t of tasks) {
        const ds = parseISODate(t.StartDate), de = parseISODate(t.DueDate);
        if (ds && (!sLo || ds < sLo)) sLo = ds;
        if (de && (!sHi || de > sHi)) sHi = de;
      }
      if (sLo && sHi && sHi >= sLo) {
        let cur = mondayOf(sLo);
        const last = mondayOf(sHi);
        for (let i = 0; i < 104 && cur <= last; i++) {   // hard cap: 2 years of columns
          weekSet.add(isoOf(cur));
          cur = new Date(cur); cur.setDate(cur.getDate() + 7);
        }
      }
    }
    // Fallback: members are assigned but nobody has weekly hours yet — build
    // week columns so the grid still renders in tabular form and "Edit
    // Allocation" has cells to type into. The span prefers the PHASE SCHEDULE
    // (weeks must line up with the phases hours are planned against), then
    // member assignment dates, then the project's target dates. When the
    // tenant uses phase schedules (hideSchedule=false) and none is assigned
    // yet, we deliberately do NOT synthesize — the render below shows a clear
    // "add a schedule first" notice instead of an editable grid.
    if (weekSet.size === 0 && team.length > 0 && (hideSchedule || tasks.length > 0)) {
      let lo: Date | null = null, hi: Date | null = null;
      const widen = (s?: unknown, e?: unknown) => {
        const ds = parseISODate(s), de = parseISODate(e);
        if (ds && (!lo || ds < lo)) lo = ds;
        if (de && (!hi || de > hi)) hi = de;
      };
      for (const t of tasks) widen(t.StartDate, t.DueDate);
      if (!lo || !hi) widen(scheduleStart, scheduleEnd);
      if (!lo || !hi) for (const m of team) widen(m.startDate, m.endDate);
      if (!lo || !hi) widen(projectStartDate, projectEndDate);
      let loD: Date = lo ?? mondayOf(new Date());
      let hiD: Date = hi ?? loD;
      if (hiD < loD) hiD = loD;
      // Single-day / missing spans still get a usable editing window (~12 weeks).
      if ((hiD.getTime() - loD.getTime()) < 7 * 86400000 * 4) {
        hiD = new Date(loD); hiD.setDate(hiD.getDate() + 7 * 11);
      }
      let cur = mondayOf(loD);
      const last = mondayOf(hiD);
      for (let i = 0; i < 104 && cur <= last; i++) {   // hard cap: 2 years of columns
        weekSet.add(isoOf(cur));
        cur = new Date(cur); cur.setDate(cur.getDate() + 7);
      }
    }
    // ISO "YYYY-MM-DD" keys sort correctly as plain strings
    const allWeeks = Array.from(weekSet).sort();

    const phaseForWeek = new Map<string, number>();
    for (let pi = 0; pi < tasks.length; pi++) {
      const p = tasks[pi];
      const start = parseISODate(p.StartDate);
      const end   = parseISODate(p.DueDate);
      if (!start || !end) continue;
      for (const wk of allWeeks) {
        const d = parseISODate(wk);   // wh.week is ISO "YYYY-MM-DD", not "DD-Mon-YY"
        if (!d) continue;
        const wkMon = mondayOf(d);
        const wkSun = new Date(wkMon.getTime() + 6 * 86400000);
        if (wkMon <= end && wkSun >= start && !phaseForWeek.has(wk)) {
          phaseForWeek.set(wk, pi);
        }
      }
    }
    return { allWeeks, phaseForWeek };
  }, [team, tasks, hideSchedule, scheduleStart, scheduleEnd, projectStartDate, projectEndDate]);

  // ── External hour writers (EditAllocationModal) ──────────────────────────
  // The modal saves through the SAME per-member queue (lib/memberWriteQueue),
  // but it can't reach this component's confirmed-base refs. It announces its
  // outcome instead, and we mirror the grid's own bookkeeping: success →
  // advance the confirmed base to what the modal POSTed (server full-replace:
  // any week not in its payload is now 0) and clear the rebase flag; failure →
  // server state is ambiguous, keep the base and flag the member so the next
  // queued write re-reads server truth first.
  const allWeeksRef = useRef<string[]>([]);
  useEffect(() => { allWeeksRef.current = allWeeks; }, [allWeeks]);
  useEffect(() => {
    return subscribeMemberWrites(projectId, ({ memberId, weekMap, ok }) => {
      if (!ok || !weekMap) {
        cellRebaseRef.current.add(memberId);
        return;
      }
      const base: Record<string, number> = {};
      for (const wk of allWeeksRef.current) base[wk] = 0;
      for (const [wk, hrs] of Object.entries(weekMap)) base[wk] = hrs;
      cellBaseRef.current.set(memberId, base);
      cellRebaseRef.current.delete(memberId);
    });
  }, [projectId]);

  // ── Schedule-first gate ───────────────────────────────────────────────────
  // When the tenant plans hours against phase schedules (hideSchedule=false)
  // and this project has no schedule assigned yet, block hour entry and show
  // a clear "add a schedule first" notice instead. Only applies while nobody
  // has weekly hours — legacy projects with hours but no schedule still render.
  const needsSchedule =
    !hideSchedule && tasksLoaded && !tasksFailed && tasks.length === 0 &&
    team.length > 0 && !team.some(m => (m.weeklyHours ?? []).length > 0);

  // ── Inline "Add member" row (opens INSIDE the grid, below the last member
  // row) — toggled from the "+ Add member" button in the toolbar above.
  const [addOpen, setAddOpen] = useState(false);

  // ── Current week key (ISO, matching wh.week format) ──────────────────────
  const nowWeekKey = useMemo(() => {
    const mon = mondayOf(new Date());
    return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
  }, []);

  // ── Past-edit lock ────────────────────────────────────────────────────────
  // Shared with PhaseBreakdown, Quick Actions and the canonical save helper.
  const isWeekLocked = (wk: string): boolean =>
    getPastWeekEditStateFor(wk, module).locked;

  // ── Phase-UI visibility + column sizing ──────────────────────────────────
  // showPhaseUI: phase cards / detail / header row / colouring are only shown
  // when a schedule exists AND settings don't hide it.
  const showPhaseUI = !hideSchedule && tasks.length > 0;

  // ── Schedule bounds for the date-range picker ────────────────────────────
  // Only when the tenant plans hours against a phase schedule (same condition
  // as showPhaseUI): the "Set hours for a date range" dates are clamped to the
  // schedule's first phase start → last phase end. Other display modes
  // (no-schedule variants in Settings) keep free date entry.
  const schedBounds = useMemo(() => {
    if (hideSchedule || tasks.length === 0) return null;
    let lo: Date | null = null, hi: Date | null = null;
    for (const t of tasks) {
      const s = parseISODate(t.StartDate), e = parseISODate(t.DueDate);
      if (s && (!lo || s < lo)) lo = s;
      if (e && (!hi || e > hi)) hi = e;
    }
    if (!lo || !hi) return null;
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { min: iso(lo), max: iso(hi) };
  }, [hideSchedule, tasks]);

  // ── Frozen org columns — shown only when the tenant actually has data ────
  // BU / DIVISION / DEPT each render only when at least one member carries a
  // value (BU and DEPT additionally respect the business-rule visibility
  // flags). m.memberBu = Business Unit, m.bu = Division title, m.dept =
  // Department. ROLE / NAME / EAC / ETC always render.
  // rulesVersion subscribes this memo to business-rule loads so the column
  // set reacts when rules resolve after mount.
  const rulesVersion = useBusinessRulesVersion();

  // ── Auto-expanding hour/cost column widths ───────────────────────────────
  // Four columns: ETC HRS / EAC HRS (hours) and ETC COST / EAC COST (cost).
  // Width follows the longest rendered value (e.g. "12345h" / "$1234K") so
  // large numbers expand the column instead of being clipped. W_EAC / W_ETC
  // stay as minimums for typical 2-3 digit values.
  const hourCostColW = useMemo(() => {
    let etcHrsLen = 3, eacHrsLen = 3, etcCostLen = 3, eacCostLen = 3;
    for (const m of team) {
      etcHrsLen  = Math.max(etcHrsLen,  (m.etcHrs ? `${Math.round(m.etcHrs)}h` : "—").length);
      eacHrsLen  = Math.max(eacHrsLen,  (m.eacHrs ? `${Math.round(m.eacHrs)}h` : "—").length);
      etcCostLen = Math.max(etcCostLen, fmtEtcCost(m.etcCost).length);
      eacCostLen = Math.max(eacCostLen, fmtEtcCost(m.eacCost).length);
    }
    const hrsW  = (n: number) => Math.max(W_EAC, Math.round(n * 6.8) + 14);
    const costW = (n: number) => Math.max(W_ETC, Math.round(n * 6.4) + 14);
    return {
      etcHrs:  hrsW(etcHrsLen),
      eacHrs:  hrsW(eacHrsLen),
      etcCost: costW(etcCostLen),
      eacCost: costW(eacCostLen),
    };
  }, [team]);

  // NAME / TITLE keeps the name readable in the frozen pane. The wider
  // baseline is balanced by showing eight weeks rather than ten, so the
  // weekly timeline still has useful week-cell widths.
  const nameColW = useMemo(() => {
    // Full display name drives the width so "Adam Johnson" never truncates to
    // "Adam". Capped so one very long name can't eat the weekly timeline —
    // past the cap the cell ellipsizes and the hover title shows the rest.
    const longest = team.reduce((mx, m) => Math.max(mx, String(m.name || "").trim().length), 0);
    return Math.max(W_NAME, Math.min(260, 68 + Math.round(longest * 7.5)));
  }, [team]);

  /** Names that appear more than once in the current team — used to decide
   *  whether to render a disambiguation hint beside a member's name. */
  const dupNames = useMemo<ReadonlySet<string>>(() => {
    const counts: Record<string, number> = {};
    for (const m of team) counts[m.name] = (counts[m.name] ?? 0) + 1;
    return new Set(Object.keys(counts).filter(n => counts[n] > 1));
  }, [team]);

  const frozenCols = useMemo(() => {
    const { showBusinessUnit, showDivision, showDepartment } = getBusinessRules();
    const cols: { key: string; label: string; w: number }[] = [];
    // Show org columns whenever the tenant has them enabled — unconditionally.
    // Do NOT gate on whether any current member has a value: that caused the
    // column to appear (or disappear) mid-session when Change Resource assigned
    // someone with a BU, shifting every other column and breaking alignment.
    if (showBusinessUnit) cols.push({ key: "bu", label: "BU", w: W_BU });
    if (showDivision) cols.push({ key: "division", label: "DIVISION", w: W_DIV });
    if (showDepartment) cols.push({ key: "dept", label: "DEPT", w: W_DEPT });
    cols.push({ key: "role", label: "ROLE", w: W_ROLE });
    cols.push({ key: "name", label: "NAME / TITLE", w: nameColW });
    // FLAGS — soft-allocation / non-chargeable / lock sub-slots. Takes a
    // column when any member carries a flag — and always for manage-staff
    // viewers, so they can set the FIRST flag from the empty slots.
    if (team.some(m => m.softAllocation || m.nonChargeable || m.isLocked) || canUnlock) {
      cols.push({ key: "flags", label: "FLAGS", w: W_FLAGS });
    }
    // No-schedule display mode: assignment Start / End dates get their own
    // columns right after NAME — member rows show their dates and the inline
    // add-member row picks dates here (no floating card under the grid).
    if (hideSchedule) {
      cols.push({ key: "start", label: "START", w: W_DATE });
      cols.push({ key: "end", label: "END", w: W_DATE });
    }
    // EAC HRS is always visible (most useful single column for construction).
    // The other 3 only appear when the user expands via the ‹› in the header.
    // EAC HRS is always visible (the anchor column that carries the toggle).
    // When expanded: EAC HRS → ETC HRS → ETC COST → EAC COST.
    cols.push({ key: "eacHrs", label: "EAC HRS", w: hourCostColW.eacHrs });
    if (costColsExpanded) {
      cols.push({ key: "etcHrs",  label: "ETC HRS",  w: hourCostColW.etcHrs  });
      cols.push({ key: "etcCost", label: "ETC COST", w: hourCostColW.etcCost });
      cols.push({ key: "eacCost", label: "EAC COST", w: hourCostColW.eacCost });
    }
    // Actions column: green schedule-hours button (editors) and/or the red
    // remove ✕ (manage-staff — presence of onRemoveMember IS the gate; the
    // page only passes it when the viewer holds the capability). Both
    // visible → widen so the two 26px buttons sit side by side.
    if (canEdit) cols.push({ key: "act", label: "", w: W_ACT });
    // Metadata may move only within its own section. Financial totals and
    // actions retain their canonical trailing order.
    const meta = cols
      .filter(c => (ORDERABLE_METADATA_KEYS as readonly string[]).includes(c.key))
      .sort((a, b) => orderedMetadataKeys.indexOf(a.key) - orderedMetadataKeys.indexOf(b.key));
    const protectedCols = cols.filter(c => !(ORDERABLE_METADATA_KEYS as readonly string[]).includes(c.key));
    // Apply the user's drag-resize overrides (persisted per tenant). The
    // "act" (actions) column keeps its fixed width — it has no drag handle.
    return [...meta, ...protectedCols].map(c => {
      const ov = c.key === "act" ? undefined : colOverrides[c.key];
      return typeof ov === "number" ? { ...c, w: ov } : c;
    });
  }, [team, rulesVersion, hourCostColW, canEdit, onRemoveMember, nameColW, hideSchedule, colOverrides, costColsExpanded, orderedMetadataKeys]);
  const FROZEN_W = frozenCols.reduce((s, c) => s + c.w, 0);
  const hasOrgCol = (k: string) => frozenCols.some(c => c.key === k);
  // Effective width of a frozen column — row cells read THIS (not the W_*
  // constants) so they track drag-resize overrides in lockstep with the header.
  const colW = (k: string) => frozenCols.find(c => c.key === k)?.w ?? 0;
  const colOrder = (k: string) => frozenCols.findIndex(c => c.key === k);

  // ── Fit-to-page week window ──────────────────────────────────────────────
  // The default view shows roughly one month (today −15d … +15d): week
  // columns are sized so that window fills the visible grid width, and the
  // horizontal scroller reaches every other week. When the project has no
  // weeks near today (fully past or future), fall back to a ~5-column window
  // centred on the nearest week.
  const [gridW, setGridW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setGridW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [allWeeks.length]);

  const { windowStartIdx, windowCount } = useMemo(() => {
    if (allWeeks.length === 0) return { windowStartIdx: 0, windowCount: 0 };
    const isoOf = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // Default view starts AT today's week (user mandate) — no look-back week.
    const today = new Date();
    const lo = new Date(today);
    const hi = new Date(today); hi.setDate(hi.getDate() + 77);
    const loKey = isoOf(mondayOf(lo));
    const hiKey = isoOf(mondayOf(hi));
    let start = -1, end = -1;
    for (let i = 0; i < allWeeks.length; i++) {
      const wk = allWeeks[i];
      if (wk >= loKey && wk <= hiKey) { if (start < 0) start = i; end = i; }
    }
    // No-schedule mode shows START/END date columns in the frozen pane, so the
    // week window shrinks to 3 columns to keep everything on screen. Normal
    // weekly mode uses eight columns so the wider NAME / TITLE pane remains
    // readable without making each week cell too narrow.
    const maxWin = hideSchedule ? 3 : 8;
    // The window is ALWAYS maxWin columns when that many weeks exist (user
    // mandate): near the end of a schedule only a week or two lies ahead of
    // today, and sizing columns to just those made each week span the whole
    // page. Pull earlier weeks in so the page stays full — the window then
    // ends at the last week instead of starting at today's. When the project
    // has fewer weeks than maxWin in total, the columns stretch to fit.
    const desired = Math.min(maxWin, allWeeks.length);
    if (start >= 0) {
      void end; // forward extent no longer caps the window
      return {
        windowStartIdx: Math.max(0, Math.min(start, allWeeks.length - desired)),
        windowCount: desired,
      };
    }
    // No weeks near today — centre an ~8-week (3 in no-schedule mode) window
    // on the nearest week.
    const nowMs = new Date(nowWeekKey).getTime();
    let nearest = 0, best = Infinity;
    for (let i = 0; i < allWeeks.length; i++) {
      const diff = Math.abs(new Date(allWeeks[i]).getTime() - nowMs);
      if (diff < best) { best = diff; nearest = i; }
    }
    const count = Math.min(hideSchedule ? 3 : 8, allWeeks.length);
    const s = Math.max(0, Math.min(nearest - Math.floor(count / 2), allWeeks.length - count));
    return { windowStartIdx: s, windowCount: count };
  }, [allWeeks, nowWeekKey, hideSchedule]);

  // Week columns also auto-expand when any single week's hours reach ~5
  // digits, so long values don't get clipped inside the cells.
  const maxHourChars = useMemo(() => {
    let mx = 1;
    for (const m of team) {
      for (const wh of (m.weeklyHours ?? [])) {
        mx = Math.max(mx, String(Math.round(wh.hours)).length);
      }
    }
    return mx;
  }, [team]);
  const colMinW = maxHourChars >= 5 ? maxHourChars * 8 + 14 : COL_W;

  // Week column width: the window's weeks share the visible area (never
  // narrower than colMinW). Until the container is measured, use colMinW.
  const weekColW = (() => {
    if (!gridW || !windowCount) return colMinW;
    const avail = gridW - FROZEN_W;
    if (avail <= colMinW) return colMinW;
    return Math.max(colMinW, Math.floor(avail / windowCount));
  })();

  // When the schedule spans only a few weeks the columns flex-grow far wider
  // than weekColW, and the diagonal label anchored at each cell's left edge
  // looks lost in the wide empty header. If every column is wide enough to
  // fit the full "23 FEB 26" label horizontally (~66px at 10px bold + side
  // padding), render it flat and centered instead. effWeekW mirrors the
  // flex distribution: equal share of the container once minimums are met.
  const effWeekW = gridW && allWeeks.length
    ? Math.max(weekColW, Math.floor((gridW - FROZEN_W) / allWeeks.length))
    : weekColW;
  const flatWeekHead = effWeekW >= 84;
  // Week header = date zone + dedicated hours/util strip (20px). The diagonal
  // zone must be tall enough for the full rotated "23 FEB 26" label (~50px
  // vertical extent) or the sticky-header clip cuts its top; the flat centered
  // variant needs far less.
  const HEAD_H = flatWeekHead ? 48 : 80;
  const weekCellSizing = { flex: `1 0 ${weekColW}px`, minWidth: weekColW } as const;

  // ACTUAL rendered week-column width. Week cells flex-GROW past weekColW when
  // the container is wider than the columns' combined minimum, so any scroll
  // math based on the nominal weekColW lands short. Measure the real width
  // from the scroller's content instead.
  const actualWeekW = (el: HTMLElement) =>
    allWeeks.length ? Math.max(weekColW, (el.scrollWidth - FROZEN_W) / allWeeks.length) : weekColW;

  // Focused week index: when the caller passed a focusDate (Gantt popup —
  // the user clicked a specific month on a member's bar), the initial scroll
  // targets the week containing that date instead of the default today-window.
  // Exact Monday match first, nearest week otherwise (clicks outside the
  // member's weeks land on the closest edge).
  const focusIdx = useMemo(() => {
    if (!focusDate || allWeeks.length === 0) return -1;
    const d = new Date(focusDate.slice(0, 10) + "T00:00:00");
    if (isNaN(d.getTime())) return -1;
    const key = isoOfDate(mondayOf(d));
    const target = new Date(key + "T00:00:00").getTime();
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < allWeeks.length; i++) {
      if (allWeeks[i] === key) return i;
      const diff = Math.abs(new Date(allWeeks[i] + "T00:00:00").getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }, [focusDate, allWeeks]);

  // One-time auto-scroll (per data load) that brings the window's first week
  // into view right after the frozen block. Runs only after the container is
  // measured (so weekColW is final) and never fights user scrolling after.
  const autoScrolledFor = useRef("");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !gridW || allWeeks.length === 0) return;
    const key = `${allWeeks[0]}|${allWeeks.length}|${allWeeks[allWeeks.length - 1]}|${focusIdx}`;
    if (autoScrolledFor.current === key) return;
    autoScrolledFor.current = key;
    el.scrollLeft = (focusIdx >= 0 ? focusIdx : windowStartIdx) * actualWeekW(el);
  }, [gridW, allWeeks, windowStartIdx, weekColW, focusIdx]);

  // Track scroll position so chevron buttons show/hide correctly
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const atLeft  = el.scrollLeft <= 2;
      const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
      setScrollEdge({ left: !atLeft, right: !atRight });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [gridW, allWeeks]);

  // Sync the thin mirror scrollbar ↔ the hidden main scroll container. The
  // explicit one-event echo guards are important: a scrollLeft assignment fires
  // its scroll event on a later frame in some browsers, and treating that echo
  // as new user input can cancel an in-flight smooth chevron/phase jump.
  useEffect(() => {
    const main   = scrollRef.current;
    const mirror = mirrorScrollRef.current;
    if (!main || !mirror) return;
    let ignoreNextMain = false;
    let ignoreNextMirror = false;
    const setMirror = (left: number) => {
      if (Math.abs(mirror.scrollLeft - left) < 1) return;
      ignoreNextMirror = true;
      mirror.scrollLeft = left;
    };
    const setMain = (left: number) => {
      if (Math.abs(main.scrollLeft - left) < 1) return;
      ignoreNextMain = true;
      main.scrollLeft = left;
    };
    const onMain = () => {
      if (ignoreNextMain) {
        ignoreNextMain = false;
        return;
      }
      setMirror(main.scrollLeft);
    };
    const onMirror = () => {
      if (ignoreNextMirror) {
        ignoreNextMirror = false;
        return;
      }
      setMain(mirror.scrollLeft);
    };
    setMirror(main.scrollLeft);
    main.addEventListener("scroll",   onMain,   { passive: true });
    mirror.addEventListener("scroll", onMirror, { passive: true });
    return () => {
      main.removeEventListener("scroll",   onMain);
      mirror.removeEventListener("scroll", onMirror);
    };
    // Re-attach when the grid (re)mounts: on a cold load allWeeks is empty on
    // first render, the scroller/mirror don't exist yet, and a []-dep effect
    // would never bind the sync at all.
  }, [allWeeks.length]);

  /** Phase index for a week — always -1 (no phase colouring) when phase UI is hidden. */
  const piOf = (wk: string) => (showPhaseUI ? (phaseForWeek.get(wk) ?? -1) : -1);

  // ── Phase column-group spans ──────────────────────────────────────────────
  const phaseSpans = useMemo(() => {
    if (!allWeeks.length) return [];
    type Span = { pi: number; start: number; count: number };
    const spans: Span[] = [];
    let cur = phaseForWeek.get(allWeeks[0]) ?? -1;
    let start = 0;
    for (let i = 1; i <= allWeeks.length; i++) {
      const pi = i < allWeeks.length ? (phaseForWeek.get(allWeeks[i]) ?? -1) : -2;
      if (pi !== cur) { spans.push({ pi: cur, start, count: i - start }); cur = pi; start = i; }
    }
    return spans;
  }, [allWeeks, phaseForWeek]);

  // ── Phase-start border map ────────────────────────────────────────────────
  // The phase header row paints a 2px coloured left border at each phase
  // boundary.  Build a map so every cell row (date header, Hrs/Week, member
  // rows, weekly total) can draw the SAME border — making the vertical phase
  // dividers run continuously from top to bottom instead of floating.
  const weekBorderLeft = useMemo(() => {
    const m = new Map<string, string>();
    for (let i = 0; i < allWeeks.length; i++) {
      const wk = allWeeks[i];
      const pi = showPhaseUI ? (phaseForWeek.get(wk) ?? -1) : -1;
      if (pi >= 0) {
        const prevPi = i > 0 ? (phaseForWeek.get(allWeeks[i - 1]) ?? -1) : -1;
        if (pi !== prevPi) {
          m.set(wk, `2px solid ${phaseColor(pi)}55`);
          continue;
        }
      }
      m.set(wk, `1px solid ${C.cellBorder}`);
    }
    return m;
  }, [allWeeks, phaseForWeek, showPhaseUI]);

  // ── Default phase selection = the phase containing TODAY ─────────────────
  // The phase-card strip used to default to the FIRST phase. User mandate:
  // the card covering the present week must be pre-selected — in BOTH the
  // Gantt-view overview and the Schedule view. Runs once per project when
  // tasks land and never overrides a click the user already made. No scroll
  // here: the grid's own window logic already centres on the current week.
  const phaseAutoSelRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showPhaseUI || tasks.length === 0) return;
    if (phaseAutoSelRef.current === projectId) return;
    phaseAutoSelRef.current = projectId;
    const today = new Date();
    // Prefer the phase whose window contains today…
    let idx = tasks.findIndex(t => {
      const s = parseISODate(t.StartDate), e = parseISODate(t.DueDate);
      return !!s && !!e && today >= s && today.getTime() < e.getTime() + 86400000;
    });
    // …else the phase the current-week column maps to (grid colouring)…
    if (idx < 0) idx = phaseForWeek.get(nowWeekKey) ?? -1;
    // …else (before the schedule or in a gap between phases) the next
    // upcoming phase; after the schedule ends → the last phase.
    if (idx < 0) {
      idx = tasks.findIndex(t => { const s = parseISODate(t.StartDate); return !!s && s > today; });
      if (idx < 0) idx = tasks.length - 1;
    }
    setSelPhase(idx);
  }, [tasks, showPhaseUI, projectId, phaseForWeek, nowWeekKey]);

  /** True when a member counts as assigned during phase `pi`: has hours in a
      week of that phase, OR has no hours ANYWHERE yet (newly-added members
      must stay visible so their hours can be entered). Members whose hours
      all sit in OTHER phases are hidden — exactly the user's ask. An
      assignment-span test was deliberately rejected: spans commonly default
      to the whole project window, which would make this filter a no-op. */
  const memberInPhase = (m: ProjectTeamMember, pi: number): boolean => {
    let anyHours = false;
    for (const wh of (m.weeklyHours ?? [])) {
      if (wh.hours > 0) {
        anyHours = true;
        if (phaseForWeek.get(wh.week) === pi) return true;
      }
    }
    return !anyHours;
  };

  // Always show all team members regardless of which phase card is selected.
  // Phase selection only scrolls the week columns into view — it never hides rows.
  const mSearchQ = mSearch.trim().toLowerCase();
  const gridTeam = mSearchQ
    ? team.filter(m => m.name.toLowerCase().includes(mSearchQ))
    : team;

  // ── Phase summary stats ───────────────────────────────────────────────────
  const phaseSummaries = useMemo(() =>
    tasks.map((t, pi) => {
      let totalHrs = 0;
      const teamInPhase: { name: string; hrs: number }[] = [];
      for (const m of team) {
        let mHrs = 0;
        for (const wh of (m.weeklyHours ?? [])) {
          if (phaseForWeek.get(wh.week) === pi) { totalHrs += wh.hours; mHrs += wh.hours; }
        }
        // Only members actually assigned during this phase are listed (user
        // request): any hours in the phase, OR no hours anywhere yet — so
        // newly-added members stay visible before weekly hours are entered.
        // Members whose hours all sit in other phases are hidden.
        const anyHours = (m.weeklyHours ?? []).some(wh => wh.hours > 0);
        if (mHrs > 0 || !anyHours) teamInPhase.push({ name: m.name, hrs: mHrs });
      }
      const pct = Number(t.PercentComplete ?? 0);
      return { totalHrs, spentHrs: Math.round(totalHrs * pct / 100), teamInPhase, pct };
    }),
  [tasks, team, phaseForWeek]);

  // ── Grand totals ──────────────────────────────────────────────────────────
  const totals = useMemo(() => ({
    eacHrs:  Math.round(team.reduce((s, m) => s + (m.eacHrs || 0), 0)),
    etcHrs:  Math.round(team.reduce((s, m) => s + (m.etcHrs || 0), 0)),
    etcCost: Math.round(team.reduce((s, m) => s + (m.etcCost || 0), 0)),
    eacCost: Math.round(team.reduce((s, m) => s + (m.eacCost || 0), 0)),
  }), [team]);

  // ── Week-popup data ───────────────────────────────────────────────────────
  const weekPopupRows = useMemo(() => {
    if (!selWeek) return null;
    const wwh = Math.max(1, getBusinessRules().workWeekHours ?? 40);
    const rows = team
      .map(m => {
        const h    = (m.weeklyHours ?? []).find(wh => wh.week === selWeek)?.hours ?? 0;
        const util = Math.round((h / wwh) * 100);
        return { name: m.name, role: m.role ?? "", h, util };
      })
      .filter(r => r.name)
      .sort((a, b) => b.h - a.h);
    const active   = rows.filter(r => r.h > 0);
    const totalH   = active.reduce((s, r) => s + r.h, 0);
    const avgUtil  = active.length > 0 ? Math.round(active.reduce((s, r) => s + r.util, 0) / active.length) : 0;
    return { rows, active, idle: rows.filter(r => r.h === 0), totalH, avgUtil, wwh };
  }, [team, selWeek]);

  useEffect(() => {
    if (selWeek) { const t = requestAnimationFrame(() => setPopupMounted(true)); return () => cancelAnimationFrame(t); }
    setPopupMounted(false);
    return undefined;
  }, [selWeek]);

  // ── Weekly column totals (read mode) ─────────────────────────────────────
  const weekTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const mem of team) {
      for (const wh of (mem.weeklyHours ?? [])) {
        if (wh.hours > 0) m.set(wh.week, (m.get(wh.week) ?? 0) + wh.hours);
      }
    }
    return m;
  }, [team]);

  // ── Batch edit mode ───────────────────────────────────────────────────────
  // No longer user-triggered (the old "Edit Allocation" button is gone —
  // cells are edited directly in the grid). Still entered programmatically by
  // fixMismatch so the user can confirm and re-save mismatched weeks.
  function cancelEdit() {
    setEditMode(false); setEditHours({}); setSaveErr(null);
    // Clear any batch-cell over-limit errors — they are keyed `${memberId}|${wk}`.
    setWeekInputErrors(prev => {
      const remaining = new Set(Array.from(prev).filter(k => !k.includes("|")));
      return remaining.size === prev.size ? prev : remaining;
    });
  }

  function setHour(memberId: string, wk: string, val: number) {
    // Store the raw (possibly over-limit) value so it stays visible.
    // The error flag is already set by validateWeeklyInput on the onChange
    // handler — setHour just persists whatever the input held.
    setEditHours(prev => ({
      ...prev,
      [memberId]: { ...(prev[memberId] ?? {}), [wk]: Math.max(0, val) },
    }));
  }

  // ── Save all edits ────────────────────────────────────────────────────────
  async function saveEdits() {
    // Block save when any BATCH CELL input still holds an over-168h value.
    // Batch cell keys are keyed `${memberId}|${wk}`.  The "flat" / "range"
    // modal keys live in weekInputErrors too but those modals block their own
    // Apply buttons directly — they must not prevent this batch save.
    const batchErrors = Array.from(weekInputErrors).filter(k => k.includes("|"));
    if (batchErrors.length > 0) {
      setSaveErr(`One or more weekly hours exceed ${MAX_WEEK_HOURS}h — the maximum is ${MAX_WEEK_HOURS}h/week (${MAX_WEEK_HOURS_HINT}). Correct the highlighted cells before saving.`);
      return;
    }
    // Belt-and-braces: scan editHours directly for any over-limit value that
    // could slip in via a path that bypassed validateWeeklyInput.
    for (const [mid, weeks] of Object.entries(editHours)) {
      for (const [wk, h] of Object.entries(weeks)) {
        if (h > MAX_WEEK_HOURS) {
          const m = team.find(tm => (tm.resourceId ?? tm.name) === mid);
          setSaveErr(`${m?.name ?? mid}: the week of ${wk} is set to ${h}h — the maximum is ${MAX_WEEK_HOURS}h/week. Correct it before saving.`);
          return;
        }
      }
    }
    setSaving(true);
    setSaveErr(null);
    // Let every queued per-member write (cell drains, quick actions, an
    // EditAllocationModal save) settle first. This is a courtesy drain only —
    // real serialization happens below: each member's POST is CHAINED onto
    // that member's queue tail, so a write queued after this snapshot still
    // cannot race the bulk write. Queue tails never reject.
    await Promise.all(pendingProjectWrites(projectId));
    // Week keys convert via the module-level isoToWeekKey (pure string split,
    // no timezone drift).
    // Track exactly what was sent for each member so we can verify after reload.
    const intended: Record<string, Record<string, number>> = {};
    // Generation snapshot per edited member, taken the moment their write is
    // recorded — the verification below only applies while it is still current.
    const genAtSave = new Map<string, number>();
    try {
      // Make sure allocation records are loaded — fixMismatch kicks off the
      // fetch without awaiting it, so a fast Save could otherwise find
      // rawAllocs still empty and silently skip every member.
      const allocs = await ensureQuickAllocs();
      for (const m of team) {
        const memberId = m.resourceId ?? m.name;
        const edits = editHours[memberId];
        if (!edits) continue;
        const orig = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
        const changed = Object.entries(edits).some(([wk, h]) => (orig[wk] ?? 0) !== h);
        if (!changed) continue;

        const memberAlloc = matchMemberAlloc(allocs, { name: m.name, resourceId: m.resourceId }, projectId);
        if (!memberAlloc) continue;

        // Chain this member's bulk write onto their shared queue tail —
        // payload built at OUR queue turn from the CONFIRMED base (same rule
        // as cell drains / quick actions), so a modal/cell write queued
        // before or after this one serializes cleanly instead of racing it
        // (last full-map write wins wholesale server-side).
        // Errors propagate to the outer catch via the returned promise.
        await queueMemberWrite(memberId, async () => {
          try {
            const base = await resolveBaseMap(memberId);
            if (!base) {
              throw new Error(`${m.name} is no longer on the team — refresh the page and try again.`);
            }
            const weekMap = { ...base };
            for (const [wk, hrs] of Object.entries(edits)) weekMap[wk] = hrs;

            const allocations = buildPhaseHourAllocations(weekMap, memberAlloc);
            const result = await updateHoursAllocation({ ProjectID: projectId, Allocations: allocations });
            // The SP returns HTTP 200 with {raw:"Error"} when DivisionLookup /
            // JobTitleLookup / Title are missing from the payload. Treat that as a
            // hard failure so the user sees an error instead of a silent no-op.
            if (
              (result as any)?.raw === "Error" ||
              (result as any)?.raw === "error" ||
              result === "Error"
            ) {
              throw new Error(
                `Save rejected for ${m.name} — edit this member's assignment once (pencil icon on the member card) to repair the allocation record, then try again.`
              );
            }
            // Advance the confirmed base SYNCHRONOUSLY — writers queued
            // behind this bulk write build on what it just stored, never on
            // the pre-bulk base (which would resurrect pre-bulk hours).
            cellBaseRef.current.set(memberId, { ...weekMap });
            cellRebaseRef.current.delete(memberId);
          } catch (e) {
            // Server state ambiguous — keep the confirmed base and make the
            // next queued write for this member re-read server truth first.
            cellRebaseRef.current.add(memberId);
            throw e;
          }
        });
        // Record ONLY the weeks that actually changed so unchanged weeks
        // that aren't returned by the server don't create false-positive mismatches.
        const origForVerify = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
        intended[memberId] = Object.fromEntries(
          Object.entries(edits).filter(([wk, h]) => (origForVerify[wk] ?? 0) !== h)
        );
        bumpSaveGen(memberId);
        genAtSave.set(memberId, saveGenRef.current.get(memberId) ?? 0);
      }
      // ── Optimistic update ────────────────────────────────────────────────
      // Immediately patch local team state from editHours so the grid reflects
      // the new values without waiting for a network round-trip.  The onReload
      // call below then re-fetches fresh data in the background to keep the
      // surrounding page (EAC/ETC header, Team List) in sync.
      setTeam(prev => prev.map(m => {
        const memberId = m.resourceId ?? m.name;
        const edits = intended[memberId];   // only members that actually changed
        if (!edits) return m;
        const editMap = new Map(Object.entries(edits));
        let dEtc = 0, dEac = 0;
        const updatedWeekly = (m.weeklyHours ?? []).map(wh => {
          if (!editMap.has(wh.week)) return wh;
          const nh = editMap.get(wh.week)!;
          const d = nh - (wh.hours ?? 0);
          dEac += d;
          if (wh.week >= nowWeekKey) dEtc += d;
          return { ...wh, hours: nh };
        });
        // ETC/EAC summary fields move with the same optimistic update.
        return applyCostDeltas({ ...m, weeklyHours: updatedWeekly }, dEtc, dEac);
      }));
      setEditMode(false);
      setEditHours({});
      setSaveIntended(intended);
      // Bust the specific team cache key then re-fetch for verification.
      // fresh=true makes the server bypass its own per-worker cache too —
      // an immediate post-save read can otherwise hit a cluster worker whose
      // cache-invalidation message hasn't arrived yet and return pre-save data.
      bustCache("project:team:" + projectId);
      bustCache("resource-allocations:");
      const res = await getProjectTeam(projectId, true).catch(() => null);
      if (res?.team) {
        // ── Approach-A verification ───────────────────────────────────────
        // Compare only the changed weeks against what came back from the DB.
        const newMismatches: Record<string, WeekMismatch[]> = {};
        for (const m of res.team) {
          const memberId = m.resourceId ?? m.name;
          if (!intended[memberId]) continue;
          // A newer edit/save for this member landed while this verify fetch
          // was in flight — the fetch may carry the NEWER save's values, and
          // comparing them against OUR older intent is exactly the false
          // "rapid re-edit" warning. The newer chain verifies itself; skip.
          if ((saveGenRef.current.get(memberId) ?? 0) !== genAtSave.get(memberId)) continue;
          const gotMap = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
          const mm = Object.entries(intended[memberId])
            .filter(([wk, intHrs]) => (gotMap[wk] ?? 0) !== intHrs)
            .map(([wk, intHrs]) => ({ week: wk, intended: intHrs, got: gotMap[wk] ?? 0 }));
          if (mm.length > 0) newMismatches[memberId] = mm;
        }
        // Only overwrite local team state if verification found no mismatches
        // (i.e. server round-trip confirms what we already showed optimistically).
        // Members superseded by a newer write keep their on-screen row — the
        // fetched row may predate that write, and adopting it would resurrect
        // outdated hours until the newer chain's own verify corrects them.
        if (Object.keys(newMismatches).length === 0) {
          const freshTeam = filterSoloTeam(res.team, soloMember);
          setTeam(prev => freshTeam.map(f => {
            const id = f.resourceId ?? f.name;
            const cap = genAtSave.get(id);
            if (cap !== undefined && (saveGenRef.current.get(id) ?? 0) !== cap) {
              return prev.find(p => (p.resourceId ?? p.name) === id) ?? f;
            }
            return f;
          }));
        }
        setMismatches(newMismatches);
      }
      // Re-fetch surrounding context (Team List, EAC/ETC header numbers) —
      // the grid itself already shows fresh values via the optimistic update.
      onReload?.(true);
    } catch (e) {
      // Show the server's reason in plain words instead of raw JSON like
      // `502: {"error":...,"detail":...}` so failures explain themselves.
      let msg = e instanceof Error ? e.message : String(e);
      const jm = msg.match(/^\d{3}:\s*(\{[\s\S]*\})\s*$/);
      if (jm) {
        try {
          const p = JSON.parse(jm[1]) as { error?: string; detail?: string };
          const d = (p.detail || "").replace(/^Error:\s*/, "");
          msg = [p.error, d].filter(Boolean).join(" — ") || msg;
        } catch { /* keep raw message */ }
      }
      if (msg.includes("NOT_ON_TEAM")) {
        msg =
          "This person was removed from the project in another session. " +
          "Refresh to see the updated team before editing hours.";
      }
      setSaveErr(msg);
    } finally {
      // Confirmed-base bookkeeping is maintained PER MEMBER inside each
      // queued bulk write (advance on success, rebase flag on failure) —
      // never cleared wholesale here: a clear() would erase bases that
      // writes queued behind the bulk save have already established.
      setSaving(false);
    }
  }

  // ── Per-member quick "Schedule Hours" actions ─────────────────────────────
  // These mirror the member card's Schedule Hours popup and reuse the exact
  // same save path as saveEdits above.

  /** Allocation records for the quick actions — reuses rawAllocs when already
      loaded (edit mode), otherwise fetches with the same empty-retry pattern. */
  async function ensureQuickAllocs(): Promise<AllocationsResponse | null> {
    const ea = (rawAllocs as any)?.ExistingAllocations;
    if (Array.isArray(ea) && ea.length > 0) return rawAllocs;
    let data = await getFullProjectAllocations(projectId).catch(() => null);
    const got = (data as any)?.ExistingAllocations;
    if (!Array.isArray(got) || got.length === 0) {
      data = await getFullProjectAllocations(projectId).catch(() => null);
    }
    if (data) setRawAllocs(data as AllocationsResponse);
    return (data as AllocationsResponse | null) ?? null;
  }

  /** Save one member's week map through the same buildWeeklyAllocations →
      updateHoursAllocation path as saveEdits. Takes a map BUILDER, not a map:
      the full map is built only when this write's turn in the member queue
      arrives, from the authoritative base — so a map computed at click time
      can never resurrect values an earlier queued write already changed.
      Returns true when the save succeeded, false when it failed. */
  async function saveMemberWeekMap(
    m: ProjectTeamMember,
    buildMap: (base: Record<string, number>) => Record<string, number>,
  ): Promise<boolean> {
    // Locked allocations are frozen against hour changes (server enforces the
    // same rule with ALLOCATION_LOCKED) — fail fast with a clear message.
    if (m.isLocked) {
      setSaveErr(`${m.name}'s allocation is locked — unlock it from the FLAGS column before changing hours.`);
      return false;
    }
    const memberId = m.resourceId ?? m.name;
    // A bulk edit-mode save is mid-flight (POST → verify) — quick writes are
    // NOT serialized against it, so letting one through could interleave
    // full-map POSTs and trip the bulk verification. Bounce with a clear
    // message instead (the window is a few seconds).
    if (saving) {
      setSaveErr("The grid is still saving your last change — try again in a moment.");
      return false;
    }
    bumpSaveGen(memberId);                   // newer intent → older verifies obsolete
    const genAtWrite = saveGenRef.current.get(memberId) ?? 0;
    setQuickBusy(prev => { const n = new Set(prev); n.add(memberId); return n; });
    setSaveErr(null);
    let okOut = false;
    try {
      await queueMemberWrite(memberId, async () => {
        try {
          const base = await resolveBaseMap(memberId);
          if (!base) {
            throw new Error("This person is no longer on the team — refresh the page and try again.");
          }
          const weekMap = buildMap(base);
          const allocs = await ensureQuickAllocs();
          const memberAlloc = matchMemberAlloc(allocs, { name: m.name, resourceId: m.resourceId }, projectId);
          if (!memberAlloc) {
            throw new Error(`Couldn't find the allocation record for ${m.name}. Reload the page and try again.`);
          }
          const allocations = buildPhaseHourAllocations(weekMap, memberAlloc);
          const result = await updateHoursAllocation({ ProjectID: projectId, Allocations: allocations });
          if (
            (result as any)?.raw === "Error" ||
            (result as any)?.raw === "error" ||
            result === "Error"
          ) {
            throw new Error(
              `Save rejected for ${m.name} — edit this member's assignment once (pencil icon on the member card) to repair the allocation record, then try again.`
            );
          }
          // Advance the confirmed base SYNCHRONOUSLY — later queued writes
          // build on this even if a background refetch delivers stale rows.
          // A successful full-map POST also resolves any earlier ambiguity.
          cellBaseRef.current.set(memberId, { ...weekMap });
          cellRebaseRef.current.delete(memberId);
          // Optimistic patch so the row updates immediately — ETC/EAC summary
          // fields move in the same instant (delta-adjusted; the verify below
          // adopts server truth and corrects any drift).
          setTeam(prev => prev.map(tm => {
            if ((tm.resourceId ?? tm.name) !== memberId) return tm;
            const byWeek = new Map((tm.weeklyHours ?? []).map(wh => [wh.week, wh] as const));
            let dEtc = 0, dEac = 0;
            for (const [wk, hrs] of Object.entries(weekMap)) {
              const curr = byWeek.get(wk);
              const d = hrs - (curr?.hours ?? 0);
              dEac += d;
              if (wk >= nowWeekKey) dEtc += d;
              byWeek.set(wk, curr ? { ...curr, hours: hrs } : { week: wk, hours: hrs });
            }
            const weekly = Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
            return applyCostDeltas({ ...tm, weeklyHours: weekly }, dEtc, dEac);
          }));
          // Fast path: the save response embedded the member's refreshed week data.
          // Apply it directly — no extra /project-team round-trip needed.
          const mu = (result as any)?.memberUpdates as Record<string, MemberUpdatePayload> | undefined;
          const myUpdate: MemberUpdatePayload | undefined = mu
            ? (mu[memberId] ?? mu[memberId.toLowerCase()] ?? mu[(m.resourceId ?? "").toLowerCase()] ?? Object.values(mu)[0])
            : undefined;
          if (myUpdate && !cellDirtyRef.current.has(memberId)) {
            const savedMap = new Map(myUpdate.weeklyHours.map(wh => [wh.week, wh.hours]));
            const rate = teamRef.current.find(tm => (tm.resourceId ?? tm.name) === memberId)?.costRate || 0;
            setTeam(prev => prev.map(tm => {
              if ((tm.resourceId ?? tm.name) !== memberId) return tm;
              const byWeek2 = new Map((tm.weeklyHours ?? []).map(wh => [wh.week, wh] as const));
              for (const wk of Object.keys(weekMap)) {
                const h = savedMap.get(wk) ?? 0;
                if (h > 0) byWeek2.set(wk, { week: wk, hours: h });
                else byWeek2.delete(wk);
              }
              const weekly2 = Array.from(byWeek2.values()).sort((a, b) => a.week.localeCompare(b.week));
              // Keep existing EAC/ETC: the optimistic delta applied above is
              // accurate; the readback only covers short-span rows and would
              // undercount for members with lump-sum container rows.
              return { ...tm, weeklyHours: weekly2 };
            }));
            if (!cellDirtyRef.current.has(memberId)) {
              cellBaseRef.current.set(memberId, Object.fromEntries(myUpdate.weeklyHours.map(wh => [wh.week, wh.hours])));
            }
            onReload?.();
            okOut = true;
            // skip the slow verify fetch below
            return;
          }
          // Slow path fallback: server didn't embed member data — use the old
          // verify fetch. fresh=true bypasses server-worker caches.
          bustCache("project:team:" + projectId);
          bustCache("resource-allocations:");
          const res = await getProjectTeam(projectId, true).catch(() => null);
          // Gen check: a newer intent (another quick action, cell commit)
          // superseded this write while the fetch was in flight — its own
          // verify owns truth now; comparing/adopting here would use rows
          // that may already carry the newer save's values.
          if (res?.team && (saveGenRef.current.get(memberId) ?? 0) === genAtWrite) {
            const fresh = res.team.find(tm => (tm.resourceId ?? tm.name) === memberId);
            const gotMap = Object.fromEntries((fresh?.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
            const confirmed = Object.entries(weekMap).every(([wk, h]) => (gotMap[wk] ?? 0) === h);
            // Merge ONLY this member's confirmed row — replacing the whole array
            // could overwrite another member's in-flight optimistic edit with
            // server data that predates their write.
            if (confirmed && fresh) {
              setTeam(prev => prev.map(tm => ((tm.resourceId ?? tm.name) === memberId ? fresh : tm)));
              // Re-sync the base to server truth (only when no later write is
              // queued behind us — their base must stay the advanced one).
              if (!cellDirtyRef.current.has(memberId)) {
                cellBaseRef.current.set(memberId, quickWeekBase(fresh));
              }
            }
          }
          onReload?.();
          okOut = true;
        } catch (e) {
          // Server state ambiguous — KEEP the confirmed base for writers
          // queued behind us and flag the member for a fresh server read
          // before the next payload build.
          cellRebaseRef.current.add(memberId);
          setSaveErr(e instanceof Error ? e.message : String(e));
          // This failed intent already silenced any older chain's verify —
          // re-sync from the server so a genuine divergence still surfaces.
          void reconcileMemberRow(memberId);
        }
      });
      return okOut;
    } finally {
      setQuickBusy(prev => { const n = new Set(prev); n.delete(memberId); return n; });
    }
  }

  /** Current week→hours map for a member across every grid week. */
  function quickWeekBase(m: ProjectTeamMember): Record<string, number> {
    const cur = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
    const map: Record<string, number> = {};
    for (const wk of allWeeks) map[wk] = cur[wk] ?? 0;
    return map;
  }

  /** After a FAILED write, adopt server truth for one member (row + confirmed
      base). A failed newer intent has already silenced any older chain's
      verification, so without this re-sync a genuine server divergence (e.g.
      another user's concurrent edit) could stay hidden behind reverted
      optimistic values until the next reload. Gen/dirty-gated: stands down
      the moment an even newer write intent appears. */
  async function reconcileMemberRow(memberId: string): Promise<void> {
    const genAtFail = saveGenRef.current.get(memberId) ?? 0;
    bustCache("project:team:" + projectId);
    const res = await getProjectTeam(projectId, true).catch(() => null);
    if (!res?.team) return;
    if ((saveGenRef.current.get(memberId) ?? 0) !== genAtFail) return;
    if (cellDirtyRef.current.has(memberId)) return;
    const fresh = res.team.find(tm => (tm.resourceId ?? tm.name) === memberId);
    if (!fresh) return;
    setTeam(prev => prev.map(tm => ((tm.resourceId ?? tm.name) === memberId ? fresh : tm)));
    cellBaseRef.current.set(memberId, quickWeekBase(fresh));
    cellRebaseRef.current.delete(memberId);
  }

  /** Group a week→hours map by phase and build the allocation payload —
      the one shared payload builder for saveMemberWeekMap and cell saves. */
  function buildPhaseHourAllocations(weekMap: Record<string, number>, memberAlloc: any) {
    const phaseMap = new Map<number, { key: string; hours: number }[]>();
    for (const [wk, hrs] of Object.entries(weekMap)) {
      const pi = phaseForWeek.get(wk) ?? -1;
      const bucket = phaseMap.get(pi) ?? [];
      bucket.push({ key: isoToWeekKey(wk), hours: hrs });
      phaseMap.set(pi, bucket);
    }
    const phaseHours = Array.from(phaseMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([pi, weeks]) => ({
        phaseName: pi >= 0 ? String(tasks[pi]?.Title ?? `Phase ${pi + 1}`) : "Unscheduled",
        stageStep: 0,
        color: pi >= 0 ? phaseColor(pi) : C.faint,
        weeks,
      }));
    return buildWeeklyAllocations(phaseHours, memberAlloc);
  }

  /** Serialize ALL hour writers for one member through a single promise
      queue — two concurrent full-map POSTs for the same person could
      resurrect older values (last write wins wholesale server-side).
      Entries stay in the map; a settled promise costs nothing and avoids
      delete/re-register races. */
  function queueMemberWrite(memberId: string, fn: () => Promise<void>): Promise<void> {
    // Delegates to the MODULE-scoped queue (lib/memberWriteQueue) so writers
    // outside this component — EditAllocationModal — chain onto the same tail
    // instead of racing it.
    return queueProjectMemberWrite(projectId, memberId, fn);
  }

  /** Authoritative full week map to build a member's next save on: the last
      map a successful POST confirmed (advanced synchronously — immune to
      background refetches delivering pre-save rows), falling back to the
      current on-screen row for the first write. */
  function memberBaseMap(memberId: string): Record<string, number> | null {
    const confirmed = cellBaseRef.current.get(memberId);
    if (confirmed) return { ...confirmed };
    const row = teamRef.current.find(tm => (tm.resourceId ?? tm.name) === memberId);
    return row ? quickWeekBase(row) : null;
  }

  /** memberBaseMap plus failure reconciliation. Called at the START of every
      queued write (so it's serialized): when a previous write for this member
      failed, re-read server truth and rebase on it before building anything.
      Returns null only when the member is genuinely gone from the team. */
  async function resolveBaseMap(memberId: string): Promise<Record<string, number> | null> {
    if (cellRebaseRef.current.has(memberId)) {
      bustCache("project:team:" + projectId);
      const res = await getProjectTeam(projectId, true).catch(() => null);
      if (res?.team) {
        const fresh = res.team.find(tm => (tm.resourceId ?? tm.name) === memberId);
        if (!fresh) return null;                       // removed server-side
        cellRebaseRef.current.delete(memberId);
        const map = quickWeekBase(fresh);
        cellBaseRef.current.set(memberId, { ...map });
        return map;
      }
      // Reconciliation read failed. Proceed from the last CONFIRMED base if
      // one exists (a successful full-map POST resolves the ambiguity anyway,
      // since the server replaces this member's weeks wholesale) — but NEVER
      // from the screen row, which a stale background refetch may have
      // replaced. The flag stays set until a read or a POST succeeds.
      const confirmed = cellBaseRef.current.get(memberId);
      if (confirmed) return { ...confirmed };
      throw new Error("Couldn't re-check this person's saved hours after an earlier failed save — reload the page before making more changes.");
    }
    return memberBaseMap(memberId);
  }

  /** Option 1 — one hours/week value stamped on every editable week.
      Locked (past) weeks keep their existing hours. */
  function applyUniformHours(m: ProjectTeamMember, hoursPerWeek: number) {
    const n = Math.max(0, Math.round(hoursPerWeek));
    // Builder runs when this write's queue turn arrives — `base` is the
    // authoritative map at that moment, not a click-time snapshot.
    void saveMemberWeekMap(m, base => {
      const map = { ...base };
      for (const wk of allWeeks) { if (!isWeekLocked(wk)) map[wk] = n; }
      return map;
    });
  }

  /** Option 2 — hours/week stamped onto weeks inside each From–To range. */
  function applyRangeHours(m: ProjectTeamMember, rows: { from: string; to: string; hours: string }[]) {
    void saveMemberWeekMap(m, base => {
      const map = { ...base };
      for (const r of rows) {
        // Skip incomplete rows entirely — a row with dates but a blank hours
        // field must NOT stamp 0h onto those weeks.
        if (r.hours.trim() === "") continue;
        const fromD = parseISODate(r.from);
        const toD = parseISODate(r.to);
        if (!fromD || !toD) continue;
        const fromKey = isoOfDate(mondayOf(fromD));   // include the week containing "from"
        const toKey = isoOfDate(toD);
        const n = Math.max(0, Math.round(Number(r.hours) || 0));
        for (const wk of allWeeks) {
          if (isWeekLocked(wk)) continue;
          if (wk >= fromKey && wk <= toKey) map[wk] = n;
        }
      }
      return map;
    });
  }

  /** Option 3 — spread a user-entered TOTAL over editable weeks.
      Without ratePerWeek: even split (whole hours; first weeks absorb the
      remainder, like the member card). With ratePerWeek: fill week by week at
      that pace until the total runs out (next week gets the remainder, later
      weeks go to 0). Past (locked) weeks keep their hours and count toward the
      entered total, so only the remainder is spread across future weeks. */
  function applyDistributeTotal(m: ProjectTeamMember, total: number, ratePerWeek?: number) {
    const editable = allWeeks.filter(wk => !isWeekLocked(wk));
    if (editable.length === 0) return;
    void saveMemberWeekMap(m, baseMap => {
      const map = { ...baseMap };
      const lockedSum = Math.round(
        allWeeks.filter(wk => isWeekLocked(wk)).reduce((s, wk) => s + (map[wk] ?? 0), 0)
      );
      const rem = Math.max(0, Math.round(total) - lockedSum);
      if (ratePerWeek && ratePerWeek > 0) {
        // Fill week by week at the given pace until the total is used up;
        // the week after the last full one gets the remainder, later weeks go to 0.
        const fullWeeks = Math.floor(rem / ratePerWeek);
        const remainder = Math.round((rem - fullWeeks * ratePerWeek) * 100) / 100;
        editable.forEach((wk, i) => {
          map[wk] = i < fullWeeks ? ratePerWeek : (i === fullWeeks ? remainder : 0);
        });
      } else {
        const per = Math.floor(rem / editable.length);
        const extra = rem - per * editable.length;
        editable.forEach((wk, i) => { map[wk] = per + (i < extra ? 1 : 0); });
      }
      return map;
    });
  }

  // ── Allocation flags (toggle S / NC / lock from the FLAGS sub-slots) ─────
  const [flagBusy, setFlagBusy] = useState<Set<string>>(new Set());
  // Pending flag toggle awaiting the user's confirmation in the popup —
  // every S / NC / lock click explains what it will do BEFORE it acts.
  const [flagConfirm, setFlagConfirm] = useState<{ m: ProjectTeamMember; flag: FlagKind; next: boolean } | null>(null);
  // $/hr rate input shown in the NC confirm popup — pre-filled from the
  // member's configured role cost rate (m.costRate) when non-zero.
  const [ncRateInput, setNcRateInput] = useState("");
  // The NC $/hr rate is financial data — only users with the financial
  // capability see/enter it; for everyone else NC applies with the role's
  // default rate (the server rejects rate writes from them anyway).
  const canEditNcRate = useEditFinancialsCap();
  // NC badge hover — shows the rate × hours = cost breakdown in a tooltip.
  const [ncHover, setNcHover] = useState<{ m: ProjectTeamMember; rect: DOMRect } | null>(null);
  // Remove member / open position — professional confirm popup (shared
  // RemoveMemberConfirm, includes the audit-log notice). removeBusy disables
  // the popup buttons while the server round-trip runs.
  const [removeConfirm, setRemoveConfirm] = useState<
    | { kind: "member"; m: ProjectTeamMember }
    | { kind: "open"; r: import("@/lib/api").OpenRole }
    | null
  >(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  async function handleFlagClick(m: ProjectTeamMember, flag: "soft" | "nc" | "locked", next: boolean, costRate?: number) {
    // Lock falls back to the legacy onToggleLock when no generic handler was
    // passed (older callers); S / NC need onToggleFlag.
    const runner = onToggleFlag
      ? (v: boolean) => onToggleFlag(m, flag, v, costRate)
      : (flag === "locked" && onToggleLock ? (v: boolean) => onToggleLock(m, v) : null);
    if (!runner || !canUnlock) return;
    const id = m.resourceId ?? m.name;
    const key = `${id}:${flag}`;
    if (flagBusy.has(key)) return;
    setFlagBusy(prev => new Set(prev).add(key));
    try {
      const ok = await runner(next);
      // Optimistic local patch so the badge flips instantly; the parent's
      // refresh delivers the authoritative row set right after.
      // For NC, also patch the entered $/hr into local state so the badge
      // tooltip shows the rate immediately (not "No cost rate configured"
      // until the next full refresh delivers the server row).
      if (ok) setTeam(prev => prev.map(tm => (tm.resourceId ?? tm.name) === id
        ? { ...tm, ...(flag === "soft" ? { softAllocation: next }
            : flag === "nc" ? { nonChargeable: next, ncRate: next ? (costRate ?? tm.ncRate ?? 0) : 0 }
            : { isLocked: next }) }
        : tm));
    } finally {
      setFlagBusy(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  // ── Direct in-grid cell editing ───────────────────────────────────────────
  /** Click on an editable week cell → open the inline editor for it. */
  function openCellEdit(m: ProjectTeamMember, wk: string) {
    // A save in flight for ANOTHER member doesn't block editing this one —
    // only the member currently being saved is off-limits.
    if (!canEdit || editMode || needsSchedule || saving || isWeekLocked(wk)) return;
    if (quickBusy.has(m.resourceId ?? m.name)) return;
    // Locked allocation — hours are frozen. Surface the reason instead of
    // silently ignoring the click.
    if (m.isLocked) {
      setSaveErr(`${m.name}'s allocation is locked — an admin (or a user who can manage staff) can unlock it from the FLAGS column.`);
      return;
    }
    const cur = (m.weeklyHours ?? []).find(w => w.week === wk)?.hours ?? 0;
    setSaveErr(null);
    // Warm the allocation records while the user types — the first save then
    // skips its slowest step (getFullProjectAllocations round-trip).
    void ensureQuickAllocs();
    cellDoneRef.current = false;
    setCellEdit({ memberId: m.resourceId ?? m.name, wk, val: cur > 0 ? String(cur) : "" });
  }

  /** Delta-adjust a member's ETC/EAC summary fields after weekly-hours
      changes so the summary columns + header totals move in the SAME
      instant as the edited cell (the queue-idle verify adopts server
      truth later and corrects any drift). EAC (total) moves by the full
      delta; ETC (remaining, this week forward) only by the part landing
      in current/future weeks. Costs follow at the member's billing
      rate — members without a rate keep their "—". */
  function applyCostDeltas<T extends ProjectTeamMember>(tm: T, dEtc: number, dEac: number): T {
    if (!dEtc && !dEac) return tm;
    const rate = tm.costRate || 0;
    return {
      ...tm,
      etcHrs:  Math.max(0, (tm.etcHrs  || 0) + dEtc),
      eacHrs:  Math.max(0, (tm.eacHrs  || 0) + dEac),
      etcCost: Math.max(0, (tm.etcCost || 0) + dEtc * rate),
      eacCost: Math.max(0, (tm.eacCost || 0) + dEac * rate),
    };
  }

  /** Patch ONE week's hours for one member in local team state — pulling
      the member's ETC/EAC along instantly. Commit AND failure-revert both
      flow through here, so the adjustment reverses itself symmetrically. */
  function patchTeamWeek(memberId: string, wk: string, hours: number) {
    setTeam(prev => prev.map(tm => {
      if ((tm.resourceId ?? tm.name) !== memberId) return tm;
      const byWeek = new Map((tm.weeklyHours ?? []).map(wh => [wh.week, wh] as const));
      const curW = byWeek.get(wk);
      const delta = hours - (curW?.hours ?? 0);
      byWeek.set(wk, curW ? { ...curW, hours } : { week: wk, hours });
      const next = { ...tm, weeklyHours: Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week)) };
      return applyCostDeltas(next, wk >= nowWeekKey ? delta : 0, delta);
    }));
  }

  /** Shape of per-member enriched data embedded in the save response.
      Returned by the server after each /hours-allocation write so the client
      can adopt server truth without a separate /project-team round-trip. */
  type MemberUpdatePayload = {
    weeklyHours: Array<{ week: string; hours: number }>;
    eacHrs: number;
    etcHrs: number;
  };

  /** POST one member's full week map — no optimistic patching, no verify
      refetch (the drain loop owns those). Returns the server's embedded
      member data when available so the drain loop can skip the verify fetch;
      returns ok:false after showing the failure reason in the banner. */
  async function saveCellMap(
    m: ProjectTeamMember,
    weekMap: Record<string, number>,
  ): Promise<{ ok: boolean; memberUpdate?: MemberUpdatePayload }> {
    if (m.isLocked) {
      setSaveErr(`${m.name}'s allocation is locked — unlock it from the FLAGS column before changing hours.`);
      return { ok: false };
    }
    try {
      const allocs = await ensureQuickAllocs();
      const memberAlloc = matchMemberAlloc(allocs, { name: m.name, resourceId: m.resourceId }, projectId);
      if (!memberAlloc) {
        throw new Error(`Couldn't find the allocation record for ${m.name}. Reload the page and try again.`);
      }
      const allocations = buildPhaseHourAllocations(weekMap, memberAlloc);
      const result = await updateHoursAllocation({ ProjectID: projectId, Allocations: allocations });
      if (
        (result as any)?.raw === "Error" ||
        (result as any)?.raw === "error" ||
        result === "Error"
      ) {
        throw new Error(
          `Save rejected for ${m.name} — edit this member's assignment once (pencil icon on the member card) to repair the allocation record, then try again.`
        );
      }
      // Server may embed refreshed week/EAC/ETC data so we can skip the verify
      // /project-team round-trip (see saveWeeklyHoursRds memberUpdates).
      const personId = (m.resourceId ?? m.name).toLowerCase();
      const rawUpdates = (result as any)?.memberUpdates as Record<string, MemberUpdatePayload> | undefined;
      // memberUpdates is keyed by person GUID (lowercase from SQL)
      const memberUpdate: MemberUpdatePayload | undefined =
        rawUpdates
          ? (rawUpdates[personId] ??
             rawUpdates[(m.resourceId ?? "").toLowerCase()] ??
             Object.values(rawUpdates)[0])
          : undefined;
      return { ok: true, memberUpdate };
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
      return { ok: false };
    }
  }

  /** Background drain loop for one member's queued cell edits. Each pass
      POSTs the member's CURRENT full week map (so edits made mid-save are
      picked up by the next pass). Cache-bust + verify + parent reload run
      ONCE after the queue empties, off the user's critical path. */
  async function drainCellSaves(memberId: string): Promise<void> {
    // A drain queued behind one that already flushed everything: nothing to do.
    if (!cellDirtyRef.current.has(memberId)) return;
    // Track the embedded member update from the LAST successful save so the
    // verify step can skip the /project-team round-trip when available.
    let lastMemberUpdate: MemberUpdatePayload | undefined;
    try {
      while (cellDirtyRef.current.has(memberId)) {
        cellDirtyRef.current.delete(memberId);
        const row = teamRef.current.find(tm => (tm.resourceId ?? tm.name) === memberId);
        // Base = last CONFIRMED full map (or the on-screen row for the first
        // save), overlaid with the pending cell values. Never rebuilt from
        // team state mid-chain — a background refetch delivering pre-save
        // rows must not resurrect hours an earlier POST already changed.
        // After a failed write, resolveBaseMap re-reads server truth first.
        const map = await resolveBaseMap(memberId);
        if (!row || !map) throw new Error("This person is no longer on the team — refresh the page and try again.");
        const covered: Array<[string, number]> = [];
        for (const [k, v] of cellValRef.current) {
          if (!k.startsWith(`${memberId}|`)) continue;
          map[k.slice(memberId.length + 1)] = v;
          covered.push([k, v]);
        }
        const { ok, memberUpdate } = await saveCellMap(row, map);
        if (!ok) throw new Error("__handled__");   // banner already set
        if (memberUpdate) lastMemberUpdate = memberUpdate;
        // Advance the confirmed base SYNCHRONOUSLY for the next pass/writer.
        // A successful full-map POST also resolves any earlier ambiguity.
        cellBaseRef.current.set(memberId, { ...map });
        cellRebaseRef.current.delete(memberId);
        // Confirmed — release cells whose value didn't change mid-POST (a
        // re-edited cell stays pending for the next pass).
        for (const [k, v] of covered) {
          if (cellValRef.current.get(k) === v) {
            cellValRef.current.delete(k);
            cellPrevRef.current.delete(k);
          }
        }
      }
    } catch (e) {
      // Revert every unconfirmed cell for this member to its pre-edit value.
      // KEEP the confirmed base (writers queued behind us must not fall back
      // to a possibly-stale screen row) and flag the member so the next
      // write re-reads server truth before building its payload.
      cellDirtyRef.current.delete(memberId);
      cellRebaseRef.current.add(memberId);
      const mine = [...cellPrevRef.current.entries()].filter(([k]) => k.startsWith(`${memberId}|`));
      for (const [k, prev] of mine) {
        cellPrevRef.current.delete(k);
        cellValRef.current.delete(k);
        patchTeamWeek(memberId, k.slice(memberId.length + 1), prev);
      }
      if (e instanceof Error && e.message !== "__handled__") setSaveErr(e.message);
      // This failed write may have silenced an older chain's verification (a
      // newer intent makes older verifies stand down) — re-sync from the
      // server so a genuine divergence (e.g. another user's concurrent edit)
      // still surfaces instead of hiding behind the reverted values.
      void reconcileMemberRow(memberId);
      return;
    }
    // ── Queue empty: adopt server truth + cross-page sync ───────────────────
    // Fast path: the save response embedded the member's refreshed week data.
    // Apply it directly — no extra /project-team round-trip needed.
    if (lastMemberUpdate && !cellDirtyRef.current.has(memberId)) {
      const mu = lastMemberUpdate;
      const cur = teamRef.current.find(tm => (tm.resourceId ?? tm.name) === memberId);
      if (cur) {
        // Rebuild weeklyHours: keep weeks outside the saved map (untouched),
        // replace or clear weeks the server just wrote.
        const savedMap = new Map(mu.weeklyHours.map(wh => [wh.week, wh.hours]));
        const savedBase = cellBaseRef.current.get(memberId) ?? {};
        // savedBase covers the exact weeks we just POSTed; any week in it but
        // absent from savedMap was explicitly cleared (hours → 0).
        const byWeek = new Map((cur.weeklyHours ?? []).map(wh => [wh.week, wh] as const));
        for (const wk of Object.keys(savedBase)) {
          const h = savedMap.get(wk) ?? 0;
          if (h > 0) byWeek.set(wk, { week: wk, hours: h });
          else byWeek.delete(wk);
        }
        const weekly = Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
        // Keep the existing EAC/ETC: the optimistic delta was already applied
        // by patchTeamWeek → applyCostDeltas and is accurate. The readback
        // only covers short-span (< 30 day) rows, so any lump-sum rows a
        // member has would make eacHrs/etcHrs here an undercount. Adopting
        // those values would visibly drop EAC/ETC until the next reload.
        setTeam(prev => prev.map(tm => (tm.resourceId ?? tm.name) !== memberId ? tm : {
          ...tm,
          weeklyHours: weekly,
          // eacHrs / etcHrs / etcCost / eacCost intentionally NOT overridden.
        }));
        cellBaseRef.current.set(memberId, Object.fromEntries(mu.weeklyHours.map(wh => [wh.week, wh.hours])));
      }
      onReload?.();
      return;
    }
    // Slow path (fallback): server didn't embed member data — use the old
    // verify fetch. fresh=true bypasses server-worker caches (a post-save
    // read can otherwise hit a worker whose cache-invalidation hasn't arrived
    // and return pre-save data).
    bustCache("project:team:" + projectId);
    bustCache("resource-allocations:");
    // Verification only holds while OUR chain is still the newest writer for
    // this member. A generation bump during the round-trip means a newer edit
    // owns the truth (its own drain verifies it) — flagging or adopting here
    // would warn about / resurrect outdated values.
    const genAtVerify = saveGenRef.current.get(memberId) ?? 0;
    const res = await getProjectTeam(projectId, true).catch(() => null);
    if (res?.team && !cellDirtyRef.current.has(memberId) &&
        (saveGenRef.current.get(memberId) ?? 0) === genAtVerify) {
      const fresh = res.team.find(tm => (tm.resourceId ?? tm.name) === memberId);
      const cur = teamRef.current.find(tm => (tm.resourceId ?? tm.name) === memberId);
      if (fresh && cur) {
        const gotMap = Object.fromEntries((fresh.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
        const curMap = Object.fromEntries((cur.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
        const match = allWeeks.every(w => (gotMap[w] ?? 0) === (curMap[w] ?? 0));
        // Adopt the server row either way (it carries refreshed ETC/EAC too);
        // only complain when it disagrees with what the user entered. Re-sync
        // the base to server truth for the next writer.
        setTeam(prev => prev.map(tm => ((tm.resourceId ?? tm.name) === memberId ? fresh : tm)));
        cellBaseRef.current.set(memberId, quickWeekBase(fresh));
        if (!match) setSaveErr(`${cur.name}: the server stored different hours than entered for some weeks — showing the saved values.`);
      }
    }
    onReload?.();
    // Edits that arrived during verification already queued their own drain
    // behind this one — no tail recursion needed.
  }

  /** Commit (Enter / click-away) — the new number shows in the cell INSTANTLY
      (no saving indicator — it looks saved right away) and the row stays
      editable; the save is queued per member and runs in the background. On
      failure the original values are restored and the banner explains why. */
  function confirmCellEdit(m: ProjectTeamMember) {
    if (!cellEdit) return;
    // A bulk edit-mode save in flight (or edit mode itself) must never
    // interleave with cell-path full-map POSTs — drop a straggler confirm
    // (e.g. an editor blur racing the Save click).
    if (saving || editMode) { setCellEdit(null); return; }
    const { memberId, wk, val } = cellEdit;
    const cellKey = `${memberId}|${wk}`;
    // Block commit when the input holds an over-168h value — keep the editor
    // open so the user can see and correct the value (Escape still cancels).
    const parsed = Number(val);
    if (Number.isFinite(parsed) && parsed > MAX_WEEK_HOURS) {
      // Leave cellEdit open; the error flag and cap hint are already shown.
      setSaveErr(`${MAX_WEEK_HOURS}h is the maximum per week — ${MAX_WEEK_HOURS_HINT}. Enter a value from 0 to ${MAX_WEEK_HOURS}.`);
      return;
    }
    const hours = Math.max(0, Number.isFinite(parsed) ? parsed : 0);
    const cur = (m.weeklyHours ?? []).find(w => w.week === wk)?.hours ?? 0;
    setCellEdit(null);
    // Clear the error for this cell (the value is now valid).
    setWeekInputErrors(prev => { if (!prev.has(cellKey)) return prev; const s = new Set(prev); s.delete(cellKey); return s; });
    setSaveErr(null);
    if (hours === cur && !cellValRef.current.has(cellKey)) return;   // nothing changed
    // Remember the ORIGINAL value once — if the whole chain fails, every
    // touched cell reverts to what the server last confirmed.
    if (!cellPrevRef.current.has(cellKey)) cellPrevRef.current.set(cellKey, cur);
    cellValRef.current.set(cellKey, hours);
    patchTeamWeek(memberId, wk, hours);      // instant visual update
    cellDirtyRef.current.add(memberId);
    bumpSaveGen(memberId);                   // newer intent → older verifies obsolete
    // Every confirm queues a drain; drains behind an already-flushed queue
    // see no dirt and exit instantly, so extra entries are harmless.
    void queueMemberWrite(memberId, () => drainCellSaves(memberId));
  }

  // Autofocus + select the cell editor's input as soon as it opens.
  useEffect(() => {
    if (cellEdit) { cellInputRef.current?.focus(); cellInputRef.current?.select(); }
    // Only when the edited cell IDENTITY changes — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellEdit?.memberId, cellEdit?.wk]);

  // ── Fix a member's mismatched weeks ───────────────────────────────────────
  // Re-enters edit mode with the intended (pre-save) values pre-filled for just
  // the affected member so the user can confirm and re-save cleanly.
  function fixMismatch(memberId: string) {
    const mm = mismatches[memberId];
    if (!mm?.length) return;
    // Seed ALL members from their current weeklyHours so other rows are editable.
    const newEditHours: Record<string, Record<string, number>> = {};
    for (const m of team) {
      const mid = m.resourceId ?? m.name;
      newEditHours[mid] = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
    }
    // Override the mismatched member's weeks with what they intended to save.
    for (const { week, intended } of mm) {
      newEditHours[memberId][week] = intended;
    }
    setEditHours(newEditHours);
    // Clear just this member's mismatch — others (if any) stay visible.
    setMismatches(prev => { const n = { ...prev }; delete n[memberId]; return n; });
    // Make sure allocation records are loaded for saveEdits (the old
    // "Edit Allocation" button used to do this before entering edit mode).
    void ensureQuickAllocs();
    setCellEdit(null);
    setEditMode(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Overview mode renders nothing while loading / on error / with no team —
  // it sits above the Gantt list, which handles its own empty states.
  if (overviewOnly && (loading || error || team.length === 0)) return null;

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "28px 0", justifyContent: "center", color: C.muted, fontSize: 13 }}>
      <span style={{ width: 14, height: 14, border: `2px solid ${C.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
      Loading schedule…
    </div>
  );

  if (error) return (
    <div style={{ padding: "20px 8px", textAlign: "center", color: "var(--rm-ink-red)", fontSize: 12 }}>
      {error}
    </div>
  );

  // Solo mode: the member exists in the Gantt list but not in the team fetch
  // (e.g. an optimistic row) — show a compact note, never the team-level
  // "add your first member" copy.
  if (team.length === 0 && soloMember) return (
    <div style={{ padding: "14px 8px", textAlign: "center", color: C.muted, fontSize: 12 }}>
      No schedule data for this member yet.
    </div>
  );

  if (team.length === 0) return (
    <div>
      <div style={{ padding: "28px 8px", textAlign: "center", color: C.muted, fontSize: 13 }}>
        {canEdit && onMemberAdded
          ? "No team members assigned yet. Add your first member."
          : "No team members assigned yet. Add members to see the schedule view."}
      </div>
      {canEdit && onMemberAdded && onAddMember && (
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 8 }}>
          <button onClick={() => onAddMember()} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 18px", backgroundColor: C.green, border: "none",
            borderRadius: 8, color: "#FFF", fontSize: 12, fontWeight: 700,
            cursor: "pointer",
          }} className="tsg-add-member-cta" aria-haspopup="dialog">
            <Plus size={13} />
            Add member
          </button>
        </div>
      )}
      {canEdit && onMemberAdded && !onAddMember && (
        <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <InlineAddMemberRow
            projectId={projectId}
            module={module}
            projectName={projectName || ""}
            projectStartDate={projectStartDate || ""}
            projectEndDate={projectEndDate || ""}
            scheduleStart={scheduleStart}
            scheduleEnd={scheduleEnd}
            existingAllocations={existingAllocations || []}
            showDates={!!hideSchedule}
            openRoles={openRoles}
            onAssigned={(name, optimistic) => {
              onMemberAdded(name, optimistic);
              setLocalReload(k => k + 1);
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div>
      {/* Editable-cell affordance: dashed slot on every directly-editable week
          cell so users can SEE where inline editing is available; hover turns
          it green (+ a "+" hint on empty cells). */}
      <style>{`
        .tsg-cell-editable {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 30px; min-height: 20px; border-radius: 6px;
          border: 1px dashed var(--rm-sched-cell-border);
          transition: border-color 0.12s, background-color 0.12s;
        }
        .tsg-week-cell:hover > .tsg-cell-editable {
          border-color: var(--rm-green);
          background-color: var(--rm-green-soft);
        }
        .tsg-week-cell:hover > .tsg-cell-editable:empty::before {
          content: "+";
          color: var(--rm-green);
          font-weight: 700;
        }
        /* Flag chip toggle — the icon/label springs when the state flips
           (the inner span is remounted via its key, replaying this). */
        @keyframes tsg-flag-pop {
          0%   { transform: scale(0.35) rotate(-25deg); opacity: 0.2; }
          55%  { transform: scale(1.3) rotate(8deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        /* Cell editor input: no native number spinner arrows */
        .tsg-cell-input::-webkit-inner-spin-button,
        .tsg-cell-input::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .tsg-cell-input {
          -moz-appearance: textfield;
          appearance: textfield;
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          box-sizing: border-box;
          height: 22px;
          padding: 2px 4px;
          border: 1px solid var(--rm-green);
          border-radius: 6px;
          background: var(--rm-panel);
          color: var(--rm-text);
          font: inherit;
          font-size: 11px;
          line-height: 16px;
          text-align: center;
          outline: none;
          box-shadow: 0 0 0 2px var(--rm-green-soft);
          text-overflow: ellipsis;
        }
        .tsg-cell-input:focus {
          border-color: var(--rm-green);
          box-shadow: 0 0 0 2px var(--rm-green-soft);
        }
      `}</style>


      {/* ── Phase cards ── (hidden in solo mode — the phase group headers
            inside the grid still show; only the team-level card strip goes) */}
      {showPhaseUI && !soloMember && (
        <div className="rm-dark-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
          {tasks.map((t, pi) => {
            const sum = phaseSummaries[pi];
            const pct = Math.min(100, Math.round(Number(t.PercentComplete ?? 0)));
            const color = phaseColor(pi);
            const active = selPhase === pi;
            return (
              <div key={pi} onClick={() => {
                const next = active ? null : pi;
                setSelPhase(next);
                if (next !== null) {
                  let firstWkIdx = allWeeks.findIndex(wk => phaseForWeek.get(wk) === next);
                  if (firstWkIdx < 0) {
                    // No week column maps to this phase (e.g. the schedule is
                    // longer than the 2-year column cap, or the phase sits in
                    // a gap). Jump to the week nearest the phase start instead
                    // of silently doing nothing.
                    const ps = parseISODate(t.StartDate);
                    if (ps) {
                      const target = mondayOf(ps).getTime();
                      let best = Infinity;
                      for (let i = 0; i < allWeeks.length; i++) {
                        const d = parseISODate(allWeeks[i]);
                        if (!d) continue;
                        const diff = Math.abs(mondayOf(d).getTime() - target);
                        if (diff < best) { best = diff; firstWkIdx = i; }
                      }
                    }
                  }
                  if (firstWkIdx >= 0) {
                    const el = scrollRef.current;
                    if (el) el.scrollTo({ left: firstWkIdx * actualWeekW(el), behavior: "smooth" });
                  }
                }
              }} style={{
                minWidth: 108, flexShrink: 0, padding: "8px 10px", borderRadius: 10,
                border: `2px solid ${active ? color : "transparent"}`,
                outline: active ? `0 solid ${color}` : "none",
                boxShadow: active ? `0 0 0 2px ${color}28` : "none",
                backgroundColor: active ? `${color}10` : C.soft,
                cursor: "pointer", position: "relative",
              }}>
                <div style={{ fontSize: 9, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                  Phase {pi + 1}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 3, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {String(t.Title ?? `Phase ${pi + 1}`)}
                </div>
                <div style={{ fontSize: 9, color: C.faint, marginBottom: 6, whiteSpace: "nowrap" }}>
                  {fmtShortDate(t.StartDate)} – {fmtShortDate(t.DueDate)}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 9, color: C.faint }}>Total</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{fmtHours(sum.totalHrs)}h</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.faint }}>Spent</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color }}>{fmtHours(sum.spentHrs)}h</div>
                  </div>
                </div>
                <div style={{ height: 3, backgroundColor: C.border, borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, backgroundColor: color, transition: "width 0.3s" }} />
                </div>
                {pct >= 100 && (
                  <Check size={10} color={color} style={{ position: "absolute", top: 6, right: 6 }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Selected phase detail — Gantt-view overview ONLY (the Schedule
            view keeps just the cards; the chart panel lives under Gantt). ── */}
      {overviewOnly && showPhaseUI && selPhase !== null && !!phaseSummaries[selPhase] && (() => {
        const t = tasks[selPhase];
        const sum = phaseSummaries[selPhase];
        const color = phaseColor(selPhase);
        const pct = Math.min(100, Math.round(Number(t?.PercentComplete ?? 0)));
        const maxHrs = Math.max(...sum.teamInPhase.map(x => x.hrs), 1);
        // Sort: members with hours first (descending), then 0h members alphabetically.
        const sortedTeam = [...sum.teamInPhase].sort((a, b) =>
          a.hrs !== b.hrs ? b.hrs - a.hrs : a.name.localeCompare(b.name));

        // Sparkline: weekly totals across all team members for this phase
        const chartWeeks = allWeeks.filter(wk => phaseForWeek.get(wk) === selPhase);
        const chartData = chartWeeks.map(wk => ({
          wk,
          hrs: team.reduce((s, m) => s + ((m.weeklyHours ?? []).find(w => w.week === wk)?.hours ?? 0), 0),
        }));
        const maxChartHrs = Math.max(...chartData.map(p => p.hrs), 1);

        return (
          <div
            style={{
            backgroundColor: C.soft, borderRadius: 14,
            border: `1px solid ${C.border}`, marginBottom: 12, overflow: "hidden",
            position: "relative",
          }}>
            <button onClick={() => setSelPhase(null)} style={{
              position: "absolute", top: 10, right: 10, background: "transparent",
              border: "none", cursor: "pointer", color: C.faint, padding: 4, zIndex: 2,
            }}><X size={14} /></button>

            {/* Top section: stats + team */}
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {/* Left: phase stats */}
              <div style={{ padding: "13px 18px", minWidth: 210, flex: "0 0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <CalIcon size={13} color={color} />
                  <span style={{ fontSize: 15, fontWeight: 700, color }}>{String(t?.Title ?? `Phase ${selPhase + 1}`)}</span>
                  <span style={{
                    fontSize: 10, padding: "2px 9px",
                    backgroundColor: `${color}22`, color, borderRadius: 20, fontWeight: 600,
                  }}>
                    {pct >= 100 ? "Complete" : pct > 0 ? "In Progress" : "Pending"}
                  </span>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: C.muted }}>Progress</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{pct}%</span>
                  </div>
                  <div style={{ height: 5, backgroundColor: C.border, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: `linear-gradient(90deg, ${color}, ${color}99)`,
                      borderRadius: 3, transition: "width 0.4s",
                    }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 18, marginBottom: 6 }}>
                  {([["Total Hrs", `${fmtHours(sum.totalHrs)}h`, C.text], ["Spent Hrs", `${fmtHours(sum.spentHrs)}h`, color], ["Remaining", `${fmtHours(Math.max(0, sum.totalHrs - sum.spentHrs))}h`, C.muted]] as [string, string, string][]).map(([lbl, val, clr]) => (
                    <div key={lbl}>
                      <div style={{ fontSize: 8, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5 }}>{lbl}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: clr, marginTop: 1 }}>{val}</div>
                    </div>
                  ))}
                </div>
                {t?.StartDate && t?.DueDate && (
                  <div style={{ fontSize: 10, color: C.faint }}>
                    {fmtShortDate(t.StartDate)} → {fmtShortDate(t.DueDate)}
                  </div>
                )}
              </div>

              {/* Divider */}
              {sortedTeam.length > 0 && (
                <div style={{ width: 1, backgroundColor: C.border, flexShrink: 0, alignSelf: "stretch" }} />
              )}

              {/* Right: team in phase */}
              {sortedTeam.length > 0 && (
                <div style={{ flex: 1, padding: "13px 18px", minWidth: 220 }}>
                  <div style={{
                    fontSize: 8, fontWeight: 700, color: C.faint,
                    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8,
                  }}>
                    Team in this phase
                  </div>
                  {/* >5 members: lay the list out in multiple columns (user
                      request) instead of one very tall single column. */}
                  <div style={sortedTeam.length > 5 ? {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                    columnGap: 22,
                  } : undefined}>
                  {sortedTeam.map(tp => (
                    <div key={tp.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                        backgroundColor: tp.hrs > 0 ? avatarColor(tp.name) : C.border,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 700, color: tp.hrs > 0 ? "#fff" : C.muted, letterSpacing: 0.3,
                      }}>{initials(tp.name)}</div>
                      <span style={{
                        fontSize: 12, color: tp.hrs > 0 ? C.text : C.muted, flex: 1,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{tp.name}</span>
                      <span style={{
                        fontSize: 12, fontWeight: tp.hrs > 0 ? 700 : 400,
                        color: tp.hrs > 0 ? color : C.faint,
                        flexShrink: 0, minWidth: 34, textAlign: "right",
                      }}>{tp.hrs > 0 ? `${tp.hrs}h` : "—"}</span>
                      {/* Only show the bar for members who have hours */}
                      {tp.hrs > 0 ? (
                        <div style={{ width: 80, flexShrink: 0 }}>
                          <div style={{ height: 3, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${Math.round((tp.hrs / maxHrs) * 100)}%`,
                              background: `linear-gradient(90deg, ${color}, ${color}66)`,
                              borderRadius: 2,
                            }} />
                          </div>
                        </div>
                      ) : (
                        <div style={{ width: 80, flexShrink: 0 }} />
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Cumulative burnup chart (all phases) ── */}
            {allWeeks.length > 1 && (() => {
              // Build cumulative data across ALL project weeks (not just selected phase)
              const totalHrsAll = allWeeks.reduce((s, wk) =>
                s + team.reduce((ms, m) => ms + ((m.weeklyHours ?? []).find(w => w.week === wk)?.hours ?? 0), 0), 0);
              let cum = 0;
              const allPts = allWeeks.map(wk => {
                const weekHrs = team.reduce((s, m) => s + ((m.weeklyHours ?? []).find(w => w.week === wk)?.hours ?? 0), 0);
                cum += weekHrs;
                return { wk, weekHrs, cumPct: totalHrsAll > 0 ? (cum / totalHrsAll) * 100 : 0, pi: phaseForWeek.get(wk) ?? -1 };
              });

              // Phase background spans
              type Band = { pi: number; x0: number; x1: number };
              const VW = 700, VH = 82;
              const PAD = { t: 6, r: 16, b: 20, l: 38 };
              const gW = VW - PAD.l - PAD.r;
              const gH = VH - PAD.t - PAD.b;
              const n = allPts.length;
              const xOf = (i: number) => PAD.l + (n <= 1 ? gW / 2 : (i / (n - 1)) * gW);
              const yOf = (pct: number) => PAD.t + gH - (pct / 100) * gH;

              const bands: Band[] = [];
              for (let i = 0; i < n; i++) {
                const pi = allPts[i].pi;
                const last = bands[bands.length - 1];
                const x = xOf(i);
                if (last && last.pi === pi) { last.x1 = x + (i < n - 1 ? (xOf(i + 1) - x) / 2 : 0); }
                else { bands.push({ pi, x0: x - (i > 0 ? (x - xOf(i - 1)) / 2 : 0), x1: x + (i < n - 1 ? (xOf(i + 1) - x) / 2 : 0) }); }
              }

              const pts = allPts.map((p, i) => ({ x: xOf(i), y: yOf(p.cumPct), ...p }));
              const area = `M ${pts[0].x},${PAD.t + gH} ${pts.map(p => `L ${p.x},${p.y}`).join(" ")} L ${pts[pts.length - 1].x},${PAD.t + gH} Z`;
              const gradId = `cum-${selPhase}`;
              const lineColor = "#38BDF8"; // fallback for unphased weeks

              // Split line into per-phase colored segments (overlap 1 pt at boundaries)
              type Seg = { polyStr: string; pi: number };
              const segments: Seg[] = [];
              {
                let segPi = pts[0].pi;
                let segPts = [pts[0]];
                for (let i = 1; i < pts.length; i++) {
                  if (pts[i].pi !== segPi) {
                    segments.push({ polyStr: segPts.map(p => `${p.x},${p.y}`).join(" "), pi: segPi });
                    segPts = [pts[i - 1]]; // overlap prev point for seamless join
                    segPi = pts[i].pi;
                  }
                  segPts.push(pts[i]);
                }
                segments.push({ polyStr: segPts.map(p => `${p.x},${p.y}`).join(" "), pi: segPi });
              }

              // Thin dot indices: max ~20 dots evenly spaced + always include last
              const dotStep = Math.max(1, Math.ceil(n / 20));
              const dotIndices = new Set<number>();
              for (let i = 0; i < n; i += dotStep) dotIndices.add(i);
              dotIndices.add(n - 1);

              // X-axis label indices: max 6 labels so they comfortably fit horizontal.
              // After building candidates we strip any that are too close (in pixels)
              // to the next one — prevents the forced "last week" tick crowding the
              // preceding label at the right edge.
              const MIN_PX_PH = 46;
              const labelStep = Math.max(1, Math.ceil(n / 6));
              const labelCandidatesPh: number[] = [];
              for (let i = 0; i < n; i += labelStep) labelCandidatesPh.push(i);
              if (labelCandidatesPh[labelCandidatesPh.length - 1] !== n - 1) labelCandidatesPh.push(n - 1);
              const filteredPh: number[] = [labelCandidatesPh[labelCandidatesPh.length - 1]];
              for (let k = labelCandidatesPh.length - 2; k >= 0; k--) {
                const xNext = PAD.l + (n <= 1 ? gW / 2 : (filteredPh[filteredPh.length - 1] / (n - 1)) * gW);
                const xCur  = PAD.l + (n <= 1 ? gW / 2 : (labelCandidatesPh[k] / (n - 1)) * gW);
                if (xNext - xCur >= MIN_PX_PH) filteredPh.push(labelCandidatesPh[k]);
              }
              const labelIndices = new Set<number>(filteredPh);

              // Hover state (index into pts)
              const hov = chartHover !== null && chartHover < pts.length ? chartHover : null;

              return (
                <div
                  style={{ borderTop: `1px solid ${C.border}`, padding: "6px 0 0", position: "relative" }}
                  onMouseLeave={() => setChartHover(null)}
                >
                  <svg
                    width="100%" viewBox={`0 0 ${VW} ${VH}`}
                    style={{ display: "block", overflow: "visible", cursor: "crosshair" }}
                    onMouseMove={e => {
                      const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                      const mx = ((e.clientX - rect.left) / rect.width) * VW;
                      let best = 0;
                      for (let i = 1; i < pts.length; i++) {
                        if (Math.abs(pts[i].x - mx) < Math.abs(pts[best].x - mx)) best = i;
                      }
                      setChartHover(best);
                    }}
                  >
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
                        <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
                      </linearGradient>
                    </defs>

                    {/* Phase background bands */}
                    {bands.map((b, bi) => b.pi >= 0 && (
                      <rect key={bi}
                        x={Math.max(PAD.l, b.x0)} y={PAD.t}
                        width={Math.min(PAD.l + gW, b.x1) - Math.max(PAD.l, b.x0)}
                        height={gH}
                        fill={phaseColor(b.pi)} fillOpacity={b.pi === selPhase ? 0.14 : 0.06}
                      />
                    ))}

                    {/* Horizontal gridlines */}
                    {[0, 25, 50, 75, 100].map(pct => (
                      <line key={pct}
                        x1={PAD.l} y1={yOf(pct)} x2={PAD.l + gW} y2={yOf(pct)}
                        stroke={C.border} strokeWidth="0.6" strokeOpacity="0.7"
                      />
                    ))}

                    {/* Y-axis labels */}
                    {[0, 25, 50, 75, 100].map(pct => (
                      <text key={pct}
                        x={PAD.l - 5} y={yOf(pct) + 3}
                        textAnchor="end" fontSize="7.5" fill="var(--rm-text-faint)"
                      >{pct}%</text>
                    ))}

                    {/* Area fill */}
                    <path d={area} fill={`url(#${gradId})`} />

                    {/* Per-phase colored line segments */}
                    {segments.map((seg, si) => (
                      <polyline key={si} points={seg.polyStr} fill="none"
                        stroke={seg.pi >= 0 ? phaseColor(seg.pi) : lineColor}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    ))}

                    {/* Thinned dots (max ~20) colored per phase */}
                    {pts.map((p, i) => {
                      if (!dotIndices.has(i) && hov !== i) return null;
                      const col = p.pi >= 0 ? phaseColor(p.pi) : lineColor;
                      return (
                        <circle key={i} cx={p.x} cy={p.y}
                          r={hov === i ? 5 : 2.5}
                          fill={col} fillOpacity={hov === i ? 1 : 0.9}
                          stroke={hov === i ? C.soft : "none"} strokeWidth="1.5" />
                      );
                    })}

                    {/* Hover: dashed vertical line */}
                    {hov !== null && (
                      <line
                        x1={pts[hov].x} y1={PAD.t}
                        x2={pts[hov].x} y2={PAD.t + gH}
                        stroke={lineColor} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.8"
                      />
                    )}

                    {/* X-axis labels — max 6, horizontal, comfortably spaced.
                        First label anchors "start" so it doesn't bleed left of
                        the Y-axis; last label anchors "end" so it stays inside
                        the right edge of the viewBox. */}
                    {pts.filter((_, i) => labelIndices.has(i)).map((p, li, arr) => {
                      const anchor = li === 0 ? "start" : li === arr.length - 1 ? "end" : "middle";
                      return (
                        <text key={li}
                          x={p.x} y={VH - 4}
                          textAnchor={anchor} fontSize="7.5" fill="var(--rm-text-faint)"
                        >{fmtWeekColLabel(p.wk)}</text>
                      );
                    })}

                    {/* Hover tooltip bubble */}
                    {hov !== null && (() => {
                      const p = pts[hov];
                      const phaseName = p.pi >= 0 ? String(tasks[p.pi]?.Title ?? `Phase ${p.pi + 1}`) : null;
                      const phaseCol = p.pi >= 0 ? phaseColor(p.pi) : C.faint;
                      const TW = 110, TH = phaseName ? 52 : 42;
                      const tx = Math.min(Math.max(p.x - TW / 2, PAD.l), PAD.l + gW - TW);
                      // Always keep tooltip inside the SVG viewBox — clamp so it
                      // never falls below (overflow:hidden on parent would clip it)
                      const ty = Math.max(PAD.t + 2, Math.min(VH - TH - PAD.b, p.y - TH - 10));
                      return (
                        <g>
                          <rect x={tx} y={ty} width={TW} height={TH} rx="5" ry="5"
                            fill={C.panel} stroke={C.border} strokeWidth="1" />
                          <text x={tx + 7} y={ty + 13} fontSize="8.5" fontWeight="700" fill={C.text}>{fmtWeekColLabel(p.wk)}</text>
                          <text x={tx + 7} y={ty + 24} fontSize="7.5" fill={C.muted}>This week: <tspan fontWeight="700" fill={C.text}>{p.weekHrs}h</tspan></text>
                          <text x={tx + 7} y={ty + 35} fontSize="7.5" fill={C.muted}>Cumulative: <tspan fontWeight="700" fill={lineColor}>{Math.round(p.cumPct)}%</tspan></text>
                          {phaseName && (
                            <text x={tx + 7} y={ty + 46} fontSize="7" fill={phaseCol}>{phaseName}</text>
                          )}
                        </g>
                      );
                    })()}
                  </svg>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ── Standalone weekly-hours chart — Gantt-view overview only, shown
            when the phase UI is hidden (no schedule). Single-week projects
            render as one centered bar instead of an area line. ── */}
      {overviewOnly && !showPhaseUI && allWeeks.length > 0 && (() => {
        const data = allWeeks.map(wk => ({ wk, hrs: weekTotals.get(wk) ?? 0 }));
        const maxHrs = Math.max(...data.map(d => d.hrs), 1);
        const VW = 700, VH = 96;
        const PAD = { t: 8, r: 16, b: 20, l: 40 };
        const gW = VW - PAD.l - PAD.r;
        const gH = VH - PAD.t - PAD.b;
        const n = data.length;
        const xOf = (i: number) => PAD.l + (n <= 1 ? gW / 2 : (i / (n - 1)) * gW);
        const yOf = (h: number) => PAD.t + gH - (h / maxHrs) * gH;
        const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.hrs), ...d }));
        const area = `M ${pts[0].x},${PAD.t + gH} ${pts.map(p => `L ${p.x},${p.y}`).join(" ")} L ${pts[pts.length - 1].x},${PAD.t + gH} Z`;
        const line = pts.map(p => `${p.x},${p.y}`).join(" ");
        // Max 6 x-axis labels + always the last week.
        // After building the candidate set we strip any label whose pixel
        // distance from the NEXT label is below MIN_PX — this prevents the
        // forced "last week" tick from crowding against the preceding one.
        const MIN_PX = 46; // min gap between label centres (≈ width of "26-Jul-26" at 7.5px)
        const labelStep = Math.max(1, Math.ceil(n / 6));
        const labelCandidates: number[] = [];
        for (let i = 0; i < n; i += labelStep) labelCandidates.push(i);
        // Ensure the last week is included; if it's already the last candidate skip dup
        if (labelCandidates[labelCandidates.length - 1] !== n - 1) labelCandidates.push(n - 1);
        // Remove any candidate whose pixel gap to the NEXT candidate is too tight.
        // We iterate from second-to-last backwards so the forced last always survives.
        const filtered: number[] = [labelCandidates[labelCandidates.length - 1]];
        for (let k = labelCandidates.length - 2; k >= 0; k--) {
          if (xOf(filtered[filtered.length - 1]) - xOf(labelCandidates[k]) >= MIN_PX)
            filtered.push(labelCandidates[k]);
        }
        const labelIdx = new Set<number>(filtered);
        // Thinned dots: max ~20 + always the last week
        const dotStep = Math.max(1, Math.ceil(n / 20));
        const dotIdx = new Set<number>();
        for (let i = 0; i < n; i += dotStep) dotIdx.add(i);
        dotIdx.add(n - 1);
        const hov = chartHover !== null && chartHover < n ? chartHover : null;
        const yTicks = Array.from(new Set([0, Math.round(maxHrs / 2), maxHrs]));
        const green = "#6BA539";
        return (
          <div
            style={{ backgroundColor: C.soft, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 12, padding: "10px 12px 4px" }}
            onMouseLeave={() => setChartHover(null)}
          >
            <div style={{ fontSize: 8.5, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
              Team hours per week
            </div>
            <svg
              width="100%" viewBox={`0 0 ${VW} ${VH}`}
              style={{ display: "block", overflow: "visible", cursor: "crosshair" }}
              onMouseMove={e => {
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const mx = ((e.clientX - rect.left) / rect.width) * VW;
                let best = 0;
                for (let i = 1; i < pts.length; i++) {
                  if (Math.abs(pts[i].x - mx) < Math.abs(pts[best].x - mx)) best = i;
                }
                setChartHover(best);
              }}
            >
              <defs>
                <linearGradient id="hrs-standalone" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={green} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={green} stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Horizontal gridlines + hour labels */}
              {yTicks.map(v => (
                <g key={v}>
                  <line x1={PAD.l} y1={yOf(v)} x2={PAD.l + gW} y2={yOf(v)}
                    stroke={C.border} strokeWidth="0.6" strokeOpacity="0.7" />
                  <text x={PAD.l - 5} y={yOf(v) + 3} textAnchor="end" fontSize="7.5" fill="var(--rm-text-faint)">{v}h</text>
                </g>
              ))}

              {/* Area fill + line — or a single centered bar when only one week exists */}
              {n === 1 ? (
                <>
                  <rect
                    x={xOf(0) - 30} y={yOf(data[0].hrs)} width={60}
                    height={Math.max(2, PAD.t + gH - yOf(data[0].hrs))} rx="4"
                    fill="url(#hrs-standalone)" stroke={green} strokeWidth="1.5" />
                  <text x={xOf(0)} y={yOf(data[0].hrs) - 5} textAnchor="middle"
                    fontSize="9" fontWeight="700" fill={green}>{data[0].hrs}h</text>
                </>
              ) : (
                <>
                  <path d={area} fill="url(#hrs-standalone)" />
                  <polyline points={line} fill="none" stroke={green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}

              {/* Dots */}
              {pts.map((p, i) => {
                if (!dotIdx.has(i) && hov !== i) return null;
                return (
                  <circle key={i} cx={p.x} cy={p.y}
                    r={hov === i ? 5 : 2.5}
                    fill={green} fillOpacity={hov === i ? 1 : 0.9}
                    stroke={hov === i ? C.soft : "none"} strokeWidth="1.5" />
                );
              })}

              {/* Hover: dashed vertical line */}
              {hov !== null && (
                <line x1={pts[hov].x} y1={PAD.t} x2={pts[hov].x} y2={PAD.t + gH}
                  stroke={green} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.8" />
              )}

              {/* X-axis labels */}
              {pts.filter((_, i) => labelIdx.has(i)).map((p, li, arr) => {
                const anchor = arr.length === 1 ? "middle" : li === 0 ? "start" : li === arr.length - 1 ? "end" : "middle";
                return (
                  <text key={li} x={p.x} y={VH - 4} textAnchor={anchor} fontSize="7.5" fill="var(--rm-text-faint)">
                    {fmtWeekColLabel(p.wk)}
                  </text>
                );
              })}

              {/* Hover tooltip bubble */}
              {hov !== null && (() => {
                const p = pts[hov];
                const TW = 100, TH = 30;
                const tx = Math.min(Math.max(p.x - TW / 2, PAD.l), PAD.l + gW - TW);
                const ty = Math.max(PAD.t + 2, Math.min(VH - TH - PAD.b, p.y - TH - 10));
                return (
                  <g>
                    <rect x={tx} y={ty} width={TW} height={TH} rx="5" ry="5"
                      fill={C.panel} stroke={C.border} strokeWidth="1" />
                    <text x={tx + 7} y={ty + 12} fontSize="8.5" fontWeight="700" fill={C.text}>{fmtWeekColLabel(p.wk)}</text>
                    <text x={tx + 7} y={ty + 23} fontSize="7.5" fill={C.muted}>Team hours: <tspan fontWeight="700" fill={green}>{p.hrs}h</tspan></text>
                  </g>
                );
              })()}
            </svg>
          </div>
        );
      })()}

      {/* Everything below (edit buttons, weekly grid, popups, modals) is the
          full Schedule view — skipped entirely in overview mode. */}
      {!overviewOnly && <>

      {/* ── Edit Allocation / Save / Cancel — above the grid, below the chart ──
          Hidden while the project still needs a phase schedule: hours are
          planned against phases, so there is nothing to edit yet. editMode
          keeps the row visible so an in-flight edit can always Save/Cancel. */}
      {canEdit && (!needsSchedule || editMode) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {/* Left cluster: Add member + Add Open Position + Manage with AI */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!editMode && onMemberAdded && (
              <button onClick={() => {
                // Popup mode: hand off to the host's Add Team Member modal.
                if (onAddMember) { onAddMember(); return; }
                setAddSeed(null); setAddOpen(o => !o);
              }} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 14px",
                backgroundColor: addOpen ? C.greenSoft : C.soft,
                border: `1px solid ${addOpen ? C.green : C.border}`,
                borderRadius: 8, color: addOpen ? C.green : C.muted,
                fontSize: 11, fontWeight: 600, cursor: "pointer",
               }} className="tsg-add-member-cta" aria-expanded={addOpen}>
                <Plus size={11} />
                Add member
              </button>
            )}
            {!editMode && onAddOpenPosition && (
              <button onClick={onAddOpenPosition} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 14px",
                backgroundColor: "rgba(232,119,34,0.12)",
                border: "1px solid rgba(232,119,34,0.35)",
                borderRadius: 8, color: "#E87722",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>
                <Plus size={11} />
                Add Open Position
              </button>
            )}
            {/* Member filter — type to narrow the visible rows in-place */}
            {!editMode && (
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <Search size={12} style={{ position: "absolute", left: 9, color: C.muted, pointerEvents: "none" }} />
                <input
                  className="rm-member-search"
                  value={mSearch}
                  placeholder="Filter team members…"
                  onChange={(e) => setMSearch(e.target.value)}
                  style={{
                    padding: "6px 10px 6px 26px", width: 172,
                    backgroundColor: C.soft, border: `1px solid ${C.border}`,
                    borderRadius: 8, color: C.text, fontSize: 11.5, fontWeight: 600,
                    outline: "none",
                    ["--rm-search-ph" as never]: C.muted,
                  }}
                />
                {mSearch && (
                  <button
                    onClick={() => setMSearch("")}
                    style={{ position: "absolute", right: 7, background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
                  >
                    <X size={11} color={String(C.muted)} />
                  </button>
                )}
              </div>
            )}
            {!editMode && (
              <span style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 10, color: C.faint, fontWeight: 500,
              }}>
                <Edit2 size={10} />
                Click any week cell to edit hours directly
              </span>
            )}
          </div>
          {/* Right cluster: Hide ETC/EAC + Apply Template + Manage with AI (+ Save / Cancel while fixing mismatches) */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!editMode && onApplyTemplate && (
              <button onClick={onApplyTemplate} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 14px",
                backgroundColor: "#eff6ff",
                border: "1px solid #93c5fd",
                borderRadius: 8, color: "#1d4ed8",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>
                <Layers size={11} />
                Apply Template
              </button>
            )}
          {!editMode && onManageAI && (
            <button onClick={onManageAI}
              title="Manage with AI"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "6px 10px",
                backgroundColor: "rgba(124,58,237,0.12)",
                border: "1px solid rgba(124,58,237,0.35)",
                borderRadius: 8, color: "rgb(124,58,237)",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>
              <Sparkles size={13} />
              AI
            </button>
          )}
          {editMode && saveErr && (
            <span style={{ fontSize: 11, color: "var(--rm-ink-red)", maxWidth: 420 }}>{saveErr}</span>
          )}
          {editMode && (
            <button onClick={cancelEdit} disabled={saving} style={{
              padding: "6px 14px", background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.muted, fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>Cancel</button>
          )}
          {editMode && (
            <button onClick={saveEdits} disabled={saving} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 14px", backgroundColor: C.green, border: "none",
              borderRadius: 8, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>
              {saving
                ? <span style={{ width: 11, height: 11, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
                : <Check size={11} />}
              Save
            </button>
          )}
          </div>{/* end right cluster */}
        </div>
      )}


      {/* Quick-action errors happen OUTSIDE edit mode (the per-member Schedule
          Hours popup), so they need their own banner — the toolbar one above
          only renders while editMode is on. */}
      {!editMode && saveErr && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8,
          padding: "8px 12px", borderRadius: 8,
          border: "1px solid var(--rm-ink-red)", backgroundColor: C.soft,
        }}>
          <AlertTriangle size={13} color="var(--rm-ink-red)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 11, color: "var(--rm-ink-red)", flex: 1 }}>{saveErr}</span>
          <button onClick={() => setSaveErr(null)} title="Dismiss" style={{
            background: "transparent", border: "none", cursor: "pointer", color: C.faint, padding: 0, flexShrink: 0,
          }}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Schedule grid ── */}
      {allWeeks.length > 0 ? (
        <div style={{ position: "relative" }}>
          {/* Left scroll button */}
          {scrollEdge.left && (
            <button
              onClick={() => { const el = scrollRef.current; if (el) el.scrollBy({ left: -actualWeekW(el), behavior: "smooth" }); }}
              style={{
                position: "absolute", left: FROZEN_W + 4, top: "50%", transform: "translateY(-50%)",
                zIndex: 10, width: 28, height: 28, borderRadius: "50%",
                background: C.panel, border: `1px solid ${C.border}`,
                boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: C.text, padding: 0,
              }}
            >
              <ChevronLeft size={15} />
            </button>
          )}
          {/* Right scroll button */}
          {scrollEdge.right && (
            <button
              onClick={() => { const el = scrollRef.current; if (el) el.scrollBy({ left: actualWeekW(el), behavior: "smooth" }); }}
              style={{
                position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                zIndex: 10, width: 28, height: 28, borderRadius: "50%",
                background: C.panel, border: `1px solid ${C.border}`,
                boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: C.text, padding: 0,
              }}
            >
              <ChevronRight size={15} />
            </button>
          )}
        <div style={{
          borderRadius: 10,
          border: `1px solid ${C.border}`,
          // The Home/Quick Actions dialog owns vertical scrolling. Allow its
          // sticky mirror scrollbar to use that outer viewport; the actual
          // week content remains clipped by rm-grid-vscroll below.
          overflow: modalScrollOwner ? "visible" : "hidden",
        }}>
          {/* Project Detail caps this at roughly 10 member rows. Inside Quick
              Actions, the dialog is the vertical owner: this viewport expands
              naturally and only the week columns scroll here. */}
          <div
            className="rm-grid-vscroll"
            ref={scrollRef}
            style={{
              overflowX: "auto",
              overflowY: modalScrollOwner ? "hidden" : "auto",
              maxHeight: modalScrollOwner ? "none" : 560,
            }}
          >
            <div style={{ display: "inline-flex", flexDirection: "column", minWidth: "100%" }}>

              {/* Phase header + week date header — single sticky block so they
                  always travel together and no cascading-top drift causes gaps */}
              <div style={{ position: "sticky", top: 0, zIndex: 4, backgroundColor: C.panel }}>

                {/* Phase group header row — hidden when the phase UI is off */}
                {showPhaseUI && (
                <div style={{ display: "flex", backgroundColor: C.panel }}>
                  <div style={{
                    width: FROZEN_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 5,
                    backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
                    height: PHASE_H, padding: "0 10px",
                    fontSize: 10, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: 0.5,
                    display: "flex", alignItems: "center", gap: 4,
                  }}>
                    <span>Team Member</span>
                    {(gridTeam.length > 0 || (openRoles?.length ?? 0) > 0) && (
                      <span style={{ fontWeight: 600, color: C.muted, fontSize: 9, letterSpacing: 0 }}>
                        ({gridTeam.length + (openRoles?.length ?? 0)}
                        {(openRoles?.length ?? 0) > 0 && (
                          <span style={{ fontWeight: 500, color: C.faint, fontSize: 8 }}>
                            {" "}· {openRoles!.length} open
                          </span>
                        )})
                      </span>
                    )}
                  </div>
                  {phaseSpans.map((span, si) => {
                    const color = span.pi >= 0 ? phaseColor(span.pi) : "transparent";
                    const label = span.pi >= 0 ? String(tasks[span.pi]?.Title ?? `Phase ${span.pi + 1}`) : "";
                    const isActivePh = selPhase === span.pi;
                    return (
                      <div key={si}
                        style={{
                          flex: `${span.count} 0 ${span.count * weekColW}px`,
                          minWidth: span.count * weekColW, height: PHASE_H,
                          backgroundColor: span.pi >= 0 ? `${color}12` : C.panel,
                          borderBottom: `1px solid ${C.border}`,
                          borderLeft: span.pi >= 0 ? `2px solid ${color}55` : "none",
                          padding: "0 6px",
                          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                          cursor: "default",
                        }}>
                        {label && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color,
                            textTransform: "uppercase", letterSpacing: 0.5,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>{label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}

                <span id={dragInstructionsId} className="sr-only">
                  Drag a metadata column grip to reorder it, or focus the grip and use Alt plus Left or Right arrow.
                </span>
                <span className="sr-only" aria-live="polite" aria-atomic="true">{columnMoveAnnouncement}</span>
                {/* Week date header row — clipPath clips vertical overflow only
                    so labels rotated past the cell top are hidden, but horizontal
                    overflow into neighbouring cells is allowed (100px each side) */}
                <div style={{ display: "flex", backgroundColor: C.panel, clipPath: "inset(0px -100px 0px -100px)" }}>
                  {/* Frozen column sub-headers */}
                  <div style={{
                    width: FROZEN_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 5,
                    backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
                    display: "flex",
                  }}>
                    {frozenCols.map(c => {
                      // ETC/EAC columns are narrow — split "ETC HRS" → "ETC" on
                      // line 1, "HRS" (smaller) on line 2 so both words show.
                      const TWO_LINE_KEYS = new Set(["etcHrs","eacHrs","etcCost","eacCost"]);
                      const [hTop, hBot] = TWO_LINE_KEYS.has(c.key) && c.label.includes(" ")
                        ? c.label.split(" ")
                        : [c.label, ""];
                      // Total summary shown above the column label for the 4 ETC/EAC cols.
                      // Accents come from the phase palette (COL_ACCENT) so the
                      // summary columns share the phase cards' color family.
                      const headAccent = COL_ACCENT[c.key];
                      const colTotalVal =
                        c.key === "etcHrs"  ? (totals.etcHrs  ? `${fmtHours(totals.etcHrs)}h` : null)
                      : c.key === "eacHrs"  ? (totals.eacHrs  ? `${fmtHours(totals.eacHrs)}h` : null)
                      : c.key === "etcCost" ? (totals.etcCost ? fmtEtcCost(totals.etcCost) : null)
                      : c.key === "eacCost" ? (totals.eacCost ? fmtEtcCost(totals.eacCost) : null)
                      : null;
                      // EAC HRS header carries a tiny ‹/› expand toggle on
                      // its left edge — only visible ETC/EAC column by default.
                      const isEacHrs = c.key === "eacHrs";
                      // Toggle button takes 16 px on the left edge of EAC HRS.
                      // Add matching paddingLeft so the total value and label are
                      // centred in the remaining space, never hidden behind the button.
                      const eacToggleOffset = isEacHrs && !soloMember ? 16 : 0;
                      return (
                      <div key={c.key} data-schedule-column-key={c.key} title={isEacHrs ? undefined : HEADER_TIPS[c.key]}
                        onDragOver={ORDERABLE_METADATA_KEYS.includes(c.key as typeof ORDERABLE_METADATA_KEYS[number]) ? (e) => { e.preventDefault(); if (draggedMetadataKey !== c.key) setDropMetadataKey(c.key); } : undefined}
                        onDrop={ORDERABLE_METADATA_KEYS.includes(c.key as typeof ORDERABLE_METADATA_KEYS[number]) ? (e) => { e.preventDefault(); if (draggedMetadataKey) moveMetadataColumn(draggedMetadataKey, c.key); setDraggedMetadataKey(null); setDropMetadataKey(null); } : undefined}
                        style={{
                        width: c.w, flexShrink: 0,
                        padding: "4px 5px", paddingLeft: 5 + eacToggleOffset,
                        fontSize: 10, fontWeight: 800, color: headAccent ?? C.text,
                        textTransform: "uppercase", letterSpacing: 0.4,
                        borderRight: `1px solid ${C.border}`, display: "flex",
                        flexDirection: "column", alignItems: "center", justifyContent: "center",
                        position: "relative", overflow: "hidden",
                        ...(HEADER_TIPS[c.key] && !isEacHrs ? { cursor: "help" } : {}),
                        ...(dropMetadataKey === c.key ? { boxShadow: `inset 3px 0 0 ${C.green}` } : {}),
                      }}>
                        {ORDERABLE_METADATA_KEYS.includes(c.key as typeof ORDERABLE_METADATA_KEYS[number]) && (
                          <button
                            type="button"
                            draggable
                            aria-label={`Reorder ${c.label} column`}
                            aria-describedby={dragInstructionsId}
                            title="Drag to reorder · Alt + Left/Right to move"
                            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.key); setDraggedMetadataKey(c.key); }}
                            onDragEnd={() => { setDraggedMetadataKey(null); setDropMetadataKey(null); }}
                             onPointerDown={(e) => {
                               if (e.pointerType === "mouse") return;
                               e.currentTarget.setPointerCapture(e.pointerId);
                               setDraggedMetadataKey(c.key);
                               setDropMetadataKey(null);
                             }}
                             onPointerMove={(e) => {
                               if (e.pointerType === "mouse" || draggedMetadataKey !== c.key) return;
                               const target = document.elementFromPoint(e.clientX, e.clientY)
                                 ?.closest<HTMLElement>("[data-schedule-column-key]")
                                 ?.dataset.scheduleColumnKey;
                               if (target && target !== c.key && (ORDERABLE_METADATA_KEYS as readonly string[]).includes(target)) {
                                 setDropMetadataKey(target);
                               }
                             }}
                             onPointerUp={(e) => {
                               if (e.pointerType === "mouse") return;
                               if (dropMetadataKey) moveMetadataColumn(c.key, dropMetadataKey);
                               setDraggedMetadataKey(null);
                               setDropMetadataKey(null);
                             }}
                            onKeyDown={(e) => {
                              if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                              e.preventDefault();
                              const index = frozenCols.findIndex(x => x.key === c.key);
                              const neighbor = frozenCols[index + (e.key === "ArrowLeft" ? -1 : 1)];
                              if (neighbor && ORDERABLE_METADATA_KEYS.includes(neighbor.key as typeof ORDERABLE_METADATA_KEYS[number])) moveMetadataColumn(c.key, neighbor.key);
                            }}
                            style={{
                              position: "absolute", left: 1, top: 1, padding: 0, border: "none",
                              background: "transparent", color: C.faint, cursor: "grab", lineHeight: 0, zIndex: 8,
                              touchAction: "none",
                            }}
                          ><GripVertical size={12} /></button>
                        )}
                        {/* ‹/› expand toggle on the LEFT edge of the EAC HRS header cell */}
                        {isEacHrs && !soloMember && (
                          <button
                            onClick={toggleCostCols}
                            title={costColsExpanded ? "Collapse — show EAC HRS only" : "Expand — show ETC HRS · EAC HRS · ETC Cost · EAC Cost"}
                            style={{
                              position: "absolute", left: 0, top: 0, bottom: 0,
                              width: 16,
                              background: `linear-gradient(to right, ${COL_ACCENT.eacHrs}55, transparent)`,
                              border: "none",
                              borderRight: `2px solid ${COL_ACCENT.eacHrs}77`,
                              padding: 0, cursor: "pointer",
                              color: COL_ACCENT.eacHrs,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              zIndex: 7,
                            }}>
                            {costColsExpanded
                              ? <ChevronLeft  size={13} strokeWidth={3} />
                              : <ChevronRight size={13} strokeWidth={3} />}
                          </button>
                        )}
                        {colTotalVal && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap",
                            color: headAccent ?? C.text, marginBottom: 1,
                          }}>{colTotalVal}</span>
                        )}
                        {hBot ? (
                          <>
                            <span style={{ whiteSpace: "nowrap", lineHeight: 1.2 }}>{hTop}</span>
                            <span style={{ fontSize: 8, fontWeight: 600, color: C.faint, whiteSpace: "nowrap", lineHeight: 1.2 }}>{hBot}</span>
                          </>
                        ) : (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                        )}
                        {c.key !== "act" && (
                          <div
                            onMouseDown={(e) => startColDrag(e, c.key, c.w)}
                            onDoubleClick={() => resetColW(c.key)}
                            title="Drag to resize · double-click to reset"
                            style={{
                              position: "absolute", top: 0, right: 0, width: 7, height: "100%",
                              cursor: "col-resize", zIndex: 6,
                            }}
                          />
                        )}
                      </div>
                      );
                    })}
                  </div>
                  {/* Week date cells — diagonal (-45°) date label on top,
                      hours + utilization % on a dedicated strip below */}
                  {allWeeks.map(wk => {
                    const isNow = wk === nowWeekKey;
                    const pi = piOf(wk);
                    const isSel = wk === selWeek;
                    return (
                      <div key={wk} onClick={() => setSelWeek(isSel ? null : wk)} title={`Week of ${fmtWeekColLabel(wk)}`} style={{
                        ...weekCellSizing,
                        position: "relative",
                        backgroundColor: isSel ? `${C.green}22` : isNow ? C.nowBg : pi >= 0 ? `${phaseColor(pi)}08` : C.panel,
                        borderBottom: `1px solid ${isSel ? C.green : C.border}`,
                        borderLeft: weekBorderLeft.get(wk) ?? `1px solid ${C.cellBorder}`,
                        height: HEAD_H, cursor: "pointer",
                      }}>
                        <div style={{
                          position: "absolute", inset: 0,
                          display: "flex", flexDirection: "column",
                          pointerEvents: "none",
                        }}>
                          {/* Date zone — flat + centered when the columns are
                              wide enough for the label (few-week schedules);
                              otherwise diagonal, rotation anchored at the
                              label's bottom-LEFT corner so the text only rises
                              upward and never dips into the hours strip below */}
                          <div style={{ position: "relative", flex: 1 }}>
                            {flatWeekHead ? (
                              <span style={{
                                position: "absolute", inset: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
                                color: isSel ? C.green : isNow ? C.nowHead : C.text,
                                textTransform: "uppercase", whiteSpace: "nowrap",
                              }}>
                                {fmtWeekColShort(wk)}
                              </span>
                            ) : (
                              <span style={{
                                position: "absolute", bottom: 4, left: 8,
                                transform: "rotate(-45deg)",
                                transformOrigin: "0% 100%",
                                fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
                                color: isSel ? C.green : isNow ? C.nowHead : C.text,
                                textTransform: "uppercase", whiteSpace: "nowrap",
                                display: "inline-block",
                              }}>
                                {fmtWeekColShort(wk)}
                              </span>
                            )}
                          </div>
                          {/* Hours + utilization strip */}
                          <div style={{
                            height: 20, borderTop: `1px solid ${C.cellBorder}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            overflow: "hidden",
                          }}>
                            {(() => {
                              const wkTotal = weekTotals.get(wk) ?? 0;
                              if (!wkTotal) return null;
                              const wwh = Math.max(1, getBusinessRules().workWeekHours ?? 40);
                              const utilPct = Math.round((wkTotal / wwh) * 100);
                              const col = isSel ? C.green : pi >= 0 ? phaseColor(pi) : C.green;
                              return (
                                <span style={{ fontSize: 9.5, fontWeight: 700, color: col, lineHeight: 1, whiteSpace: "nowrap" }}>
                                  {formatWeeklyTotal(wkTotal)}h ({utilPct}%)
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>


              {/* Member rows — always full team; phase card only scrolls columns */}
              {gridTeam.map(m => {
                const memberId = m.resourceId ?? m.name;
                const hourMap = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
                const etcStr = fmtEtcCost(m.etcCost);
                const eacCostStr = fmtEtcCost(m.eacCost);
                const memberMismatches = mismatches[memberId];
                const mismatchWeeks = new Set(memberMismatches?.map(mm => mm.week) ?? []);
                // Whole-row wash when any flag is set (locked > NC > soft).
                // The week-cell area takes the translucent tint directly; the
                // frozen pane must stay OPAQUE (it slides over the week cells),
                // so it layers the same tint over C.panel via backgroundImage.
                const flagTint = rowFlagTint(m);
                return (
                  <div key={m.resourceId || `${m.name}:${m.role}`} style={{ display: "contents" }}>
                    <div data-member-id={memberId} style={{ display: "flex", borderBottom: memberMismatches?.length ? "none" : `1px solid ${C.border}`, backgroundColor: flagTint ?? undefined, transition: "background-color 0.35s" }}>
                      {/* Frozen member info */}
                      <div style={{
                        width: FROZEN_W, flexShrink: 0, display: "flex",
                        backgroundColor: C.panel, position: "sticky", left: 0, zIndex: 2,
                        backgroundImage: flagTint ? `linear-gradient(${flagTint}, ${flagTint})` : undefined,
                        borderRight: `1px solid ${C.colSep}`,
                      }}>
                        {hasOrgCol("bu") && (
                          <div title={m.memberBu || undefined} style={{ order: colOrder("bu"), width: colW("bu"), flexShrink: 0, padding: "6px 5px", fontSize: 11, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.memberBu || "—"}</span>
                          </div>
                        )}
                        {hasOrgCol("division") && (
                          <div title={m.bu || undefined} style={{ order: colOrder("division"), width: colW("division"), flexShrink: 0, padding: "6px 5px", fontSize: 11, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.bu || "—"}</span>
                          </div>
                        )}
                        {hasOrgCol("dept") && (
                          <div title={m.dept || undefined} style={{ order: colOrder("dept"), width: colW("dept"), flexShrink: 0, padding: "6px 5px", fontSize: 11, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.dept || "—"}</span>
                          </div>
                        )}
                        <div title={m.role || undefined} style={{ order: colOrder("role"), width: colW("role"), flexShrink: 0, padding: "6px 5px", fontSize: 11, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.role || "—"}</span>
                        </div>
                        <div title={m.name} style={{ order: colOrder("name"), width: colW("name"), flexShrink: 0, padding: "5px 7px", display: "flex", alignItems: "center", gap: 7, borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                            backgroundColor: avatarColor(m.name),
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 9, fontWeight: 700, color: "#fff",
                          }}>{initials(m.name)}</div>
                          <div style={{ overflow: "hidden", flex: 1 }}>
                            {/* Full name — ellipsizes past the column cap with
                                the complete name on the cell's hover title. */}
                            <div style={{ fontSize: 11, fontWeight: 600, color: empTypeColor(m.employeeType) ?? C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {m.name}
                              {(() => {
                                const hint = disambiguatorFor(m, dupNames);
                                return hint ? (
                                  <span style={{ fontSize: 9, fontWeight: 500, color: C.muted, marginLeft: 4, fontStyle: "italic" }}>
                                    ({hint})
                                  </span>
                                ) : null;
                              })()}
                            </div>
                             <DisabledMemberStatus enabled={m.enabled} userGuid={m.resourceId} tenantId={m.tenantId}
                               canManageStaff={!!canEdit} onReactivated={() => {
                                 setTeam(prev => prev.map(row => row.resourceId === m.resourceId ? { ...row, enabled: true } : row));
                                 onReload?.(true);
                               }} />
                            {(() => {
                              // When DEPT has its own column, the subtitle shows only
                              // the job title — no duplicated department text.
                              const subtitle = [hasOrgCol("dept") ? "" : m.dept, m.title].filter(Boolean).join(" · ");
                              return subtitle ? (
                                <div style={{ fontSize: 9, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {subtitle}
                                </div>
                              ) : null;
                            })()}
                          </div>
                          {/* ⋯ member actions — Change resource + Remove (both
                              manage-staff-gated by the page via the callbacks). */}
                          {(onChangeResource || onRemoveMember) && (
                            <MemberActionMenu
                              name={m.name}
                              disabledNote={editMode || saving ? "Finish the hours edit first" : undefined}
                              onChangeResource={onChangeResource ? () => onChangeResource(m) : undefined}
                              onRemove={onRemoveMember ? () => setRemoveConfirm({ kind: "member", m }) : undefined}
                            />
                          )}
                        </div>
                        {hasOrgCol("flags") && (() => {
                          // Three fixed sub-slots (S | NC | lock) so the flags line
                          // up as mini-columns. Manage-staff viewers click a slot —
                          // a confirm popup explains the effect BEFORE it acts. Off
                          // state renders dimmed/dashed (the lock shows an OPEN
                          // padlock); read-only viewers see only the active badges.
                          const mid = m.resourceId ?? m.name;
                          const canToggle = canUnlock && !!(onToggleFlag || onToggleLock);
                          const slotBase = {
                            width: 24, height: 18, display: "inline-flex", alignItems: "center",
                            justifyContent: "center", borderRadius: 4, flexShrink: 0,
                            fontSize: 9, fontWeight: 900, letterSpacing: "0.02em", padding: 0,
                          } as const;
                          const slots: Array<{ flag: FlagKind; on: boolean }> = [
                            { flag: "soft", on: !!m.softAllocation },
                            { flag: "nc", on: !!m.nonChargeable },
                            { flag: "locked", on: !!m.isLocked },
                          ];
                          return (
                            <div style={{ order: colOrder("flags"), width: colW("flags"), flexShrink: 0, padding: "4px 3px", borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" }}>
                              {slots.map(s => {
                                const meta = FLAG_META[s.flag];
                                const busy = flagBusy.has(`${mid}:${s.flag}`);
                                // Lock still toggles through the legacy onToggleLock
                                // when no generic handler was passed.
                                const clickable = canToggle && (!!onToggleFlag || s.flag === "locked");
                                // The key remounts the span whenever the state flips,
                                // replaying the pop animation — the lock visibly
                                // springs between the closed and OPEN padlock.
                                const inner = (
                                  <span key={s.on ? "on" : "off"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", animation: "tsg-flag-pop 0.35s ease" }}>
                                    {s.flag === "locked"
                                      ? (s.on ? <Lock size={10} strokeWidth={2.75} /> : <LockOpen size={10} strokeWidth={2.25} />)
                                      : meta.short}
                                  </span>
                                );
                                if (!s.on && !clickable) {
                                  // Quick Actions intentionally hosts this same
                                  // grid in read-only flag mode. Keep the three
                                  // S / NC / lock marks visible there too,
                                  // instead of turning inactive flags into
                                  // invisible spacers.
                                  return (
                                    <span
                                      key={s.flag}
                                      title={`${meta.name} — ${meta.what}. Only an admin (or a user who can manage staff) can change flags.`}
                                      aria-label={`${meta.name} inactive`}
                                      style={{
                                        ...slotBase,
                                        color: meta.color,
                                        background: "transparent",
                                        border: `1px dashed ${meta.chipBd}`,
                                        opacity: 0.5,
                                        cursor: "default",
                                      }}
                                    >
                                      {inner}
                                    </span>
                                  );
                                }
                                if (!clickable) {
                                  return (
                                    <span key={s.flag} title={`${meta.name} — ${meta.what}. Only an admin (or a user who can manage staff) can change flags.`}
                                      style={{ ...slotBase, color: "#fff", background: meta.chipBg, border: `1px solid ${meta.chipBd}`, boxShadow: `0 0 8px ${meta.color}55`, cursor: "default" }}>
                                      {inner}
                                    </span>
                                  );
                                }
                                return (
                                  <button key={s.flag} type="button"
                                    title={s.on && s.flag !== "nc"
                                      ? `${meta.name} — ${meta.what}. Click to remove.`
                                      : (!s.on ? `${s.flag === "locked" ? "Lock" : `Mark ${meta.short}`} — ${meta.what}.` : undefined)}
                                    onMouseEnter={s.flag === "nc" && s.on ? e => setNcHover({ m, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
                                    onMouseLeave={s.flag === "nc" && s.on ? () => setNcHover(null) : undefined}
                                    onClick={() => {
                                      if (!busy) {
                                        setNcHover(null);
                                        // Pre-fill the NC rate input from the member's configured
                                        // cost rate so the user just has to confirm or adjust.
                                        // (Financial-capability users only — others never send a rate.)
                                        if (s.flag === "nc" && !s.on && m.costRate > 0 && canEditNcRate) {
                                          setNcRateInput(String(m.costRate));
                                        } else {
                                          setNcRateInput("");
                                        }
                                        setFlagConfirm({ m, flag: s.flag, next: !s.on });
                                      }
                                    }}
                                    style={{
                                      ...slotBase, cursor: busy ? "wait" : "pointer",
                                      color: s.on ? "#fff" : meta.color,
                                      background: s.on ? meta.chipBg : "rgba(255,255,255,0.07)",
                                      border: `1px solid ${s.on ? meta.chipBd : meta.color}`,
                                      boxShadow: s.on ? `0 0 8px ${meta.color}55` : "none",
                                      opacity: busy ? 0.45 : 1,
                                      transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s, color 0.2s",
                                    }}>
                                    {inner}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                        {hasOrgCol("start") && (
                          <div style={{ order: colOrder("start"), width: colW("start"), flexShrink: 0, padding: "6px 4px", fontSize: 9, color: C.muted, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtShortDate(m.startDate) || "—"}</span>
                          </div>
                        )}
                        {hasOrgCol("end") && (
                          <div style={{ order: colOrder("end"), width: colW("end"), flexShrink: 0, padding: "6px 4px", fontSize: 9, color: C.muted, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtShortDate(m.endDate) || "—"}</span>
                          </div>
                        )}
                        {/* Order matches frozenCols: EAC HRS (anchor) first, then ETC HRS. */}
                        {hasOrgCol("eacHrs") && (
                        <div onMouseEnter={showCostTip("eacHrs", m)} onMouseLeave={hideCostTip} style={{ order: colOrder("eacHrs"), width: colW("eacHrs"), flexShrink: 0, padding: "6px 4px", fontSize: 11, fontWeight: 600, color: COL_ACCENT.eacHrs, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "hidden", cursor: "help" }}>
                          {m.eacHrs ? `${Math.round(m.eacHrs)}h` : "—"}
                        </div>
                        )}
                        {hasOrgCol("etcHrs") && (
                        <div onMouseEnter={showCostTip("etcHrs", m)} onMouseLeave={hideCostTip} style={{ order: colOrder("etcHrs"), width: colW("etcHrs"), flexShrink: 0, padding: "6px 4px", fontSize: 11, fontWeight: 600, color: COL_ACCENT.etcHrs, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "hidden", cursor: "help" }}>
                          {m.etcHrs ? `${Math.round(m.etcHrs)}h` : "—"}
                        </div>
                        )}
                        {hasOrgCol("etcCost") && (
                        <div onMouseEnter={showCostTip("etcCost", m)} onMouseLeave={hideCostTip} style={{ order: colOrder("etcCost"), width: colW("etcCost"), flexShrink: 0, padding: "6px 4px", fontSize: 10, fontWeight: 600, color: COL_ACCENT.etcCost, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "hidden", cursor: "help" }}>
                          {/* No billing rate resolved for this member (role/title
                              rate + tenant default all missing) — cost can never
                              compute, so offer a one-click jump to the Billing
                              Rates page focused on this role's row. */}
                          {canEdit && !m.costRate && (m.role || m.title) ? (
                            <button
                              title={`No billing rate set for ${m.role || m.title} — click to set it on the Billing Rates page`}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/billing-rates?editRole=${encodeURIComponent((m.role || m.title).trim())}&returnTo=${encodeURIComponent(location)}`);
                              }}
                              data-testid={`btn-set-rate-${memberId}`}
                              style={{
                                fontSize: 9, fontWeight: 700, lineHeight: 1.2, padding: "2px 8px",
                                borderRadius: 8, border: "1px solid #6BA539", background: "transparent",
                                color: "#6BA539", cursor: "pointer",
                              }}
                            >Set</button>
                          ) : etcStr}
                        </div>
                        )}
                        {hasOrgCol("eacCost") && (
                        <div onMouseEnter={showCostTip("eacCost", m)} onMouseLeave={hideCostTip} style={{ order: colOrder("eacCost"), width: colW("eacCost"), flexShrink: 0, padding: "6px 4px", fontSize: 10, fontWeight: 600, color: COL_ACCENT.eacCost, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", overflow: "hidden", cursor: "help" }}>
                          {eacCostStr}
                        </div>
                        )}
                        {hasOrgCol("act") && (
                          <div style={{ order: colOrder("act"), width: colW("act"), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            {canEdit && (
                            <button
                              title={`Schedule hours for ${m.name}`}
                              disabled={editMode || saving || quickBusy.has(memberId)}
                              onClick={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const left = Math.max(8, Math.min(rect.left, window.innerWidth - 290));
                                // Open toward whichever side of the button has
                                // more room — top rows used to clip the menu
                                // above the viewport because it always opened
                                // upward. maxH caps the menu to the available
                                // room so every option stays reachable.
                                const spaceAbove = rect.top - 12;
                                const spaceBelow = window.innerHeight - rect.bottom - 12;
                                const EST_MENU_H = 320;
                                if (spaceAbove >= EST_MENU_H || spaceAbove >= spaceBelow) {
                                  setActMenu({ memberId, bottom: window.innerHeight - rect.top + 4, left, maxH: Math.max(140, spaceAbove) });
                                } else {
                                  setActMenu({ memberId, top: rect.bottom + 4, left, maxH: Math.max(140, spaceBelow) });
                                }
                              }}
                              style={{
                                width: 26, height: 26, borderRadius: 7,
                                background: C.greenSoft, border: `1px solid ${C.green}`,
                                boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                                cursor: (editMode || saving || quickBusy.has(memberId)) ? "default" : "pointer",
                                opacity: (editMode || saving) ? 0.35 : 1,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                padding: 0, flexShrink: 0,
                              }}
                            >
                              {quickBusy.has(memberId)
                                ? <span style={{ width: 12, height: 12, border: `2px solid ${C.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
                                : <CalendarClock size={16} color={C.green} strokeWidth={2.2} />}
                            </button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Week cells */}
                      {allWeeks.map(wk => {
                        const hrs = editMode
                          ? (editHours[memberId]?.[wk] ?? hourMap[wk] ?? 0)
                          : (hourMap[wk] ?? 0);
                        const isNow = wk === nowWeekKey;
                        const pi = piOf(wk);
                        const isMismatch = !editMode && mismatchWeeks.has(wk);
                        // In fix-edit mode, highlight cells that were pre-filled with intended values
                        const isFixCell = editMode && mismatchWeeks.size > 0 && mismatchWeeks.has(wk);
                        const pastLocked = isWeekLocked(wk);
                        const locked = editMode && pastLocked;
                        // Direct cell editing (read mode only)
                        const isCellEditing = !editMode && cellEdit?.memberId === memberId && cellEdit?.wk === wk;
                        // A cell mid-save stays editable — the queue coalesces
                        // the newer value into the next background POST.
                        const cellEditable  = canEdit && !editMode && !needsSchedule && !pastLocked
                          && !saving && !quickBusy.has(memberId) && !isCellEditing;
                        return (
                          <div
                            key={wk}
                            className={cellEditable ? "tsg-week-cell" : undefined}
                            onClick={cellEditable ? () => openCellEdit(m, wk) : undefined}
                            title={cellEditable ? "Click to edit hours"
                              : (!editMode && pastLocked && canEdit ? "Past week — locked" : undefined)}
                            style={{
                              ...weekCellSizing,
                              position: "relative",
                              backgroundColor: isMismatch ? "#F59E0B18"
                                : locked ? `${C.border}18`
                                : isNow ? C.nowBg
                                : pi >= 0 ? `${phaseColor(pi)}08` : "transparent",
                              borderLeft: weekBorderLeft.get(wk) ?? `1px solid ${C.cellBorder}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              padding: editMode ? 2 : 0,
                              cursor: cellEditable ? "pointer" : "default",
                            }}>
                            {editMode && !locked ? (() => {
                              const batchKey = `${memberId}|${wk}`;
                              const hasErr = weekInputErrors.has(batchKey);
                              return (
                                <input
                                  type="number" min="0"
                                  value={hrs === 0 ? "" : String(hrs)}
                                  placeholder="0"
                                  onChange={e => {
                                    validateWeeklyInput(e.target.value, batchKey);
                                    const n = Number(e.target.value);
                                    // Store raw value (may be over limit — visible, error shown)
                                    setHour(memberId, wk, Math.max(0, Number.isFinite(n) ? n : 0));
                                  }}
                                  style={{
                                    width: "100%", textAlign: "center", background: "transparent",
                                    border: `1px solid ${hasErr ? "#ef4444" : isFixCell ? "#F59E0B" : hrs > 0 ? C.green : C.border}`,
                                    borderRadius: 4, color: hasErr ? "#ef4444" : isFixCell ? "#F59E0B" : C.text, fontSize: 11,
                                    padding: "2px 0", outline: "none",
                                  }}
                                />
                              );
                            })() : isCellEditing ? (<>
                              {/* Inline editor — contained INSIDE the cell (the old
                                 floating card overlapped the neighbouring week
                                 columns). Spreadsheet feel: Enter or clicking
                                 away saves, Esc cancels. */}
                              {(() => {
                                const cellKey2 = `${memberId}|${wk}`;
                                const hasErr = weekInputErrors.has(cellKey2);
                                return (
                              <input
                                ref={cellInputRef}
                                className="tsg-cell-input"
                                type="number" min="0"
                                value={cellEdit!.val}
                                placeholder="0"
                                onChange={e => {
                                  const v = validateWeeklyInput(e.target.value, cellKey2);
                                  setCellEdit(ce => ce ? { ...ce, val: v } : ce);
                                }}
                                onKeyDown={e => {
                                  if (e.key === "Enter") {
                                    if (!cellDoneRef.current) { cellDoneRef.current = true; void confirmCellEdit(m); }
                                  } else if (e.key === "Escape") {
                                    cellDoneRef.current = true;
                                    setCellEdit(null);
                                  }
                                }}
                                onBlur={() => {
                                  // Click-away = save, like a spreadsheet. The ref
                                  // guard keeps Enter/Esc from double-firing this.
                                  if (!cellDoneRef.current) { cellDoneRef.current = true; void confirmCellEdit(m); }
                                }}
                              />
                                );
                              })()}
                            </>) : (
                              <span
                                className={cellEditable ? "tsg-cell-editable" : undefined}
                                style={{
                                  fontSize: 11, fontWeight: hrs > 0 ? 600 : 400,
                                  color: locked ? C.faint
                                    : isMismatch ? "#F59E0B"
                                    : hrs > 0 ? (isNow ? C.nowText : C.text) : C.faint,
                                  opacity: locked ? 0.45 : 1,
                                }}>
                                {hrs > 0 ? hrs : ""}
                              </span>
                            )}
                            {capHintCell === `${memberId}|${wk}` && (
                              <div style={{
                                position: "absolute", bottom: "calc(100% + 4px)", left: "50%",
                                transform: "translateX(-50%)", whiteSpace: "nowrap",
                                background: "#1B2B38", color: "#ef4444",
                                border: "1px solid #ef444466", borderRadius: 6,
                                padding: "4px 8px", fontSize: 11, fontWeight: 600,
                                zIndex: Z.MODAL_MENU, pointerEvents: "none",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                              }}>
                                Exceeds {MAX_WEEK_HOURS}h/week — {MAX_WEEK_HOURS_HINT}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* ── Mismatch banner ── shown only when save verification detects a round-trip discrepancy */}
                    {memberMismatches && memberMismatches.length > 0 && (
                      <div style={{
                        position: "sticky", left: 0,
                        width: gridW ? gridW : "100%", boxSizing: "border-box",
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "5px 10px", borderBottom: `1px solid ${C.border}`,
                        backgroundColor: "#F59E0B14",
                        borderLeft: "3px solid #F59E0B",
                      }}>
                        <AlertTriangle size={12} color="#F59E0B" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "#F59E0B", flex: 1 }}>
                          {memberMismatches.length} week{memberMismatches.length !== 1 ? "s" : ""} for <strong>{m.name}</strong> didn't save correctly
                          {memberMismatches.length <= 3 && (
                            <span style={{ color: "#F59E0B99", marginLeft: 6 }}>
                              ({memberMismatches.map(mm => {
                                const d = mm.week.slice(5); // "MM-DD"
                                return `${d} → ${mm.intended}h`;
                              }).join(", ")})
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => fixMismatch(memberId)}
                          style={{
                            padding: "3px 10px", backgroundColor: "#F59E0B", border: "none",
                            borderRadius: 6, color: "#000", fontSize: 11, fontWeight: 700,
                            cursor: "pointer", flexShrink: 0,
                          }}
                        >
                          Fix now
                        </button>
                        <button
                          onClick={() => setMismatches(prev => { const n = { ...prev }; delete n[memberId]; return n; })}
                          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#F59E0B99", padding: 2, flexShrink: 0 }}
                          title="Dismiss"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── OPEN positions: unfilled demand as slim amber rows below
                    the members (mirrors the Gantt's dashed-amber convention).
                    Manage-staff viewers get the same ✕ remove as member rows —
                    the popup + server only ever touch still-open RA rows, so a
                    stale click can never delete a person's allocation. ── */}
              {!editMode && !soloMember && (openRoles?.length ?? 0) > 0 && openRoles!.map((r, oi) => (
                <div key={`open-${oi}-${r.allocationId || r.role}`} style={{ display: "flex", minWidth: "fit-content", borderTop: `1px solid ${C.border}` }}>
                  <div style={{
                    width: FROZEN_W, flexShrink: 0, display: "flex",
                    backgroundColor: C.panel, position: "sticky", left: 0, zIndex: 2,
                    backgroundImage: "linear-gradient(rgba(245,158,11,0.07), rgba(245,158,11,0.07))",
                    borderRight: `1px solid ${C.colSep}`,
                  }}>
                    {hasOrgCol("bu") && (
                      <div title={r.bu || undefined} style={{ order: colOrder("bu"), width: colW("bu"), flexShrink: 0, padding: "6px 5px", fontSize: 11, fontWeight: 500, color: C.text, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.bu || "—"}</span>
                      </div>
                    )}
                    {hasOrgCol("division") && <div style={{ order: colOrder("division"), width: colW("division"), flexShrink: 0, padding: "6px 5px", fontSize: 11, color: C.faint, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center" }}>—</div>}
                    {hasOrgCol("dept") && <div style={{ order: colOrder("dept"), width: colW("dept"), flexShrink: 0, padding: "6px 5px", fontSize: 11, color: C.faint, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center" }}>—</div>}
                    <div title={r.role || undefined} style={{ order: colOrder("role"), width: colW("role"), flexShrink: 0, padding: "6px 5px", fontSize: 11, fontWeight: 600, color: "#F59E0B", borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.role || "—"}</span>
                    </div>
                    <div style={{ order: colOrder("name"), width: colW("name"), flexShrink: 0, padding: "5px 7px", display: "flex", alignItems: "center", gap: 7, borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: "50%", flexShrink: 0, boxSizing: "border-box",
                        border: "2px dashed #F59E0B",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}><span style={{ color: "#F59E0B", fontWeight: 700, fontSize: 11 }}>?</span></div>
                      <div style={{ overflow: "hidden", flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#F59E0B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Open position</div>
                        {r.title && <div style={{ fontSize: 9, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>}
                      </div>
                    </div>
                    {hasOrgCol("flags") && <div style={{ order: colOrder("flags"), width: colW("flags"), flexShrink: 0, borderRight: `1px solid ${C.border}` }} />}
                    {hasOrgCol("start") && (
                      <div style={{ order: colOrder("start"), width: colW("start"), flexShrink: 0, padding: "6px 4px", fontSize: 9, color: C.muted, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>
                        {r.startDate ? new Date(r.startDate.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}
                      </div>
                    )}
                    {hasOrgCol("end") && (
                      <div style={{ order: colOrder("end"), width: colW("end"), flexShrink: 0, padding: "6px 4px", fontSize: 9, color: C.muted, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>
                        {r.endDate ? new Date(r.endDate.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}
                      </div>
                    )}
                    {/* Order matches frozenCols: EAC HRS (anchor) first, then ETC HRS. */}
                    {hasOrgCol("eacHrs") && (
                    <div style={{ order: colOrder("eacHrs"), width: colW("eacHrs"), flexShrink: 0, padding: "6px 4px", fontSize: 10, fontWeight: 600, color: "#F59E0B", borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {r.eacHrs > 0 ? `${Math.round(r.eacHrs)}h` : "—"}
                    </div>
                    )}
                    {hasOrgCol("etcHrs") && (
                    <div style={{ order: colOrder("etcHrs"), width: colW("etcHrs"), flexShrink: 0, padding: "6px 4px", fontSize: 10, fontWeight: 600, color: "#F59E0B", borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {r.etcHrs > 0 ? `${Math.round(r.etcHrs)}h` : "—"}
                    </div>
                    )}
                    {hasOrgCol("etcCost") && <div style={{ order: colOrder("etcCost"), width: colW("etcCost"), flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.faint }}>—</div>}
                    {hasOrgCol("eacCost") && <div style={{ order: colOrder("eacCost"), width: colW("eacCost"), flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.faint }}>—</div>}
                    {hasOrgCol("act") && (
                      <div style={{ order: colOrder("act"), width: colW("act"), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {onRemoveOpenPosition && (r.raIds?.length ?? 0) > 0 && (
                          <button
                            title={`Remove this open ${r.role || "position"}`}
                            aria-label={`Remove open position ${r.role || ""}`}
                            onClick={() => setRemoveConfirm({ kind: "open", r })}
                            style={{
                              width: 26, height: 26, borderRadius: 7, padding: 0, flexShrink: 0,
                              background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.45)",
                              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            <X size={15} color="#F87171" strokeWidth={2.4} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Week area: no weekly cells for unfilled demand — a quiet hint instead. */}
                  <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 10px", background: "rgba(245,158,11,0.04)" }}>
                    <span style={{ fontSize: 9.5, color: C.faint, fontStyle: "italic", whiteSpace: "nowrap" }}>
                      unfilled — assign a person to plan weekly hours
                    </span>
                  </div>
                </div>
              ))}

              {/* Inline add-member form — appears directly below the last
                  member row, with each field aligned under its grid column */}
              {addOpen && canEdit && onMemberAdded && !onAddMember && !editMode && (
                <InlineAddMemberRow
                  // Remount when a different person is picked from the toolbar
                  // search so the cascade re-seeds cleanly (its prefill only
                  // applies on mount).
                  key={addSeed ? `seed-${addSeed.personId}` : "add-blank"}
                  variant="gridRow"
                  gridCols={frozenCols}
                  projectId={projectId}
                  module={module}
                  projectName={projectName || ""}
                  projectStartDate={projectStartDate || ""}
                  projectEndDate={projectEndDate || ""}
                  scheduleStart={scheduleStart}
                  scheduleEnd={scheduleEnd}
                  existingAllocations={existingAllocations || []}
                  showDates={!!hideSchedule}
                  openRoles={openRoles}
                  prefillPersonId={addSeed?.personId}
                  prefillPersonName={addSeed?.personName}
                  prefillTitle={addSeed?.title || undefined}
                  onCancel={() => { setAddOpen(false); setAddSeed(null); }}
                  onAssigned={(name, optimistic) => {
                    onMemberAdded(name, optimistic);
                    setLocalReload(k => k + 1);
                    setAddOpen(false);
                    setAddSeed(null);
                  }}
                />
              )}

              {/* Weekly team total row (redundant for a single member) —
                  sticky at the bottom so totals stay visible while the
                  member rows scroll vertically. */}
              {!soloMember && (
              <div style={{ display: "flex", backgroundColor: C.soft, position: "sticky", bottom: 0, zIndex: 3 }}>
                <div style={{
                  width: FROZEN_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2,
                  backgroundColor: C.soft, borderTop: `1px solid ${C.border}`,
                  borderRight: `1px solid ${C.colSep}`,
                  padding: "7px 10px", display: "flex", alignItems: "center",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    Weekly Team Total
                  </span>
                </div>
                {allWeeks.map(wk => {
                  const total = editMode
                    ? team.reduce((s, m) => {
                        const memberId = m.resourceId ?? m.name;
                        const orig = Object.fromEntries((m.weeklyHours ?? []).map(wh => [wh.week, wh.hours]));
                        return s + (editHours[memberId]?.[wk] ?? orig[wk] ?? 0);
                      }, 0)
                    : (weekTotals.get(wk) ?? 0);
                  const isNow = wk === nowWeekKey;
                  const pi = piOf(wk);
                  return (
                    <div key={wk} style={{
                      ...weekCellSizing,
                      backgroundColor: isNow ? C.nowBg : pi >= 0 ? `${phaseColor(pi)}08` : "transparent",
                      borderLeft: weekBorderLeft.get(wk) ?? `1px solid ${C.cellBorder}`, borderTop: `1px solid ${C.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "7px 2px",
                    }}>
                      <span style={{
                        fontSize: 12, fontWeight: total > 0 ? 700 : 400,
                        color: total > 0 ? (isNow ? C.nowText : C.green) : C.faint,
                        display: "block", width: "100%", overflow: "hidden",
                        whiteSpace: "nowrap", textAlign: "center",
                      }}>
                        {formatWeeklyTotal(total)}
                      </span>
                    </div>
                  );
                })}
              </div>
              )}


            </div>
          </div>
        </div>
        {/* Thin mirror scrollbar — sits flush below the grid border, starts
            at the frozen-column edge so it covers ONLY the week columns. */}
        <div
          ref={mirrorScrollRef}
          className="rm-grid-mirror-scroll"
          style={{
            marginLeft: FROZEN_W + 1,
            height: 14,
            minHeight: 14,
            overflowX: "auto",
            overflowY: "hidden",
            marginTop: 2,
            // In the Home/Quick Actions modal the surrounding dialog owns
            // vertical scrolling. Keep the only horizontal scrollbar pinned
            // to the dialog's lower edge instead of burying it after every
            // team row; it remains in normal flow at the end of the grid so
            // it never changes the table's scroll width or row geometry.
            ...(modalScrollOwner
              ? {
                  position: "sticky" as const,
                  bottom: 0,
                  zIndex: 8,
                  backgroundColor: C.panel,
                  borderTop: `1px solid ${C.border}`,
                  boxShadow: "0 -2px 6px rgba(15,23,42,0.10)",
                }
              : {}),
          }}
        >
          <div style={{ width: allWeeks.length * weekColW, height: 1, minHeight: 1, flexShrink: 0 }} />
        </div>
        </div>
      ) : (
        <div style={{ padding: "20px 8px" }}>
          {team.length > 0 && !tasksLoaded && !hideSchedule ? (
            /* ── Grid-shaped loading skeleton ──────────────────────────────
               The schedule check is still in flight, so the week span isn't
               known yet. Show the real member names with shimmering week
               cells so the section reads as "loading in place" — the old
               behaviour painted a finished-looking chip list plus a
               "Checking the project schedule…" line, then jumped to the
               grid, which felt like the page loading twice. */
            (() => {
              const skel: React.CSSProperties = {
                borderRadius: 6,
                background: `linear-gradient(90deg, ${C.soft} 25%, ${C.border} 50%, ${C.soft} 75%)`,
                backgroundSize: "200% 100%",
                animation: "rmone-shimmer 1.4s infinite",
              };
              return (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", backgroundColor: C.soft, borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ width: 130, height: 10, ...skel }} />
                    <div style={{ flex: 1 }} />
                    {[0, 1, 2, 3, 4, 5].map(i => (
                      <div key={i} style={{ width: 46, height: 10, ...skel }} />
                    ))}
                  </div>
                  {team.slice(0, 8).map(m => (
                    <div key={m.resourceId || `${m.name}:${m.role}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: `1px solid ${C.cellBorder}` }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                        backgroundColor: C.border,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 8, fontWeight: 700, color: C.muted,
                      }}>{initials(m.name)}</div>
                      <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{m.name}</span>
                      {m.role && (
                        <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>· {m.role}</span>
                      )}
                      <div style={{ flex: 1 }} />
                      {[0, 1, 2, 3, 4, 5].map(i => (
                        <div key={i} style={{ width: 46, height: 12, ...skel }} />
                      ))}
                    </div>
                  ))}
                  {team.length > 8 && (
                    <div style={{ padding: "7px 10px", borderTop: `1px solid ${C.cellBorder}`, fontSize: 11, color: C.faint }}>
                      +{team.length - 8} more team members…
                    </div>
                  )}
                </div>
              );
            })()
          ) : team.length > 0 ? (
            <>
              {needsSchedule ? (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  margin: "0 auto 14px", maxWidth: 560,
                  padding: "12px 14px", borderRadius: 10,
                  border: "1px solid #F59E0B55", backgroundColor: "#F59E0B14",
                }}>
                  <CalIcon size={16} color="#F59E0B" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", marginBottom: 3 }}>
                      Add a project schedule first
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                      Weekly hours are planned against the project's schedule phases, and this
                      project doesn't have a schedule yet. Open the <strong style={{ color: C.text }}>Project
                      Schedule</strong> section above and assign a lifecycle template — hour
                      entry unlocks here as soon as the schedule is in place.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", color: C.muted, fontSize: 12, marginBottom: 14 }}>
                  No weekly hours assigned yet — <strong style={{ color: C.text }}>click a week cell</strong> in the grid to add hours directly.
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {team.map(m => (
                  <div key={m.resourceId || `${m.name}:${m.role}`} style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "5px 10px", borderRadius: 20,
                    border: `1px solid ${C.border}`, backgroundColor: C.soft,
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      backgroundColor: C.border,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8, fontWeight: 700, color: C.muted,
                    }}>{initials(m.name)}</div>
                    <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{m.name}</span>
                    {m.role && (
                      <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap" }}>· {m.role}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>
              No weekly hours data available yet.
            </div>
          )}
          {canEdit && onMemberAdded && onAddMember && (
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              <button onClick={() => onAddMember()} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 18px", backgroundColor: C.green, border: "none",
                borderRadius: 8, color: "#FFF", fontSize: 12, fontWeight: 700,
                cursor: "pointer",
              }} className="tsg-add-member-cta" aria-haspopup="dialog">
                <Plus size={13} />
                Add member
              </button>
            </div>
          )}
          {canEdit && onMemberAdded && !onAddMember && (
            <div style={{ marginTop: 14, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
              <InlineAddMemberRow
                projectId={projectId}
                module={module}
                projectName={projectName || ""}
                projectStartDate={projectStartDate || ""}
                projectEndDate={projectEndDate || ""}
                scheduleStart={scheduleStart}
                scheduleEnd={scheduleEnd}
                existingAllocations={existingAllocations || []}
                showDates={!!hideSchedule}
                openRoles={openRoles}
                onAssigned={(name, optimistic) => {
                  onMemberAdded(name, optimistic);
                  setLocalReload(k => k + 1);
                }}
              />
            </div>
          )}
        </div>
      )}


      {/* ── Week-click popup ─────────────────────────────────────────────── */}
      {selWeek && weekPopupRows && (() => {
        const { rows, active, idle, totalH, avgUtil, wwh } = weekPopupRows;
        const weekLabel = fmtWeekColLabel(selWeek);
        // util colour helpers
        const utilColor  = (u: number) => u >= 110 ? "#f97316" : u >= 61 ? "#22c55e" : u > 0 ? "#ef4444" : C.faint;
        const utilLabel  = (u: number) => u >= 110 ? "Over" : u >= 61 ? "Good" : u > 0 ? "Under" : "";
        const POPUP_KF = `
          @keyframes sgSlide { from{opacity:0;transform:translateY(18px) scale(0.94)} to{opacity:1;transform:translateY(0) scale(1)} }
          @keyframes sgBar   { from{width:0} }
          @keyframes sgRow   { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
        `;
        return (
          <>
            <style>{POPUP_KF}</style>
            <div
              onClick={() => setSelWeek(null)}
              style={{
                position: "fixed", inset: 0, zIndex: Z.DRAWER_PICKER,
                backgroundColor: popupMounted ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0)",
                backdropFilter: popupMounted ? "blur(6px)" : "blur(0)",
                WebkitBackdropFilter: popupMounted ? "blur(6px)" : "blur(0)",
                transition: "background-color 240ms, backdrop-filter 240ms",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  width: 620, maxHeight: "80vh",
                  backgroundColor: "var(--rm-card, #1a2035)",
                  border: `1px solid ${C.border}`,
                  borderRadius: 20,
                  boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)",
                  display: "flex", flexDirection: "column", overflow: "hidden",
                  animation: "sgSlide 380ms cubic-bezier(0.34,1.4,0.64,1) both",
                }}
              >
                {/* Header */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 20px 12px",
                  borderBottom: `1px solid ${C.border}`,
                  background: `linear-gradient(135deg, var(--rm-panel) 0%, var(--rm-bg) 100%)`,
                  flexShrink: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      backgroundColor: `${C.green}22`, border: `2px solid ${C.green}`,
                      borderRadius: 10, padding: "4px 12px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: C.green, lineHeight: 1 }}>{weekLabel}</div>
                      <div style={{ fontSize: 8, color: C.green, fontWeight: 700, opacity: 0.8, marginTop: 1 }}>week</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Project Team</div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>Hours allocation for this week</div>
                    </div>
                  </div>
                  <button onClick={() => setSelWeek(null)} style={{
                    background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
                    color: C.muted, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "3px 8px",
                  }}>×</button>
                </div>

                {/* Stats band */}
                <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                  {([
                    { val: String(active.length), label: "ACTIVE PEOPLE",    color: C.text },
                    { val: `${totalH}h`,           label: "TOTAL HOURS",      color: C.text },
                    { val: `${avgUtil}%`,           label: "AVG UTILISATION",  color: utilColor(avgUtil) },
                    { val: String(idle.length),    label: "IDLE PEOPLE",      color: C.muted },
                  ] as { val: string; label: string; color: string }[]).map(({ val, label, color }, i, arr) => (
                    <div key={label} style={{
                      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                      padding: "12px 8px",
                      borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : "none",
                    }}>
                      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{val}</div>
                      <div style={{ fontSize: 8, color: C.faint, fontWeight: 700, letterSpacing: 0.7, marginTop: 4, textTransform: "uppercase" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Bar rows */}
                <div style={{ overflowY: "auto", flex: 1, padding: "6px 16px 10px" }}>
                  {rows.length === 0 ? (
                    <div style={{ textAlign: "center", color: C.muted, padding: "32px 0", fontSize: 13 }}>
                      No team members found.
                    </div>
                  ) : rows.map((r, i) => {
                    const barW  = r.util > 0 ? Math.min(100, Math.max(2, r.util)) : 0;
                    const color = utilColor(r.util);
                    const badge = utilLabel(r.util);
                    const delay = `${Math.min(i * 25, 350)}ms`;
                    return (
                      <div key={r.name} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 6px", borderRadius: 7,
                        borderBottom: i < rows.length - 1 ? `1px solid ${C.border}28` : "none",
                        animation: `sgRow 280ms ease both`, animationDelay: delay,
                      }}>
                        {/* rank */}
                        <div style={{ width: 18, fontSize: 10, color: C.faint, fontWeight: 700, textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
                        {/* name */}
                        <div style={{ width: 130, fontSize: 12, fontWeight: 600, color: r.h > 0 ? C.text : C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }} title={r.name}>{r.name}</div>
                        {/* utilisation bar */}
                        <div style={{ flex: 1, height: 20, backgroundColor: `${C.border}55`, borderRadius: 6, overflow: "hidden", position: "relative" }}>
                          <div style={{
                            position: "absolute", left: 0, top: 0, bottom: 0,
                            width: popupMounted ? `${barW}%` : "0%",
                            background: `linear-gradient(90deg, ${color}bb, ${color})`,
                            borderRadius: 6,
                            transition: `width 600ms cubic-bezier(0.34,1.1,0.64,1) ${delay}`,
                          }} />
                        </div>
                        {/* pct */}
                        <div style={{ width: 38, fontSize: 12, fontWeight: 800, color, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {r.h > 0 ? `${r.util}%` : "—"}
                        </div>
                        {/* hours */}
                        <div style={{ width: 30, fontSize: 11, color: C.muted, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {r.h > 0 ? `${r.h}h` : ""}
                        </div>
                        {/* badge */}
                        <div style={{ width: 46, flexShrink: 0 }}>
                          {badge && (
                            <span style={{
                              fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                              padding: "2px 6px", borderRadius: 5,
                              backgroundColor: `${color}22`, color,
                              border: `1px solid ${color}55`,
                            }}>{badge}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer — legend */}
                <div style={{ padding: "7px 16px", borderTop: `1px solid ${C.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 14 }}>
                  {([
                    { dot: "#22c55e", label: `Healthy (61–109%)` },
                    { dot: "#ef4444", label: `Under (1–60%)` },
                    { dot: "#f97316", label: `Over (≥110%)` },
                  ]).map(({ dot, label }) => (
                    <span key={label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, color: C.faint }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: dot, display: "inline-block", flexShrink: 0 }} />
                      {label}
                    </span>
                  ))}
                  <span style={{ marginLeft: "auto", fontSize: 9.5, color: C.faint, fontStyle: "italic" }}>Bars sized by utilisation · {wwh}h full week</span>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── ETC/EAC hover tooltip — definitions + cost formula ── */}
      {costTip && createPortal(
        (() => {
          const { kind, m } = costTip;
          const meta = COST_TIP_META[kind];
          const isCost = kind === "etcCost" || kind === "eacCost";
          const hrs = kind === "etcHrs" || kind === "etcCost" ? m.etcHrs : m.eacHrs;
          const cost = kind === "etcCost" ? m.etcCost : m.eacCost;
          const usesInternalNcRate = isCost && hasInternalNcCost(m);
          const rate = usesInternalNcRate
            ? (m.ncRate || (m.ncHrs && m.ncCost ? m.ncCost / m.ncHrs : 0) || m.costRate || 0)
            : (m.costRate || 0);
          const costLabel = usesInternalNcRate
            ? kind === "etcCost" ? "ETC Internal Cost" : "EAC Internal Cost"
            : meta.label;
          const costFull = usesInternalNcRate
            ? `${meta.full} — internal non-chargeable cost`
            : meta.full;
          const ncHours = Math.min(
            Math.max(0, hrs || 0),
            Math.max(0, m.ncHrs || (m.nonChargeable ? hrs || 0 : 0)),
          );
          const originalBillingRate = m.billingRate || 0;
          const beforeNcCost = originalBillingRate > 0 ? (hrs || 0) * originalBillingRate : 0;
          const movedBilling = originalBillingRate > 0 ? ncHours * originalBillingRate : 0;
          const movedInternal = m.ncCost || (ncHours > 0 && rate > 0 ? ncHours * rate : 0);
          const costDifference = beforeNcCost > 0 ? beforeNcCost - (cost || 0) : 0;
          const W = kind === "eacCost" && usesInternalNcRate ? 304 : 264;
          const left = Math.max(8, Math.min(costTip.x - W / 2, window.innerWidth - W - 8));
          // Flip above the cell when there's no room below.
          const below = costTip.bottom + (kind === "eacCost" && usesInternalNcRate ? 280 : 190) < window.innerHeight;
          const pos = below
            ? { top: costTip.bottom + 6 }
            : { top: costTip.top - 6, transform: "translateY(-100%)" };
          return (
            <div style={{
              position: "fixed", left, width: W, zIndex: Z.MODAL_CHILD_2, pointerEvents: "none",
              background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)", padding: "10px 12px", ...pos,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: meta.accent }}>{isCost ? costLabel : meta.label}</span>
                <span style={{ fontSize: 10, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginTop: 2 }}>{isCost ? costFull : meta.full}</div>
              {!isCost ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 800, color: meta.accent, marginTop: 6 }}>
                    {hrs ? `${Math.round(hrs)}h` : "—"}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>
                    {!hrs
                      ? "No hours scheduled yet for this member."
                      : kind === "etcHrs"
                        ? "Hours still planned from the current week forward — past weeks are excluded."
                        : "Total planned hours for this assignment: hours already delivered plus the remaining (ETC) hours."}
                  </div>
                </>
              ) : !hrs ? (
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>
                  No hours scheduled yet, so there is no cost to project.
                </div>
              ) : !rate ? (
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>
                  {usesInternalNcRate
                    ? "No internal non-chargeable cost rate is set for this member."
                    : "No billing rate is set for this member's role or title. Add one on the Billing Rates page to see projected cost."}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 16, fontWeight: 800, color: meta.accent, marginTop: 6 }}>
                    {fmtMoneyFull(cost)}
                  </div>
                  <div style={{
                    marginTop: 6, padding: "6px 8px", borderRadius: 8,
                    background: C.soft, border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.faint }}>
                      How it's calculated
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginTop: 3 }}>
                      {Math.round(hrs)}h × {fmtRateStr(rate)} = {fmtMoneyFull(cost)}
                    </div>
                    <div style={{ fontSize: 9.5, color: C.muted, marginTop: 3 }}>
                      {kind === "etcCost" ? "Remaining (ETC) hours" : "Total (EAC) hours"} × {usesInternalNcRate ? "internal NC cost rate" : "billing rate"}
                    </div>
                  </div>
                  {kind === "eacCost" && usesInternalNcRate && (
                    <div style={{
                      marginTop: 7, padding: "7px 8px", borderRadius: 8,
                      background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.35)",
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8B5CF6" }}>
                        Before & after non-chargeable
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 8px", marginTop: 4, fontSize: 10.5 }}>
                        <span style={{ color: C.muted }}>Before NC {originalBillingRate > 0 ? `at ${fmtRateStr(originalBillingRate)}` : ""}</span>
                        <span style={{ color: beforeNcCost > 0 ? C.text : C.faint, fontWeight: 700, textAlign: "right" }}>
                          {beforeNcCost > 0 ? fmtMoneyFull(beforeNcCost) : "Rate not configured"}
                        </span>
                        <span style={{ color: C.muted }}>Now internal NC cost</span>
                        <span style={{ color: meta.accent, fontWeight: 800, textAlign: "right" }}>{fmtMoneyFull(cost || 0)}</span>
                        {beforeNcCost > 0 && (
                          <>
                            <span style={{ color: C.muted }}>Difference</span>
                            <span style={{ color: costDifference >= 0 ? "#6BA539" : "#F87171", fontWeight: 800, textAlign: "right" }}>
                              {costDifference >= 0 ? `${fmtMoneyFull(costDifference)} lower` : `${fmtMoneyFull(Math.abs(costDifference))} higher`}
                            </span>
                          </>
                        )}
                      </div>
                      {ncHours > 0 && (
                        <div style={{ fontSize: 9.5, color: C.muted, marginTop: 5, lineHeight: 1.4 }}>
                          <b style={{ color: "#8B5CF6" }}>{Math.round(ncHours)}h moved to NC</b>
                          {movedBilling > 0 && <> · {fmtMoneyFull(movedBilling)} no longer bills the client</>}
                          {movedInternal > 0 && <> · {fmtMoneyFull(movedInternal)} remains as internal cost</>}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: 9.5, color: C.faint, marginTop: 5, lineHeight: 1.4 }}>
                    {usesInternalNcRate
                      ? "This member's hours are still scheduled, but they are not billed to the client. The amount is included as internal non-chargeable cost."
                      : "Billing rate comes from this member's role or title on the Billing Rates page (or the tenant default when none is set)."}
                  </div>
                </>
              )}
            </div>
          );
        })(),
        document.body
      )}


      {/* ── Per-member Schedule Hours menu (same 3 options as the member card) ── */}
      {actMenu && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL }} onClick={() => setActMenu(null)} />
          <div style={{
            position: "fixed", top: actMenu.top, bottom: actMenu.bottom, left: actMenu.left, zIndex: Z.MODAL_MENU,
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            minWidth: 260, maxWidth: 300, overflow: "hidden",
            maxHeight: actMenu.maxH ?? "calc(100vh - 16px)", overflowY: "auto",
          }}>
            {(() => {
              const m = team.find(tm => (tm.resourceId ?? tm.name) === actMenu.memberId);
              if (!m) return null;
              const total = Math.round((m.weeklyHours ?? []).reduce((s, wh) => s + wh.hours, 0));
              return (
                <>
                  <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` }}>
                    Schedule hours — {m.name}{(() => { const h = disambiguatorFor(m, dupNames); return h ? <span style={{ fontStyle: "italic", fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>({h})</span> : null; })()}
                  </div>
                  <button
                    onClick={() => { setActMenu(null); setFlatVal(""); setFlatFor(m); }}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", color: C.text }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Uniform Weekly Hours</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      Type one hours/week value — it's applied to every week at once.
                    </div>
                  </button>
                  <div style={{ height: 1, background: C.border }} />
                  <button
                    onClick={() => {
                      setActMenu(null);
                      // Default "From" to the current week's Monday so the
                      // user sees today's week, not the project start, which
                      // is often months in the past.
                      const todayMon = nowWeekKey; // already ISO YYYY-MM-DD
                      const fromDefault = schedBounds
                        ? (todayMon >= schedBounds.min && todayMon <= schedBounds.max
                            ? todayMon
                            : schedBounds.min)
                        : todayMon;
                      setRangeRows([{ id: 1, from: fromDefault, to: schedBounds?.max ?? "", hours: "" }]);
                      setRangeFor(m);
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", color: C.text }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Set hours for a date range</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      Pick a "From – To" date range and one hours/week value; add more
                      rows with + for different periods.
                    </div>
                  </button>
                  <div style={{ height: 1, background: C.border }} />
                  <button
                    onClick={() => { setActMenu(null); setDistVal(total > 0 ? String(total) : ""); setDistRate(""); setDistFor(m); }}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", color: C.text }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Distribute total hours</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {total > 0
                        ? `Type a total (currently ${fmtHours(total)}h) — it's split evenly across the weeks.`
                        : "Type a total for this member — it's split evenly across the weeks."}
                    </div>
                  </button>
                </>
              );
            })()}
          </div>
        </>,
        document.body,
      )}

      {/* ── Uniform Weekly Hours modal ── */}
      {flatFor && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(0,0,0,0.35)" }} onClick={() => setFlatFor(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: Z.MODAL_MENU, background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            minWidth: 300, padding: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>
              Uniform Weekly Hours
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
              Applies to all {allWeeks.length} weeks for {flatFor.name}{(() => { const h = disambiguatorFor(flatFor, dupNames); return h ? <> <span style={{ fontStyle: "italic" }}>({h})</span></> : null; })()}.
              {allWeeks.some(wk => isWeekLocked(wk)) && " Past weeks stay unchanged."}
            </div>
            {(() => {
              const flatNum = Number(flatVal);
              const flatOver = flatVal.trim() !== "" && Number.isFinite(flatNum) && flatNum > MAX_WEEK_HOURS;
              const flatOk = flatVal.trim() !== "" && !flatOver;
              const applyFlat = () => {
                if (!flatOk) return;
                const m = flatFor; setFlatFor(null);
                applyUniformHours(m, Math.max(0, flatNum));
              };
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number" min={0} autoFocus
                      value={flatVal}
                      onChange={(e) => { validateWeeklyInput(e.target.value, "flat"); setFlatVal(e.target.value); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && flatOk) applyFlat();
                        if (e.key === "Escape") setFlatFor(null);
                      }}
                      placeholder="e.g. 40"
                      style={{ flex: 1, background: C.soft, border: `1px solid ${flatOver ? "#ef4444" : C.border}`, color: flatOver ? "#ef4444" : C.text, borderRadius: 8, padding: "8px 10px", fontSize: 13 }}
                    />
                    <span style={{ fontSize: 11, color: C.faint }}>h/week</span>
                  </div>
                  {flatOver && (
                    <div style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>
                      Exceeds {MAX_WEEK_HOURS}h/week — {MAX_WEEK_HOURS_HINT}. Enter a value from 0 to {MAX_WEEK_HOURS}.
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                    <button
                      onClick={() => setFlatFor(null)}
                      style={{ background: C.soft, border: `1px solid ${C.border}`, color: C.text, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={applyFlat}
                      disabled={!flatOk}
                      style={{
                        background: C.green, border: "none", color: "#fff", padding: "6px 14px",
                        borderRadius: 8, fontSize: 11, fontWeight: 700,
                        cursor: flatOk ? "pointer" : "default", opacity: flatOk ? 1 : 0.5,
                      }}
                    >
                      Apply to all weeks
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </>,
        document.body,
      )}

      {/* ── Flag confirm popup — every S / NC / lock click states what it
           will do ("this will act as …") BEFORE anything changes. ── */}
      {flagConfirm && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(0,0,0,0.35)" }} onClick={() => setFlagConfirm(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: Z.MODAL_MENU, background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            width: 340, padding: "18px 20px 16px",
          }}>
            {(() => {
              const { m, flag, next } = flagConfirm;
              const meta = FLAG_META[flag];
              const first = firstNameOf(m.name);
              const title =
                flag === "locked" ? (next ? `Lock ${first}'s allocation?` : `Unlock ${first}'s allocation?`)
                : flag === "soft" ? (next ? `Mark ${first} as a soft allocation?` : `Make ${first}'s booking firm again?`)
                : (next ? `Mark ${first} as non-chargeable?` : `Make ${first}'s hours chargeable again?`);
              const body = next
                ? (flag === "locked"
                    ? `${first} will be frozen — imports, schedule moves and hour edits can't change this member until unlocked. Removing the member by hand stays possible.`
                    : flag === "soft"
                      ? `${first}'s booking will count as tentative (pencilled-in) — the hours are planned but not confirmed yet.`
                      : `${first}'s hours on this project won't bill the client.`)
                : (flag === "locked"
                    ? `Imports, schedule moves and hour edits will be able to change ${first}'s hours again.`
                    : flag === "soft"
                      ? `${first}'s booking goes back to a confirmed (firm) allocation.`
                      : `${first}'s hours count as chargeable again.`);
              const confirmLabel = flag === "locked" ? (next ? "Lock" : "Unlock") : next ? `Mark ${meta.short}` : `Remove ${meta.short}`;
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{
                      width: 30, height: 30, borderRadius: 8, background: meta.chipBg, border: `1px solid ${meta.chipBd}`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center", color: meta.color,
                      fontSize: 10, fontWeight: 800, flexShrink: 0,
                    }}>
                      {flag === "locked" ? (next ? <Lock size={14} /> : <LockOpen size={14} />) : meta.short}
                    </span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.55, marginBottom: 6 }}>{body}</div>
                  {/* Cost-rate input — only when marking NC (not removing).
                      Pre-filled from m.costRate; user can edit or leave blank.
                      Written to ra.CostRate so Financial shows NC cost in $. */}
                  {flag === "nc" && next && canEditNcRate && (() => {
                    const parsedRate = parseFloat(ncRateInput);
                    const rateOk = isFinite(parsedRate) && parsedRate > 0;
                    const totalHrs = Math.round((m.eacHrs || 0) * 10) / 10;
                    const totalCost = rateOk && totalHrs > 0
                      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(parsedRate * totalHrs)
                      : null;
                    return (
                      <div style={{ marginBottom: 12 }}>
                        {/* Live cost preview — shown as soon as the user types a rate */}
                        {rateOk && totalCost && (
                          <div style={{
                            background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)",
                            borderRadius: 8, padding: "7px 10px", marginBottom: 8, lineHeight: 1.5,
                          }}>
                            <span style={{ fontSize: 11, color: C.text }}>
                              At <b style={{ color: "#a78bfa" }}>${parsedRate}/hr</b> × <b>{totalHrs} hrs</b> = <b style={{ color: "#a78bfa" }}>{totalCost}</b>
                            </span>
                            <span style={{ fontSize: 10, color: C.muted, display: "block", marginTop: 2 }}>
                              This is what your firm pays internally — it won't be billed to the client.
                            </span>
                          </div>
                        )}
                        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          What does {first} cost your firm per hour?
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, color: C.muted, flexShrink: 0 }}>$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={m.costRate > 0 ? String(m.costRate) : "e.g. 70"}
                            value={ncRateInput}
                            onChange={e => setNcRateInput(e.target.value)}
                            autoFocus
                            style={{
                              flex: 1, padding: "6px 10px", borderRadius: 7,
                              background: C.soft, border: `1px solid ${C.border}`,
                              color: C.text, fontSize: 12, outline: "none",
                            }}
                          />
                        </div>
                        {!rateOk && (
                          <div style={{ fontSize: 10, color: C.faint, marginTop: 4, lineHeight: 1.4 }}>
                            Leave blank to use the role's default rate.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {flag === "nc" && (() => {
                    const totalHrs = Math.round((m.eacHrs || 0) * 10) / 10;
                    const chosenRate = next
                      ? (Number.isFinite(parseFloat(ncRateInput)) && parseFloat(ncRateInput) > 0
                        ? parseFloat(ncRateInput)
                        : m.costRate || 0)
                      : (m.ncRate || (m.ncHrs && m.ncCost ? m.ncCost / m.ncHrs : 0) || m.costRate || 0);
                    const priorClientRate = m.billingRate || 0;
                    const priorClientValue = priorClientRate > 0 ? totalHrs * priorClientRate : 0;
                    const currentInternalValue = !next && m.ncCost > 0
                      ? m.ncCost
                      : chosenRate > 0 ? totalHrs * chosenRate : 0;
                    const difference = priorClientValue - currentInternalValue;
                    if (totalHrs <= 0) return null;
                    return (
                      <div style={{
                        marginBottom: 12, padding: "8px 10px", borderRadius: 8,
                        background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.30)",
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8B5CF6", marginBottom: 5 }}>
                          Before & after
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 10px", fontSize: 10.5 }}>
                          <span style={{ color: C.muted }}>Before NC</span>
                          <b style={{ color: priorClientValue > 0 ? C.text : C.faint, textAlign: "right" }}>
                            {priorClientValue > 0 ? `${totalHrs}h × ${fmtRateStr(priorClientRate)} = ${fmtMoneyFull(priorClientValue)}` : "Client rate not configured"}
                          </b>
                          <span style={{ color: C.muted }}>{next ? "After marking NC" : "Current NC cost"}</span>
                          <b style={{ color: "#8B5CF6", textAlign: "right" }}>
                            {chosenRate > 0 ? `${totalHrs}h × ${fmtRateStr(chosenRate)} = ${fmtMoneyFull(currentInternalValue)}` : "Internal rate not configured"}
                          </b>
                          {priorClientValue > 0 && chosenRate > 0 && (
                            <>
                              <span style={{ color: C.muted }}>Difference</span>
                              <b style={{ color: difference >= 0 ? "#6BA539" : "#F87171", textAlign: "right" }}>
                                {difference >= 0 ? `${fmtMoneyFull(difference)} lower` : `${fmtMoneyFull(Math.abs(difference))} higher`}
                              </b>
                            </>
                          )}
                        </div>
                        <div style={{ fontSize: 9.5, color: C.muted, marginTop: 5, lineHeight: 1.4 }}>
                          {totalHrs}h {next ? "will move" : "is currently moved"} to non-chargeable:
                          {priorClientValue > 0 && ` ${fmtMoneyFull(priorClientValue)} is excluded from client billing`}
                          {currentInternalValue > 0 && `${priorClientValue > 0 ? "," : ""} ${fmtMoneyFull(currentInternalValue)} remains as internal cost`}
                          {!next && priorClientValue > 0 && " · Removing NC restores the client billing basis."}
                        </div>
                      </div>
                    );
                  })()}
                  {flag !== "nc" && next && (
                    <div style={{ fontSize: 10.5, color: C.faint, marginBottom: 12 }}>
                      {first}'s whole row gets a <b style={{ color: meta.color }}>{meta.tintWord}</b> tint so it's visible at a glance.
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: next ? 0 : 12 }}>
                    <button
                      onClick={() => setFlagConfirm(null)}
                      style={{ background: C.soft, border: `1px solid ${C.border}`, color: C.text, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        const fc = flagConfirm;
                        setFlagConfirm(null);
                        const parsed = fc.flag === "nc" && fc.next ? parseFloat(ncRateInput) : NaN;
                        const costRate = isFinite(parsed) && parsed >= 0 ? parsed : undefined;
                        void handleFlagClick(fc.m, fc.flag, fc.next, costRate);
                      }}
                      style={{ background: meta.color, border: "none", color: "#0B1220", padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                    >
                      {confirmLabel}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </>,
        document.body,
      )}

      {/* ── NC badge hover tooltip — rate × hours = cost breakdown ── */}
      {ncHover && createPortal((() => {
        const { m: hm, rect } = ncHover;
        // ncHrs is currently 0 on the team endpoint (it tracks the flag but not
        // the hours split), so fall back to eacHrs — for NC members all their
        // hours on this project are non-chargeable.
        const hrs   = Math.round((hm.ncHrs || hm.eacHrs || 0) * 10) / 10;
        const cost  = hm.ncCost || 0;
        // Rate priority: ncRate (entered at Mark-NC time) > ncCost/ncHrs
        // (server-computed) > costRate (role default).
        const ncRateVal = hm.ncRate || 0;
        const rate  = ncRateVal > 0 ? ncRateVal
          : hrs > 0 && cost > 0 ? cost / hrs
          : (hm.costRate || 0);
        // billingRate is preserved independently by the team endpoint. Never
        // fall back to costRate here: for an NC member that is the $/hr
        // internal-cost override, not the original client billing rate.
        const originalBillingRate = hm.billingRate || 0;
        const originalBillValue = originalBillingRate > 0 ? originalBillingRate * hrs : 0;
        const internalCost = cost > 0 ? cost : rate * hrs;
        const rateDifference = originalBillingRate > 0 && rate > 0
          ? originalBillingRate - rate
          : 0;
        const valueDifference = originalBillValue > 0
          ? originalBillValue - internalCost
          : 0;
        const fmtD  = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
        const fmtR  = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
        // The comparison popup is wider than the standard tooltip. Keep its
        // centre inside the viewport so it never clips at either grid edge.
        const popoverHalfWidth = 168;
        const left  = Math.max(
          popoverHalfWidth + 8,
          Math.min(rect.left + rect.width / 2, window.innerWidth - popoverHalfWidth - 8),
        );
        const top   = rect.bottom + 8;
        return (
          <div style={{
            position: "fixed", left, top, transform: "translateX(-50%)",
            zIndex: Z.MODAL_MENU, pointerEvents: "none",
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            padding: "10px 14px", minWidth: 288, maxWidth: 320,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              Non-Chargeable — {firstNameOf(hm.name)}
            </div>
            {hrs > 0 ? (
              <>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr auto",
                  gap: "4px 10px", fontSize: 11, color: C.muted, marginBottom: 8,
                }}>
                  <span>Hours on project</span>
                  <span style={{ color: C.text, fontWeight: 600, textAlign: "right" }}>{hrs} hrs</span>
                  <span>Original billing rate</span>
                  <span style={{ color: originalBillingRate > 0 ? C.text : C.faint, fontWeight: 600, textAlign: "right" }}>
                    {originalBillingRate > 0 ? `${fmtR(originalBillingRate)}/hr` : "Not configured"}
                  </span>
                  <span>NC internal cost rate</span>
                  <span style={{ color: rate > 0 ? "#a78bfa" : C.faint, fontWeight: 700, textAlign: "right" }}>
                    {rate > 0 ? `${fmtR(rate)}/hr` : "Not configured"}
                  </span>
                  {originalBillingRate > 0 && rate > 0 && (
                    <>
                      <span>Rate difference</span>
                      <span style={{ color: rateDifference >= 0 ? "#8EC94A" : "#F87171", fontWeight: 700, textAlign: "right" }}>
                        {rateDifference >= 0 ? `${fmtR(rateDifference)}/hr lower` : `${fmtR(Math.abs(rateDifference))}/hr higher`}
                      </span>
                    </>
                  )}
                  {originalBillValue > 0 && (
                    <>
                      <span style={{ borderTop: `1px solid ${C.border}`, paddingTop: 5, marginTop: 2 }}>Client billing excluded</span>
                      <span style={{ color: C.muted, fontWeight: 700, textAlign: "right", borderTop: `1px solid ${C.border}`, paddingTop: 5, marginTop: 2 }}>{fmtD(originalBillValue)}</span>
                    </>
                  )}
                  <span style={{ color: C.text, fontWeight: 700 }}>Internal NC cost</span>
                  <span style={{ color: "#a78bfa", fontWeight: 800, textAlign: "right" }}>{rate > 0 ? fmtD(internalCost) : "—"}</span>
                  {originalBillValue > 0 && rate > 0 && (
                    <>
                      <span style={{ color: C.text, fontWeight: 700 }}>Value difference</span>
                      <span style={{ color: valueDifference >= 0 ? "#8EC94A" : "#F87171", fontWeight: 800, textAlign: "right" }}>
                        {valueDifference >= 0 ? `${fmtD(valueDifference)} lower` : `${fmtD(Math.abs(valueDifference))} higher`}
                      </span>
                    </>
                  )}
                </div>
                {originalBillValue > 0 && rate > 0 && (
                  <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.45, marginBottom: 5 }}>
                    {hrs}h × {fmtR(originalBillingRate)} = {fmtD(originalBillValue)} potential client billing. Marking this row NC makes that revenue <b>$0</b>; {hrs}h × {fmtR(rate)} = {fmtD(internalCost)} remains as internal cost.
                  </div>
                )}
                <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.4 }}>
                  Scheduled hours are unchanged. The internal amount appears on the Financial page as non-chargeable cost.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
                Hours on this project won't bill the client.{!rate ? " No cost rate configured." : ""}
              </div>
            )}
          </div>
        );
      })(), document.body)}

      {/* ── Remove member / open position confirm — shared professional popup
            with the mandated audit-log sentence (login + timestamp). ── */}
      {removeConfirm && (
        <RemoveMemberConfirm
          target={removeConfirm.kind === "member"
            ? { kind: "member", name: removeConfirm.m.name, role: removeConfirm.m.role }
            : { kind: "open", role: removeConfirm.r.role, title: removeConfirm.r.title }}
          module={module ?? undefined}
          busy={removeBusy}
          onCancel={() => { if (!removeBusy) setRemoveConfirm(null); }}
          onConfirm={() => {
            if (!removeConfirm || removeBusy) return;
            setRemoveBusy(true);
            void (async () => {
              try {
                if (removeConfirm.kind === "member") await onRemoveMember?.(removeConfirm.m);
                else await onRemoveOpenPosition?.(removeConfirm.r);
                setRemoveConfirm(null);
              } finally {
                setRemoveBusy(false);
              }
            })();
          }}
        />
      )}

      {/* ── Distribute total hours modal ── */}
      {distFor && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(0,0,0,0.35)" }} onClick={() => setDistFor(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: Z.MODAL_MENU, background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            width: 340, padding: "18px 20px 16px",
          }}>
            {(() => {
              const editable = allWeeks.filter(wk => !isWeekLocked(wk));
              const hasLocked = allWeeks.some(wk => isWeekLocked(wk));
              const baseMap = quickWeekBase(distFor);
              const lockedSum = Math.round(
                allWeeks.filter(wk => isWeekLocked(wk)).reduce((s, wk) => s + (baseMap[wk] ?? 0), 0)
              );
              const total = Number(distVal) || 0;
              const rate = Number(distRate) || 0;
              const rateGiven = distRate.trim() !== "";
              const rateOk = !rateGiven || rate > 0;
              const rem = Math.max(0, Math.round(total) - lockedSum);
              const fits = !(rateGiven && rateOk) || rem <= rate * editable.length + 1e-9;
              // Physical ceiling: no split can give any week more than 168h,
              // so the distributable total caps at editable weeks × 168 (the
              // server rejects any week above 168h anyway — this is UX only).
              const physCap = editable.length * MAX_WEEK_HOURS;
              const physOk = rem <= physCap;
              const rateCapOk = !rateGiven || rate <= MAX_WEEK_HOURS;
              const canGo = !!distVal.trim() && rateOk && rateCapOk && fits && physOk && editable.length > 0;
              const go = () => {
                if (!canGo) return;
                const m = distFor;
                setDistFor(null);
                applyDistributeTotal(m, total, rateGiven && rateOk ? rate : undefined);
              };
              let hint: string | null = null;
              let hintError = false;
              if (rateGiven && !rateOk) {
                hint = "Weekly rate must be greater than 0, or leave it blank to split evenly.";
                hintError = true;
              } else if (rateGiven && !rateCapOk) {
                hint = `Weekly rate can't exceed ${MAX_WEEK_HOURS}h — ${MAX_WEEK_HOURS_HINT}.`;
                hintError = true;
              } else if (!physOk) {
                hint = `That total needs more than ${MAX_WEEK_HOURS}h in a week — ${MAX_WEEK_HOURS_HINT}. The most that fits here is ${physCap + lockedSum}h.`;
                hintError = true;
              } else if (rateGiven && distVal.trim() && total > 0) {
                if (!fits) {
                  const maxFit = Math.round(rate * editable.length + lockedSum);
                  hint = `${rate} h/week only fits ${maxFit}h across ${editable.length} week${editable.length === 1 ? "" : "s"}. Lower the total or increase the weekly rate.`;
                  hintError = true;
                } else {
                  const fullWeeks = Math.floor(rem / rate);
                  const remainder = Math.round((rem - fullWeeks * rate) * 100) / 100;
                  const parts: string[] = [];
                  if (fullWeeks > 0) parts.push(`${fullWeeks} wk × ${rate}h`);
                  if (remainder > 0) parts.push(`${remainder}h`);
                  const used = fullWeeks + (remainder > 0 ? 1 : 0);
                  const zeroed = editable.length - used;
                  hint = parts.length === 0
                    ? "Past weeks already cover this total — remaining weeks go to 0h."
                    : parts.join(" + ") + (zeroed > 0 ? `, then ${zeroed} wk × 0h` : "");
                }
              }
              const inputStyle = {
                width: "100%", boxSizing: "border-box" as const,
                background: C.soft, border: `1px solid ${C.border}`,
                color: C.text, borderRadius: 8, padding: "7px 10px", fontSize: 13,
              };
              const labelStyle = {
                display: "block", fontSize: 10, fontWeight: 700 as const,
                color: C.faint, textTransform: "uppercase" as const,
                letterSpacing: 0.4, marginBottom: 4,
              };
              return (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>
                    Distribute total hours
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
                    {hasLocked
                      ? `${editable.length} remaining weeks · ${distFor.name}`
                      : `${editable.length} weeks · ${distFor.name}`}
                  </div>
                  {/* Two side-by-side fields */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: hint ? 10 : 14 }}>
                    <div>
                      <label style={labelStyle}>Total hours</label>
                      <input
                        type="number" min={0} autoFocus
                        value={distVal}
                        onChange={(e) => setDistVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") setDistFor(null); }}
                        placeholder="e.g. 500"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Per week <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                      <input
                        type="number" min={0}
                        value={distRate}
                        onChange={(e) => setDistRate(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") setDistFor(null); }}
                        placeholder="e.g. 40"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  {hint && (
                    <div style={{
                      fontSize: 11, color: hintError ? "#ef4444" : C.muted,
                      marginBottom: 12, lineHeight: 1.45,
                      padding: hintError ? "6px 8px" : "0",
                      background: hintError ? "rgba(239,68,68,0.08)" : "transparent",
                      borderRadius: hintError ? 6 : 0,
                    }}>
                      {hint}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button
                      onClick={() => setDistFor(null)}
                      style={{ background: C.soft, border: `1px solid ${C.border}`, color: C.text, padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={go}
                      disabled={!canGo}
                      style={{
                        background: C.green, border: "none", color: "#fff", padding: "6px 16px",
                        borderRadius: 8, fontSize: 11, fontWeight: 700,
                        cursor: canGo ? "pointer" : "default", opacity: canGo ? 1 : 0.5,
                      }}
                    >
                      Distribute
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </>,
        document.body,
      )}

      {/* ── Set hours for a date range modal ── */}
      {rangeFor && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(0,0,0,0.35)" }} onClick={() => setRangeFor(null)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: Z.MODAL_MENU, background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
            width: "min(440px, 92vw)", padding: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>
              Set hours for a date range
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
              Each row stamps its hours/week onto the weeks between From and To for {rangeFor.name}{(() => { const h = disambiguatorFor(rangeFor, dupNames); return h ? <> <span style={{ fontStyle: "italic" }}>({h})</span></> : null; })()}.
              Weeks outside every range keep their current hours.
              {allWeeks.some(wk => isWeekLocked(wk)) && " Past weeks stay unchanged."}
              {schedBounds && (
                <> Dates must stay within the project schedule
                  {" "}({new Date(schedBounds.min + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {" – "}{new Date(schedBounds.max + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}).</>
              )}
            </div>
            {rangeRows.map((r, i) => {
              const fromOut = !!(schedBounds && r.from && (r.from < schedBounds.min || r.from > schedBounds.max));
              const toOut   = !!(schedBounds && r.to   && (r.to   < schedBounds.min || r.to   > schedBounds.max));
              return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <DateField
                  value={r.from}
                  min={schedBounds?.min} max={schedBounds?.max}
                  onChange={(v) => setRangeRows(rows => rows.map(x => x.id === r.id ? { ...x, from: v } : x))}
                  wrapStyle={{ flex: 1, minWidth: 0, width: "auto" }}
                  style={{ background: C.soft, border: `1px solid ${fromOut ? "#ef4444" : C.border}`, color: fromOut ? "#ef4444" : C.text, borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                />
                <span style={{ fontSize: 11, color: C.faint, flexShrink: 0 }}>–</span>
                <DateField
                  value={r.to}
                  min={schedBounds?.min} max={schedBounds?.max}
                  onChange={(v) => setRangeRows(rows => rows.map(x => x.id === r.id ? { ...x, to: v } : x))}
                  wrapStyle={{ flex: 1, minWidth: 0, width: "auto" }}
                  style={{ background: C.soft, border: `1px solid ${toOut ? "#ef4444" : C.border}`, color: toOut ? "#ef4444" : C.text, borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                />
                {(() => {
                  const rHoursNum = Number(r.hours);
                  const rOver = r.hours.trim() !== "" && Number.isFinite(rHoursNum) && rHoursNum > MAX_WEEK_HOURS;
                  return (
                    <input
                      type="number" min={0} value={r.hours} placeholder="h/wk"
                      onChange={(e) => {
                        validateWeeklyInput(e.target.value, "range");
                        setRangeRows(rows => rows.map(x => x.id === r.id ? { ...x, hours: e.target.value } : x));
                      }}
                      style={{ width: 60, flexShrink: 0, background: C.soft, border: `1px solid ${rOver ? "#ef4444" : C.border}`, color: rOver ? "#ef4444" : C.text, borderRadius: 8, padding: "6px 8px", fontSize: 12, textAlign: "center" }}
                    />
                  );
                })()}
                {rangeRows.length > 1 && (
                  <button
                    onClick={() => setRangeRows(rows => rows.filter(x => x.id !== r.id))}
                    title="Remove this range"
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: C.faint, padding: 2, flexShrink: 0 }}
                  >
                    <X size={13} />
                  </button>
                )}
                {i === rangeRows.length - 1 && (
                  <button
                    onClick={() => setRangeRows(rows => [...rows, { id: Math.max(...rows.map(x => x.id)) + 1, from: "", to: "", hours: "" }])}
                    title="Add another range"
                    style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", color: C.green, padding: 3, flexShrink: 0, display: "flex" }}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              );
            })}
            {(() => {
              const anyRangeOver = rangeRows.some(r => {
                const n = Number(r.hours);
                return r.hours.trim() !== "" && Number.isFinite(n) && n > MAX_WEEK_HOURS;
              });
              return anyRangeOver && (
                <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>
                  Exceeds {MAX_WEEK_HOURS}h/week — {MAX_WEEK_HOURS_HINT}. Correct the highlighted row(s) before applying.
                </div>
              );
            })()}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => setRangeFor(null)}
                style={{ background: C.soft, border: `1px solid ${C.border}`, color: C.text, padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
              {(() => {
                const anyRangeOver = rangeRows.some(r => {
                  const n = Number(r.hours);
                  return r.hours.trim() !== "" && Number.isFinite(n) && n > MAX_WEEK_HOURS;
                });
                const outOfBounds = !!schedBounds && rangeRows.some(r =>
                  (r.from && (r.from < schedBounds.min || r.from > schedBounds.max)) ||
                  (r.to   && (r.to   < schedBounds.min || r.to   > schedBounds.max)));
                const ok = !anyRangeOver && !outOfBounds && rangeRows.some(r => r.from && r.to && r.hours.trim() !== "");
                return (
                  <button
                    onClick={() => { if (!ok) return; const m = rangeFor; setRangeFor(null); applyRangeHours(m, rangeRows); }}
                    disabled={!ok}
                    title={outOfBounds ? "One or more dates are outside the project schedule." : anyRangeOver ? `Max ${MAX_WEEK_HOURS}h/week` : undefined}
                    style={{
                      background: C.green, border: "none", color: "#fff", padding: "6px 14px",
                      borderRadius: 8, fontSize: 11, fontWeight: 700,
                      cursor: ok ? "pointer" : "default",
                      opacity: ok ? 1 : 0.5,
                    }}
                  >
                    Apply hours
                  </button>
                );
              })()}
            </div>
          </div>
        </>,
        document.body,
      )}

      </>}
    </div>
  );
}
