// ─────────────────────────────────────────────────────────────────────────────
// ResourcesTimelineGrid — graduated "Resources Timeline" Gantt (approved mockup 1).
//
// Person rows show weekly total hours colored by that week's utilization band
// (client palette: Under = red, Good = green, Over = amber). Each person row
// expands into per-project sub-rows whose week cells are colored by the phase
// the project is in THAT week (lib/projectPhases nearest-match system). An
// amber "Allocated Demand (FTE)" footer row shows unstaffed open-position
// demand per week so managers see supply and demand on one screen.
//
// Data contracts (all shared with the page-level modals via lib/utilGrid):
//   • rows      — utilization grid rows ("P:…#H:…#C:…" encoded cells)
//   • staffResources — quarter-enriched resources; allAllocations drives the
//     per-project weekly walk (same math as the cell-detail modal)
//   • demandItems — open positions; PctAllocation is a PERCENT here (display
//     paths divide by 100 for FTE), window = AllocationStart/EndDate
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Calendar, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { getBusinessRules, getPastWeekEditStateFor, useBusinessRulesVersion } from "@/lib/businessRules";
import { MAX_WEEK_HOURS } from "@/lib/utilGrid";
import { empTypeColor } from "@/lib/employmentColor";
import { parseWeeklyHoursDraft } from "@/lib/weeklyHoursValidation";
import { fmtHours } from "@/lib/utils";
import type { ActiveAllocationProxy, DemandItem, LiveResourceProxy } from "@/lib/api";
import { DisabledMemberStatus } from "@/components/DisabledMemberStatus";
import {
  GANTT_HATCH, GANTT_HIGHLIGHT, PHASE_COLORS, UTIL_COLORS, type PhaseColor,
} from "@/lib/phaseColors";
import {
  isLeadProject, loadProjectPhaseMap, projectPhaseColor, type ProjectPhaseMap,
} from "@/lib/projectPhases";
import {
  allocEntryHrsPerWeek, hoursWinFilter, mondayOf, parseLocalDay, parsePeriodKey, parseUtilCell,
  type UtilCellData, type UtilMode,
} from "@/lib/utilGrid";

const LEFT_W = 340;
const CW = 68;
const TOT_W = 76;

/* Keep every frozen cell opaque even inside a scope that has not opted into
   the light-theme card token. Transparent sticky cells let week cells bleed
   into the header, TOTAL H column, and pinned footer rows while scrolling. */
const CARD = "var(--rm-card, var(--rm-panel))";
const BORDER = "var(--rm-panel-border)";
const TEXT = "var(--rm-text)";
const MUTED = "var(--rm-text-muted)";
const FAINT = "var(--rm-text-faint)";
const GREEN = "#6BA539";
/* Opaque sticky-cell tints: backgroundColor supplies the solid theme color,
   backgroundImage layers the tint — sticky cells must never be translucent
   or row content shows through while horizontally scrolling. */
const TINT_PERSON = "linear-gradient(rgba(100,116,139,0.12),rgba(100,116,139,0.12))";
const TINT_HEAD = "linear-gradient(rgba(100,116,139,0.07),rgba(100,116,139,0.07))";
const HL_CELL = "rgba(207,161,238,0.20)"; // translucent — works over both themes

interface UtilBand { key: "under" | "good" | "over"; label: string; c: PhaseColor }

interface ProjRow {
  pid: string;
  name: string;
  module?: "PMM" | "OPM" | "LEM";
  hours: number[];
  total: number;
}

export interface ResourceProjectWeekEdit {
  personId: string;
  personName: string;
  role: string;
  projectId: string;
  projectName: string;
  week: string;
  hours: number;
  /** Called after the server accepts the write, before verification finishes. */
  onAccepted?: () => void;
}

/** Multi-week edit — the Monthly editor writes a whole month's weeks in ONE
 * atomic save (weekPatches), sharing the weekly path's queueing, past-week
 * locks, 168h validation, and post-save verification. */
export interface ResourceProjectWeeksEdit {
  personId: string;
  personName: string;
  role: string;
  projectId: string;
  projectName: string;
  /** ISO Monday → hours; merged onto authoritative server truth at save time. */
  weeks: Record<string, number>;
  /** Called after the server accepts the write, before verification finishes. */
  onAccepted?: () => void;
}

interface PersonRow {
  key: string;
  sectionKey: string;
  row: Record<string, unknown>;
  name: string;
  disambig: string;
  userId: string;
  org: string;
  cells: (UtilCellData | null)[];
  totalH: number;
  avgPct: number;
  band: UtilBand | null;
  staffRow?: LiveResourceProxy;
}

interface PeriodWin { key: string; startMs: number; endMs: number; weekStarts: number[] }

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function firstNameSortKey(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? "";
}

function compareByFirstName(a: string, b: string): number {
  return firstNameSortKey(a).localeCompare(firstNameSortKey(b))
    || a.localeCompare(b);
}

function fmtHrs(h: number): string {
  return fmtHours(h);
}
function localIsoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface OptimisticWeekOverride {
  personKey: string;
  projectId: string;
  week: string;
  original: number;
  hours: number;
  generation: number;
}

export function ResourcesTimelineGrid({
  rows, periods, mode, selectedQ, loading, error, onRetry,
  staffResources, demandItems,
  onPersonClick, onCellClick, onColumnClick, onStatusBadgeClick, onQClick, pName, onProjectClick,
  quarterMenu, canEditProjectWeeks = false, canManageStaff = false, onSaveProjectWeek, onQuarterNavigate,
  sections, defaultExpandedUserIds, projectScopeByUserId, personSort = "hours",
}: {
  rows: Record<string, unknown>[];
  periods: string[];
  mode: UtilMode;
  selectedQ: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  staffResources: LiveResourceProxy[];
  demandItems: DemandItem[];
  onPersonClick: (name: string, userId?: string) => void;
  onCellClick: (
    name: string,
    period: string,
    cell: UtilCellData,
    row: Record<string, unknown>,
    userId?: string,
    staffResource?: LiveResourceProxy,
  ) => void;
  onColumnClick?: (period: string) => void;
  onStatusBadgeClick?: (name: string, userId?: string) => void;
  onQClick?: () => void;
  pName?: (pid: string) => string;
  onProjectClick?: (projectId: string, module?: "PMM" | "OPM" | "LEM") => void;
  quarterMenu?: React.ReactNode;
  canEditProjectWeeks?: boolean;
  /** Kept separate from edit-data: account reactivation is manage-staff only. */
  canManageStaff?: boolean;
  onSaveProjectWeek?: (edit: ResourceProjectWeekEdit) => Promise<void>;
  onQuarterNavigate?: (direction: -1 | 1) => void;
  /** Optional ordered grouping (Manager view): people re-order into these
   *  labeled sections (UserId match, lowercase-name fallback for synthesized
   *  zero-allocation rows). A divider row renders before each non-empty
   *  labeled section; unmatched people keep grid order at the end. */
  sections?: { label: string; userIds: string[]; rowKeys?: string[] }[];
  /** Auto-expand these people's project rows once after rows load (the
   *  Manager view opens the selected manager pre-expanded). */
  defaultExpandedUserIds?: string[];
  /** Manager hierarchy only: limit each person's cells and expanded projects
   * to records shared with the selected hierarchy owner. */
  projectScopeByUserId?: Record<string, string[]>;
  /** Optional Manager-only ordering; the regular Timeline stays hour-sorted. */
  personSort?: "hours" | "firstName";
}) {
  // Re-render when admin-tunable employment-type name colors change.
  useBusinessRulesVersion();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [phaseMap, setPhaseMap] = useState<ProjectPhaseMap | null>(null);
  // The compact utilization legend doubles as a quick roster filter. Keep this
  // local to the Timeline so Staff/Demand views remain independent.
  const [bandFilter, setBandFilter] = useState<UtilBand["key"] | null>(null);
  const [editingThreshold, setEditingThreshold] = useState<"under" | "over" | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [underHoursOverride, setUnderHoursOverride] = useState<number | null>(null);
  const [overHoursOverride, setOverHoursOverride] = useState<number | null>(null);
  const [weekEdit, setWeekEdit] = useState<{
    personKey: string;
    personId: string;
    personName: string;
    role: string;
    projectId: string;
    projectName: string;
    week: string;
    original: number;
    draft: string;
  } | null>(null);
  // Multiple cells can be mid-save at once: the parent's coalescer resolves
  // each folded cell's promise when its batch settles, so this must be a SET
  // of in-flight cell keys — a single "current key" would wrongly re-enable
  // (or never disable) sibling cells whose saves are still pending.
  const [savingWeekKeys, setSavingWeekKeys] = useState<Set<string>>(() => new Set());
  const [weekSaveError, setWeekSaveError] = useState<string | null>(null);
  const [optimisticWeekOverrides, setOptimisticWeekOverrides] = useState<Record<string, OptimisticWeekOverride>>({});
  const optimisticWeekGenerationRef = useRef(0);
  const weekCommitRef = useRef(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineFrameRef = useRef<HTMLDivElement>(null);
  const resourceHeaderRef = useRef<HTMLTableCellElement>(null);
  const totalHeaderRef = useRef<HTMLTableCellElement>(null);
  const timelineScrollAnimationRef = useRef<number | null>(null);
  const [timelineOverlay, setTimelineOverlay] = useState<{
    left: number;
    right: number;
    top: number;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const compactTimeline = viewportWidth <= 1200;
  // Keep the full quarter visible at laptop widths before horizontal scrolling
  // is needed. Week cells remain wide enough for short hour values.
  const timelineLeftW = compactTimeline ? 280 : LEFT_W;
  const timelineCW = compactTimeline ? 42 : CW;
  const timelineTotW = compactTimeline ? 64 : TOT_W;
  const br = getBusinessRules();
  const workWeekHours = br.workWeekHours || 40;
  const underHours = underHoursOverride ?? Math.round(br.targetUtilizationPct / 100 * workWeekHours);
  const overHours = overHoursOverride ?? Math.round(br.overCapacityPct / 100 * workWeekHours);
  const underPct = (underHours / workWeekHours) * 100;
  const overPct = (overHours / workWeekHours) * 100;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The table is width:100%, so its fixed-layout columns can stretch when the
  // timeline fills a wide viewport. Measure the actual sticky boundaries
  // instead of positioning the overlay arrows from the nominal col widths.
  // This keeps both arrows aligned with the weekly area at full width, zoom,
  // and when a vertical scrollbar changes the available table width.
  useLayoutEffect(() => {
    const frame = timelineFrameRef.current;
    const scroll = timelineScrollRef.current;
    const resourceHeader = resourceHeaderRef.current;
    const totalHeader = totalHeaderRef.current;
    if (!frame || !scroll || !resourceHeader || !totalHeader) return;

    const syncOverlay = () => {
      const frameRect = frame.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const resourceRect = resourceHeader.getBoundingClientRect();
      const totalRect = totalHeader.getBoundingClientRect();
      const viewportLeft = scrollRect.left - frameRect.left;
      const viewportRight = scrollRect.right - frameRect.left;
      const clamp = (value: number, min: number, max: number) =>
        Math.min(Math.max(value, min), max);
      // If TOTAL H is currently beyond the horizontally scrollable viewport,
      // keep the later-weeks control on the visible edge rather than letting
      // it disappear with the off-screen sticky cell. The same clamp protects
      // the earlier-weeks control when the frozen Resource column is covered
      // by a narrow/zoomed viewport.
      const leftBoundary = clamp(
        resourceRect.right - frameRect.left,
        viewportLeft + 14,
        viewportRight - 14,
      );
      const rightBoundary = clamp(
        totalRect.left - frameRect.left,
        leftBoundary + 28,
        viewportRight - 14,
      );
      const next = {
        left: leftBoundary - 14,
        right: frameRect.right - frameRect.left - rightBoundary - 14,
        top: scrollRect.top - frameRect.top + scrollRect.height / 2,
      };
      setTimelineOverlay(previous => (
        previous
        && Math.abs(previous.left - next.left) < 0.25
        && Math.abs(previous.right - next.right) < 0.25
        && Math.abs(previous.top - next.top) < 0.25
          ? previous
          : next
      ));
    };

    syncOverlay();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncOverlay);
    observer?.observe(frame);
    observer?.observe(scroll);
    observer?.observe(resourceHeader);
    observer?.observe(totalHeader);
    return () => observer?.disconnect();
  }, [timelineCW, timelineLeftW, timelineTotW, periods.length, viewportWidth]);

  useEffect(() => {
    let alive = true;
    loadProjectPhaseMap().then(m => { if (alive) setPhaseMap(m); });
    return () => { alive = false; };
  }, []);

  // ── Period windows: [startMs, endMs] + the Mondays inside each period ─────
  const wins = useMemo<PeriodWin[]>(() => periods.map(p => {
    const t = parsePeriodKey(p);
    if (isNaN(t)) return { key: p, startMs: NaN, endMs: NaN, weekStarts: [] };
    if (mode === "Weekly") {
      const ws = mondayOf(t);
      const e = new Date(ws); e.setDate(e.getDate() + 7);
      return { key: p, startMs: ws, endMs: e.getTime() - 1, weekStarts: [ws] };
    }
    // Monthly: enumerate Mondays that FALL INSIDE the month so a week
    // straddling two months is only counted once (in its Monday's month).
    const d = new Date(t);
    const endMs = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    const weekStarts: number[] = [];
    const cur = new Date(mondayOf(t));
    if (cur.getTime() < t) cur.setDate(cur.getDate() + 7);
    while (cur.getTime() <= endMs) { weekStarts.push(cur.getTime()); cur.setDate(cur.getDate() + 7); }
    if (weekStarts.length === 0) weekStarts.push(mondayOf(t));
    return { key: p, startMs: t, endMs, weekStarts };
  }), [periods, mode]);

  // A quarter change replaces the period columns. Start the new window at its
  // beginning so the arrow feels like a continuous timeline rather than
  // inheriting the previous quarter's horizontal offset.
  useEffect(() => {
    if (!timelineScrollRef.current) return;
    if (timelineScrollAnimationRef.current !== null) {
      cancelAnimationFrame(timelineScrollAnimationRef.current);
      timelineScrollAnimationRef.current = null;
    }
    timelineScrollRef.current.scrollLeft = 0;
  }, [selectedQ]);

  useEffect(() => () => {
    if (timelineScrollAnimationRef.current !== null) {
      cancelAnimationFrame(timelineScrollAnimationRef.current);
    }
  }, []);

  // Super-header groups: months (Weekly mode) / years (Monthly mode)
  const superGroups = useMemo(() => {
    const gs: { label: string; span: number }[] = [];
    for (const w of wins) {
      let label = "";
      if (!isNaN(w.startMs)) {
        const d = new Date(w.startMs);
        label = mode === "Weekly"
          ? `${d.toLocaleDateString("en-US", { month: "short" })} '${String(d.getFullYear() % 100).padStart(2, "0")}`
          : String(d.getFullYear());
      }
      const last = gs[gs.length - 1];
      if (last && last.label === label) last.span += 1;
      else gs.push({ label, span: 1 });
    }
    return gs;
  }, [wins, mode]);

  const colLabel = (w: PeriodWin): string => {
    if (isNaN(w.startMs)) return w.key;
    const d = new Date(w.startMs);
    return mode === "Weekly"
      ? `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleDateString("en-US", { month: "short" })}`
      : d.toLocaleDateString("en-US", { month: "short" });
  };

  const nowIdx = useMemo(
    () => wins.findIndex(w => !isNaN(w.startMs) && Date.now() >= w.startMs && Date.now() <= w.endMs),
    [wins],
  );

  // ── Utilization band (client palette, business-rule thresholds) ───────────
  const bandOf = (pct: number): UtilBand | null => {
    if (pct <= 0) return null;
    if (pct > overPct) return { key: "over", label: "Over", c: UTIL_COLORS.over };
    if (pct >= underPct) return { key: "good", label: "Good", c: UTIL_COLORS.good };
    return { key: "under", label: "Under", c: UTIL_COLORS.under };
  };

  // ── Person rows ────────────────────────────────────────────────────────────
  const people = useMemo<PersonRow[]>(() => {
    const byId = new Map<string, LiveResourceProxy>();
    const byName = new Map<string, LiveResourceProxy>();
    for (const sr of staffResources) {
      if (sr.id) byId.set(sr.id.toLowerCase(), sr);
      if (sr.name) byName.set(sr.name.toLowerCase(), sr);
    }
    const counts: Record<string, number> = {};
    rows.forEach(r => { const n = String(r.ResourceUser ?? ""); counts[n] = (counts[n] ?? 0) + 1; });

    const out = rows.map((r, i) => {
      const name = String(r.ResourceUser ?? `Row ${i}`);
      const userId = String((r as Record<string, unknown>).UserId ?? "");
      const sectionKey = String((r as Record<string, unknown>).__managerSectionKey ?? "").trim().toLowerCase();
      const rawCells = periods.map(p => parseUtilCell(r[p]));
      const baseStaffRow = byId.get(userId.toLowerCase()) ?? byName.get(name.toLowerCase());
      const rowScope = (r as Record<string, unknown>).__managerProjectScope;
      const scopedIds = Array.isArray(rowScope)
        ? rowScope.map(String)
        : projectScopeByUserId?.[userId.toLowerCase()];
      // Manager view uses an explicitly seeded scope for every displayed
      // person. An empty scope therefore means "nothing shared", not the
      // person's unrestricted allocation history.
      const scopedSet = scopedIds
        ? new Set(scopedIds.map(projectId => projectId.trim().toLowerCase()))
        : null;
      const scopedEntries = scopedSet
        ? ((baseStaffRow?.allAllocations ?? baseStaffRow?.activeAllocations ?? []) as ActiveAllocationProxy[])
            .filter(entry => scopedSet.has((entry.projectId || "").trim().toLowerCase()))
        : null;
      const staffRow = scopedSet && baseStaffRow
        ? {
            ...baseStaffRow,
            allAllocations: scopedEntries ?? [],
            activeAllocations: (baseStaffRow.activeAllocations ?? []).filter(entry =>
              scopedSet.has((entry.projectId || "").trim().toLowerCase())),
          }
        : baseStaffRow;
      const cells = scopedSet
        ? wins.map(win => {
            if (!Number.isFinite(win.startMs)) return null;
            const projectHours = new Map<string, number>();
            for (const weekStart of win.weekStarts) {
              const weekEnd = (() => {
                const d = new Date(weekStart);
                d.setDate(d.getDate() + 7);
                return d.getTime() - 1;
              })();
              const inWeek = (scopedEntries ?? []).filter(entry => {
                const start = parseLocalDay(entry.startDate);
                const end = parseLocalDay(entry.endDate);
                return Number.isFinite(start) && Number.isFinite(end) && start <= weekEnd && end >= weekStart;
              });
              for (const entry of hoursWinFilter(inWeek)) {
                const projectId = entry.projectId?.trim();
                if (!projectId) continue;
                projectHours.set(
                  projectId,
                  (projectHours.get(projectId) ?? 0) + allocEntryHrsPerWeek(entry, workWeekHours),
                );
              }
            }
            const activeProjects = [...projectHours]
              .map(([pid, hours]) => ({ pid, hours }))
              .filter(project => project.hours > 0);
            const h = Math.round((activeProjects.reduce((sum, project) => sum + project.hours, 0) + Number.EPSILON) * 100) / 100;
            if (h <= 0) return null;
            const capacity = Math.max(workWeekHours * Math.max(win.weekStarts.length, 1), 1);
            const p = Math.round((h / capacity) * 100);
            return {
              p,
              h,
              c: activeProjects.length,
              status: p > overPct ? "Over" : p >= underPct ? "Good" : "Under",
              projectIds: activeProjects.map(project => ({
                pid: project.pid,
                pct: Math.round((project.hours / capacity) * 100),
              })),
            } satisfies UtilCellData;
          })
        : rawCells;
      const totalH = Math.round(cells.reduce((s, c) => s + (c?.h ?? 0), 0));
      const active = cells.filter(c => (c?.h ?? 0) > 0);
      const avgPct = active.length > 0
        ? Math.round(active.reduce((s, c) => s + (c?.p ?? 0), 0) / active.length) : 0;
      const org = (staffRow?.role || String(r.Title ?? "") || staffRow?.divisionName || String(r.Department ?? "")).trim();
      const disambig = (counts[name] ?? 0) > 1
        ? (String(r.Department ?? "").trim() || String(r.Title ?? "").trim() || userId.slice(-4))
        : "";
      return {
        key: sectionKey || (userId || name) + ":" + i,
        sectionKey,
        row: r, name, disambig, userId, org, cells, totalH, avgPct,
        band: bandOf(avgPct), staffRow,
      };
    });
    out.sort((a, b) => personSort === "firstName"
      ? compareByFirstName(a.name, b.name)
      : b.totalH - a.totalH);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, periods, staffResources, underHours, overHours, workWeekHours, wins, projectScopeByUserId, personSort]);

  // Auto-expand requested people (Manager view opens the selected manager's
  // project rows) exactly once per mount — afterwards the user's own
  // expand/collapse toggles win, even across data refetches.
  const appliedDefaultExpandRef = useRef(false);
  useEffect(() => {
    if (appliedDefaultExpandRef.current || !defaultExpandedUserIds?.length) return;
    const wanted = new Set(defaultExpandedUserIds.map(x => x.toLowerCase()));
    const keys = people.filter(p => p.userId && wanted.has(p.userId.toLowerCase())).map(p => p.key);
    if (keys.length === 0) return; // rows still loading — retry when they land
    appliedDefaultExpandRef.current = true;
    setExpanded(prev => { const n = new Set(prev); for (const k of keys) n.add(k); return n; });
  }, [people, defaultExpandedUserIds]);

  // ── Per-project weekly hours for EXPANDED people only ─────────────────────
  // Tenant work-week basis captured per render (useBusinessRulesVersion above
  // re-renders when the async effective settings land or an admin edits them),
  // and listed as a memo dep so expanded rows recompute for non-40h tenants.
  const wwHrs = getBusinessRules().workWeekHours || 40;
  const projectsByKey = useMemo(() => {
    const winFirst = wins.find(w => !isNaN(w.startMs))?.startMs ?? NaN;
    const winLast = [...wins].reverse().find(w => !isNaN(w.endMs))?.endMs ?? NaN;
    const m = new Map<string, ProjRow[]>();
    for (const person of people) {
      if (!expanded.has(person.key)) continue;
      const entries = (person.staffRow?.allAllocations ?? person.staffRow?.activeAllocations ?? []) as ActiveAllocationProxy[];
      const byPid = new Map<string, ActiveAllocationProxy[]>();
      for (const e of entries) {
        if (!e.projectId) continue;
        const list = byPid.get(e.projectId);
        if (list) list.push(e); else byPid.set(e.projectId, [e]);
      }
      const projRows: ProjRow[] = [];
      for (const [pid, list] of byPid) {
        const hours = wins.map(w => {
          if (isNaN(w.startMs)) return 0;
          let h = 0;
          for (const wsMs of w.weekStarts) {
            const wEnd = (() => { const d = new Date(wsMs); d.setDate(d.getDate() + 7); return d.getTime() - 1; })();
            const inWeek = list.filter(e => {
              const s = parseLocalDay(e.startDate);
              const en = parseLocalDay(e.endDate);
              return !isNaN(s) && !isNaN(en) && s <= wEnd && en >= wsMs;
            });
            // hours-win: real hours replace the %-plan for this week, never add.
            for (const e of hoursWinFilter(inWeek)) h += allocEntryHrsPerWeek(e, wwHrs);
          }
          return Math.round((h + Number.EPSILON) * 100) / 100;
        });
        const total = Math.round((hours.reduce((a, b) => a + b, 0) + Number.EPSILON) * 100) / 100;
        const overlapsWindow = !isNaN(winFirst) && !isNaN(winLast) && list.some(e => {
          const s = parseLocalDay(e.startDate);
          const en = parseLocalDay(e.endDate);
          return !isNaN(s) && !isNaN(en) && s <= winLast && en >= winFirst;
        });
        if (total <= 0 && !overlapsWindow) continue;
        const rawName = list.find(e => e.projectName && e.projectName !== pid)?.projectName;
        projRows.push({
          pid,
          name: rawName ?? pName?.(pid) ?? pid,
          module: list.find(entry => entry.module)?.module,
          hours,
          total,
        });
      }
      projRows.sort((a, b) => b.total - a.total);
      m.set(person.key, projRows);
    }
    return m;
  }, [people, expanded, wins, pName, wwHrs]);

  // ── Demand FTE per period (open positions overlapping each window) ────────
  const demandFte = useMemo(() => wins.map(w => {
    if (isNaN(w.startMs)) return 0;
    let f = 0;
    for (const d of demandItems) {
      const s = parseLocalDay(d.AllocationStartDate);
      const en = parseLocalDay(d.AllocationEndDate);
      if (isNaN(s) || isNaN(en)) continue;
      if (s <= w.endMs && en >= w.startMs) f += (d.PctAllocation ?? 0) / 100;
    }
    return Math.round(f * 100) / 100;
  }), [wins, demandItems]);
  const hasDemand = demandFte.some(v => v > 0);
  const peakDemandFte = Math.max(0, ...demandFte);
  const projectWeekKey = (personKey: string, projectId: string, week: string) =>
    `${personKey}|${projectId}|${week}`;
  const optimisticDeltas = useMemo(() => {
    const byPersonWeek = new Map<string, number>();
    const byPerson = new Map<string, number>();
    let total = 0;
    for (const override of Object.values(optimisticWeekOverrides)) {
      const delta = override.hours - override.original;
      const personWeekKey = `${override.personKey}|${override.week}`;
      byPersonWeek.set(personWeekKey, (byPersonWeek.get(personWeekKey) ?? 0) + delta);
      byPerson.set(override.personKey, (byPerson.get(override.personKey) ?? 0) + delta);
      total += delta;
    }
    return { byPersonWeek, byPerson, total };
  }, [optimisticWeekOverrides]);

  // ── Loading / error / empty ───────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
      <Loader2 size={28} color={GREEN} style={{ animation: "spin 1s linear infinite" }} />
      <div style={{ color: MUTED, fontSize: 12 }}>Loading {mode.toLowerCase()} utilization…</div>
    </div>
  );
  if (error && rows.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: 12 }}>
      <AlertCircle size={32} color="#F87171" />
      <div style={{ color: TEXT, fontSize: 14, fontWeight: 600 }}>{error}</div>
      <button onClick={onRetry} style={{ padding: "8px 18px", borderRadius: 8, border: "none",
        backgroundColor: "var(--rm-green)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Retry</button>
    </div>
  );
  if (rows.length === 0 || periods.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "60px 20px", gap: 12 }}>
      <Calendar size={32} color={FAINT} />
      <div style={{ color: TEXT, fontSize: 14, fontWeight: 600 }}>No utilization data</div>
      <div style={{ color: MUTED, fontSize: 12, textAlign: "center" }}>No allocations found for this period.</div>
    </div>
  );

  // ── Header stats (same derivations as the previous grid) ─────────────────
  const visiblePeople = bandFilter ? people.filter(p => p.band?.key === bandFilter) : people;

  // ── Optional section ordering (Manager view) ───────────────────────────────
  // Re-orders visiblePeople into the caller's labeled sections; the FIRST
  // member of each labeled section carries sectionBreak so the render loop
  // draws one divider row. Band-filter stats above stay section-agnostic.
  type SectionBreak = { label: string; count: number };
  let displayPeople: (PersonRow & { sectionBreak?: SectionBreak })[];
  if (sections?.length) {
    const used = new Set<string>();
    const out: (PersonRow & { sectionBreak?: SectionBreak })[] = [];
    for (const s of sections) {
      // Blank ids must never enter the match set — a person row with an
      // empty userId would otherwise "match" a stray empty string.
      const ids = new Set(s.userIds.map(x => x.trim().toLowerCase()).filter(Boolean));
      const rowKeys = new Set((s.rowKeys ?? []).map(x => x.trim().toLowerCase()).filter(Boolean));
      const members = visiblePeople.filter(p =>
        !used.has(p.key) && (
          (rowKeys.size > 0 && rowKeys.has(p.sectionKey))
          || (rowKeys.size === 0 && (ids.has(p.userId.toLowerCase()) || ids.has(p.name.toLowerCase())))
        ));
      members.forEach((m, idx) => {
        used.add(m.key);
        out.push(idx === 0 && s.label ? { ...m, sectionBreak: { label: s.label, count: members.length } } : m);
      });
    }
    for (const p of visiblePeople) if (!used.has(p.key)) out.push(p);
    displayPeople = out;
  } else {
    displayPeople = visiblePeople;
  }
  const hierarchyRootId = defaultExpandedUserIds?.[0]?.trim().toLowerCase() || null;
  const isManagerHierarchy = Boolean(hierarchyRootId && sections?.length);
  const hierarchyOwnerIndex = isManagerHierarchy
    ? displayPeople.findIndex(person => person.userId.trim().toLowerCase() === hierarchyRootId)
    : -1;
  const hierarchyOwnerName = hierarchyOwnerIndex >= 0
    ? displayPeople[hierarchyOwnerIndex]?.name
    : undefined;
  const personTotalHours = (person: PersonRow) =>
    Math.round((person.totalH + (optimisticDeltas.byPerson.get(person.key) ?? 0)) * 10) / 10;
  const uniquePeople = new Map<string, number>();
  for (const person of visiblePeople) {
    const identity = person.userId.trim().toLowerCase() || person.name.trim().toLowerCase();
    uniquePeople.set(identity, (uniquePeople.get(identity) ?? 0) + personTotalHours(person));
  }
  const totalPeople = uniquePeople.size;
  const activePeople = [...uniquePeople.values()].filter(hours => hours > 0).length;
  const idlePeople = totalPeople - activePeople;
  const totalHours = Math.round(visiblePeople.reduce((s, p) => s + personTotalHours(p), 0) * 10) / 10;
  // A Manager record section can repeat one person across several projects.
  // Add those project-scoped percentages per person/week before averaging so
  // the headline remains a people-utilization metric, not a project-row metric.
  const pctByPersonPeriod = new Map<string, number>();
  for (const person of visiblePeople) {
    const identity = person.userId.trim().toLowerCase() || person.name.trim().toLowerCase();
    person.cells.forEach((cell, index) => {
      const key = `${identity}::${index}`;
      pctByPersonPeriod.set(key, (pctByPersonPeriod.get(key) ?? 0) + (cell?.p ?? 0));
    });
  }
  const allPcts = [...pctByPersonPeriod.values()].filter(v => v > 0);
  const avgUtil = allPcts.length > 0 ? Math.round(allPcts.reduce((a, b) => a + b) / allPcts.length) : 0;
  const [qLabel, qYear] = selectedQ.split(" ");
  const colTotals = wins.map((win, i) => {
    const weekIso = Number.isFinite(win.weekStarts[0] ?? win.startMs)
      ? localIsoDay(win.weekStarts[0] ?? win.startMs)
      : "";
    return Math.round(visiblePeople.reduce(
      (sum, person) => sum + (person.cells[i]?.h ?? 0) + (optimisticDeltas.byPersonWeek.get(`${person.key}|${weekIso}`) ?? 0),
      0,
    ) * 10) / 10;
  });
  const grandTotal = Math.round(colTotals.reduce((a, b) => a + b, 0) * 10) / 10;

  const toggle = (key: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });

  const cellBorder = `1px solid ${BORDER}`;
  const startThresholdEdit = (key: "under" | "over") => {
    setEditingThreshold(key);
    setThresholdDraft(String(key === "under" ? underHours : overHours));
  };
  const commitThresholdEdit = () => {
    if (!editingThreshold) return;
    const proposed = Math.round(Number(thresholdDraft));
    if (!Number.isFinite(proposed) || proposed < 0) {
      setEditingThreshold(null);
      return;
    }
    if (editingThreshold === "under") {
      setUnderHoursOverride(Math.min(proposed, overHours));
    } else {
      setOverHoursOverride(Math.max(proposed, underHours));
    }
    setEditingThreshold(null);
  };
  const scrollTimeline = (direction: -1 | 1) => {
    const timeline = timelineScrollRef.current;
    if (!timeline) return;
    const atStart = timeline.scrollLeft <= 4;
    const atEnd = timeline.scrollLeft + timeline.clientWidth >= timeline.scrollWidth - 4;
    if ((direction < 0 && atStart) || (direction > 0 && atEnd)) {
      onQuarterNavigate?.(direction);
      return;
    }
    // Advance a predictable four week columns at a time. Native smooth scroll
    // jumps large table widths differently by browser and stutters when users
    // alternate directions; a short rAF animation stays column-aligned and
    // starts cleanly from the current position on every click.
    const page = timelineCW * 4;
    const maxLeft = Math.max(0, timeline.scrollWidth - timeline.clientWidth);
    const target = Math.max(0, Math.min(
      maxLeft,
      Math.round((timeline.scrollLeft + direction * page) / timelineCW) * timelineCW,
    ));
    if (Math.abs(target - timeline.scrollLeft) < 1) {
      onQuarterNavigate?.(direction);
      return;
    }
    if (timelineScrollAnimationRef.current !== null) {
      cancelAnimationFrame(timelineScrollAnimationRef.current);
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      timeline.scrollLeft = target;
      timelineScrollAnimationRef.current = null;
      return;
    }
    const start = timeline.scrollLeft;
    const distance = target - start;
    const startedAt = performance.now();
    const duration = 280;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      // Ease-in-out prevents the abrupt start and stop that made the timeline
      // feel stuck when stepping through adjacent week groups.
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      timeline.scrollLeft = start + distance * eased;
      if (progress < 1) {
        timelineScrollAnimationRef.current = requestAnimationFrame(animate);
      } else {
        timeline.scrollLeft = target;
        timelineScrollAnimationRef.current = null;
      }
    };
    timelineScrollAnimationRef.current = requestAnimationFrame(animate);
  };

  const pastWeekLocked = (projectId: string, weekMs: number): boolean =>
    // Canonical local-calendar rule — hand-rolled ms/7d age math miscounts
    // across DST transitions (a 167-hour week floors to age 0).
    getPastWeekEditStateFor(localIsoDay(weekMs), projectId.split("-")[0]).locked;
  const beginWeekEdit = (person: PersonRow, proj: ProjRow, i: number, hours: number) => {
    const weekMs = wins[i]?.weekStarts[0];
    if (
      !canEditProjectWeeks ||
      !onSaveProjectWeek ||
      mode !== "Weekly" ||
      !Number.isFinite(weekMs) ||
      pastWeekLocked(proj.pid, weekMs)
    ) return;
    weekCommitRef.current = false;
    setWeekSaveError(null);
    setWeekEdit({
      personKey: person.key,
      personId: person.staffRow?.id || person.userId,
      personName: person.name,
      role: person.staffRow?.roleName || person.staffRow?.role || person.org,
      projectId: proj.pid,
      projectName: pName?.(proj.pid) ?? proj.name,
      week: localIsoDay(weekMs),
      original: hours,
      draft: fmtHrs(hours),
    });
  };
  const commitWeekEdit = async () => {
    if (weekCommitRef.current || !weekEdit || !onSaveProjectWeek) return;
    const parsed = parseWeeklyHoursDraft(weekEdit.draft);
    if (parsed === null || parsed < 0 || parsed > MAX_WEEK_HOURS) return;
    weekCommitRef.current = true;
    if (parsed === weekEdit.original) {
      setWeekEdit(null);
      return;
    }
    const edit = weekEdit;
    const key = projectWeekKey(edit.personKey, edit.projectId, edit.week);
    const generation = ++optimisticWeekGenerationRef.current;
    setSavingWeekKeys(current => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setWeekSaveError(null);
    setOptimisticWeekOverrides(current => ({
      ...current,
      [key]: {
        personKey: edit.personKey,
        projectId: edit.projectId,
        week: edit.week,
        original: edit.original,
        hours: parsed,
        generation,
      },
    }));
    setWeekEdit(null);
    try {
      await onSaveProjectWeek({
        personId: edit.personId,
        personName: edit.personName,
        role: edit.role,
        projectId: edit.projectId,
        projectName: edit.projectName,
        week: edit.week,
        hours: parsed,
        onAccepted: () => {
          // The Resources page now owns the cross-view accepted-value overlay.
          // Hand off immediately so this local aggregate delta is not applied
          // on top of the same page-level delta while verification is pending.
          setOptimisticWeekOverrides(current => {
            if (current[key]?.generation !== generation) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        },
      });
      // The parent waits for the verified fresh read before resolving. Remove
      // the local projection only once that confirmed value is already visible.
      setOptimisticWeekOverrides(current => {
        if (current[key]?.generation !== generation) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (e) {
      setOptimisticWeekOverrides(current => {
        if (current[key]?.generation !== generation) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      setWeekSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      weekCommitRef.current = false;
      setSavingWeekKeys(current => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  const thresholdInput = (
    threshold: "under" | "over",
    filterBand: UtilBand["key"] = threshold,
  ) => {
    const currentValue = threshold === "under" ? underHours : overHours;
    const editingThisValue = editingThreshold === threshold;
    return (
      <input
        type="text"
        pattern="[0-9]*"
        inputMode="numeric"
        autoComplete="off"
        value={editingThisValue ? thresholdDraft : String(currentValue)}
        onFocus={() => {
          setBandFilter(filterBand);
          startThresholdEdit(threshold);
        }}
        onChange={e => setThresholdDraft(e.target.value)}
        onBlur={commitThresholdEdit}
        onKeyDown={e => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setEditingThreshold(null);
            e.currentTarget.blur();
          }
        }}
        aria-label={`Edit ${threshold === "under" ? "Good range start / Under" : "Good range end / Over"} hours threshold`}
        title={`Edit ${threshold === "under" ? "Good range start / Under" : "Good range end / Over"} hours threshold`}
        style={{
          width: 34, minWidth: 34, height: 19, boxSizing: "border-box", padding: "1px 3px",
          border: `1px solid ${threshold === "under" ? UTIL_COLORS.under.bg : UTIL_COLORS.over.bg}`,
          borderRadius: 4, background: `${threshold === "under" ? UTIL_COLORS.under.bg : UTIL_COLORS.over.bg}12`,
          color: TEXT, fontSize: 10, fontWeight: 800, outline: "none",
          fontVariantNumeric: "tabular-nums", textAlign: "center", cursor: "text",
        }}
      />
    );
  };

  return (
    <div style={{
      marginBottom: 12, marginLeft: 12, marginRight: 12, marginTop: 4,
      backgroundColor: CARD, borderRadius: 12,
      // Keep the internal table/header dividers, but do not draw an outer
      // container box around the Manager hierarchy.
      border: "none", overflow: "hidden",
    }}>
      {/* ── Card header: quarter badge + title | legend ─────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px 10px", borderBottom: `1px solid ${BORDER}`,
        flexWrap: "wrap", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
          <button onClick={onQClick} title="Change quarter" style={{
            border: `2px solid ${GREEN}`, borderRadius: 8, padding: "4px 8px",
            textAlign: "center", minWidth: 44, cursor: onQClick ? "pointer" : "default",
            background: GREEN + "20", transition: "background 0.15s",
          }}
            onMouseEnter={e => { if (onQClick) (e.currentTarget as HTMLButtonElement).style.background = GREEN + "40"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = GREEN + "20"; }}
          >
            <div style={{ fontSize: 15, fontWeight: 900, color: GREEN, lineHeight: 1 }}>{qLabel ?? "Q?"}</div>
            <div style={{ fontSize: 9, color: GREEN, fontWeight: 700, opacity: 0.8, marginTop: 1 }}>{qYear ?? ""}</div>
          </button>
          {quarterMenu}
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>All Resources</div>
            {/* Compact, clickable utilization legend. Project-phase colors remain
                visible in expanded rows, where they carry useful context. */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 4 }}>
              {([
                { key: "under" as const, label: "Under", c: UTIL_COLORS.under },
                { key: "good" as const, label: "Good", c: UTIL_COLORS.good },
                { key: "over" as const, label: "Over", c: UTIL_COLORS.over },
              ]).map(l => {
                const active = bandFilter === l.key;
                const isBoundary = l.key === "under" || l.key === "over";
                const detail = l.key === "under" ? `<${underHours}h`
                  : l.key === "good" ? `${underHours}–${overHours}h`
                  : `>${overHours}h`;
                return (
                  <div
                    key={l.label}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5, flex: "0 0 auto",
                      border: `1px solid ${active ? l.c.bg : `${l.c.bg}66`}`,
                      background: active ? `${l.c.bg}26` : `${l.c.bg}0D`,
                      borderRadius: 999, padding: "4px 8px", minHeight: 28, boxSizing: "border-box",
                      transition: "background 0.15s, border-color 0.15s, transform 0.15s",
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setBandFilter(current => current === l.key ? null : l.key)}
                      title={active ? "Show all resources" : `Show ${l.label.toLowerCase()} resources only`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: 0, border: "none", background: "transparent", color: TEXT, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: l.c.bg, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 800 }}>{l.label}</span>
                      <span style={{ fontSize: 9, color: active ? l.c.bg : FAINT, marginLeft: 1 }}>↗</span>
                    </button>
                    {isBoundary ? (
                      <>
                        <span style={{ color: MUTED, fontSize: 9, fontWeight: 700 }}>
                          {l.key === "under" ? "<" : ">"}
                        </span>
                        {thresholdInput(l.key)}
                        <span style={{ color: MUTED, fontSize: 9, fontWeight: 700 }}>h</span>
                      </>
                    ) : (
                      <>
                        {thresholdInput("under", "good")}
                        <span style={{ color: MUTED, fontSize: 9, fontWeight: 700 }}>–</span>
                        {thresholdInput("over", "good")}
                        <span style={{ color: MUTED, fontSize: 9, fontWeight: 700 }}>h</span>
                      </>
                    )}
                  </div>
                );
              })}
              {bandFilter && (
                <button onClick={() => setBandFilter(null)} style={{
                  border: "none", background: "transparent", color: GREEN, cursor: "pointer",
                  fontSize: 10, fontWeight: 700, padding: "3px 2px",
                }}>Show all</button>
              )}
            </div>
            <div style={{ fontSize: 10, color: FAINT }}>
              Week-by-week hours · expand a person for per-project phases
              {canEditProjectWeeks && mode === "Weekly" ? " · click a project/week value to edit" : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "stretch", flexWrap: "wrap" }}>
          {([
            { val: String(totalPeople), label: "TOTAL PEOPLE", color: TEXT },
            { val: totalHours >= 10000 ? `${(totalHours / 1000).toFixed(1).replace(/\.0$/, "")}k h` : `${totalHours.toLocaleString("en-US")}h`, label: "TOTAL HOURS", color: TEXT },
            { val: String(activePeople), label: "ACTIVE PEOPLE", color: TEXT },
            { val: String(idlePeople), label: "IDLE PEOPLE", color: TEXT },
            { val: `${avgUtil}%`, label: "AVG UTILISATION", color: bandOf(avgUtil)?.c.bg ?? TEXT },
          ] as { val: string; label: string; color: string }[]).map(({ val, label, color }, i) => (
            <div key={label} style={{
              minWidth: 86, padding: "2px 12px",
              borderLeft: i === 0 ? "none" : `1px solid ${BORDER}`,
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{val}</div>
              <div style={{ fontSize: 8, color: FAINT, fontWeight: 700, letterSpacing: 0.6, marginTop: 4, whiteSpace: "nowrap" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Gantt table ─────────────────────────────────────────────────── */}
      {/* Scroll lives INSIDE the card: vertical is capped to the viewport so
          the horizontal scrollbar is always visible without scrolling the
          whole page to the bottom (646 people = a very long table). Headers
          are sticky-top, the Resource column sticky-left and TOTAL H
          sticky-right. borderCollapse must stay "separate": collapsed borders
          do not travel with sticky cells and produce ghost gridlines that
          look like overlapping content while scrolling sideways. */}
      <style>{`
        .rm-tl-scroll { scrollbar-width: thin; scrollbar-color: rgba(107,165,57,0.65) rgba(128,128,128,0.14); }
        .rm-tl-scroll::-webkit-scrollbar { height: 12px; width: 10px; }
        .rm-tl-scroll::-webkit-scrollbar-track { background: rgba(128,128,128,0.14); }
        .rm-tl-scroll::-webkit-scrollbar-thumb {
          background: rgba(107,165,57,0.55); border-radius: 999px;
          border: 2px solid transparent; background-clip: padding-box;
        }
        .rm-tl-scroll::-webkit-scrollbar-thumb:hover { background: rgba(107,165,57,0.85); background-clip: padding-box; }
        .rm-tl-scroll::-webkit-scrollbar-corner { background: transparent; }
      `}</style>
      <div ref={timelineFrameRef} style={{ position: "relative" }}>
        <div ref={timelineScrollRef} className="rm-tl-scroll" style={{ overflow: "auto", maxHeight: "max(360px, calc(100vh - 270px))", position: "relative", isolation: "isolate" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", minWidth: timelineLeftW + timelineCW * wins.length + timelineTotW, width: "100%" }}>
          <colgroup>
            <col style={{ width: timelineLeftW }} />
            {wins.map((w) => <col key={w.key} style={{ width: timelineCW }} />)}
            <col style={{ width: timelineTotW }} />
          </colgroup>
          <thead style={{ position: "sticky", top: 0, zIndex: 20, isolation: "isolate" }}>
            {/* Month / year super-header.
                Seam-proofing for browser zoom: the week row below sticks at
                top:25 (1px INTO this 26px row) and carries the divider as its
                own borderTop. At fractional zoom levels (125/150/175%) the
                painted height of this row rounds to device pixels and can
                drift a fraction of a CSS px from 26 — pinning the second row
                at exactly 26 leaves a hairline gap where body rows show
                through while scrolling ("names collaging with months"). The
                1px overlap absorbs that drift; this row has NO borderBottom
                so nothing peeks past the overlap. */}
            <tr>
              <th ref={resourceHeaderRef} style={{
                position: "sticky", top: 0, left: 0, zIndex: 40, backgroundColor: CARD,
                backgroundImage: TINT_HEAD, borderRight: cellBorder, padding: "3px 8px",
                height: 26, boxSizing: "border-box",
              }} />
              {superGroups.map((g, i) => (
                <th key={i} colSpan={g.span} style={{
                  position: "sticky", top: 0, zIndex: 30,
                  borderRight: cellBorder, color: MUTED, fontSize: 10, fontWeight: 700,
                  textAlign: "center", padding: "3px 4px", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                  backgroundColor: CARD, backgroundImage: TINT_HEAD,
                  height: 26, boxSizing: "border-box",
                }}>{g.label ? (g.span >= 2 ? `← ${g.label} →` : g.label) : ""}</th>
              ))}
              <th ref={totalHeaderRef} style={{
                position: "sticky", top: 0, right: 0, zIndex: 35,
                borderLeft: cellBorder, borderRight: cellBorder,
                backgroundColor: CARD, backgroundImage: TINT_HEAD,
                height: 26, boxSizing: "border-box",
              }} />
            </tr>
            {/* Week header — sticks 1px into the month row (see note above) */}
            <tr>
              <th style={{
                position: "sticky", top: 25, left: 0, zIndex: 40, backgroundColor: CARD,
                borderTop: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, padding: "4px 8px",
                color: FAINT, fontSize: 10, textAlign: "left", fontWeight: 600,
                height: 26, boxSizing: "border-box",
              }}>Resource</th>
              {wins.map((w, i) => {
                const hl = i === nowIdx;
                return (
                  <th key={w.key} style={{ position: "sticky", top: 25, zIndex: 30, borderTop: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, padding: 0, backgroundColor: hl ? GANTT_HIGHLIGHT.header : CARD, height: 26, boxSizing: "border-box" }}>
                    <button
                      onClick={() => onColumnClick?.(w.key)}
                      title={onColumnClick ? "Open week view" : undefined}
                      style={{
                        width: "100%", padding: "4px 0", background: "none", border: "none",
                        color: hl ? GANTT_HIGHLIGHT.headerText : (onColumnClick ? GREEN : MUTED),
                        fontSize: 10, fontWeight: hl ? 800 : 600, textAlign: "center",
                        cursor: onColumnClick ? "pointer" : "default",
                      }}
                      onMouseEnter={e => { if (onColumnClick) (e.currentTarget as HTMLButtonElement).style.opacity = "0.65"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                    >{colLabel(w)}</button>
                  </th>
                );
              })}
              <th style={{
                position: "sticky", top: 25, right: 0, zIndex: 35,
                borderTop: cellBorder, borderLeft: cellBorder, borderRight: cellBorder, borderBottom: cellBorder,
                backgroundColor: CARD, color: FAINT,
                fontSize: 9, fontWeight: 800, letterSpacing: 0.6, padding: "4px 0",
                height: 26, boxSizing: "border-box",
              }}>TOTAL H</th>
            </tr>
          </thead>
          <tbody>
            {displayPeople.map((person, personIndex) => {
              const open = expanded.has(person.key);
              const projRows = open ? (projectsByKey.get(person.key) ?? []) : [];
              const isHierarchyOwner = Boolean(
                isManagerHierarchy
                && hierarchyRootId
                && person.userId.trim().toLowerCase() === hierarchyRootId,
              );
              const isHierarchySubordinate = Boolean(isManagerHierarchy && !isHierarchyOwner);
              const startsSubordinateGroup = Boolean(
                isManagerHierarchy
                && hierarchyOwnerIndex >= 0
                && personIndex === hierarchyOwnerIndex + 1,
              );
              return (
                <React.Fragment key={person.key}>
                  {/* One explicit inner group makes the selected PM the
                      headline and the rows below unmistakably subordinate. */}
                  {startsSubordinateGroup && (
                    <tr>
                      <td style={{
                        position: "sticky", left: 0, zIndex: 5,
                        backgroundColor: CARD,
                        backgroundImage: "none",
                        borderRight: cellBorder, borderBottom: undefined,
                        padding: "5px 10px 5px 22px",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        <span aria-hidden="true" style={{
                          position: "absolute", left: 18, top: 0, bottom: 0, width: 2,
                          background: `${GREEN}66`, pointerEvents: "none",
                        }} />
                        <span aria-hidden="true" style={{
                          position: "absolute", left: 18, right: 0, top: 0, height: 2,
                          background: `${GREEN}66`, pointerEvents: "none",
                        }} />
                        <span aria-hidden="true" style={{
                          position: "absolute", left: 18, right: 0, bottom: 0, height: 1,
                          background: BORDER, pointerEvents: "none",
                        }} />
                        <span style={{
                          display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                          color: MUTED, fontSize: 9, fontWeight: 900,
                          letterSpacing: 0.75, textTransform: "uppercase",
                        }} title={`Working under ${hierarchyOwnerName ?? "selected manager"}`}>
                          Working under {hierarchyOwnerName ?? "selected manager"}
                        </span>
                      </td>
                      <td colSpan={wins.length} style={{
                        borderTop: `2px solid ${GREEN}66`,
                        borderRight: cellBorder, borderBottom: cellBorder,
                        backgroundColor: CARD,
                        backgroundImage: "none",
                      }} />
                      <td style={{
                        position: "sticky", right: 0, zIndex: 4,
                        borderTop: `2px solid ${GREEN}66`,
                        borderLeft: cellBorder, borderBottom: cellBorder,
                        backgroundColor: CARD,
                        backgroundImage: "none",
                      }} />
                    </tr>
                  )}
                  {/* SECTION DIVIDER (Manager view hierarchy groups) */}
                  {person.sectionBreak && (
                    <tr>
                      <td style={{
                        position: "sticky", left: 0, zIndex: 5,
                         backgroundColor: CARD,
                         backgroundImage: isManagerHierarchy ? "none" : TINT_HEAD,
                         borderTop: undefined,
                         borderRight: cellBorder, borderBottom: isManagerHierarchy ? undefined : cellBorder,
                         padding: isManagerHierarchy ? "4px 10px 4px 22px" : "4px 10px",
                         whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {isManagerHierarchy && (
                          <span aria-hidden="true" style={{
                            position: "absolute", left: 18, top: 0, bottom: 0, width: 2,
                            background: `${GREEN}66`, pointerEvents: "none",
                          }} />
                        )}
                        {isManagerHierarchy && (
                          <span aria-hidden="true" style={{
                            position: "absolute", left: 18, right: 0, top: 0, height: 2,
                            background: `${GREEN}66`, pointerEvents: "none",
                          }} />
                        )}
                        {isManagerHierarchy && (
                          <span aria-hidden="true" style={{
                            position: "absolute", left: 18, right: 0, bottom: 0, height: 1,
                            background: BORDER, pointerEvents: "none",
                          }} />
                        )}
                        <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                          <span style={{
                            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                            fontSize: 9, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: MUTED,
                          }} title={person.sectionBreak.label}>
                            {person.sectionBreak.label}
                          </span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: FAINT, marginLeft: 6, flexShrink: 0 }}>
                            {person.sectionBreak.count}
                          </span>
                        </div>
                      </td>
                      <td colSpan={wins.length} style={{
                        borderTop: isManagerHierarchy ? `2px solid ${GREEN}66` : undefined,
                        borderBottom: cellBorder,
                        backgroundColor: CARD,
                        backgroundImage: isManagerHierarchy ? "none" : TINT_HEAD,
                      }} />
                      <td style={{
                        position: "sticky", right: 0, zIndex: 4,
                        backgroundColor: CARD,
                        backgroundImage: isManagerHierarchy ? "none" : TINT_HEAD,
                        borderTop: isManagerHierarchy ? `2px solid ${GREEN}66` : undefined,
                        borderLeft: cellBorder, borderBottom: cellBorder,
                      }} />
                    </tr>
                  )}
                  {/* PERSON SUMMARY ROW */}
                  <tr
                    style={{ cursor: "pointer" }}
                    onClick={() => toggle(person.key)}
                    aria-expanded={open}
                  >
                    <td style={{
                      position: "sticky", left: 0, zIndex: 5,
                      backgroundColor: CARD,
                      backgroundImage: isManagerHierarchy
                        ? "none"
                        : isHierarchyOwner
                        ? "linear-gradient(90deg, rgba(107,165,57,0.14), rgba(107,165,57,0.02) 72%, transparent)"
                        : TINT_PERSON,
                      borderRight: cellBorder, borderBottom: isManagerHierarchy ? undefined : cellBorder,
                      padding: isHierarchySubordinate ? "7px 12px 7px 34px" : "8px 12px 7px 10px",
                      minHeight: isHierarchyOwner ? 48 : 44,
                      // The hierarchy rail below is the only connector accent.
                      // Do not add a second outer stripe around the selected PM.
                      boxShadow: undefined,
                    }}>
                      {isManagerHierarchy && (
                        <span aria-hidden="true" style={{
                          position: "absolute", left: 18, top: 0, bottom: 0, width: 2,
                          background: isHierarchyOwner ? GREEN : `${GREEN}66`, pointerEvents: "none",
                        }} />
                      )}
                      {isManagerHierarchy && (
                        <span aria-hidden="true" style={{
                          position: "absolute", left: 18, right: 0, bottom: 0, height: 1,
                          background: BORDER, pointerEvents: "none",
                        }} />
                      )}
                      {/* overflow:hidden — cell content must never spill over the
                          week columns; at fractional zoom the fixed-width pieces
                          can round 1-2px past the 290px column. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                        {open
                          ? <ChevronDown size={12} color={FAINT} style={{ flexShrink: 0 }} />
                          : <ChevronRight size={12} color={FAINT} style={{ flexShrink: 0 }} />}
                        <div style={{
                           width: 28, height: 28, borderRadius: "50%", background: "#475569",
                          display: "flex", alignItems: "center", justifyContent: "center",
                           color: "#fff", fontSize: 10, fontWeight: 800, flexShrink: 0,
                        }}>{initialsOf(person.name)}</div>
                        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                          <button
                            onClick={e => { e.stopPropagation(); onPersonClick(person.name, person.userId); }}
                            title={`Open ${person.name}'s workload, then edit an exact project week`}
                            style={{
                              display: "block", background: "none", border: "none", padding: 0,
                              color: empTypeColor(person.staffRow?.employeeType) ?? GREEN,
                               fontSize: isHierarchyOwner ? 14 : 13,
                               fontWeight: isHierarchyOwner ? 900 : 850, cursor: "pointer",
                              textAlign: "left", maxWidth: "100%",
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            }}
                          >
                            {person.name}
                            {person.disambig && (
                              <span style={{ fontWeight: 400, color: FAINT, fontSize: 10, marginLeft: 3 }}>
                                ({person.disambig})
                              </span>
                            )}
                          </button>
                           <DisabledMemberStatus enabled={person.staffRow?.enabled} userGuid={person.staffRow?.id ?? person.userId}
                             tenantId={person.staffRow?.tenantId} canManageStaff={canManageStaff} onReactivated={onRetry} />
                          <div style={{
                             color: MUTED, fontSize: 10, maxWidth: "100%",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>{person.org}</div>
                        </div>
                        {person.band && (
                          <button
                            onClick={e => { e.stopPropagation(); onStatusBadgeClick?.(person.name, person.userId); }}
                            title={`Click for AI analysis of ${person.name}'s utilization`}
                            style={{
                              marginLeft: "auto", flexShrink: 0,
                              background: person.band.c.bg, color: person.band.c.text,
                              fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 10,
                              border: "none", cursor: onStatusBadgeClick ? "pointer" : "default",
                            }}
                          >{person.band.label}</button>
                        )}
                      </div>
                    </td>
                    {person.cells.map((cell, i) => {
                      const hl = i === nowIdx;
                      const weekMs = wins[i].weekStarts[0] ?? wins[i].startMs;
                      const weekIso = Number.isFinite(weekMs) ? localIsoDay(weekMs) : "";
                      const h = (cell?.h ?? 0) + (optimisticDeltas.byPersonWeek.get(`${person.key}|${weekIso}`) ?? 0);
                      const weekBand = bandOf((h / workWeekHours) * 100);
                      if (h <= 0 || !weekBand) {
                        return (
                          <td key={wins[i].key} style={{ borderRight: cellBorder, borderBottom: cellBorder, padding: 0, background: hl ? HL_CELL : undefined }}>
                            <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: FAINT, fontSize: 10 }}>—</div>
                          </td>
                        );
                      }
                      return (
                        <td key={wins[i].key} style={{ borderRight: cellBorder, borderBottom: cellBorder, padding: 0, background: hl ? HL_CELL : undefined }}>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (cell) onCellClick(person.name, wins[i].key, cell, person.row, person.userId, person.staffRow);
                            }}
                            title={cell ? `${Math.round((h / workWeekHours) * 100)}% · ${fmtHrs(h)}h · ${cell.c} project${cell.c === 1 ? "" : "s"}` : undefined}
                            style={{
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              width: "100%", height: 30, padding: 0, border: "none", cursor: "pointer",
                              background: weekBand.c.bg, color: weekBand.c.text, lineHeight: 1.1,
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.78"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtHrs(h)}</span>
                            <span style={{ fontSize: 8, opacity: 0.85 }}>{cell?.c ?? 0} Proj.</span>
                          </button>
                        </td>
                      );
                    })}
                    <td style={{ position: "sticky", right: 0, zIndex: 4, backgroundColor: CARD, borderLeft: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, padding: 0, textAlign: "center" }}>
                      {personTotalHours(person) > 0 ? (
                        <span style={{ fontSize: 12, fontWeight: 800, color: TEXT, fontVariantNumeric: "tabular-nums" }}>
                          {fmtHrs(personTotalHours(person))}h
                        </span>
                      ) : <span style={{ fontSize: 10, color: FAINT }}>—</span>}
                    </td>
                  </tr>

                  {/* PROJECT SUB-ROWS (phase-colored) */}
                  {open && projRows.length === 0 && (
                    <tr>
                        <td style={{
                          position: "sticky", left: 0, zIndex: 5, backgroundColor: CARD,
                          borderRight: cellBorder, borderBottom: isManagerHierarchy ? undefined : cellBorder,
                          padding: "7px 10px 7px 58px",
                          color: FAINT, fontSize: 10, fontStyle: "italic",
                        }}>
                          {isManagerHierarchy && (
                            <span aria-hidden="true" style={{
                              position: "absolute", left: 18, top: 0, bottom: 0, width: 2,
                              background: `${GREEN}66`, pointerEvents: "none",
                            }} />
                          )}
                          {isManagerHierarchy && (
                            <span aria-hidden="true" style={{
                              position: "absolute", left: 18, right: 0, bottom: 0, height: 1,
                              background: BORDER, pointerEvents: "none",
                            }} />
                          )}
                          No allocation detail for this window
                        </td>
                      <td colSpan={wins.length} style={{ borderRight: cellBorder, borderBottom: cellBorder }} />
                      <td style={{ position: "sticky", right: 0, zIndex: 4, backgroundColor: CARD, borderLeft: cellBorder, borderRight: cellBorder, borderBottom: cellBorder }} />
                    </tr>
                  )}
                  {open && projRows.map(proj => {
                    const displayedHours = proj.hours.map((hours, i) => {
                      const weekMs = wins[i].weekStarts[0] ?? wins[i].startMs;
                      const weekIso = Number.isFinite(weekMs) ? localIsoDay(weekMs) : "";
                      return optimisticWeekOverrides[projectWeekKey(person.key, proj.pid, weekIso)]?.hours ?? hours;
                    });
                    const displayedTotal = Math.round(displayedHours.reduce((sum, hours) => sum + hours, 0) * 10) / 10;
                    const firstIdx = displayedHours.findIndex(h => h > 0);
                    const dotColor = isLeadProject(proj.module, proj.pid)
                      ? PHASE_COLORS["Lead"]
                      : phaseMap
                      ? projectPhaseColor(phaseMap, proj.pid, Date.now()).color
                      : PHASE_COLORS["No Phase"];
                    const displayName = pName?.(proj.pid) ?? proj.name;
                    return (
                      <tr key={proj.pid}>
                        <td style={{
                          position: "sticky", left: 0, zIndex: 5, backgroundColor: CARD,
                          borderRight: cellBorder, borderBottom: isManagerHierarchy ? undefined : cellBorder,
                           padding: isManagerHierarchy ? "6px 10px 6px 64px" : "6px 10px 6px 48px",
                           boxShadow: isManagerHierarchy ? undefined : `inset 3px 0 ${dotColor.bg}`,
                        }}>
                          {isManagerHierarchy && (
                            <span aria-hidden="true" style={{
                              position: "absolute", left: 18, top: 0, bottom: 0, width: 2,
                              background: `${GREEN}66`, pointerEvents: "none",
                            }} />
                          )}
                          {isManagerHierarchy && (
                            <span aria-hidden="true" style={{
                              position: "absolute", left: 18, right: 0, bottom: 0, height: 1,
                              background: BORDER, pointerEvents: "none",
                            }} />
                          )}
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, overflow: "hidden" }}>
                            <span style={{
                              width: 8, height: 8, borderRadius: 3, flexShrink: 0, marginTop: 4,
                              background: dotColor.bg,
                              border: dotColor.outline ? `1px solid ${dotColor.outline}` : "1px solid rgba(0,0,0,0.1)",
                            }} />
                            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                              <div style={{
                                display: "flex", alignItems: "center", gap: 6, minWidth: 0,
                              }}>
                                <span style={{
                                  color: dotColor.bg, fontSize: 10.5, fontWeight: 900,
                                  letterSpacing: 0.15, whiteSpace: "nowrap",
                                  overflow: "hidden", textOverflow: "ellipsis",
                                }}>{proj.pid}</span>
                                {proj.module && (
                                  <span style={{
                                    color: MUTED, fontSize: 8, fontWeight: 800,
                                    letterSpacing: 0.5, textTransform: "uppercase",
                                    flexShrink: 0,
                                  }}>{proj.module}</span>
                                )}
                                {onProjectClick && (
                                  <button
                                    type="button"
                                    title={`Open ${displayName !== proj.pid ? displayName : proj.name} Project Team`}
                                    aria-label={`Open ${displayName !== proj.pid ? displayName : proj.name} Project Team`}
                                    onClick={event => {
                                      event.stopPropagation();
                                      onProjectClick(proj.pid, proj.module);
                                    }}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 3,
                                      marginLeft: 2, padding: 0, border: "none", background: "transparent",
                                      color: "#60A5FA", fontSize: 8.5, fontWeight: 800, cursor: "pointer",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    Open record <ExternalLink size={9} />
                                  </button>
                                )}
                              </div>
                              <div style={{
                                color: TEXT, fontSize: 10.5, fontWeight: 650,
                                maxWidth: "100%", marginTop: 1,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>{displayName !== proj.pid ? displayName : proj.name}</div>
                              {isLeadProject(proj.module, proj.pid) && (
                                <div style={{ color: PHASE_COLORS["Lead"].bg, fontSize: 8.5, fontWeight: 800, marginTop: 2 }}>Lead record</div>
                              )}
                            </div>
                          </div>
                        </td>
                        {displayedHours.map((h, i) => {
                          const hl = i === nowIdx;
                          const weekMs = wins[i].weekStarts[0];
                          const weekIso = Number.isFinite(weekMs) ? localIsoDay(weekMs) : "";
                          const cellKey = projectWeekKey(person.key, proj.pid, weekIso);
                          const editingThis = weekEdit?.personKey === person.key
                            && weekEdit.projectId === proj.pid
                            && weekEdit.week === weekIso;
                          const savingThis = savingWeekKeys.has(cellKey);
                          const isPastLocked = Number.isFinite(weekMs) && pastWeekLocked(proj.pid, weekMs);
                          const isEditable = canEditProjectWeeks && Boolean(onSaveProjectWeek)
                            && mode === "Weekly" && Number.isFinite(weekMs) && !isPastLocked;
                          const draftValue = editingThis ? Number(weekEdit.draft) : NaN;
                          const draftInvalid = editingThis && (
                            weekEdit.draft.trim() === "" ||
                            !Number.isFinite(draftValue) ||
                            draftValue < 0 ||
                            draftValue > MAX_WEEK_HOURS
                          );
                          const pc = phaseMap
                            ? projectPhaseColor(phaseMap, proj.pid, wins[i].weekStarts[0] ?? wins[i].startMs).color
                            : PHASE_COLORS["No Phase"];
                          return (
                            <td key={wins[i].key} style={{ borderRight: cellBorder, borderBottom: cellBorder, padding: 0, background: hl ? HL_CELL : undefined }}>
                              {editingThis ? (
                                <input
                                  autoFocus
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  value={weekEdit.draft}
                                  disabled={savingThis}
                                  aria-label={`${proj.name}, week of ${weekIso}, hours`}
                                  title={draftValue > MAX_WEEK_HOURS ? `${MAX_WEEK_HOURS} hours is the maximum for one week` : "Press Enter to save · Escape to cancel"}
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => setWeekEdit(cur => cur ? { ...cur, draft: e.target.value } : cur)}
                                  onBlur={() => {
                                    if (!draftInvalid && !savingThis) void commitWeekEdit();
                                  }}
                                  onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === "Enter" && !draftInvalid && !savingThis) {
                                      e.preventDefault();
                                      void commitWeekEdit();
                                    } else if (e.key === "Escape" && !savingThis) {
                                      weekCommitRef.current = true;
                                      setWeekEdit(null);
                                      setWeekSaveError(null);
                                    }
                                  }}
                                  style={{
                                    width: "100%", height: 26, boxSizing: "border-box", padding: "0 3px",
                                    border: draftInvalid ? "2px solid #F87171" : `2px solid ${GREEN}`,
                                    background: draftInvalid ? "rgba(248,113,113,0.12)" : CARD,
                                    color: TEXT, textAlign: "center", outline: "none", fontSize: 11,
                                    fontWeight: 800, fontVariantNumeric: "tabular-nums",
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  disabled={!isEditable || savingThis}
                                  onClick={e => {
                                    e.stopPropagation();
                                    beginWeekEdit(person, proj, i, h);
                                  }}
                                  title={isPastLocked
                                    ? "Past-week editing is disabled by your business rules"
                                    : isEditable
                                      ? `Edit ${fmtHrs(h)} hours for this project/week`
                                      : h > 0 ? `${fmtHrs(h)} hours` : undefined}
                                  style={{
                                    width: "100%", height: 26, padding: 0,
                                    background: h > 0 ? pc.bg : "transparent",
                                    border: h > 0 && pc.outline ? `1px solid ${pc.outline}` : "none",
                                    opacity: h > 0 && i === firstIdx ? 0.62 : 1,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: h > 0 ? pc.text : FAINT, fontSize: 11, fontWeight: 700,
                                    fontVariantNumeric: "tabular-nums",
                                    cursor: isEditable ? "text" : "default",
                                  }}
                                >
                                  {h > 0 ? fmtHrs(h) : isEditable ? "—" : ""}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ position: "sticky", right: 0, zIndex: 4, backgroundColor: CARD, borderLeft: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, padding: 0, textAlign: "center" }}>
                          {displayedTotal > 0 ? (
                            <span style={{ fontSize: 10, fontWeight: 700, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                              {fmtHrs(displayedTotal)}h
                            </span>
                          ) : <span style={{ fontSize: 10, color: FAINT }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* WEEK TOTALS */}
            {grandTotal > 0 && (
              <tr>
                <td style={{
                  position: "sticky", left: 0, bottom: hasDemand ? 35 : 0, zIndex: 12, backgroundColor: CARD,
                  backgroundImage: TINT_HEAD, borderTop: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, padding: "5px 8px",
                  fontSize: 10, fontWeight: 800, color: FAINT, letterSpacing: 0.6,
                }}>WEEK TOTALS</td>
                {colTotals.map((tot, i) => (
                  <td key={wins[i].key} style={{
                    position: "sticky", bottom: hasDemand ? 35 : 0, zIndex: 10, borderTop: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, textAlign: "center",
                    backgroundColor: CARD, backgroundImage: TINT_HEAD,
                    fontSize: 10, fontWeight: 800, color: FAINT, fontVariantNumeric: "tabular-nums",
                  }}>{tot > 0 ? (tot >= 1000 ? `${(tot / 1000).toFixed(1)}k` : `${tot}h`) : "—"}</td>
                ))}
                <td style={{
                  position: "sticky", right: 0, bottom: hasDemand ? 35 : 0, zIndex: 12, borderLeft: cellBorder,
                  borderTop: cellBorder, borderRight: cellBorder, borderBottom: cellBorder, textAlign: "center",
                  backgroundColor: CARD, backgroundImage: TINT_HEAD,
                  fontSize: 11, fontWeight: 900, color: TEXT, fontVariantNumeric: "tabular-nums",
                }}>{grandTotal >= 1000 ? `${(grandTotal / 1000).toFixed(1)}k` : `${grandTotal}h`}</td>
              </tr>
            )}

            {/* ALLOCATED DEMAND (FTE) — open positions per week */}
            {hasDemand && (
              <tr>
                <td style={{
                  position: "sticky", left: 0, bottom: 0, zIndex: 14, backgroundColor: "#fffbeb",
                  borderTop: "1px solid #fde68a", borderRight: "1px solid #fde68a", borderBottom: "1px solid #fde68a", padding: "4px 8px",
                }}>
                  <span
                    title="Open-position demand whose dated allocation window overlaps the week. 0.00 means no dated demand in that week."
                    style={{ color: "#92400e", fontSize: 11, fontWeight: 700 }}
                  >Allocated Demand (FTE)</span>
                </td>
                {demandFte.map((d, i) => (
                  <td key={wins[i].key} style={{ position: "sticky", bottom: 0, zIndex: 13, borderTop: "1px solid #fde68a", borderRight: "1px solid #fde68a", borderBottom: "1px solid #fde68a", padding: 0, backgroundColor: "#fef3c7" }}>
                    <div style={{
                      height: 26, background: "#fef3c7",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#92400e", fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                    }} title={`${d.toFixed(2)} FTE open-position demand for ${colLabel(wins[i])}`}>
                      {d.toFixed(2)}
                    </div>
                  </td>
                ))}
                <td style={{ position: "sticky", right: 0, bottom: 0, zIndex: 14, borderTop: "1px solid #fde68a", borderLeft: "1px solid #fde68a", borderRight: "1px solid #fde68a", borderBottom: "1px solid #fde68a", background: "#fef3c7", textAlign: "center", color: "#92400e", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {peakDemandFte > 0 ? `Peak ${peakDemandFte.toFixed(2)}` : "—"}
                </td>
              </tr>
            )}
          </tbody>
           </table>
        </div>
        {/* Keep the existing overlay controls, but anchor them to the weekly
            timeline boundaries instead of the frozen Resource / TOTAL H columns. */}
        <button
          type="button"
          onClick={() => scrollTimeline(-1)}
          aria-label="Show earlier weeks"
          title="Show earlier weeks"
          style={{
            position: "absolute",
            left: timelineOverlay?.left ?? timelineLeftW - 14,
            top: timelineOverlay?.top ?? "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`,
            background: "#E8F5D0", color: "#477A24", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 7px rgba(15,23,42,0.2)", cursor: "pointer",
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => scrollTimeline(1)}
          aria-label="Show later weeks"
          title="Show later weeks"
          style={{
            position: "absolute",
            right: timelineOverlay?.right ?? timelineTotW - 14,
            top: timelineOverlay?.top ?? "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            width: 28, height: 28, borderRadius: "50%", border: `1px solid ${BORDER}`,
            background: GREEN, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 7px rgba(15,23,42,0.2)", cursor: "pointer",
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "7px 14px", borderTop: `1px solid ${BORDER}`,
        backgroundColor: CARD,
      }}>
        <span style={{ fontSize: 10, color: FAINT, fontStyle: "italic" }}>
          {selectedQ} · sorted by total hours · click a row to expand per-project phases
          {canEditProjectWeeks && mode === "Weekly"
            ? " · person totals open details; project/week values edit directly"
            : " · click a cell for the week detail"}
        </span>
        {weekSaveError && (
          <span role="alert" style={{ fontSize: 10, color: "#F87171", fontWeight: 700, textAlign: "right" }}>
            {weekSaveError}
          </span>
        )}
      </div>
    </div>
  );
}
