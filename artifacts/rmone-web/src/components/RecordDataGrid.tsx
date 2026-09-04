import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, GripVertical, Inbox, Sparkles } from "lucide-react";
import { getStoredUser } from "@/lib/api";

const T = {
  panel: "var(--rm-panel)",
  border: "var(--rm-panel-border)",
  text: "var(--rm-text)",
  muted: "var(--rm-text-muted)",
  faint: "var(--rm-text-faint)",
  green: "var(--rm-green)",
};

// Auto-fit ceiling: a single very-long cell can widen its column up to this many
// pixels before it starts to ellipsize, so one outlier never balloons the grid.
const MAX_AUTO_COL = 520;

export interface GridColumn<Row> {
  key: string;
  label: string;
  width?: number | string;
  minWidth?: number;
  align?: "left" | "center" | "right";
  sortValue?: (row: Row) => string | number | null | undefined;
  render?: (row: Row) => ReactNode;
  noSort?: boolean;
  /** Hard ceiling for this column's auto-fit width. Long text columns (Title,
      Client) set this so one verbose value can't widen the whole column —
      the cell ellipsizes instead. Pair with `hoverTitle` so the full text is
      still reachable on mouseover. */
  maxAuto?: number;
  /** Full-text tooltip for the cell (native `title` attr on the td). Use on
      truncating columns so hovering reveals the complete value. */
  hoverTitle?: (row: Row) => string | undefined;
  /** Pin this column to the right edge of the scroll area so it stays
      visible while the rest of the grid scrolls horizontally (actions/AI
      columns). Only a trailing run of stickyRight columns is honored. */
  stickyRight?: boolean;
}

/** Pill badge for record IDs (like the classic RM ONE grid). */
export function IdPill({ id }: { id: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "4px 10px", borderRadius: 8,
      background: "linear-gradient(135deg, var(--rm-green), #578a2e)",
      color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    }}>
      {id}
    </span>
  );
}

/** Tone-colored status chip. */
export function GridChip({ label, color, minW, maxW, title }: { label: string; color: string; minW?: number; maxW?: number; title?: string }) {
  return (
    <span title={title} style={{
      display: "inline-block", padding: "3px 9px", borderRadius: 999,
      backgroundColor: color + "1F", border: `1px solid ${color}55`,
      color, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      // Uniform pill width — status pills line up as one size instead of
      // hugging each label ("Lost" vs "Awarded" vs "Cancelled").
      ...(minW ? { minWidth: minW, textAlign: "center" as const } : {}),
      // Hard cap — long labels clip with an ellipsis INSIDE the pill instead
      // of spilling into the neighbouring column; pass `title` for the full
      // text. min(cap, 100%) also keeps the pill inside its own CELL when the
      // fit-to-page shrink squeezes the column below the cap on small screens.
      ...(maxW ? { maxWidth: `min(${maxW}px, 100%)`, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "middle", boxSizing: "border-box" as const } : {}),
    }}>
      {label}
    </span>
  );
}

/**
 * Bordered count pill — a single number with an outer border + soft tint,
 * used for Total / Open / Active / Closed style count columns.
 * Zero counts render dimmed (and non-interactive even if onClick given).
 */
export function CountPill({
  count, color, onClick, title,
}: {
  count: number;
  color: string;
  onClick?: () => void;
  title?: string;
}) {
  const live = count > 0;
  return (
    <button
      onClick={e => { e.stopPropagation(); if (live && onClick) onClick(); }}
      disabled={!live || !onClick}
      title={live ? title : undefined}
      style={{
        minWidth: 40, padding: "4px 11px", borderRadius: 10,
        border: `1.5px solid ${live ? color + "66" : T.border}`,
        backgroundColor: live ? color + "14" : "transparent",
        color: live ? color : T.faint,
        fontSize: 12, fontWeight: 800, whiteSpace: "nowrap",
        cursor: live && onClick ? "pointer" : "default",
        transition: "background-color 0.12s, box-shadow 0.12s",
      }}
      onMouseEnter={e => { if (live && onClick) { e.currentTarget.style.backgroundColor = color + "2E"; e.currentTarget.style.boxShadow = `0 0 10px ${color}33`; } }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = live ? color + "14" : "transparent"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {count}
    </button>
  );
}

/**
 * Currency (or any metric) with a thin proportional bar underneath —
 * pass frac = value / maxValueInDataset (0..1).
 */
export function ValueBar({
  text, frac, color = "var(--rm-green)",
}: {
  text: ReactNode;
  frac: number;
  color?: string;
}) {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, minWidth: 64, maxWidth: "100%", verticalAlign: "middle" }}>
      <span style={{ fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap" }}>{text}</span>
      <span style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.18)", overflow: "hidden" }}>
        <span style={{
          display: "block", height: "100%", borderRadius: 2,
          width: `${f > 0 ? Math.max(4, f * 100) : 0}%`,
          background: color,
          transition: "width 0.4s ease",
        }} />
      </span>
    </span>
  );
}

/**
 * Compact grid date — "May 15 '26" — short enough to always fit its column
 * without truncation. Use for ALL date columns in data grids app-wide.
 */
export function fmtGridDate(s?: string | null): string {
  if (!s) return "";
  const str = String(s);
  const d = new Date(str.length === 10 ? str + "T00:00:00" : str);
  if (isNaN(d.getTime()) || d.getFullYear() < 1900) return "";
  return `${d.toLocaleDateString("en-US", { month: "short" })} ${d.getDate()} '${String(d.getFullYear()).slice(2)}`;
}

/** Icon-only Sparkles button for the AI grid column — keeps the column narrow. */
export function AiAnalyzeButton({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={title ?? "AI analysis"}
      aria-label={title ?? "AI analysis"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, padding: 0, borderRadius: 999, flexShrink: 0,
        background: "linear-gradient(135deg, rgba(107,165,57,0.15), rgba(169,194,63,0.08))",
        border: "1px solid rgba(107,165,57,0.45)",
        color: "#3a6e10", cursor: "pointer",
        transition: "all 0.12s",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = "linear-gradient(135deg, rgba(107,165,57,0.32), rgba(169,194,63,0.2))";
        e.currentTarget.style.boxShadow = "0 0 12px rgba(107,165,57,0.25)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "linear-gradient(135deg, rgba(107,165,57,0.16), rgba(169,194,63,0.10))";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <Sparkles size={14} />
    </button>
  );
}

/**
 * Clickable org-unit cell (Role / Title / BU / Division / Department).
 * Clicking filters the page to that value — the click never triggers the row's
 * own onRowClick. Renders a dim dash when the value is empty.
 */
export function OrgFilterCell({
  value, onFilter, label,
}: {
  value?: string | null;
  onFilter: (v: string) => void;
  label?: string;
}) {
  const v = (value ?? "").trim();
  if (!v) return <span style={{ color: T.faint }}>—</span>;
  return (
    <button
      className="rm-dg-orglink"
      onClick={e => { e.stopPropagation(); onFilter(v); }}
      title={`Show only ${label ? `${label} ` : ""}"${v}"`}
      style={{
        display: "inline-block", background: "none", border: "none",
        padding: 0, margin: 0, font: "inherit", color: "inherit",
        cursor: "pointer", maxWidth: "100%",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        textAlign: "inherit", verticalAlign: "middle",
        borderBottom: "1px dashed rgba(128,128,128,0.35)",
        transition: "color 0.12s, border-color 0.12s",
      }}
    >
      {v}
    </button>
  );
}

/** Circled allocation badge (red when 0, blue when staffed) — like ALLOC in the classic grid. */
export function AllocBadge({ count, total, openCount }: { count: number; total?: number; openCount?: number }) {
  const color = count > 0 ? "#4B9CD3" : "#F87171";
  const hasOpen = (openCount ?? 0) > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 0,
      borderRadius: 999, border: `1.5px solid ${color}`,
      overflow: "hidden", whiteSpace: "nowrap",
      fontSize: 11, fontWeight: 800,
    }}>
      <span style={{ padding: "3px 7px", color, minWidth: 22, textAlign: "center" }}>
        {total != null ? `${count}/${total}` : count}
      </span>
      {hasOpen && (
        <span style={{
          padding: "3px 7px", color: "#fff", background: "#E87722",
          borderLeft: "1.5px solid #E87722",
        }}>
          {openCount}+
        </span>
      )}
    </span>
  );
}

const PAGE_SIZES = [25, 50, 100, 200];

type SortState = { key: string; dir: "asc" | "desc" } | null;

function gridColumnOrderStorageKey(gridKey: string): string {
  const session = getStoredUser();
  const tenant = encodeURIComponent((session?.tenant ?? "signed-out").trim().toLowerCase());
  const username = encodeURIComponent((session?.username ?? "anonymous").trim().toLowerCase());
  const grid = encodeURIComponent(gridKey.trim().toLowerCase() || "default");
  return `rmone:grid-column-order:${tenant}:${username}:${grid}`;
}

function readGridColumnOrder(storageKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
      : null;
  } catch {
    return null;
  }
}

export function RecordDataGrid<Row>({
  columns: inputColumns, rows, rowKey, onRowClick, onRowHover, onRowHoverEnd, rowStyle, rowClassName, initialSort = null, emptyText = "No records found", maxBodyHeight = "60vh", onPageRowsChange, columnPreferenceKey = "default",
}: {
  columns: GridColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, i: number) => string;
  onRowClick?: (row: Row) => void;
  /** Optional hover callback (e.g. prefetch the record the pointer rests on). */
  onRowHover?: (row: Row) => void;
  /** Fired on mouse-leave so a pending hover prefetch can be cancelled. */
  onRowHoverEnd?: () => void;
  /** Optional per-row style override (e.g. highlight selected-for-compare rows). */
  rowStyle?: (row: Row) => React.CSSProperties | undefined;
  /** Optional per-row extra class (e.g. "rm-dg-row-open" tints rows with open
   *  positions). Unlike rowStyle, this does NOT mark the row as selected. */
  rowClassName?: (row: Row) => string | undefined;
  initialSort?: SortState;
  emptyText?: string;
  maxBodyHeight?: string;
  /** Fires with the rows on the CURRENT page (after sort + pagination), so the
   *  parent can fetch per-row data (e.g. team counts) for exactly what's visible. */
  onPageRowsChange?: (rows: Row[]) => void;
  /** Stable per-grid identity for this user's persistent column order. */
  columnPreferenceKey?: string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [goInput, setGoInput] = useState("");

  // Column drag-resize: user can grab the right edge of any header cell.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const dragInstructionsId = useId();
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [dropTargetColumnKey, setDropTargetColumnKey] = useState<string | null>(null);
  const [columnMoveAnnouncement, setColumnMoveAnnouncement] = useState("");

  const [columnPreferenceStorageKey, setColumnPreferenceStorageKey] = useState(
    () => gridColumnOrderStorageKey(columnPreferenceKey),
  );
  const [savedColumnOrder, setSavedColumnOrder] = useState<string[] | null>(
    () => readGridColumnOrder(gridColumnOrderStorageKey(columnPreferenceKey)),
  );

  useEffect(() => {
    const syncSessionKey = () => {
      const nextKey = gridColumnOrderStorageKey(columnPreferenceKey);
      // Update key + value in one event batch so a mounted grid never renders
      // the previous account's order during an in-app user/tenant switch.
      setColumnPreferenceStorageKey(nextKey);
      setSavedColumnOrder(readGridColumnOrder(nextKey));
    };
    syncSessionKey();
    window.addEventListener("rmone:authChanged", syncSessionKey);
    return () => window.removeEventListener("rmone:authChanged", syncSessionKey);
  }, [columnPreferenceKey]);

  useEffect(() => {
    const load = () => setSavedColumnOrder(readGridColumnOrder(columnPreferenceStorageKey));
    const onStorage = (e: StorageEvent) => {
      if (e.key === columnPreferenceStorageKey) load();
    };
    const onPreferenceChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: unknown }>).detail;
      if (!detail?.key || detail.key === columnPreferenceStorageKey) load();
    };
    load();
    window.addEventListener("storage", onStorage);
    window.addEventListener("rmone:gridColumnOrderChanged", onPreferenceChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("rmone:gridColumnOrderChanged", onPreferenceChanged);
    };
  }, [columnPreferenceStorageKey]);

  const columns = useMemo(() => {
    const byKey = new Map(inputColumns.map(col => [col.key, col]));
    const ordered: GridColumn<Row>[] = [];
    const seen = new Set<string>();
    const append = (col: GridColumn<Row>) => {
      if (seen.has(col.key)) return;
      seen.add(col.key);
      ordered.push(col);
    };
    // Keep known saved columns, dropping fields no longer present in this tab.
    for (const key of savedColumnOrder ?? []) {
      const col = byKey.get(key);
      if (col && !col.stickyRight) append(col);
    }
    // New/admin-added fields retain the source order and appear before the
    // permanently pinned action columns.
    for (const col of inputColumns) {
      if (!col.stickyRight) append(col);
    }
    for (const col of inputColumns) {
      if (col.stickyRight) append(col);
    }
    return ordered;
  }, [inputColumns, savedColumnOrder]);

  const persistColumnOrder = (next: string[]) => {
    setSavedColumnOrder(next);
    try {
      localStorage.setItem(columnPreferenceStorageKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("rmone:gridColumnOrderChanged", {
        detail: { key: columnPreferenceStorageKey },
      }));
    } catch {
      // Keep the current tab usable if browser storage is unavailable.
    }
  };

  const moveColumn = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const from = columns.findIndex(col => col.key === fromKey);
    const to = columns.findIndex(col => col.key === toKey);
    if (from < 0 || to < 0 || columns[from].stickyRight || columns[to].stickyRight) return;
    const next = columns.map(col => col.key);
    const [moved] = next.splice(from, 1);
    // The original target index intentionally means "after" when moving
    // right and "before" when moving left. The header renders the matching
    // left/right insertion marker.
    next.splice(to, 0, moved);
    persistColumnOrder(next);
    const movableCount = columns.filter(col => !col.stickyRight).length;
    const newPosition = next.filter(key => !columns.find(col => col.key === key)?.stickyRight).indexOf(moved) + 1;
    setColumnMoveAnnouncement(
      `${columns[from].label || columns[from].key} column moved to position ${newPosition} of ${movableCount}.`,
    );
  };

  const startColumnDrag = (e: React.DragEvent, col: GridColumn<Row>) => {
    if (col.stickyRight) return;
    setDraggedColumnKey(col.key);
    setDropTargetColumnKey(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", col.key);
  };

  const endColumnDrag = () => {
    setDraggedColumnKey(null);
    setDropTargetColumnKey(null);
  };

  const dragOverColumn = (e: React.DragEvent, col: GridColumn<Row>) => {
    if (!draggedColumnKey || col.stickyRight || draggedColumnKey === col.key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetColumnKey(col.key);
  };

  const dropColumn = (e: React.DragEvent, col: GridColumn<Row>) => {
    e.preventDefault();
    const source = e.dataTransfer.getData("text/plain") || draggedColumnKey;
    if (source) moveColumn(source, col.key);
    endColumnDrag();
  };
  // Auto-fit: measured natural content width per column (see the measurement
  // effect below). Used as a per-column floor so text is never clipped.
  const [contentW, setContentW] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const startResize = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th") as HTMLElement | null;
    resizeRef.current = { key, startX: e.clientX, startW: th?.offsetWidth ?? 120 };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const w = Math.max(56, r.startW + (ev.clientX - r.startX));
      setColWidths(prev => ({ ...prev, [r.key]: w }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => { setPage(1); }, [rows.length, pageSize, sort]);

  /* ---- Fit-to-viewport column sizing ----
     Watch the scroll container's width. When the columns' preferred widths
     exceed the available width, shrink the shrinkable ones proportionally
     down to their floors so the grid fits the screen. Only when even the
     readable floors don't fit does the horizontal scrollbar appear. This is
     important for admin-selected fields: adding columns must reveal them at a
     usable width rather than crushing every column into unreadable slivers.
     User-resized columns are never auto-shrunk. */
  const [availW, setAvailW] = useState(0);
  const layout = useMemo(() => {
    const sum = (a: number[]) => a.reduce((s, w) => s + w, 0);
    const base = columns.map(c => {
      const user = colWidths[c.key];
      if (user != null) return user;
      const content = contentW[c.key] ?? 0;
      let pref: number;
      if (typeof c.width === "number") pref = c.width;
      else if (c.minWidth != null) pref = Math.max(c.minWidth, 140);
      else pref = 120;
      // Never prefer a width narrower than the column's own content.
      return Math.max(pref, content);
    });
    /* Tier 1 floor: the column's own content — shrinking this far never clips
       text. Columns with a maxAuto cap (Title/Client) ellipsize by design and
       expose the full value via hoverTitle, so their floor is their configured
       minimum, not their (capped) content. */
    const floorContent = columns.map((c, i) => {
      if (colWidths[c.key] != null) return base[i];
      const cfgFloor = c.minWidth ?? Math.max(64, Math.round(base[i] * 0.7));
      if (c.maxAuto != null) return Math.min(base[i], cfgFloor);
      const content = contentW[c.key] ?? 0;
      return Math.min(base[i], Math.max(cfgFloor, content));
    });
    let widths = base.slice();
    /* Shrink proportionally to each column's slack above the given floors. */
    const shrinkTo = (floors: number[]) => {
      const need = sum(widths) - availW;
      if (need <= 0) return;
      const slack = widths.map((w, i) => Math.max(0, w - floors[i]));
      const totalSlack = sum(slack);
      if (totalSlack <= 0) return;
      const f = Math.min(1, need / totalSlack);
      widths = widths.map((w, i) => Math.round(w - slack[i] * f));
    };
    if (availW > 0 && sum(widths) > availW) {
      shrinkTo(floorContent);
    } else if (availW > 0 && sum(widths) < availW) {
      /* Leftover width goes to the ELASTIC text columns (the ones defined
         without a fixed width — Title/Client), so the compact data columns
         keep a tight, uniform rhythm instead of ballooning into uneven empty
         gaps. Fit-to-page growth may exceed maxAuto: that cap only guards
         against one verbose VALUE widening the table, and filling the page
         just reveals more of the text. */
      const extra = availW - sum(widths);
      let weights = widths.map((w, i) => {
        const c = columns[i];
        if (colWidths[c.key] != null) return 0;
        return typeof c.width === "number" ? 0 : w;
      });
      if (sum(weights) <= 0) {
        // No elastic columns in this grid — fall back to spreading across
        // all auto-sized columns.
        weights = widths.map((w, i) => (colWidths[columns[i].key] != null ? 0 : w));
      }
      const pool = sum(weights);
      if (pool > 0) widths = widths.map((w, i) => Math.round(w + (extra * weights[i]) / pool));
    }
    const map: Record<string, number> = {};
    columns.forEach((c, i) => { map[c.key] = widths[i]; });
    /* Once selected columns no longer fit at readable widths, demand the
       overflow width immediately. The scroll body's viewport-capped height
       keeps this horizontal scrollbar visible without page-bottom scrolling. */
    const minTableW = sum(floorContent);
    return { widths: map, minTableW };
  }, [columns, colWidths, availW, contentW]);

  /* Right-pinned columns (three-dots / AI): walk the trailing run of
     stickyRight columns and give each its cumulative offset from the right
     edge. The leftmost pinned column carries a soft shadow so pinned cells
     read as "floating" above the scrolled content on narrow screens. */
  const stickyRight = useMemo(() => {
    const offsets: Record<string, number> = {};
    let edgeKey: string | null = null;
    let acc = 0;
    for (let i = columns.length - 1; i >= 0; i--) {
      const c = columns[i];
      if (!c.stickyRight) break;
      offsets[c.key] = acc;
      edgeKey = c.key;
      acc += layout.widths[c.key] ?? 0;
    }
    return { offsets, edgeKey };
  }, [columns, layout]);
  const stickyCellStyle = (key: string): CSSProperties => {
    const off = stickyRight.offsets[key];
    if (off == null) return {};
    return {
      position: "sticky", right: off,
      boxShadow: stickyRight.edgeKey === key ? "-8px 0 10px -8px rgba(0,0,0,0.35)" : undefined,
    };
  };

  /* Fill the viewport: size the scroll body so the grid + pagination footer
     reach the bottom of the window instead of leaving dead space below. */
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = scrollBodyRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      /* real footer height (it can wrap to 2 lines on narrow windows) + its top margin + page bottom padding */
      const footerH = footerRef.current?.offsetHeight ?? 40;
      setFitHeight(Math.max(240, Math.round(window.innerHeight - top - footerH - 18)));
    };
    measure();
    const t = window.setTimeout(measure, 300); /* re-measure after banners/fonts settle */
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [rows.length]);

  /* Track the container's inner width for fit-to-viewport column sizing. */
  useEffect(() => {
    const el = scrollBodyRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setAvailW(prev => (Math.abs(prev - w) > 1 ? w : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Auto-fit columns to their content so text is never clipped. Measure each
     column's TRUE content width with a Range (independent of the cell's box
     width or overflow:hidden), take the max across the header label + the
     visible rows, and feed it back as a per-column floor in the layout memo.
     Columns then shrink only as far as their own content allows; when the sum
     no longer fits the viewport the grid scrolls horizontally instead of
     ellipsizing. Runs after paint and only commits when a width actually
     changed, so it converges in a single pass (no oscillation). */
  const colKeysSig = columns.map(c => c.key).join("|");
  useLayoutEffect(() => {
    const el = scrollBodyRef.current;
    if (!el) return;
    const range = document.createRange();
    const next: Record<string, number> = {};
    for (const c of columns) {
      const key = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(c.key) : c.key;
      const cells = el.querySelectorAll<HTMLElement>(`[data-colkey="${key}"]`);
      if (!cells.length) continue;
      let max = 0;
      /* Sample cap: at 200 rows/page, measuring EVERY cell (and every
         descendant's scrollWidth — each a forced layout read) froze the page
         for seconds. The header plus the first ~40 rows are plenty to size a
         column; DOM order guarantees the header cell comes first. */
      const limit = Math.min(cells.length, 41);
      for (let ci = 0; ci < limit; ci++) {
        const cell = cells[ci];
        range.selectNodeContents(cell);
        let w = range.getBoundingClientRect().width;
        // The Range measures the laid-out (possibly clipped) contents. Renderers
        // that clamp themselves — OrgFilterCell (overflow:hidden + ellipsis),
        // ValueBar (maxWidth:100%) — would otherwise report only their clamped
        // width, so the column would grow a little each interaction instead of
        // fitting its content in one pass. A clamped descendant's scrollWidth
        // reveals its full unclipped content width, so take the larger of the two.
        cell.querySelectorAll<HTMLElement>("*").forEach(kid => {
          if (kid.scrollWidth > w) w = kid.scrollWidth;
        });
        if (w > max) max = w;
      }
      // + horizontal cell padding (24px) + a little breathing room.
      // A column-level maxAuto (Title/Client) beats the global ceiling so
      // long values ellipsize at a professional width instead of stretching
      // the table; the full text stays available via the cell's hoverTitle.
      next[c.key] = Math.min(c.maxAuto ?? MAX_AUTO_COL, Math.max(56, Math.ceil(max) + 34));
    }
    setContentW(prev => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const k of keys) {
        if (Math.abs((prev[k] ?? 0) - (next[k] ?? 0)) > 1) return next;
      }
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, page, pageSize, sort, colKeysSig]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col || !col.sortValue) return rows;
    const sv = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.map((r, i) => ({ r, i })).sort((a, b) => {
      const va = sv(a.r); const vb = sv(b.r);
      const aNull = va == null || va === ""; const bNull = vb == null || vb === "";
      if (aNull && bNull) return a.i - b.i;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir || a.i - b.i;
      }
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir || a.i - b.i;
    }).map(x => x.r);
  }, [rows, sort, columns]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pageCount);
  const slice = sorted.slice((cur - 1) * pageSize, cur * pageSize);

  // Report the current page's rows to the parent. Keyed on the row-key
  // signature so it only fires when the visible set actually changes
  // (page turn, sort, filter) — not on every render. Refs keep an inline
  // callback prop from re-triggering the effect.
  const pageSig = slice.map((r, i) => rowKey(r, i)).join("|");
  const pageRowsRef = useRef(slice);
  pageRowsRef.current = slice;
  const onPageRowsChangeRef = useRef(onPageRowsChange);
  onPageRowsChangeRef.current = onPageRowsChange;
  useEffect(() => {
    onPageRowsChangeRef.current?.(pageRowsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSig]);

  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    const start = Math.max(1, Math.min(cur - 2, pageCount - 4));
    for (let n = start; n <= Math.min(pageCount, start + 4); n++) nums.push(n);
    return nums;
  }, [cur, pageCount]);

  const toggleSort = (col: GridColumn<Row>) => {
    if (col.noSort || !col.sortValue) return;
    setSort(prev => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return null;
    });
  };

  return (
    <div style={{ margin: "0 16px" }}>
      <span id={dragInstructionsId} style={{
        position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
        overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
      }}>
        Drag the handle to reorder this column, or press Alt plus Left Arrow or Right Arrow.
      </span>
      <span aria-live="polite" aria-atomic="true" style={{
        position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
        overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0,
      }}>
        {columnMoveAnnouncement}
      </span>
      <style>{`
        .rm-dg-td { transition: background-color 0.15s, border-color 0.15s, box-shadow 0.15s; }
        .rm-dg-row:hover .rm-dg-td {
          border-color: rgba(107,165,57,0.45);
          background-color: color-mix(in srgb, var(--rm-panel) 94%, #6BA539);
          box-shadow: 0 3px 10px rgba(0,0,0,0.10);
        }
        /* Rows with open positions — orange tint (legend shown above the grid).
         * Placed AFTER the green hover rule so the :hover variant below wins. */
        .rm-dg-row-open .rm-dg-td {
          background-color: rgba(232,119,34,0.10);
          border-color: rgba(232,119,34,0.40);
        }
        .rm-dg-row-open:hover .rm-dg-td {
          background-color: rgba(232,119,34,0.18);
          border-color: rgba(232,119,34,0.55);
          box-shadow: 0 3px 10px rgba(0,0,0,0.10);
        }
        /* Opportunities converted into a project — blue tint so they read as
         * "done / handed off" and stand apart from open (orange) rows. */
        .rm-dg-row-converted .rm-dg-td {
          background-color: rgba(75,156,211,0.12);
          border-color: rgba(75,156,211,0.42);
        }
        .rm-dg-row-converted:hover .rm-dg-td {
          background-color: rgba(75,156,211,0.20);
          border-color: rgba(75,156,211,0.6);
          box-shadow: 0 3px 10px rgba(0,0,0,0.10);
        }
        .rm-dg-row-selected .rm-dg-td {
          background-color: rgba(107,165,57,0.13) !important;
          border-color: rgba(107,165,57,0.5) !important;
          box-shadow: 0 0 0 1px rgba(107,165,57,0.25) !important;
        }
        .rm-dg-row-selected:hover .rm-dg-td {
          background-color: rgba(107,165,57,0.22) !important;
        }
        .rm-dg-th:hover .rm-dg-sorticon { opacity: 1 !important; }
        .rm-dg-th:hover .rm-dg-draghandle { opacity: 0.8 !important; }
        .rm-dg-th-dragging { opacity: 0.45; }
        .rm-dg-th-drop-before::before,
        .rm-dg-th-drop-after::after {
          content: "";
          position: absolute;
          top: 3px;
          bottom: 5px;
          width: 3px;
          border-radius: 3px;
          background: var(--rm-green);
          box-shadow: 0 0 0 1px rgba(107,165,57,0.18);
        }
        .rm-dg-th-drop-before::before { left: 0; }
        .rm-dg-th-drop-after::after { right: 0; }
        .rm-dg-resize:hover { background: rgba(107,165,57,0.45); }
        .rm-dg-orglink:hover { color: #6BA539 !important; border-bottom-color: #6BA539 !important; }
        .rm-dg-scroll { scrollbar-width: thin; scrollbar-color: rgba(107,165,57,0.65) rgba(128,128,128,0.14); }
        .rm-dg-scroll::-webkit-scrollbar { height: 12px; width: 10px; }
        .rm-dg-scroll::-webkit-scrollbar-track { background: rgba(128,128,128,0.14); border-radius: 999px; }
        .rm-dg-scroll::-webkit-scrollbar-thumb {
          background: rgba(107,165,57,0.55); border-radius: 999px;
          border: 2px solid transparent; background-clip: padding-box;
        }
        .rm-dg-scroll::-webkit-scrollbar-thumb:hover { background: rgba(107,165,57,0.85); background-clip: padding-box; }
        .rm-dg-scroll::-webkit-scrollbar-corner { background: transparent; }
      `}</style>

      <div ref={scrollBodyRef} className="rm-dg-scroll" style={{ overflowX: "auto", overflowY: "auto", scrollbarGutter: "stable", height: fitHeight ?? undefined, maxHeight: fitHeight ?? maxBodyHeight }}>
        <table style={{ width: "100%", minWidth: layout.minTableW, borderCollapse: "separate", borderSpacing: "0 4px", tableLayout: "fixed", marginTop: -4 }}>
          <colgroup>
            {columns.map(col => (
              <col key={col.key} style={{ width: layout.widths[col.key] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map(col => {
                const active = sort?.key === col.key;
                const sortable = !col.noSort && !!col.sortValue;
                const sourceIndex = draggedColumnKey == null ? -1 : columns.findIndex(candidate => candidate.key === draggedColumnKey);
                const targetIndex = columns.findIndex(candidate => candidate.key === col.key);
                const dropClass = dropTargetColumnKey !== col.key
                  ? ""
                  : sourceIndex >= 0 && sourceIndex < targetIndex
                    ? " rm-dg-th-drop-after"
                    : " rm-dg-th-drop-before";
                return (
                  <th
                    key={col.key}
                    data-grid-column-key={col.key}
                    className={`rm-dg-th${draggedColumnKey === col.key ? " rm-dg-th-dragging" : ""}${dropClass}`}
                    onClick={() => toggleSort(col)}
                    onDragOver={e => dragOverColumn(e, col)}
                    onDragEnter={e => dragOverColumn(e, col)}
                    onDragLeave={e => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDropTargetColumnKey(current => current === col.key ? null : current);
                      }
                    }}
                    onDrop={e => dropColumn(e, col)}
                    style={{
                      position: "sticky", top: 0, zIndex: stickyRight.offsets[col.key] != null ? 4 : 2,
                      backgroundColor: "var(--rm-bg)",
                      ...stickyCellStyle(col.key),
                      padding: "4px 12px 7px",
                      textAlign: col.align ?? "left",
                      fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8,
                      textTransform: "uppercase",
                      color: active ? T.text : T.muted,
                      cursor: sortable ? "pointer" : "default",
                      userSelect: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: layout.widths[col.key],
                    }}
                  >
                    <span data-colkey={col.key} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      flexDirection: col.align === "right" ? "row-reverse" : "row",
                    }}>
                      {!col.stickyRight && (
                        <span
                          className="rm-dg-draghandle"
                          draggable
                          role="button"
                          tabIndex={0}
                          aria-label={`Move ${col.label || col.key} column`}
                          aria-describedby={dragInstructionsId}
                          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                          title="Drag to reorder column. Alt + Left/Right also moves it."
                          onDragStart={e => startColumnDrag(e, col)}
                          onDragEnd={endColumnDrag}
                          onPointerDown={e => {
                            if (e.pointerType === "mouse") return;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            setDraggedColumnKey(col.key);
                            setDropTargetColumnKey(null);
                          }}
                          onPointerMove={e => {
                            if (e.pointerType === "mouse" || draggedColumnKey !== col.key) return;
                            const targetKey = document.elementFromPoint(e.clientX, e.clientY)
                              ?.closest<HTMLElement>("[data-grid-column-key]")
                              ?.dataset.gridColumnKey;
                            const target = columns.find(candidate => candidate.key === targetKey);
                            if (target && !target.stickyRight && target.key !== col.key) {
                              setDropTargetColumnKey(target.key);
                            }
                          }}
                          onPointerUp={e => {
                            if (e.pointerType === "mouse") return;
                            if (dropTargetColumnKey) moveColumn(col.key, dropTargetColumnKey);
                            endColumnDrag();
                          }}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => {
                            if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const index = columns.findIndex(candidate => candidate.key === col.key);
                            const target = e.key === "ArrowLeft" ? columns[index - 1] : columns[index + 1];
                            if (target && !target.stickyRight) moveColumn(col.key, target.key);
                          }}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 13, marginLeft: -5, color: T.faint,
                            cursor: draggedColumnKey === col.key ? "grabbing" : "grab",
                            opacity: 0.25, flexShrink: 0, touchAction: "none",
                          }}
                        >
                          <GripVertical size={12} />
                        </span>
                      )}
                      {col.label}
                      {sortable && (
                        active
                          ? (sort!.dir === "asc" ? <ChevronUp size={12} color={"#6BA539"} /> : <ChevronDown size={12} color={"#6BA539"} />)
                          : <ChevronsUpDown size={11} className="rm-dg-sorticon" style={{ opacity: 0.35 }} />
                      )}
                    </span>
                    <span
                      className="rm-dg-resize"
                      onMouseDown={e => startResize(e, col.key)}
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: "absolute", top: 0, right: 0, width: 7, height: "100%",
                        cursor: "col-resize", zIndex: 3,
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{
                  padding: "48px 20px", textAlign: "center",
                  backgroundColor: T.panel, border: `1px solid ${T.border}`, borderRadius: 14,
                }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <Inbox size={28} color={T.faint as string} />
                    <span style={{ color: T.muted, fontSize: 13 }}>{emptyText}</span>
                  </div>
                </td>
              </tr>
            ) : slice.map((row, i) => {
              const extra = rowStyle?.(row);
              const isSelected = extra != null;
              const extraClass = rowClassName?.(row);
              return (
              <tr
                key={rowKey(row, i)}
                className={`rm-dg-row${isSelected ? " rm-dg-row-selected" : ""}${extraClass ? ` ${extraClass}` : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                onMouseLeave={onRowHoverEnd}
                style={{ cursor: onRowClick ? "pointer" : "default", ...extra }}
              >
                {columns.map((col, ci) => (
                  <td key={col.key} data-colkey={col.key} className="rm-dg-td" title={
                    // Every plain cell ellipsizes (nowrap below) — surface the
                    // full value on hover even when the column didn't wire an
                    // explicit hoverTitle. Custom-render cells opt in via
                    // hoverTitle (their ReactNode value isn't stringifiable).
                    col.hoverTitle ? col.hoverTitle(row) : !col.render ? (() => {
                      const v = (row as Record<string, unknown>)[col.key];
                      return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;
                    })() : undefined
                  } style={{
                    padding: "6px 12px",
                    fontSize: 12.5, color: T.text,
                    backgroundColor: T.panel,
                    ...stickyCellStyle(col.key),
                    zIndex: stickyRight.offsets[col.key] != null ? 1 : undefined,
                    textAlign: col.align ?? "left",
                    borderTop: `1px solid ${T.border}`,
                    borderBottom: `1px solid ${T.border}`,
                    borderLeft: ci === 0 ? `1px solid ${T.border}` : undefined,
                    borderRight: ci === columns.length - 1 ? `1px solid ${T.border}` : undefined,
                    borderRadius: ci === 0 ? "12px 0 0 12px" : ci === columns.length - 1 ? "0 12px 12px 0" : undefined,
                    // Rows are single-line by policy: nowrap everywhere so no
                    // cell can grow the row to multiple text lines (long text
                    // ellipsizes; full value on mouseover). textOverflow only
                    // on plain-text cells — custom render functions (buttons,
                    // badges, etc.) must not have it or browsers generate a
                    // phantom "..." after the inline-flex content; text-y
                    // custom cells ellipsize their own inner span instead.
                    ...(col.render
                      ? { whiteSpace: "nowrap", overflow: "hidden" }
                      : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }),
                  }}>
                    {col.render ? col.render(row) : (() => {
                      const v = (row as Record<string, unknown>)[col.key];
                      return v == null || v === "" ? <span style={{ color: T.faint }}>—</span> : String(v);
                    })()}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: pagination */}
      <div ref={footerRef} style={{
        display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
        border: `1px solid ${T.border}`, borderRadius: 12,
        backgroundColor: T.panel, flexWrap: "wrap", marginTop: 2,
      }}>
        <span style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>
          Page {cur} of {pageCount} <span style={{ color: T.faint }}>({total.toLocaleString()} item{total === 1 ? "" : "s"})</span>
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={cur <= 1}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: 7, border: `1px solid ${T.border}`,
              backgroundColor: "transparent", color: cur <= 1 ? T.faint : T.text,
              cursor: cur <= 1 ? "default" : "pointer",
            }}
          ><ChevronLeft size={13} /></button>

          {pageNumbers.map(n => (
            <button
              key={n}
              onClick={() => setPage(n)}
              style={{
                minWidth: 26, height: 26, padding: "0 6px", borderRadius: 7,
                border: `1px solid ${n === cur ? T.green : T.border}`,
                backgroundColor: n === cur ? T.green : "transparent",
                color: n === cur ? "#fff" : T.muted,
                fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              }}
            >{n}</button>
          ))}

          <button
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            disabled={cur >= pageCount}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: 7, border: `1px solid ${T.border}`,
              backgroundColor: "transparent", color: cur >= pageCount ? T.faint : T.text,
              cursor: cur >= pageCount ? "default" : "pointer",
            }}
          ><ChevronRight size={13} /></button>

          {/* Go to page */}
          {pageCount > 5 && (
            <form
              onSubmit={e => {
                e.preventDefault();
                const n = parseInt(goInput, 10);
                if (!isNaN(n)) setPage(Math.max(1, Math.min(pageCount, n)));
                setGoInput("");
              }}
              style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}
            >
              <span style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap" }}>Go to</span>
              <input
                type="number" min={1} max={pageCount} value={goInput}
                onChange={e => setGoInput(e.target.value)}
                onBlur={() => {
                  const n = parseInt(goInput, 10);
                  if (!isNaN(n)) setPage(Math.max(1, Math.min(pageCount, n)));
                  setGoInput("");
                }}
                placeholder={String(cur)}
                style={{
                  width: 44, height: 26, borderRadius: 7, border: `1px solid ${T.border}`,
                  backgroundColor: T.panel, color: T.text, fontSize: 11.5, fontWeight: 600,
                  textAlign: "center", outline: "none", padding: "0 4px",
                }}
              />
            </form>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowSizeMenu(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "4px 9px",
              borderRadius: 7, border: `1px solid ${T.border}`, backgroundColor: "transparent",
              color: T.muted, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
            }}
          >
            {pageSize} / page <ChevronDown size={11} />
          </button>
          {showSizeMenu && (
            <>
              <div onClick={() => setShowSizeMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
              <div style={{
                position: "absolute", bottom: "calc(100% + 4px)", right: 0, zIndex: 10,
                backgroundColor: T.panel, border: `1px solid ${T.border}`, borderRadius: 9,
                overflow: "hidden", boxShadow: "0 6px 20px rgba(0,0,0,0.35)", minWidth: 90,
              }}>
                {PAGE_SIZES.map(s => (
                  <button
                    key={s}
                    onClick={() => { setPageSize(s); setShowSizeMenu(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "7px 12px",
                      border: "none", backgroundColor: s === pageSize ? "rgba(107,165,57,0.15)" : "transparent",
                      color: s === pageSize ? "#6BA539" : T.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}
                  >{s} rows</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Segmented Cards | Data Grid toggle, styled like the Grid|Gantt control. */
export function ViewModeToggle({
  mode, onChange, options,
}: {
  mode: string;
  onChange: (m: "cards" | "grid") => void;
  options?: { value: "cards" | "grid"; label: string; icon?: ReactNode }[];
}) {
  const opts = options ?? [
    { value: "grid" as const, label: "Data Grid" },
    { value: "cards" as const, label: "Cards" },
  ];
  return (
    <div style={{
      display: "flex", backgroundColor: T.panel, borderRadius: 10,
      border: `1px solid ${T.border}`, overflow: "hidden", flexShrink: 0,
    }}>
      {opts.map(o => {
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            onClick={() => {
              onChange(o.value);
              if (o.value === "grid") {
                window.dispatchEvent(new CustomEvent("rmone:gridViewActivated"));
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "7px 14px", border: "none",
              backgroundColor: active ? T.green : "transparent",
              color: active ? "#fff" : T.muted,
              fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
