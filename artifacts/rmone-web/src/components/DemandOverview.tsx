/* DemandOverview — merged "Demand Skyline" (weekly bars story) + "Demand Radar"
 * (breakdown command center) rendered at the top of the Resources → Demand tab.
 *
 * Everything here is computed from the REAL open-demand rows returned by
 * GET /resource-demands (DemandItem[]):
 *   • weekly hours  = PctAllocation/100 × workWeekHours (the admin-configured
 *     "hours in a full week" business rule) — the exact inverse of how the
 *     server derives PctAllocation from AllocationHour, so units stay honest.
 *   • hard vs soft  = the row-level SoftAllocation flag (no fabricated split).
 *   • overdue / starting-soon counts reuse the same day-math + admin urgency
 *     window as the DemandCard badges so the numbers always agree with the
 *     card list below.
 * No trends/deltas are shown because there is no demand history snapshot —
 * nothing on this overview is fabricated.
 *
 * INTERACTION MODEL (consistent for every element): clicking a week bar, a
 * donut slice, a project row, a role row/chip or a top-driver row opens ONE
 * shared drill-down panel below the charts listing the exact open positions
 * behind that number. Navigation to a project only happens via the explicit
 * "View project →" link inside the panel — never as a surprise side effect.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell,
  ReferenceLine, Tooltip as RechartsTooltip, PieChart, Pie,
} from "recharts";
import { TriangleAlert, Building2, Briefcase, X, ArrowRight, Activity, Zap, Target, Search, UserPlus } from "lucide-react";
import { getProjectDetails, getProjectTeam, type DemandItem } from "@/lib/api";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { useTheme } from "@/lib/theme";
import { Z } from "@/lib/zLayers";
import { roleQueryMatcher } from "@workspace/role-match";

/* Drill-down table columns (Role, Project ID, Project, Starts, Ends, Weeks,
 * Hours). Role gets the biggest flexible share by default; users can drag a
 * header edge to override any column with an exact px width (double-click
 * resets). The trailing actions column is fixed. */
const DRILL_COL_DEFAULTS = ["minmax(0,2.8fr)", "110px", "minmax(0,1.8fr)", "92px", "92px", "64px", "84px"];
const DRILL_COL_MIN = 56;
const DRILL_COL_MAX = 800;
const DRILL_COL_KEY = "rm.demandDrill.colWidths.v1";

/* 
 * Palette for Recharts (which doesn't support CSS variables in some contexts reliably).
 */
const CHART_PALETTE = {
  dark: {
    green: "#6BA539",
    greenDeep: "#8DC559",
    orange: "#E87722",
    orangeSoft: "#E0975C",
    amber: "#D97706",
    red: "#F87171",
    grid: "rgba(255,255,255,0.06)",
    text: "rgba(255,255,255,0.65)",
    faint: "rgba(255,255,255,0.40)",
    tooltipBg: "#2E4557",
    tooltipBorder: "rgba(255,255,255,0.14)",
    tooltipText: "#FFFFFF",
    cursor: "rgba(255,255,255,0.03)",
    donutColors: ["#6BA539", "#E87722", "#38BDF8", "#A9C23F", "#A78BFA", "#0EA5E9", "#F87171", "#94A3B8"]
  },
  light: {
    green: "#A8D672",
    greenDeep: "#6BA539",
    orange: "#EA580C",
    orangeSoft: "#FDBA74",
    amber: "#D97706",
    red: "#DC2626",
    grid: "rgba(15,25,35,0.08)",
    text: "rgba(15,25,35,0.62)",
    faint: "rgba(15,25,35,0.42)",
    tooltipBg: "#FFFFFF",
    tooltipBorder: "rgba(15,25,35,0.15)",
    tooltipText: "#0F1923",
    cursor: "rgba(0,0,0,0.03)",
    donutColors: ["#A8D672", "#EA580C", "#0284C7", "#8BBF4D", "#7C3AED", "#4F46E5", "#DC2626", "#94A3B8"]
  }
};

/* Date-only strings must parse LOCAL (append T00:00:00) or US timezones shift
 * rows into the previous week; full ISO timestamps pass through unchanged. */
function parseLocal(v?: string | null): Date | null {
  if (!v) return null;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay(); // 0=Sun
  out.setDate(out.getDate() - ((dow + 6) % 7));
  return out;
}

const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type WeekBucket = {
  week: string; startMs: number; total: number; hard: number; soft: number;
  isCurrent: boolean; isPeak: boolean;
};

/* One open position = unique project × role (mirrors the Positions group-by). */
type Position = {
  key: string; ticketId: string; title: string; role: string;
  hrs: number; hard: number; soft: number; weeks: number;
  earliest: number | null; latest: number | null;
  spans: Array<{ s: number; e: number; hrs: number }>;
  /** RA ids of the demand rows behind this position — handed to the
   *  Add Team Member flow so the save consumes THESE exact rows. */
  raIds: number[];
};

type Drill =
  | { kind: "project"; key: string; label: string }
  | { kind: "role"; key: string; label: string }
  | { kind: "otherroles"; key: "otherroles"; label: string }
  | { kind: "week"; key: string; label: string; startMs: number }
  | { kind: "thisweek"; key: "thisweek"; label: string; startMs: number }
  | { kind: "overdue"; key: "overdue"; label: string }
  | { kind: "soon"; key: "soon"; label: string; urgencyDays: number }
  | { kind: "all"; key: "all"; label: string };

function SkylineTooltip({ active, payload, label, palette }: {
  active?: boolean; payload?: Array<{ payload: WeekBucket }>; label?: string; palette: any;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      backgroundColor: palette.tooltipBg, border: `1px solid ${palette.tooltipBorder}`, borderRadius: 10,
      boxShadow: "var(--rm-shadow)", padding: "10px 12px", minWidth: 160,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: palette.tooltipText, marginBottom: 6 }}>
        Week of {label}
        {d.isCurrent && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: palette.greenDeep, backgroundColor: palette.green + "22", padding: "1px 5px", borderRadius: 4 }}>CURRENT</span>}
        {d.isPeak && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: palette.amber, backgroundColor: palette.amber + "22", padding: "1px 5px", borderRadius: 4 }}>PEAK</span>}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: palette.tooltipText, marginBottom: 4 }}>{fmtNum(d.total)} hrs total</div>
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ fontSize: 11, color: palette.text }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, backgroundColor: palette.green, marginRight: 4 }} />
          Hard {fmtNum(d.hard)}h
        </span>
        <span style={{ fontSize: 11, color: palette.text }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, backgroundColor: palette.orange, marginRight: 4 }} />
          Soft {fmtNum(d.soft)}h
        </span>
      </div>
      <div style={{ fontSize: 10, color: palette.faint, marginTop: 6 }}>Click to see the positions behind this week</div>
    </div>
  );
}

// Animated counting number
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = display;
    const end = value;
    const dur = 600;
    const startTime = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const p = Math.min((now - startTime) / dur, 1);
      // easeOutExpo
      const val = start + (end - start) * (1 - Math.pow(2, -10 * p));
      setDisplay(val);
      if (p < 1) frame = requestAnimationFrame(tick);
      else setDisplay(end);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{fmtNum(display)}</>;
}

const WEEK_MS = 7 * 86400000;

export function DemandOverview({ items, onProjectClick, onAddMember }: {
  items: DemandItem[];
  onProjectClick?: (ticketId: string) => void;
  /** Open the Add Team Member workspace prefilled for one open position
   *  (project + role + exact RA ids so the save retires that position). */
  onAddMember?: (pos: { ticketId: string; title: string; role: string; raIds: number[] }) => void;
}) {
  const { mode } = useTheme();
  const palette = CHART_PALETTE[mode];
  const rulesVersion = useBusinessRulesVersion();
  const [drill, setDrill] = useState<Drill | null>(null);
  /* Search box inside the drill-down popup — filters the FULL result set
   * (not just the first 100 rendered rows), so rows beyond the render cap
   * are reachable by typing. Reset whenever a different drill opens. */
  const [drillSearch, setDrillSearch] = useState("");

  /* --- User-resizable drill-table columns --------------------------------
   * Defaults give Role the biggest flexible share (long role names were
   * truncating while the date columns sat half-empty). Users can drag the
   * handle on any header edge to set an exact px width; double-click resets
   * that column. Overrides are a pure UI preference (no app/customer data)
   * persisted per browser. The trailing actions column is not resizable. */
  const [drillColW, setDrillColW] = useState<Record<number, number>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(DRILL_COL_KEY) || "{}") as Record<string, unknown>;
      const out: Record<number, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const idx = Number(k), w = Number(v);
        if (Number.isInteger(idx) && idx >= 0 && idx < DRILL_COL_DEFAULTS.length && Number.isFinite(w)) {
          out[idx] = Math.max(DRILL_COL_MIN, Math.min(DRILL_COL_MAX, Math.round(w)));
        }
      }
      return out;
    } catch { return {}; }
  });
  const persistDrillColW = (next: Record<number, number>) => {
    try { localStorage.setItem(DRILL_COL_KEY, JSON.stringify(next)); } catch { /* best-effort UI pref */ }
  };
  const drillGridCols =
    `${DRILL_COL_DEFAULTS.map((def, i) => (drillColW[i] != null ? `${drillColW[i]}px` : def)).join(" ")} ` +
    (onAddMember ? "252px" : "130px");
  /* The active drag's teardown lives in a ref so unmounting mid-drag (popup
   * closed, route change) still detaches the window listeners and restores
   * the cursor — otherwise they'd leak and fire setState on a dead component. */
  const drillResizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { drillResizeCleanupRef.current?.(); }, []);
  const startDrillColResize = (idx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drillResizeCleanupRef.current?.(); // never stack two drags
    const cell = (e.currentTarget as HTMLElement).parentElement;
    const startW = cell ? cell.getBoundingClientRect().width : 120;
    const startX = e.clientX;
    const prevCursor = document.body.style.cursor;
    let latest: Record<number, number> | null = null;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(DRILL_COL_MIN, Math.min(DRILL_COL_MAX, Math.round(startW + (ev.clientX - startX))));
      setDrillColW(cur => { latest = { ...cur, [idx]: w }; return latest; });
    };
    const finish = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
      document.body.style.cursor = prevCursor;
      drillResizeCleanupRef.current = null;
    };
    const onUp = () => {
      finish();
      if (latest) persistDrillColW(latest);
    };
    drillResizeCleanupRef.current = finish;
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // A mouseup outside the window (e.g. released over another app) never
    // reaches us — treat losing window focus as the end of the drag.
    window.addEventListener("blur", onUp);
  };
  const resetDrillCol = (idx: number) => {
    setDrillColW(cur => {
      const next = { ...cur };
      delete next[idx];
      persistDrillColW(next);
      return next;
    });
  };

  const agg = useMemo(() => {
    const br = getBusinessRules();
    const fullWeek = br.workWeekHours || 40;
    const urgencyDays = br.demandUrgencyDays;
    const weeklyHrs = (d: DemandItem) => ((Number(d.PctAllocation) || 0) / 100) * fullWeek;

    /* 12 forward week buckets starting this week's Monday */
    const mon0 = mondayOf(new Date());
    const buckets: WeekBucket[] = Array.from({ length: 12 }, (_, i) => {
      const s = new Date(mon0); s.setDate(s.getDate() + i * 7);
      return {
        week: s.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        startMs: s.getTime(),
        total: 0, hard: 0, soft: 0, isCurrent: i === 0, isPeak: false,
      };
    });

    /* Aggregates */
    const positions = new Map<string, Position>();
    const projAgg = new Map<string, { title: string; hrs: number }>();
    const roleAgg = new Map<string, { hrs: number; tickets: Set<string> }>();
    let hardTotal = 0, softTotal = 0;

    for (const d of items) {
      const hrs = weeklyHrs(d);
      const s = parseLocal(d.AllocationStartDate);
      const eRaw = parseLocal(d.AllocationEndDate);
      const e = eRaw && s && eRaw.getTime() < s.getTime() ? s : (eRaw ?? s);
      const sMs = s ? s.getTime() : null;
      const eMs = s ? (e ?? s).getTime() + 86400000 - 1 : null;

      /* weekly skyline: add the row's per-week hours to every overlapped bucket */
      if (sMs !== null && eMs !== null) {
        for (const b of buckets) {
          if (sMs <= b.startMs + WEEK_MS - 1 && eMs >= b.startMs) {
            b.total += hrs;
            if (d.SoftAllocation) b.soft += hrs; else b.hard += hrs;
          }
        }
      }

      /* position rollup (project × role) */
      const roleName = (d.Role || "").trim() || "Unspecified";
      const pk = `${d.TicketId}||${roleName}`;
      const pos = positions.get(pk) ?? {
        key: pk, ticketId: d.TicketId, title: d.Title || d.TicketId, role: roleName,
        hrs: 0, hard: 0, soft: 0, weeks: 0, earliest: null, latest: null, spans: [],
        raIds: [],
      };
      pos.hrs += hrs;
      if (d.SoftAllocation) pos.soft += hrs; else pos.hard += hrs;
      pos.weeks += 1;
      const rowRaId = Number(d.RaId);
      if (Number.isInteger(rowRaId) && rowRaId > 0) pos.raIds.push(rowRaId);
      if (sMs !== null && eMs !== null) {
        pos.spans.push({ s: sMs, e: eMs, hrs });
        if (pos.earliest === null || sMs < pos.earliest) pos.earliest = sMs;
        if (pos.latest === null || eMs > pos.latest) pos.latest = eMs;
      }
      positions.set(pk, pos);

      /* totals for drivers / donut / split (whole demand horizon) */
      if (d.SoftAllocation) softTotal += hrs; else hardTotal += hrs;
      const p = projAgg.get(d.TicketId) ?? { title: d.Title || d.TicketId, hrs: 0 };
      p.hrs += hrs; projAgg.set(d.TicketId, p);
      const r = roleAgg.get(roleName) ?? { hrs: 0, tickets: new Set<string>() };
      r.hrs += hrs; r.tickets.add(d.TicketId); roleAgg.set(roleName, r);
    }

    /* peak week */
    let peakIdx = -1, peakVal = 0;
    buckets.forEach((b, i) => { if (b.total > peakVal) { peakVal = b.total; peakIdx = i; } });
    if (peakIdx > 0) buckets[peakIdx].isPeak = true; // current week peak keeps CURRENT styling

    /* urgency counts (unique positions) */
    let overdue = 0, soon = 0;
    const now = Date.now();
    for (const pos of positions.values()) {
      if (pos.earliest === null) continue;
      const days = Math.round((pos.earliest - now) / 86400000);
      if (days < 0) overdue++;
      else if (days <= urgencyDays) soon++;
    }

    /* this-week position count — SAME overlap rule as the this-week drill
       popup (positions with unfilled hours in the current week), so the card
       and the popup it opens can never disagree (user saw "80" on the card
       vs 9 rows in the popup — 80 is the all-time total, shown elsewhere). */
    const ws0 = buckets[0].startMs, we0 = ws0 + WEEK_MS - 1;
    let thisWeekPositions = 0;
    for (const pos of positions.values()) {
      if (pos.spans.some(sp => sp.s <= we0 && sp.e >= ws0 && sp.hrs > 0)) thisWeekPositions++;
    }

    const topProjects = Array.from(projAgg.entries())
      .map(([id, v]) => ({ id, name: v.title, hrs: v.hrs }))
      .sort((a, b) => b.hrs - a.hrs).slice(0, 5);
    const rolesSorted = Array.from(roleAgg.entries())
      .map(([name, v]) => ({ name, hrs: v.hrs, positions: v.tickets.size }))
      .sort((a, b) => b.hrs - a.hrs);
    const donutRoles = rolesSorted.slice(0, 7);
    const otherRoleNames = new Set(rolesSorted.slice(7).map(r => r.name));
    const otherHrs = rolesSorted.slice(7).reduce((s, r) => s + r.hrs, 0);
    const donutData = [
      ...donutRoles.map((r, i) => ({ name: r.name, value: r.hrs, color: palette.donutColors[i % palette.donutColors.length] })),
      ...(otherHrs > 0 ? [{ name: "Other", value: otherHrs, color: mode === "dark" ? "#475569" : "#CBD5E1" }] : []),
    ];

    return {
      buckets, urgencyDays, overdue, soon,
      thisWeekHrs: buckets[0].total,
      thisWeekPositions,
      openPositions: positions.size,
      positionList: Array.from(positions.values()),
      totalHrs: hardTotal + softTotal,
      hardTotal, softTotal,
      topProjects, rolesSorted, donutRoles, donutData, otherRoleNames,
      peakLabel: peakIdx >= 0 && peakVal > 0 ? buckets[peakIdx].week : null,
      peakVal,
    };
  }, [items, rulesVersion, palette, mode]);

  /* Drill-down rows: the open positions behind the clicked element. */
  const drillRows = useMemo(() => {
    if (!drill) return [];
    let rows: Array<Position & { ctxHrs: number }> = [];
    if (drill.kind === "project") {
      rows = agg.positionList
        .filter(p => p.ticketId === drill.key)
        .map(p => ({ ...p, ctxHrs: p.hrs }));
    } else if (drill.kind === "role") {
      rows = agg.positionList
        .filter(p => p.role === drill.key)
        .map(p => ({ ...p, ctxHrs: p.hrs }));
    } else if (drill.kind === "otherroles") {
      /* The donut's combined "Other" slice = every role beyond the top 7. */
      rows = agg.positionList
        .filter(p => agg.otherRoleNames.has(p.role))
        .map(p => ({ ...p, ctxHrs: p.hrs }));
    } else if (drill.kind === "week" || drill.kind === "thisweek") {
      const ws = drill.startMs, we = drill.startMs + WEEK_MS - 1;
      rows = agg.positionList
        .map(p => ({
          ...p,
          ctxHrs: p.spans.reduce((sum, sp) => (sp.s <= we && sp.e >= ws ? sum + sp.hrs : sum), 0),
        }))
        .filter(p => p.ctxHrs > 0);
    } else if (drill.kind === "overdue") {
      const now = Date.now();
      rows = agg.positionList
        .filter(p => p.earliest !== null && p.earliest < now)
        .map(p => ({ ...p, ctxHrs: p.hrs }));
    } else if (drill.kind === "soon") {
      const now = Date.now();
      rows = agg.positionList
        .filter(p => {
          if (p.earliest === null) return false;
          const days = Math.round((p.earliest - now) / 86400000);
          return days >= 0 && days <= drill.urgencyDays;
        })
        .map(p => ({ ...p, ctxHrs: p.hrs }));
    } else if (drill.kind === "all") {
      rows = agg.positionList.map(p => ({ ...p, ctxHrs: p.hrs }));
    }
    return rows.sort((a, b) => b.ctxHrs - a.ctxHrs);
  }, [drill, agg]);

  /* Popup search — filters the FULL drill result set (all rows, including the
   * ones past the 100-row render cap) by role, project name or project ID. */
  const visibleRows = useMemo(() => {
    const q = drillSearch.trim().toLowerCase();
    if (!q) return drillRows;
    // Abbreviation-aware role matching ("PM" ⇄ "Project Manager") via the
    // shared matcher; project name/ID remain plain substring.
    const roleMatch = roleQueryMatcher(q);
    return drillRows.filter(r =>
      roleMatch(r.role) ||
      r.title.toLowerCase().includes(q) ||
      r.ticketId.toLowerCase().includes(q)
    );
  }, [drillRows, drillSearch]);

  /* Opening a different drill starts with a fresh (empty) search. */
  useEffect(() => { setDrillSearch(""); }, [drill]);

  /* Prefetch: the moment a drill panel opens, warm the projects the user is
   * about to click "View project →" on. getProjectDetails/getProjectTeam go
   * through lib/api's in-memory cached() (short TTL + in-flight dedup), so
   * the later page-mount calls reuse these exact results/requests — no
   * duplicate traffic and nothing written to persistent browser storage.
   * Sequential (one project at a time) to avoid a request burst; failures
   * are ignored (pure warm-up — the page load itself still fetches). */
  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!drill) return;
    const ids: string[] = [];
    for (const r of drillRows) {
      if (!r.ticketId || prefetchedRef.current.has(r.ticketId) || ids.includes(r.ticketId)) continue;
      ids.push(r.ticketId);
      if (ids.length >= 6) break;
    }
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const id of ids) {
        if (cancelled) return;
        prefetchedRef.current.add(id);
        // prefetch:true → fills the server cache without enrolling the
        // project in the hot-projects registry (this is not a real open).
        await Promise.allSettled([
          getProjectDetails(id, { prefetch: true }),
          getProjectTeam(id),
        ]);
      }
    })();
    return () => { cancelled = true; };
  }, [drill, drillRows]);

  /* Close the popup on Escape. If the user is mid-search in the search box,
   * the first Escape clears the search; when the search is already empty,
   * Escape closes the popup as usual (even with the box focused). */
  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inInput = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (inInput && drillSearch.trim()) { setDrillSearch(""); return; }
      setDrill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drill, drillSearch]);

  if (items.length === 0) return null;

  const toggleDrill = (next: Drill) =>
    setDrill(prev => (prev && prev.kind === next.kind && prev.key === next.key ? null : next));
  const isActive = (kind: Drill["kind"], key: string) => drill?.kind === kind && drill.key === key;

  const maxProjHrs = agg.topProjects.length > 0 ? agg.topProjects[0].hrs : 1;
  const softPct = agg.totalHrs > 0 ? Math.round((agg.softTotal / agg.totalHrs) * 100) : 0;
  const searching = drillSearch.trim().length > 0;
  const drillTotal = visibleRows.reduce((s, r) => s + r.ctxHrs, 0);

  const cardStyle: React.CSSProperties = {
    backgroundColor: "var(--rm-panel)",
    borderRadius: 16,
    padding: 20,
    border: `1px solid var(--rm-panel-border)`,
    boxShadow: "var(--rm-shadow)",
    position: "relative",
    overflow: "hidden"
  };

  const activeRowStyle = (active: boolean): React.CSSProperties => active
    ? { backgroundColor: "var(--rm-green-soft)", borderRadius: 8, margin: "0 -8px", padding: "6px 8px" }
    : { padding: "6px 8px", margin: "0 -8px", transition: "background-color 0.2s" };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ duration: 0.5, staggerChildren: 0.1 }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* ─── SKYLINE — weekly bars story ─────────────────────────────── */}
      <motion.div style={cardStyle} layoutId="skyline">
        {/* Glow effect in top corner */}
        <div style={{ position: "absolute", top: -100, right: -100, width: 300, height: 300, background: "radial-gradient(circle, var(--rm-green-soft) 0%, transparent 70%)", opacity: 0.6, pointerEvents: "none" }} />
        
        {/* Hero strip: this-week stat | urgent panel | top drivers */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16, marginBottom: 20, position: "relative", zIndex: 1 }}>
          {/* This Week — click opens current-week popup */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => toggleDrill({ kind: "thisweek", key: "thisweek", label: `This Week (${agg.buckets[0]?.week ?? ""})`, startMs: agg.buckets[0]?.startMs ?? 0 })}
            title="See all open positions active this week"
            style={{ 
              display: "flex", flexDirection: "column", justifyContent: "center", cursor: "pointer", 
              borderRadius: 12, padding: "12px 16px", transition: "all 0.2s ease-out", 
              backgroundColor: isActive("thisweek", "thisweek") ? "var(--rm-green-soft)" : "var(--rm-panel-soft)",
              border: `1px solid ${isActive("thisweek", "thisweek") ? "var(--rm-green)" : "transparent"}`
            }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--rm-text-faint)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Zap size={14} color="var(--rm-green)" /> This Week
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 32, fontWeight: 900, color: "var(--rm-text)", lineHeight: 1, letterSpacing: "-0.02em" }}>
                <AnimatedNumber value={agg.thisWeekHrs} />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--rm-text-muted)" }}>unfilled hours</span>
            </div>
            {/* Week-scoped count — matches the popup this card opens. The
                all-time total (agg.openPositions) lives on the orange "open"
                tile and the donut center, NOT under a "This Week" heading. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleDrill({ kind: "thisweek", key: "thisweek", label: `This Week (${agg.buckets[0]?.week ?? ""})`, startMs: agg.buckets[0]?.startMs ?? 0 });
              }}
              title="See the open positions with unfilled hours this week"
              style={{
                display: "flex", alignItems: "center", gap: 6, marginTop: 10,
                background: "none", border: "none", padding: "2px 4px", margin: "8px -4px 0", borderRadius: 6,
                cursor: "pointer", transition: "background-color 0.15s",
              }}
              className="hover:bg-[var(--rm-panel-hover)]"
            >
              <Briefcase size={13} color="var(--rm-text-faint)" />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--rm-text-muted)" }}><AnimatedNumber value={agg.thisWeekPositions} /> open position{agg.thisWeekPositions !== 1 ? "s" : ""} this week</span>
            </button>
          </motion.div>

          {/* Urgent Action Needed — overdue and soon as separate clickable tiles */}
          <div style={{
            borderRadius: 12, border: `1px solid var(--rm-ink-red)`, padding: "14px 16px",
            backgroundColor: mode === "dark" ? "rgba(248, 113, 113, 0.08)" : "#FEF6F5", display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--rm-ink-red)", fontWeight: 700, fontSize: 12, letterSpacing: 0.5 }}>
              <TriangleAlert size={16} /> URGENT ACTION
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {/* Overdue tile */}
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => toggleDrill({ kind: "overdue", key: "overdue", label: "Overdue Positions" })}
                title="See positions whose start date has already passed"
                style={{
                  flex: 1, borderRadius: 10, padding: "10px 12px", cursor: "pointer",
                  backgroundColor: isActive("overdue", "overdue") ? "var(--rm-ink-red)" : "var(--rm-panel)",
                  color: isActive("overdue", "overdue") ? "#FFF" : "var(--rm-ink-red)",
                  border: `1px solid ${isActive("overdue", "overdue") ? "transparent" : "rgba(248, 113, 113, 0.3)"}`,
                  boxShadow: isActive("overdue", "overdue") ? "0 4px 12px rgba(248, 113, 113, 0.3)" : "none",
                  transition: "all 0.2s ease-out",
                }}>
                <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>
                  <AnimatedNumber value={agg.overdue} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4, opacity: 0.9 }}>overdue</div>
              </motion.div>
              {/* All open tile */}
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => toggleDrill({ kind: "all", key: "all", label: "All Open Positions" })}
                title="See all open demand positions"
                style={{
                  flex: 1, borderRadius: 10, padding: "10px 12px", cursor: "pointer",
                  backgroundColor: isActive("all", "all") ? "var(--rm-ink-orange)" : "var(--rm-panel)",
                  color: isActive("all", "all") ? "#FFF" : "var(--rm-ink-orange)",
                  border: `1px solid ${isActive("all", "all") ? "transparent" : "rgba(251, 146, 60, 0.3)"}`,
                  boxShadow: isActive("all", "all") ? "0 4px 12px rgba(251, 146, 60, 0.3)" : "none",
                  transition: "all 0.2s ease-out",
                }}>
                <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>
                  <AnimatedNumber value={agg.openPositions} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4, opacity: 0.9 }}>open</div>
              </motion.div>
            </div>
          </div>

          <div style={{ borderRadius: 12, border: `1px solid var(--rm-panel-border)`, padding: "14px 16px", backgroundColor: "var(--rm-panel-soft)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--rm-text-faint)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Target size={14} /> Top Drivers
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {agg.topProjects[0] && (
                <div className="hover:bg-[var(--rm-panel-hover)]" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8, ...activeRowStyle(isActive("project", agg.topProjects[0].id)) }}
                  title="See the open positions on this project"
                  onClick={() => toggleDrill({ kind: "project", key: agg.topProjects[0].id, label: agg.topProjects[0].name })}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{ background: "var(--rm-panel)", padding: 4, borderRadius: 6, border: "1px solid var(--rm-panel-border)" }}>
                      <Building2 size={12} color="var(--rm-text-muted)" />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agg.topProjects[0].name}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--rm-text)", flexShrink: 0 }}>{fmtNum(agg.topProjects[0].hrs)}h</span>
                </div>
              )}
              {agg.rolesSorted[0] && (
                <div className="hover:bg-[var(--rm-panel-hover)]" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8, ...activeRowStyle(isActive("role", agg.rolesSorted[0].name)) }}
                  title="See the open positions for this role"
                  onClick={() => toggleDrill({ kind: "role", key: agg.rolesSorted[0].name, label: agg.rolesSorted[0].name })}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{ background: "var(--rm-panel)", padding: 4, borderRadius: 6, border: "1px solid var(--rm-panel-border)" }}>
                      <Briefcase size={12} color="var(--rm-text-muted)" />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agg.rolesSorted[0].name}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--rm-text)", flexShrink: 0 }}>{fmtNum(agg.rolesSorted[0].hrs)}h</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chart header + legend */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--rm-text)", display: "flex", alignItems: "center", gap: 8 }}>
              <Activity size={18} color="var(--rm-green)" /> Demand Skyline
            </div>
            <div style={{ fontSize: 13, color: "var(--rm-text-muted)", marginTop: 4 }}>12-week forward view of unfilled hours — click a week to see its positions</div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--rm-text-muted)" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: palette.green, boxShadow: `0 0 8px ${palette.green}40` }} /> Hard demand
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--rm-text-muted)" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: palette.orangeSoft }} /> Soft demand
            </span>
          </div>
        </div>

        <div style={{ width: "100%", height: 260, cursor: "pointer", position: "relative", zIndex: 2 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agg.buckets} margin={{ top: 26, right: 4, left: -12, bottom: 0 }} barCategoryGap="20%"
              onClick={(state) => {
                const label = state?.activeLabel;
                if (!label) return;
                const b = agg.buckets.find(x => x.week === label);
                if (b) toggleDrill({ kind: "week", key: b.week, label: `Week of ${b.week}`, startMs: b.startMs });
              }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
              <XAxis dataKey="week" axisLine={false} tickLine={false}
                tick={{ fill: palette.text, fontSize: 12, fontWeight: 600 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: palette.faint, fontSize: 12 }} />
              <RechartsTooltip content={<SkylineTooltip palette={palette} />} cursor={{ fill: palette.cursor }} />
              {agg.peakLabel && (
                <ReferenceLine x={agg.peakLabel} stroke={palette.amber} strokeDasharray="4 4"
                  label={{ position: "top", value: `Peak: ${fmtNum(agg.peakVal)} hrs`, fill: palette.amber, fontSize: 12, fontWeight: 700 }} />
              )}
              <Bar dataKey="hard" stackId="a" radius={[0, 0, 4, 4]}>
                {agg.buckets.map((b, i) => (
                  <Cell key={`h-${i}`}
                    fill={b.isCurrent ? palette.greenDeep : b.isPeak ? palette.amber : palette.green}
                    opacity={drill?.kind === "week" && drill.key !== b.week ? 0.3 : 1}
                    style={{ transition: "opacity 0.2s, fill 0.2s" }} />
                ))}
              </Bar>
              <Bar dataKey="soft" stackId="a" radius={[4, 4, 0, 0]}>
                {agg.buckets.map((b, i) => (
                  <Cell key={`s-${i}`}
                    fill={b.isCurrent ? palette.orange : b.isPeak ? "#F0B429" : palette.orangeSoft}
                    opacity={drill?.kind === "week" && drill.key !== b.week ? 0.3 : 1}
                    style={{ transition: "opacity 0.2s, fill 0.2s" }} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top roles in demand — horizontal bar chart */}
        {agg.rolesSorted.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid var(--rm-panel-border)` }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--rm-text-faint)" }}>
              Top roles in demand
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
              {(() => {
                const top = agg.rolesSorted.slice(0, 7);
                const maxHrs = top[0]?.hrs ?? 1;
                return top.map(r => {
                  const active = isActive("role", r.name);
                  const pct = Math.max(4, Math.round((r.hrs / maxHrs) * 100));
                  return (
                    <motion.button
                      key={r.name}
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => toggleDrill({ kind: "role", key: r.name, label: r.name })}
                      title="See the open positions for this role"
                      style={{
                        display: "grid", gridTemplateColumns: "180px 1fr auto",
                        alignItems: "center", gap: 10,
                        background: "none", border: "none", cursor: "pointer", padding: "2px 0",
                        borderRadius: 6, textAlign: "left",
                      }}>
                      <span style={{
                        fontSize: 12, fontWeight: active ? 700 : 600,
                        color: active ? "var(--rm-green)" : "var(--rm-text)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        transition: "color 0.15s",
                      }}>{r.name}</span>
                      <div style={{ height: 8, borderRadius: 999, background: "var(--rm-panel-soft)", overflow: "hidden" }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                          style={{
                            height: "100%", borderRadius: 999,
                            background: active
                              ? "linear-gradient(90deg, var(--rm-green) 0%, var(--rm-green-soft) 100%)"
                              : `linear-gradient(90deg, ${palette.green} 0%, ${palette.greenDeep} 100%)`,
                            boxShadow: active ? "0 0 6px var(--rm-green-soft)" : "none",
                            transition: "background 0.2s, box-shadow 0.2s",
                          }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: active ? "var(--rm-green)" : "var(--rm-text-muted)", whiteSpace: "nowrap", minWidth: 70, textAlign: "right" }}>
                        {fmtNum(r.hrs)}h
                        <span style={{ fontWeight: 500, color: "var(--rm-text-faint)", marginLeft: 4 }}>({r.positions})</span>
                      </span>
                    </motion.button>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </motion.div>

      {/* ─── BREAKDOWN COMMAND CENTER — projects | donut | roles ─────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr 1fr", gap: 16, alignItems: "stretch" }}>

        {/* Top projects leaderboard */}
        <motion.div style={{...cardStyle, display: "flex", flexDirection: "column"}} layoutId="projects">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <div style={{ background: "var(--rm-panel-soft)", padding: 6, borderRadius: 8 }}>
              <Building2 size={16} color="var(--rm-text-muted)" />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)" }}>Projects Driving Demand</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1, justifyContent: "center" }}>
            {agg.topProjects.map((p, i) => {
              const active = isActive("project", p.id);
              return (
                <motion.div key={p.id} 
                  whileHover={{ x: 4 }}
                  onClick={() => toggleDrill({ kind: "project", key: p.id, label: p.name })}
                  title="See the open positions on this project"
                  style={{ cursor: "pointer", borderRadius: 8, ...activeRowStyle(active) }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--rm-text)", flexShrink: 0 }}>{fmtNum(p.hrs)}h</span>
                  </div>
                  <div style={{ height: 8, width: "100%", backgroundColor: "var(--rm-panel-soft)", borderRadius: 999, overflow: "hidden", border: "1px solid var(--rm-panel-border)" }}>
                    <motion.div
                      style={{ height: "100%", backgroundColor: active ? "var(--rm-green)" : "var(--rm-text-muted)", borderRadius: 999 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, (p.hrs / maxProjHrs) * 100)}%` }}
                      transition={{ duration: 1, delay: i * 0.1, type: "spring", stiffness: 50 }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Demand-by-role donut */}
        <motion.div style={{ ...cardStyle, position: "relative", display: "flex", flexDirection: "column" }} layoutId="donut">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ background: "var(--rm-panel-soft)", padding: 6, borderRadius: 8 }}>
              <Briefcase size={16} color="var(--rm-text-muted)" />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)" }}>Demand by Role</span>
          </div>
          <div style={{ flex: 1, position: "relative", minHeight: 280, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={agg.donutData} cx="50%" cy="50%" innerRadius="68%" outerRadius="88%"
                  paddingAngle={3} dataKey="value" stroke="none">
                  {agg.donutData.map((e, i) => (
                    <Cell key={`c-${i}`} fill={e.color}
                      cursor="pointer"
                      opacity={
                        (drill?.kind === "role" && drill.key !== e.name) ||
                        (drill?.kind === "otherroles" && e.name !== "Other")
                          ? 0.25 : 1
                      }
                      style={{ transition: "opacity 0.2s", filter: `drop-shadow(0 0 4px ${e.color}40)` }}
                      onClick={() => {
                        if (!e.name) return;
                        if (e.name === "Other") {
                          toggleDrill({ kind: "otherroles", key: "otherroles", label: "Other Roles" });
                        } else {
                          toggleDrill({ kind: "role", key: e.name, label: e.name });
                        }
                      }} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(v: number | string, name: string) => [`${fmtNum(Number(v))} hrs`, name]}
                  contentStyle={{ 
                    backgroundColor: palette.tooltipBg, 
                    borderRadius: 12, 
                    border: `1px solid ${palette.tooltipBorder}`, 
                    boxShadow: "var(--rm-shadow)", 
                    fontSize: 13,
                    color: palette.tooltipText,
                    fontWeight: 600
                  }} 
                  itemStyle={{ color: palette.tooltipText }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", pointerEvents: "none",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--rm-text-faint)" }}>Total Demand</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: "var(--rm-text)", lineHeight: 1.15, marginTop: 4 }}>
                <AnimatedNumber value={agg.totalHrs} /><span style={{ fontSize: 18, fontWeight: 700, color: "var(--rm-text-muted)" }}>h</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--rm-text-muted)", marginTop: 4 }}>{agg.openPositions} open position{agg.openPositions !== 1 ? "s" : ""}</div>
            </div>
          </div>
        </motion.div>

        {/* Role breakdown legend + hard/soft split */}
        <motion.div style={{...cardStyle, display: "flex", flexDirection: "column"}} layoutId="roles">
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--rm-text)", marginBottom: 16 }}>Role Breakdown</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            {agg.donutRoles.map((r, i) => {
              const active = isActive("role", r.name);
              return (
                <div key={r.name} onClick={() => toggleDrill({ kind: "role", key: r.name, label: r.name })}
                  className="hover:bg-[var(--rm-panel-hover)]"
                  title="See the open positions for this role"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 8, ...activeRowStyle(active) }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: palette.donutColors[i % palette.donutColors.length], flexShrink: 0, boxShadow: `0 0 6px ${palette.donutColors[i % palette.donutColors.length]}80` }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--rm-text-faint)", fontWeight: 600 }}>{r.positions} pos</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--rm-text)", minWidth: 44, textAlign: "right" }}>{fmtNum(r.hrs)}h</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid var(--rm-panel-border)` }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--rm-text-muted)", marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
              <span>Demand Type</span>
              <span>{100 - softPct}% / {softPct}%</span>
            </div>
            <div style={{ display: "flex", height: 12, width: "100%", borderRadius: 999, overflow: "hidden", backgroundColor: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)" }}>
              {agg.hardTotal > 0 && <motion.div initial={{width: 0}} animate={{width: `${100 - softPct}%`}} transition={{duration: 1, delay: 0.2}} style={{ backgroundColor: "var(--rm-green)" }} title={`Hard (${100 - softPct}%)`} />}
              {agg.softTotal > 0 && <motion.div initial={{width: 0}} animate={{width: `${softPct}%`}} transition={{duration: 1, delay: 0.2}} style={{ backgroundColor: "var(--rm-ink-orange)" }} title={`Soft (${softPct}%)`} />}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--rm-green)", letterSpacing: 0.5 }}>HARD DEMAND</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--rm-ink-orange)", letterSpacing: 0.5 }}>SOFT DEMAND</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ─── DRILL-DOWN POPUP — the positions behind whatever was clicked ── */}
      <AnimatePresence>
        {drill && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrill(null)}
            style={{
              position: "fixed", inset: 0, zIndex: Z.MODAL,
              backgroundColor: "rgba(15, 27, 36, 0.7)", backdropFilter: "blur(6px)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
            }}>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()} 
            style={{
              backgroundColor: "var(--rm-panel)", border: `1px solid var(--rm-panel-border)`, 
              borderRadius: 20, width: "min(1080px, 94vw)",
              maxHeight: "85vh", display: "flex", flexDirection: "column",
              boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset",
              overflow: "hidden"
            }}>
            
            <div style={{ padding: "24px 32px", borderBottom: "1px solid var(--rm-panel-border)", background: "linear-gradient(to bottom, var(--rm-panel-soft), var(--rm-panel))", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ background: "var(--rm-green-soft)", padding: "4px 8px", borderRadius: 6, color: "var(--rm-green)", fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase" }}>
                    {drill.kind === "project" ? "Project demand" : drill.kind === "role" || drill.kind === "otherroles" ? "Role demand" : drill.kind === "overdue" || drill.kind === "soon" ? "Urgent action" : drill.kind === "all" ? "All open positions" : "Weekly demand"}
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "var(--rm-text)", letterSpacing: "-0.01em" }}>{drill.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--rm-text-muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--rm-text)" }}>{visibleRows.length}</span>
                  {searching ? <> of {drillRows.length} open position{drillRows.length !== 1 ? "s" : ""} match</> : <> open position{visibleRows.length !== 1 ? "s" : ""}</>}
                  <span style={{ opacity: 0.3 }}>•</span> 
                  <span style={{ color: "var(--rm-text)" }}>{fmtNum(drillTotal)}</span> unfilled hrs
                  {searching ? " in matches" : drill.kind === "week" ? " in this week" : " total"}
                </div>
              </div>
              <button onClick={() => setDrill(null)} title="Close" className="hover:bg-[var(--rm-panel-hover)]"
                style={{ background: "var(--rm-panel-soft)", border: `1px solid var(--rm-panel-border)`, borderRadius: 10, padding: 8, cursor: "pointer", color: "var(--rm-text-muted)", display: "flex", transition: "all 0.2s" }}>
                <X size={18} />
              </button>
            </div>

            {drillRows.length === 0 ? (
              <div style={{ fontSize: 14, color: "var(--rm-text-muted)", padding: "32px", textAlign: "center", fontWeight: 600 }}>No open positions found for this selection.</div>
            ) : (
              <>
                {/* Search — filters the FULL list (every page of results),
                    matching role, project name or project ID. */}
                <div style={{ padding: "12px 32px", borderBottom: "1px solid var(--rm-panel-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, background: "var(--rm-panel-soft)" }}>
                  <Search size={16} color="var(--rm-text-faint)" style={{ flexShrink: 0 }} />
                  <input
                    autoFocus
                    value={drillSearch}
                    onChange={(e) => setDrillSearch(e.target.value)}
                    placeholder="Search by role, project name or project ID…"
                    style={{
                      flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                      color: "var(--rm-text)", fontSize: 14, fontWeight: 600, padding: "6px 0",
                    }}
                  />
                  {searching && (
                    <button onClick={() => setDrillSearch("")} title="Clear search"
                      style={{ background: "var(--rm-panel)", border: `1px solid var(--rm-panel-border)`, borderRadius: 8, padding: "4px 6px", cursor: "pointer", color: "var(--rm-text-muted)", display: "flex" }}>
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* overflowX lets widened columns scroll sideways instead of
                    squashing the rest of the table. */}
                <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "auto", minHeight: 0, padding: "0 16px 16px 16px" }}>
                {visibleRows.length === 0 ? (
                  <div style={{ fontSize: 14, color: "var(--rm-text-muted)", padding: "32px", textAlign: "center", fontWeight: 600 }}>
                    No positions match "{drillSearch.trim()}".
                  </div>
                ) : (
                <>
                {/* header row — each column edge is a drag handle so users can
                    size columns to their liking (double-click a handle resets
                    that column to its default width). */}
                <div style={{
                  display: "grid", gridTemplateColumns: drillGridCols,
                  gap: 16, padding: "16px 16px 12px 16px", borderBottom: `1px solid var(--rm-panel-border)`,
                  position: "sticky", top: 0, backgroundColor: "var(--rm-panel)", zIndex: 1,
                  backdropFilter: "blur(10px)"
                }}>
                  {["Role needed", "Project ID", "Project", "Starts", "Ends", "Weeks", drill.kind === "week" ? "Hrs (wk)" : "Hours"].map((label, ci) => (
                    <span key={ci} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: ci >= 5 ? "flex-end" : "flex-start", minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "var(--rm-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {label}
                      </span>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${label} column`}
                        title="Drag to resize · double-click to reset"
                        onMouseDown={startDrillColResize(ci)}
                        onDoubleClick={() => resetDrillCol(ci)}
                        style={{
                          position: "absolute", right: -13, top: -8, bottom: -8, width: 12,
                          cursor: "col-resize", display: "flex", alignItems: "stretch",
                          justifyContent: "center", zIndex: 2,
                        }}
                      >
                        <span style={{ width: 2, borderRadius: 2, background: "var(--rm-panel-border)", margin: "4px 0" }} />
                      </span>
                    </span>
                  ))}
                  <span />
                </div>
                
                <div style={{ padding: "8px 0" }}>
                  {visibleRows.slice(0, 100).map((r, i) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      transition={{ delay: Math.min(i * 0.03, 0.5) }}
                      key={r.key} className="hover:bg-[rgba(169,194,63,0.07)]" style={{
                      display: "grid", gridTemplateColumns: drillGridCols,
                      gap: 16, padding: "14px 16px", alignItems: "center", borderBottom: `1px solid var(--rm-panel-border)`,
                      borderRadius: 8, transition: "background-color 0.15s"
                    }}>
                       <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                         <span title={r.role} aria-label={`Role needed: ${r.role}`} style={{ fontSize: 14, fontWeight: 700, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.role}</span>
                        {r.soft > 0 && r.hard === 0 && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--rm-ink-orange)", backgroundColor: mode === "dark" ? "rgba(234, 88, 12, 0.15)" : "#FFEDD5", padding: "2px 8px", borderRadius: 6, flexShrink: 0, letterSpacing: 0.5 }}>SOFT</span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--rm-text-muted)", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.ticketId}>{r.ticketId}</span>
                       <span title={r.title} aria-label={`Project: ${r.title}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                      <span style={{ fontSize: 13, color: "var(--rm-text-muted)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.earliest !== null ? fmtDate(r.earliest) : undefined}>{r.earliest !== null ? fmtDate(r.earliest) : "—"}</span>
                      <span style={{ fontSize: 13, color: "var(--rm-text-muted)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.latest !== null ? fmtDate(r.latest) : undefined}>{r.latest !== null ? fmtDate(r.latest) : "—"}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text)", textAlign: "right" }}>{r.weeks}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "var(--rm-text)", textAlign: "right" }}>{fmtNum(r.ctxHrs)}<span style={{ fontSize: 11, color: "var(--rm-text-faint)", fontWeight: 600, marginLeft: 2 }}>h</span></span>
                      
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        {onAddMember && (
                          <button
                            onClick={() => {
                              setDrill(null);
                              onAddMember({
                                ticketId: r.ticketId,
                                title: r.title,
                                // "Unspecified" is a display filler, not a real
                                // role — do not prefill the picker with it.
                                role: r.role === "Unspecified" ? "" : r.role,
                                raIds: r.raIds,
                              });
                            }}
                            className="hover:brightness-110"
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              fontSize: 12, fontWeight: 700,
                              color: "#fff", backgroundColor: "var(--rm-green)",
                              border: "1px solid var(--rm-green)",
                              padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                              transition: "all 0.2s", whiteSpace: "nowrap",
                            }}>
                            <UserPlus size={14} /> Add member
                          </button>
                        )}
                        {onProjectClick && (
                          <button onClick={() => { setDrill(null); onProjectClick(r.ticketId); }}
                            className="hover:bg-[var(--rm-green)] hover:text-white"
                            style={{ 
                              display: "flex", alignItems: "center", gap: 6, 
                              fontSize: 12, fontWeight: 700, 
                              color: "var(--rm-green)", border: "1px solid var(--rm-green)", 
                              padding: "6px 12px", borderRadius: 6, cursor: "pointer", 
                              transition: "all 0.2s" 
                            }}>
                            View project <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
                {visibleRows.length > 100 && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--rm-text-faint)", textAlign: "center", padding: "16px 0", fontStyle: "italic" }}>
                    + {visibleRows.length - 100} more positions (list shows the first 100) — type in the search above to narrow the list
                  </div>
                )}
                </>
                )}
                </div>
              </>
            )}
          </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}