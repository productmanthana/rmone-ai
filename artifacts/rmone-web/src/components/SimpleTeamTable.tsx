// ─────────────────────────────────────────────────────────────────────────────
// SimpleTeamTable — polished members table for the "no weekly grid" display
// modes ("no-schedule-no-grid" and "schedule-no-grid").
//
// Fully theme-aware (light + dark) — uses CSS vars only for surfaces. Date
// chips are colored by the record's PHASE windows (same palette + order as
// the phase-card strip above the table); records without dated phases fall
// back to a fixed per-period rotation (teal/blue/purple…).
// Table-layout is fixed so it always fits within the section card without a
// page-level horizontal scrollbar. Headers are click-to-sort (asc → desc →
// default order). Clicking an Hours value opens a calculation-breakdown popup
// showing exactly how the number was derived (% × week basis × weeks, or the
// recorded weekly entries from the imported file). The grand total renders in
// its own totals row directly under the HOURS column.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Pencil, Users, ChevronUp, ChevronDown, Calculator, X, Lock, GripVertical } from "lucide-react";
import { MemberActionMenu } from "@/components/MemberActionMenu";
import type { Allocation } from "@/pages/project-detail";
import { roleColor } from "@/lib/roleColors";
import { empTypeColor } from "@/lib/employmentColor";
import { RemoveMemberConfirm } from "@/components/RemoveMemberConfirm";
import { usePhaseWindows, type PhaseWindow } from "@/components/PhaseCardsStrip";
import { Z } from "@/lib/zLayers";
import { DisabledMemberStatus } from "@/components/DisabledMemberStatus";
import { getStoredUser } from "@/lib/api";

// All surface colours via CSS vars — safe in both dark and light themes.
const C = {
  text:      "var(--rm-text)",
  muted:     "var(--rm-text-muted)",
  faint:     "var(--rm-text-faint)",
  border:    "var(--rm-panel-border)",
  panelBg:   "var(--rm-panel)",
  soft:      "var(--rm-panel-soft)",
  hover:     "var(--rm-panel-hover)",
  green:     "var(--rm-green, #4FA64A)",
  amber:     "#F9AB33",
};

// Fallback period chip palette — used ONLY when the record has no dated
// phases (client request Aug 2026: date chips must take the PHASE colors from
// the strip above the table; each period previously got its own rotating
// colour, which didn't match the phase cards).
const PERIOD_COLORS = ["#12A5B8", "#2563EB", "#6D28D9", "#C2410C", "#0D9488", "#B91C7B"];

/** Color for a date chip: the color of the phase whose window contains the
    date (same palette + order as the phase-card strip). Dates outside every
    phase snap to the NEAREST phase, so e.g. a start a few days before Phase 1
    still reads as Phase 1. Falls back to the legacy rotation when the record
    has no dated phases. */
function phaseDateColor(ms: number, wins: PhaseWindow[], fallback: string): string {
  if (isNaN(ms)) return fallback;
  const dated = wins.filter((w) => !isNaN(w.startMs) && !isNaN(w.endMs) && w.endMs >= w.startMs);
  if (dated.length === 0) return fallback;
  let best = fallback, bestDist = Infinity;
  for (const w of dated) {
    const d = ms < w.startMs ? w.startMs - ms : ms > w.endMs ? ms - w.endMs : 0;
    if (d === 0) return w.color;
    if (d < bestDist) { bestDist = d; best = w.color; }
  }
  return best;
}

const SENTINEL_MS = Date.parse("2000-01-01T00:00:00");

function parseMs(d: string | undefined | null): number {
  if (!d) return NaN;
  return Date.parse(d.length === 10 ? d + "T00:00:00" : d);
}

function fmtDate(ms: number): string {
  if (isNaN(ms) || ms <= SENTINEL_MS) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtHours(h: number): string {
  return h >= 1000 ? `${(h / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(h));
}

/** Trim trailing zeros: 24 → "24", 22.5 → "22.5". */
function fmtNum(n: number): string {
  return (+n.toFixed(1)).toString();
}

/** Whole weeks spanned by [start, end] inclusive (≥1 when both valid). */
function spanWeeks(startMs: number, endMs: number): number {
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return 0;
  return Math.max(1, Math.round((((endMs - startMs) / 86_400_000) + 1) / 7));
}

function RoleBadge({ role, color }: { role: string | undefined | null; color: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px", borderRadius: 20,
      background: `${color}18`,
      border: `1px solid ${color}40`,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.03em",
      color,
      maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }} title={role || ""}>
      {role || "—"}
    </span>
  );
}

function AllocationBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  // Over 100% → amber; healthy → use a solid green that reads well in both themes.
  const isOver = pct > 100;
  const fillColor  = isOver ? "#E8820C" : "var(--rm-green, #4FA64A)";
  const textColor  = isOver ? "#B45309" : "var(--rm-green-ink, #3d8a39)";
  // Track: a neutral semi-transparent channel that adapts automatically to
  // both light and dark surfaces without needing a media query.
  const trackColor = "rgba(128,128,128,0.18)";
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      <span style={{
        fontSize: 12, fontWeight: 700, minWidth: 34, textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        color: pct > 0 ? textColor : C.faint,
      }}>
        {pct > 0 ? `${+pct.toFixed(0)}%` : "—"}
      </span>
      {pct > 0 && (
        <span style={{
          width: 46, height: 5, borderRadius: 3, flexShrink: 0,
          background: trackColor, position: "relative", overflow: "hidden",
        }}>
          <span style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${clamped}%`,
            background: fillColor,
            borderRadius: 3,
          }} />
        </span>
      )}
    </span>
  );
}

/** Solid colored date chip — takes the color of the phase the date falls in
    (legacy per-period rotation when the record has no dated phases). */
function DateChip({ ms, color }: { ms: number; color: string }) {
  const label = fmtDate(ms);
  if (label === "—") return <span style={{ color: C.faint }}>—</span>;
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 9px", borderRadius: 6,
      background: color,
      color: "#FFFFFF",
      fontSize: 11, fontWeight: 700, letterSpacing: "0.01em",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap", maxWidth: "100%",
      overflow: "hidden", textOverflow: "ellipsis",
      boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
    }}>
      {label}
    </span>
  );
}

// ── Hours-breakdown popup ────────────────────────────────────────────────────
// Explains exactly how a member's hours were computed, period by period:
//   • allocation % × week basis (e.g. 40 h) = weekly hours
//   • weekly hours × weeks that carry hours = period total
// When the recorded total does not match that formula (uneven weekly entries
// imported straight from the file), it says so honestly and shows the
// recorded number as the source of truth.
type BreakdownTarget = {
  member: Allocation;
  /** Which period row was clicked (index into slices) — highlighted. -1 = member row. */
  sliceIdx: number;
  anchor: { top: number; left: number; right: number; bottom: number };
};

function HoursBreakdownPopup({ target, phaseWins, onClose }: { target: BreakdownTarget; phaseWins: PhaseWindow[]; onClose: () => void }) {
  const { member, sliceIdx, anchor } = target;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const basis = member.weekHrsBasis && member.weekHrsBasis > 0 ? member.weekHrsBasis : 40;
  const periods = member.slices && member.slices.length > 0
    ? member.slices
    : [{ startDate: member.startDate, endDate: member.endDate, pct: member.pct, hours: member.eacHrs, weeks: undefined }];
  const total = periods.reduce((s, p) => s + (p.hours > 0 ? p.hours : 0), 0);

  // Position: prefer below-right of the clicked value; clamp into the viewport.
  const vw = window.innerWidth, vh = window.innerHeight;
  const W = 380;
  let left = anchor.right - W;
  if (left < 8) left = 8;
  if (left + W > vw - 8) left = vw - 8 - W;
  const below = vh - anchor.bottom;
  const placeBelow = below >= 320 || anchor.top < 320;
  const style: React.CSSProperties = {
    position: "fixed", left, width: W, zIndex: Z.TOP_POPOVER,
    background: C.panelBg, border: `1px solid ${C.border}`,
    borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
    display: "flex", flexDirection: "column",
    overflow: "hidden",
    ...(placeBelow
      ? { top: anchor.bottom + 6, maxHeight: Math.min(440, vh - anchor.bottom - 16) }
      : { bottom: vh - anchor.top + 6, maxHeight: Math.min(440, anchor.top - 16) }),
  };

  const lineLbl: React.CSSProperties = { fontSize: 11, color: C.muted, whiteSpace: "nowrap" };
  const lineVal: React.CSSProperties = { fontSize: 11.5, color: C.text, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return createPortal(
    <>
      {/* Transparent backdrop — closes on any outside click */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: Z.TOP_POPOVER_BACKDROP, background: "transparent" }} />
      <div style={style} role="dialog" aria-label={`How ${member.name}'s hours are calculated`}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px", borderBottom: `1px solid ${C.border}`, background: C.soft, flexShrink: 0,
        }}>
          <Calculator size={14} color={C.green} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            How {member.name.split(" ")[0]}'s hours are calculated
          </span>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: C.muted, padding: 2, display: "flex" }}>
            <X size={14} />
          </button>
        </div>

        {/* Periods */}
        <div style={{ overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {periods.map((p, i) => {
            const sMs = parseMs(p.startDate), eMs = parseMs(p.endDate);
            // Match the table's date chips: color by the phase the period starts in.
            const color = phaseDateColor(sMs, phaseWins, PERIOD_COLORS[i % PERIOD_COLORS.length]);
            const spanWk = spanWeeks(sMs, eMs);
            const wk = p.weeks && p.weeks > 0 ? p.weeks : spanWk || 1;
            const weekly = basis * (p.pct || 0) / 100;
            const derived = weekly * wk;
            // "Derived from %" only when the formula reproduces the recorded
            // total (±2% or ±2h). Otherwise the hours came straight from the
            // file's weekly entries and the formula would be a lie.
            const matches = p.hours > 0 && Math.abs(derived - p.hours) <= Math.max(2, p.hours * 0.02);
            const highlight = sliceIdx === i;
            return (
              <div key={i} style={{
                border: `1px solid ${highlight ? color : C.border}`,
                borderLeft: `4px solid ${color}`,
                borderRadius: 8, padding: "8px 10px",
                background: highlight ? `${color}0D` : "transparent",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 5, background: color, color: "#FFF",
                    fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0,
                  }}>
                    Period {i + 1}
                  </span>
                  <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fmtDate(sMs)} → {fmtDate(eMs)}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {Math.round(p.hours).toLocaleString("en-US")}h
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4 }}>
                  <span style={lineLbl}>Allocation</span>
                  <span style={lineVal}>{p.pct > 0 ? `${+p.pct.toFixed(0)}%` : "—"}</span>
                  {p.pct > 0 && (
                    <>
                      <span style={lineLbl}>Weekly hours</span>
                      <span style={lineVal}>{+p.pct.toFixed(0)}% × {fmtNum(basis)} h/week = {fmtNum(weekly)} h/week</span>
                    </>
                  )}
                  <span style={lineLbl}>Weeks with hours</span>
                  <span style={lineVal}>
                    {wk}{spanWk > 0 && spanWk !== wk ? ` (period spans ${spanWk})` : ""}
                  </span>
                  {matches ? (
                    <>
                      <span style={lineLbl}>Calculation</span>
                      <span style={lineVal}>{fmtNum(weekly)} h/week × {wk} {wk === 1 ? "week" : "weeks"} = {Math.round(p.hours).toLocaleString("en-US")}h</span>
                    </>
                  ) : (
                    <>
                      <span style={lineLbl}>Recorded total</span>
                      <span style={lineVal}>{Math.round(p.hours).toLocaleString("en-US")}h</span>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: C.faint, lineHeight: 1.5 }}>
                  {matches
                    ? "Derived from the allocation % over the weeks that carry hours."
                    : "Hours recorded week-by-week from the imported schedule — the weekly amounts vary, so the % formula alone doesn't reproduce this total."}
                </div>
              </div>
            );
          })}
        </div>

        {/* Total */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "9px 12px", borderTop: `1px solid ${C.border}`, background: C.soft, flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: "0.06em" }}>
            {periods.length > 1 ? `TOTAL — SUM OF ${periods.length} PERIODS` : "TOTAL"}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 800, color: C.text, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(total).toLocaleString("en-US")}h
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}

type SortKey = "name" | "role" | "title" | "bu" | "division" | "dept" | "start" | "end" | "hours" | "alloc";
const TEAM_COLUMN_KEYS: SortKey[] = ["name", "role", "title", "bu", "division", "dept", "start", "end", "hours", "alloc"];
const TEAM_COLUMN_LABELS: Record<SortKey, string> = {
  name: "Name", role: "Role", title: "Title", bu: "BU", division: "Division",
  dept: "Dept", start: "Start Date", end: "End Date", hours: "Hours", alloc: "Alloc",
};
const TEAM_COLUMN_WIDTHS: Record<SortKey, string> = {
  name: "15%", role: "11%", title: "11%", bu: "9%", division: "10%",
  dept: "9%", start: "10%", end: "10%", hours: "7%", alloc: "8%",
};

function teamColumnOrderStorageKey(): string {
  const user = getStoredUser();
  const tenant = encodeURIComponent((user?.tenant ?? "signed-out").trim().toLowerCase());
  const username = encodeURIComponent((user?.username ?? "anonymous").trim().toLowerCase());
  // This intentionally identifies the shared compact-team-table surface, not
  // an individual project or modal instance.
  return `rmone:simple-team-table-column-order:${tenant}:${username}:shared`;
}

function readTeamColumnOrder(storageKey: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : null;
  } catch {
    return null;
  }
}
// `a` is the row as displayed (for a period row: the member's fields with the
// period's dates/hours/%); `orig` is the underlying member allocation (edit
// always targets the whole member). groupStartMs keeps a member's period rows
// adjacent in the default sort. sliceIdx 0 = the member's first (or only) row.
// periodIdx = which slice this row shows (-1 when the member has no periods) —
// drives the date-chip colour and the highlighted card in the breakdown popup.
type Row = { a: Allocation; orig: Allocation; key: string; startMs: number; endMs: number; groupStartMs: number; sliceIdx: number; periodIdx: number };

function sortValue(r: Row, k: SortKey): string | number {
  switch (k) {
    case "name":     return r.a.name.toLowerCase();
    case "role":     return (r.a.role || "").toLowerCase();
    case "title":    return (r.a.title || "").toLowerCase();
    case "bu":       return (r.a.memberBu || "").toLowerCase();
    case "division": return (r.a.bu || "").toLowerCase();
    case "dept":     return (r.a.dept || "").toLowerCase();
    case "start":    return isNaN(r.startMs) ? Infinity : r.startMs;
    case "end":      return isNaN(r.endMs) ? Infinity : r.endMs;
    case "hours":    return r.a.eacHrs || 0;
    case "alloc":    return r.a.pct || 0;
  }
}

export function SimpleTeamTable({ allocations, searchQuery, hideHours = false, hideDates = false, canEdit = false, lockedNote = null, onEditMember, onRemoveMember, onChangeResource, canUnlock = false, onToggleLock, module, projectId, phasesRefreshToken }: {
  allocations: Allocation[];
  searchQuery: string;
  hideHours?: boolean;
  hideDates?: boolean;
  /** When set, date chips are colored by the record's PHASE windows (same
   *  palette + order as the phase-card strip). Omit to keep the legacy
   *  per-period rotation (e.g. modes that hide the schedule). */
  projectId?: string;
  /** Bump to refetch phases after the schedule is edited (mutationTick). */
  phasesRefreshToken?: number;
  canEdit?: boolean;
  /** Allocation-lock controls: canUnlock = viewer may unlock a locked member
   *  (admin or manage-staff); onToggleLock persists the change. Flag badges
   *  render inline next to the member name only when flags are set. */
  canUnlock?: boolean;
  onToggleLock?: (a: Allocation, locked: boolean) => Promise<boolean>;
  /** Plain-language stage-permission reason. When set (and canEdit is false),
   *  the edit/remove controls stay VISIBLE but disabled with this tooltip —
   *  stage-blocked users learn up front why they can't act. */
  lockedNote?: string | null;
  /** Pencil click. `period` is set when the row is ONE period of a
   *  multi-period assignment — the editor should scope itself to it. */
  onEditMember?: (a: Allocation, period?: { startDate: string; endDate: string; hours: number; rwiId?: number | null }) => void;
  /** Remove-from-team action (manage-staff only — the page passes it only
   *  when the viewer holds the capability; the server enforces it again).
   *  Shows a trash icon next to the edit pencil; confirmation happens in the
   *  shared RemoveMemberConfirm popup (with the audit-log notice). */
  onRemoveMember?: (a: Allocation) => Promise<void> | void;
  /** Change resource (manage-staff only, same gate as removal): hands the
      member's remaining weeks to another person via the ⋯ menu by the name. */
  onChangeResource?: (a: Allocation) => void;
  /** Record module ("PMM" | "OPM" | "LEM") — only drives the confirm-popup wording. */
  module?: string;
}) {
  // Phase date windows — empty when no projectId/schedule (chips fall back).
  const phaseWins = usePhaseWindows(projectId, phasesRefreshToken);
  // Action column shows for editors AND stage-blocked users (disabled + reason).
  const showActions = canEdit || !!lockedNote;
  const locked = !canEdit && !!lockedNote;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Row key with an unlock request in flight (disables its lock button).
  const [lockBusyKey, setLockBusyKey] = useState<string | null>(null);
  const [hoveredHoursKey, setHoveredHoursKey] = useState<string | null>(null);
  // Remove confirm: the allocation whose trash was clicked (opens the shared
  // RemoveMemberConfirm popup), plus the row currently being removed.
  const [confirmRemoveFor, setConfirmRemoveFor] = useState<Allocation | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownTarget | null>(null);
  const dragInstructionsId = useId();
  const [draggedColumnKey, setDraggedColumnKey] = useState<SortKey | null>(null);
  const [dropTargetColumnKey, setDropTargetColumnKey] = useState<SortKey | null>(null);
  const [columnMoveAnnouncement, setColumnMoveAnnouncement] = useState("");
  const [columnPreferenceStorageKey, setColumnPreferenceStorageKey] = useState(teamColumnOrderStorageKey);
  const [savedColumnOrder, setSavedColumnOrder] = useState<string[] | null>(() => readTeamColumnOrder(teamColumnOrderStorageKey()));
  const q = searchQuery.toLowerCase().trim();

  useEffect(() => {
    const syncAuth = () => {
      const key = teamColumnOrderStorageKey();
      setColumnPreferenceStorageKey(key);
      setSavedColumnOrder(readTeamColumnOrder(key));
    };
    syncAuth();
    window.addEventListener("rmone:authChanged", syncAuth);
    return () => window.removeEventListener("rmone:authChanged", syncAuth);
  }, []);

  useEffect(() => {
    const load = () => setSavedColumnOrder(readTeamColumnOrder(columnPreferenceStorageKey));
    const onStorage = (event: StorageEvent) => {
      if (event.key === columnPreferenceStorageKey) load();
    };
    const onChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
      if (!key || key === columnPreferenceStorageKey) load();
    };
    load();
    window.addEventListener("storage", onStorage);
    window.addEventListener("rmone:simpleTeamTableColumnOrderChanged", onChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("rmone:simpleTeamTableColumnOrderChanged", onChanged);
    };
  }, [columnPreferenceStorageKey]);

  const orderedColumnKeys = useMemo(() => {
    const seen = new Set<SortKey>();
    const ordered: SortKey[] = [];
    for (const key of savedColumnOrder ?? []) {
      if ((TEAM_COLUMN_KEYS as string[]).includes(key) && !seen.has(key as SortKey)) {
        seen.add(key as SortKey);
        ordered.push(key as SortKey);
      }
    }
    for (const key of TEAM_COLUMN_KEYS) if (!seen.has(key)) ordered.push(key);
    return ordered;
  }, [savedColumnOrder]);

  const persistColumnOrder = (next: SortKey[]) => {
    setSavedColumnOrder(next);
    try {
      localStorage.setItem(columnPreferenceStorageKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("rmone:simpleTeamTableColumnOrderChanged", {
        detail: { key: columnPreferenceStorageKey },
      }));
    } catch {
      // Reordering remains usable in the current tab when storage is blocked.
    }
  };

  const moveColumn = (from: SortKey, to: SortKey) => {
    if (from === to) return;
    const fromIndex = orderedColumnKeys.indexOf(from);
    const toIndex = orderedColumnKeys.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...orderedColumnKeys];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    persistColumnOrder(next);
    setColumnMoveAnnouncement(`${TEAM_COLUMN_LABELS[from]} column moved to position ${next.indexOf(from) + 1} of ${TEAM_COLUMN_KEYS.length}.`);
  };

  const { rows, memberCount, totalHours } = useMemo(() => {
    const filtered = q
      ? allocations.filter((a) =>
          a.name.toLowerCase().includes(q) ||
          (a.role || "").toLowerCase().includes(q) ||
          (a.title || "").toLowerCase().includes(q) ||
          (a.dept || "").toLowerCase().includes(q) ||
          (a.bu || "").toLowerCase().includes(q) ||
          (a.memberBu || "").toLowerCase().includes(q)
        )
      : allocations;
    // Expand members with 2+ assignment periods into one row per period —
    // matching the import file where the same person appears on several rows
    // (e.g. 30% Feb–Mar, then 60% Mar–Dec). Pointless when dates AND hours are
    // both hidden (Summary Only): the rows would be identical duplicates.
    const expandPeriods = !(hideDates && hideHours);
    const base: Row[] = [];
    filtered.forEach((a, i) => {
      // Always suffix with the list index: the same person can legally appear
      // as TWO separate allocation entries (e.g. two roles), and keying on the
      // bare resource GUID made React warn about duplicate keys.
      const baseKey = `${a.resourceId || a.name}::${i}`;
      const groupStartMs = parseMs(a.startDate);
      const periods = expandPeriods && a.slices && a.slices.length > 1 ? a.slices : null;
      if (periods) {
        periods.forEach((s, si) => {
          base.push({
            a: { ...a, startDate: s.startDate, endDate: s.endDate, eacHrs: s.hours, pct: s.pct },
            orig: a, sliceIdx: si, periodIdx: si, key: `${baseKey}::${si}`,
            startMs: parseMs(s.startDate), endMs: parseMs(s.endDate), groupStartMs,
          });
        });
      } else {
        base.push({
          a, orig: a, sliceIdx: 0, periodIdx: a.slices && a.slices.length === 1 ? 0 : -1, key: baseKey,
          startMs: parseMs(a.startDate), endMs: parseMs(a.endDate), groupStartMs,
        });
      }
    });
    // Default order: role → member start date → name → period start (keeps a
    // member's period rows adjacent and chronological).
    base.sort((x, y) => {
      const rx = (x.a.role || "").toLowerCase(), ry = (y.a.role || "").toLowerCase();
      if (rx !== ry) return rx < ry ? -1 : 1;
      const gx = isNaN(x.groupStartMs) ? Infinity : x.groupStartMs;
      const gy = isNaN(y.groupStartMs) ? Infinity : y.groupStartMs;
      if (gx !== gy) return gx - gy;
      const nm = x.a.name.localeCompare(y.a.name);
      if (nm !== 0) return nm;
      const sx = isNaN(x.startMs) ? Infinity : x.startMs;
      const sy = isNaN(y.startMs) ? Infinity : y.startMs;
      return sx - sy;
    });
    if (sort) {
      base.sort((x, y) => {
        const vx = sortValue(x, sort.key), vy = sortValue(y, sort.key);
        if (vx === vy) return 0;
        // Blank text and missing dates always sink to the bottom regardless
        // of direction; numeric zeros (hours/alloc) sort normally.
        if (typeof vx === "string" && typeof vy === "string") {
          if (!vx) return 1;
          if (!vy) return -1;
          return vx < vy ? -sort.dir : sort.dir;
        }
        const nx = vx as number, ny = vy as number;
        if (!isFinite(nx)) return 1;
        if (!isFinite(ny)) return -1;
        return nx < ny ? -sort.dir : sort.dir;
      });
    }
    // Member count + total hours come from the MEMBER list, not the expanded
    // rows, so period expansion never inflates the counts (per-period hours
    // are each rounded server-side; the member total avoids drift).
    const total = filtered.reduce((s, a) => s + (a.eacHrs > 0 ? a.eacHrs : 0), 0);
    return { rows: base, memberCount: filtered.length, totalHours: total };
  }, [allocations, q, sort, hideDates, hideHours]);

  if (allocations.length === 0) return null;

  if (rows.length === 0 && q) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "32px 12px", color: C.faint,
      }}>
        <Search size={22} style={{ opacity: 0.5 }} />
        <span style={{ fontSize: 13, color: C.muted }}>
          No members match <strong style={{ color: C.text }}>"{searchQuery}"</strong>
        </span>
      </div>
    );
  }

  const cellBase: React.CSSProperties = {
    padding: "10px 10px",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const toggleSort = (key: SortKey) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: 1 };
      if (cur.dir === 1) return { key, dir: -1 };
      return null; // third click → back to default order
    });
  };

  const visibleColumnKeys = orderedColumnKeys.filter(key =>
    !(hideDates && (key === "start" || key === "end")) && !(hideHours && (key === "hours" || key === "alloc")),
  );
  const SortTh = ({ k }: { k: SortKey }) => {
    const label = TEAM_COLUMN_LABELS[k];
    const align = k === "hours" || k === "alloc" ? "right" : "left";
    const active = sort?.key === k;
    const sourceIndex = draggedColumnKey == null ? -1 : orderedColumnKeys.indexOf(draggedColumnKey);
    const insertion = dropTargetColumnKey !== k ? undefined
      : sourceIndex < orderedColumnKeys.indexOf(k) ? "inset -3px 0 #6BA539" : "inset 3px 0 #6BA539";
    return (
      <th
        data-team-column-key={k}
        onClick={() => toggleSort(k)}
        onDragOver={e => {
          if (!draggedColumnKey || draggedColumnKey === k) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTargetColumnKey(k);
        }}
        onDrop={e => {
          e.preventDefault();
          const source = (e.dataTransfer.getData("text/plain") || draggedColumnKey) as SortKey;
          if ((TEAM_COLUMN_KEYS as string[]).includes(source)) moveColumn(source, k);
          setDraggedColumnKey(null); setDropTargetColumnKey(null);
        }}
        title={`Sort by ${label}`}
        style={{
          ...cellBase,
          paddingLeft: k === "name" ? 14 : 10,
          paddingRight: k === "alloc" && showActions ? 6 : 10,
          textAlign: align,
          fontSize: 9.5, fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase",
          color: active ? C.text : C.faint,
          borderBottom: `1px solid ${C.border}`,
          cursor: "pointer", userSelect: "none",
          // Sticky within the scroll cage; solid layered bg so rows never show through.
          position: "sticky", top: 0, zIndex: 2,
          background: `linear-gradient(${C.soft}, ${C.soft}), ${C.panelBg}`,
          boxShadow: insertion,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexDirection: align === "right" ? "row-reverse" : "row" }}>
          <span draggable role="button" tabIndex={0} aria-label={`Move ${label} column`}
            aria-describedby={dragInstructionsId} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            title="Drag to reorder column. Alt + Left/Right also moves it."
            onClick={e => e.stopPropagation()}
            onDragStart={e => { setDraggedColumnKey(k); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); }}
            onDragEnd={() => { setDraggedColumnKey(null); setDropTargetColumnKey(null); }}
             onPointerDown={e => {
               if (e.pointerType === "mouse") return;
               e.currentTarget.setPointerCapture(e.pointerId);
               setDraggedColumnKey(k);
               setDropTargetColumnKey(null);
             }}
             onPointerMove={e => {
               if (e.pointerType === "mouse" || draggedColumnKey !== k) return;
               const target = document.elementFromPoint(e.clientX, e.clientY)
                 ?.closest<HTMLElement>("[data-team-column-key]")
                 ?.dataset.teamColumnKey as SortKey | undefined;
               if (target && target !== k && (TEAM_COLUMN_KEYS as string[]).includes(target)) {
                 setDropTargetColumnKey(target);
               }
             }}
             onPointerUp={e => {
               if (e.pointerType === "mouse") return;
               if (dropTargetColumnKey) moveColumn(k, dropTargetColumnKey);
               setDraggedColumnKey(null);
               setDropTargetColumnKey(null);
             }}
            onKeyDown={e => {
              if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
              e.preventDefault(); e.stopPropagation();
              const target = orderedColumnKeys[orderedColumnKeys.indexOf(k) + (e.key === "ArrowLeft" ? -1 : 1)];
              if (target) moveColumn(k, target);
            }}
            style={{ display: "inline-flex", cursor: draggedColumnKey === k ? "grabbing" : "grab", color: C.faint, opacity: 0.65, touchAction: "none" }}>
            <GripVertical size={12} />
          </span>
          {label}
          {active && (sort!.dir === 1
            ? <ChevronUp size={10} style={{ flexShrink: 0 }} />
            : <ChevronDown size={10} style={{ flexShrink: 0 }} />)}
        </span>
      </th>
    );
  };

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${C.border}`,
      overflow: "hidden",
      background: C.panelBg,
      boxShadow: "var(--rm-shadow)",
    }}>
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px",
        borderBottom: `1px solid ${C.border}`,
        background: C.soft,
      }}>
        <Users size={13} color="var(--rm-green, #4FA64A)" />
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.muted,
          letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          Team Members
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700,
          background: "var(--rm-green-soft, rgba(107,165,57,0.16))",
          color: "var(--rm-green-ink, #6BA539)",
          border: "1px solid var(--rm-green, #6BA539)",
          borderRadius: 20, padding: "1px 8px",
        }}>
          {memberCount}
        </span>
        {!hideHours && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: "0.03em" }}>
            Click any hours value to see how it's calculated
          </span>
        )}
      </div>
      <span id={dragInstructionsId} className="sr-only">
        Drag a column grip to reorder it, or focus the grip and use Alt plus Left or Right arrow.
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{columnMoveAnnouncement}</span>

      {/* Scroll cage — caps the table at ~10 rows with ONE vertical scrollbar.
          overflowX stays hidden: the table is table-layout:fixed at 100% width,
          so it can never overflow sideways (no horizontal bar, by design). */}
      <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden" }}>
      {/* Table — table-layout:fixed so it NEVER forces horizontal page scroll.
          borderCollapse MUST be "separate" or the sticky header/footer lose
          their borders while scrolling (see sticky-table-scroll pattern). */}
      <table style={{
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        tableLayout: "fixed",
      }}>
        <colgroup>
          {/*
            Width budgets must total ~100% for each active column set.
            Summary (hideDates+hideHours=true, 6 cols): 26+18+20+12+14+10 = 100%
            Full    (hideDates+hideHours=false, 10 cols): 15+11+11+9+10+9+10+10+7+8 = 100%
            Edit column is fixed-px and sits outside the % pool.
          */}
          {visibleColumnKeys.map(key => <col key={key} style={{ width: hideDates && hideHours
            ? ({ name: "26%", role: "18%", title: "20%", bu: "12%", division: "14%", dept: "10%" } as Partial<Record<SortKey, string>>)[key] ?? TEAM_COLUMN_WIDTHS[key]
            : TEAM_COLUMN_WIDTHS[key] }} />)}
          {/* Edit — fixed px, outside % pool */}
          {showActions && <col style={{ width: 38 }} />}
        </colgroup>

        <thead>
          <tr style={{ background: C.soft }}>
            {visibleColumnKeys.map(k => <SortTh key={k} k={k} />)}
            {showActions && <th style={{
              borderBottom: `1px solid ${C.border}`, width: 38,
              position: "sticky", top: 0, zIndex: 2,
              background: `linear-gradient(${C.soft}, ${C.soft}), ${C.panelBg}`,
            }} aria-label="Edit" />}
          </tr>
        </thead>

        <tbody>
          {rows.map(({ a, orig, sliceIdx, periodIdx, key, startMs, endMs }, idx) => {
            const color = roleColor(a.role);
            const nameTint = empTypeColor(a.employeeType);
            const initials = a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
            const isHovered = hoveredKey === key;
            const rowBorder = idx === 0 ? "none" : `1px solid ${C.border}`;
            const rowBg = isHovered ? C.hover : idx % 2 === 1 ? C.soft : "transparent";
            const periodColor = PERIOD_COLORS[(periodIdx >= 0 ? periodIdx : 0) % PERIOD_COLORS.length];

            return (
              <tr
                key={key}
                onMouseEnter={() => setHoveredKey(key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{ background: rowBg, transition: "background 0.12s" }}
              >
                {visibleColumnKeys.map(columnKey => {
                  const standard = { ...cellBase, borderTop: rowBorder };
                  switch (columnKey) {
                    case "name": return <td key="name" style={{ ...standard, paddingLeft: 0, position: "relative" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 14 }}>
                        <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: color, opacity: 0.7 }} />
                        <span style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0, background: `${color}22`, border: `1.5px solid ${color}55`, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color, fontWeight: 800, fontSize: 9 }}>{initials || "?"}</span></span>
                        <span style={{ color: nameTint || C.text, fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>{a.name}</span>
                        {sliceIdx === 0 && <DisabledMemberStatus enabled={a.enabled} userGuid={a.resourceId} tenantId={a.tenantId} canManageStaff={canEdit} />}
                        {sliceIdx === 0 && a.softAllocation && <span title="Soft allocation — tentative (pencilled-in) booking" style={{ fontSize: 8, fontWeight: 800, color: "#60A5FA", background: "rgba(59,130,246,0.14)", border: "1px solid rgba(59,130,246,0.35)", borderRadius: 4, padding: "1px 4px", flexShrink: 0, cursor: "default" }}>S</span>}
                        {sliceIdx === 0 && a.nonChargeable && <span title="Non-chargeable — these hours don't bill" style={{ fontSize: 8, fontWeight: 800, color: "#94A3B8", background: "rgba(148,163,184,0.14)", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 4, padding: "1px 4px", flexShrink: 0, cursor: "default" }}>NC</span>}
                        {sliceIdx === 0 && a.isLocked && <button type="button" title={canUnlock ? "Locked — imports, schedule moves and hour edits can't change this member. Click to unlock." : "Locked — only an admin (or a user who can manage staff) can unlock."} disabled={lockBusyKey === key} onClick={() => { if (!canUnlock || !onToggleLock || lockBusyKey === key) return; setLockBusyKey(key); void Promise.resolve(onToggleLock(a, false)).finally(() => setLockBusyKey(null)); }} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, flexShrink: 0, background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 4, cursor: canUnlock ? "pointer" : "not-allowed", opacity: lockBusyKey === key ? 0.45 : 1 }}><Lock size={9} color="#F59E0B" /></button>}
                        {sliceIdx === 0 && (onChangeResource || onRemoveMember) && <MemberActionMenu name={a.name} disabledNote={locked ? lockedNote : undefined} onChangeResource={onChangeResource ? () => onChangeResource(orig) : undefined} onRemove={onRemoveMember ? () => setConfirmRemoveFor(orig) : undefined} />}
                      </span>
                    </td>;
                    case "role": return <td key="role" style={standard}><RoleBadge role={a.role} color={color} /></td>;
                    case "title": return <td key="title" style={{ ...standard, color: C.text }} title={a.title}>{a.title || "—"}</td>;
                    case "bu": return <td key="bu" style={{ ...standard, color: C.muted }} title={a.memberBu}>{a.memberBu || "—"}</td>;
                    case "division": return <td key="division" style={{ ...standard, color: C.muted }} title={a.bu}>{a.bu || "—"}</td>;
                    case "dept": return <td key="dept" style={{ ...standard, color: C.muted }} title={a.dept}>{a.dept || "—"}</td>;
                    case "start": return <td key="start" style={standard} title={fmtDate(startMs)}><DateChip ms={startMs} color={phaseDateColor(startMs, phaseWins, periodColor)} /></td>;
                    case "end": return <td key="end" style={standard} title={fmtDate(endMs)}><DateChip ms={endMs} color={phaseDateColor(endMs, phaseWins, periodColor)} /></td>;
                    case "hours": return <td key="hours" style={{ ...standard, textAlign: "right" }}>{a.eacHrs > 0 ? (() => { const hk = key; const hovered = hoveredHoursKey === hk; return <button type="button" title="Click to see exactly how this number is calculated" onMouseEnter={() => setHoveredHoursKey(hk)} onMouseLeave={() => setHoveredHoursKey(null)} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setBreakdown({ member: orig, sliceIdx: periodIdx, anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } }); }} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", margin: 0, font: "inherit", cursor: "pointer", borderRadius: 6, border: hovered ? "1px solid rgba(37,99,235,0.55)" : "1px solid rgba(37,99,235,0.22)", background: hovered ? "rgba(37,99,235,0.14)" : "rgba(37,99,235,0.07)", boxShadow: hovered ? "0 1px 4px rgba(37,99,235,0.18)" : "none", transition: "background 0.13s, border-color 0.13s, box-shadow 0.13s" }}><span style={{ fontSize: 13, fontWeight: 800, color: "#2563EB", fontVariantNumeric: "tabular-nums" }}>{fmtHours(a.eacHrs)}</span><span style={{ fontSize: 10, fontWeight: 600, color: "#2563EB", opacity: 0.75 }}>h</span><Calculator size={10} color="#2563EB" style={{ opacity: hovered ? 0.9 : 0.5, flexShrink: 0, transition: "opacity 0.13s" }} /></button>; })() : <span style={{ color: C.faint }}>—</span>}</td>;
                    case "alloc": return <td key="alloc" style={{ ...standard, paddingRight: showActions ? 4 : 14 }}><AllocationBar pct={a.pct} /></td>;
                  }
                })}
                {showActions && <td style={{ padding: "10px 8px 10px 2px", borderTop: rowBorder, textAlign: "center", whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}><button type="button" disabled={locked} onClick={() => { if (locked) return; const period = orig.slices && orig.slices.length > 1 ? { startDate: a.startDate, endDate: a.endDate, hours: a.eacHrs, rwiId: orig.slices[sliceIdx]?.rwiId ?? null } : undefined; onEditMember?.(orig, period); }} title={locked ? (lockedNote ?? undefined) : `Edit ${a.name}'s assignment`} style={{ background: isHovered && !locked ? C.border : "transparent", border: "none", cursor: locked ? "not-allowed" : "pointer", padding: "4px 5px", borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", color: isHovered && !locked ? C.text : C.faint, opacity: locked ? 0.45 : 1, transition: "background 0.12s, color 0.12s" }}><Pencil size={13} /></button></span></td>}
              </tr>
            );
          })}
        </tbody>

        {/* Remove confirm — shared professional popup (portal; renders no DOM
            inside the table). Includes the mandated audit-log sentence. */}
        {confirmRemoveFor && (
          <RemoveMemberConfirm
            target={{ kind: "member", name: confirmRemoveFor.name, role: confirmRemoveFor.role }}
            module={module}
            busy={removingKey !== null}
            onCancel={() => { if (removingKey === null) setConfirmRemoveFor(null); }}
            onConfirm={() => {
              if (!confirmRemoveFor || removingKey !== null) return;
              setRemovingKey(confirmRemoveFor.name);
              void Promise.resolve(onRemoveMember?.(confirmRemoveFor)).finally(() => {
                setRemovingKey(null);
                setConfirmRemoveFor(null);
              });
            }}
          />
        )}

        {/* Totals row — grand total always follows the reordered Hours column.
            Sticky at the bottom of the scroll cage so it stays visible. */}
        {!hideHours && totalHours > 0 && (() => {
          const stickyFoot: React.CSSProperties = {
            position: "sticky", bottom: 0, zIndex: 2,
            background: `linear-gradient(${C.soft}, ${C.soft}), ${C.panelBg}`,
            borderTop: `2px solid ${C.border}`,
          };
          return (
          <tfoot>
            <tr>
              {visibleColumnKeys.map(key => key === "hours" ? (
                <td key={key} style={{ ...cellBase, ...stickyFoot, textAlign: "right" }}>
                  <span style={{ display: "block", fontSize: 8, fontWeight: 700, color: C.faint, letterSpacing: "0.08em" }}>
                    TOTAL HOURS
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(totalHours).toLocaleString("en-US")}<span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>h</span>
                  </span>
                </td>
              ) : <td key={key} style={{ ...cellBase, ...stickyFoot }} />)}
              {showActions && <td style={stickyFoot} />}
            </tr>
          </tfoot>
          );
        })()}
      </table>
      </div>

      {/* Footer — member count */}
      <div style={{
        borderTop: `1px solid ${C.border}`,
        padding: "6px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: C.soft,
      }}>
        <span style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: "0.05em" }}>
          {memberCount} {memberCount === 1 ? "MEMBER" : "MEMBERS"}
        </span>
      </div>

      {breakdown && <HoursBreakdownPopup target={breakdown} phaseWins={phaseWins} onClose={() => setBreakdown(null)} />}
    </div>
  );
}
