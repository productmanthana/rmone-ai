// ─────────────────────────────────────────────────────────────────────────────
// TeamGantt — Gantt-style team list for the project detail page (view-only).
//
// Layout: a summary strip (team size, total hours, remaining, avg allocation),
// a role-color legend, a shared month axis with a "today" line, then one slim
// row per member: identity block (avatar, name, role, allocation %, hours)
// frozen on the left and a timeline bar on the right. Bars are colored by ROLE
// (stable roleColor hash — same role, same color everywhere) and, when weekly
// hours exist, shaded per week: darker = heavier weeks, gaps = zero-hour weeks.
// Each bar carries its total hours label on top.
//
// The Gantt list itself is view-only, but clicking a row opens that member's
// Schedule View in a POPUP — the SAME TeamScheduleGrid as the Schedule tab
// (same columns, same inline cell editing, same save API) filtered to just
// that person (user request — replaced the old inline "downside" expansion,
// which crowded the page). Clicking a specific month on a member's bar opens
// the popup already scrolled to that month (focusDate → TeamScheduleGrid).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { Search, X, Maximize2, Briefcase, Award, Building2, LayoutGrid, Users, Clock, Gauge, AlertTriangle, Lock } from "lucide-react";
import { MemberActionMenu } from "@/components/MemberActionMenu";
import type { Allocation } from "@/pages/project-detail";
import { roleColor } from "@/lib/roleColors";
import { abbrevRole } from "@/lib/roleAbbrev";
import { TeamScheduleGrid } from "@/components/TeamScheduleGrid";
import { getTaskData, type OpenRole } from "@/lib/api";
import { resolvePhaseColor, PHASE_COLORS, type PhaseColor } from "@/lib/phaseColors";
import { currentPhaseOf, type ProjectPhaseEntry } from "@/lib/projectPhases";
import { expandPhaseName, parseScheduleDate } from "@/lib/phaseHours";
import { DisabledMemberStatus } from "@/components/DisabledMemberStatus";

const C = {
  white: "#FFFFFF",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  textFaint: "var(--rm-text-faint)",
  border: "var(--rm-panel-border)",
  green: "#6BA539",
  red: "#F87171",
  blue: "#38BDF8",
};

// Width of the frozen identity column (px).
const LEFT_W = 236;
// Timeline row height (px) — tall enough for the hours label above the bar.
const ROW_H = 46;
// Client-approved Gantt accents: red TODAY marker, amber OPEN-position dash.
const TODAY_RED = "#FF5757";
const OPEN_AMBER = "#F9AB33";
// Platform utilization convention (matches UTIL_COLORS in lib/phaseColors):
// amber = over-allocated, green = healthy, red = under-utilized.
const OVER_AMBER = "#F9AB33";

// SQL sentinel dates (e.g. 1900-01-01) are treated as "no date".
const SENTINEL_CUTOFF_MS = Date.parse("2000-01-01T00:00:00");

/** Parse a date string at LOCAL midnight (date-only strings parse as UTC
 *  otherwise, which shifts bars by a day in US timezones). */
function parseMs(d: string | undefined | null): number {
  if (!d) return NaN;
  return Date.parse(d.length === 10 ? d + "T00:00:00" : d);
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtHours(h: number): string {
  return h >= 1000 ? `${(h / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(h));
}

import { RemoveMemberConfirm } from "@/components/RemoveMemberConfirm";

export function TeamGantt({ allocations, searchQuery, projectId, module, scheduleStart = "", scheduleEnd = "", hideHours = false, hideSchedule = false, refreshToken, canEdit = false, lockedNote = null, onReload, openRoles = [], onRemoveMember, onChangeResource, canUnlock = false, onToggleLock, onToggleFlag, onRemoveOpenPosition }: {
  allocations: Allocation[]; searchQuery: string; projectId: string;
  /** Record module (PMM/OPM/LEM) — OPM/LEM follow the opportunity-side past-edit rules. */
  module?: string | null;
  scheduleStart?: string; scheduleEnd?: string; hideHours?: boolean; hideSchedule?: boolean; refreshToken?: number; canEdit?: boolean;
  /** Stage-permission reason: when set (and canEdit is false) the member-popup
   *  remove action renders disabled with this tooltip instead of hidden. */
  lockedNote?: string | null;
  onReload?: () => void; openRoles?: OpenRole[]; onRemoveMember?: (a: Allocation) => Promise<void> | void;
  /** Change resource (manage-staff only): hands the member's remaining weeks
      to another person — offered from the ⋯ menu in the member popup. */
  onChangeResource?: (a: Allocation) => void;
  /** Remove an OPEN position (manage-staff only — the page passes it only when
   *  the viewer holds the capability). Shows a ✕ on the dashed open rows. */
  onRemoveOpenPosition?: (r: OpenRole) => Promise<void> | void;
  /** Allocation-lock controls, forwarded into the member popup's schedule
   *  grid (unlock happens there); list rows show a read-only lock icon. */
  canUnlock?: boolean;
  onToggleLock?: (m: { name: string; resourceId?: string }, locked: boolean) => Promise<boolean>;
  onToggleFlag?: (m: { name: string; resourceId?: string }, flag: "soft" | "nc" | "locked", value: boolean) => Promise<boolean>;
}) {
  // Member detail popup: which row is open + (optionally) the date the user
  // clicked on that row's timeline, so the grid opens at that month.
  const [popup, setPopup] = useState<{ key: string; focusDate?: string } | null>(null);

  // Remove-member confirm state for the popup header — opens the shared
  // RemoveMemberConfirm popup (with the mandated audit-log notice).
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { setConfirmRemove(false); setRemoving(false); }, [popup?.key]);
  // Open-position removal (manage-staff): the open row whose ✕ was clicked.
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState<OpenRole | null>(null);
  const [removingOpen, setRemovingOpen] = useState(false);

  // Esc closes the popup — but NOT while the user is inside a form control
  // (the schedule grid's cell editor / quick-hours dialogs also cancel on
  // Escape; without this guard one keypress would cancel the edit AND slam
  // the whole popup shut).
  useEffect(() => {
    if (!popup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      setPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup]);

  // Project phase schedule (/task-data, client-cached) → phase spans for the
  // band header + phase-colored bars. A failed fetch or an unscheduled project
  // yields an EMPTY list — every phase lookup then falls back to "No Phase".
  const [phaseEntries, setPhaseEntries] = useState<ProjectPhaseEntry[]>([]);
  useEffect(() => {
    if (hideSchedule || !projectId) { setPhaseEntries([]); return; }
    let cancelled = false;
    void getTaskData(projectId, "0")
      .then((res) => {
        if (cancelled) return;
        const raw = Array.isArray(res) ? (res as Record<string, unknown>[]) : [];
        const entries = raw
          .map((p) => {
            const startDayRaw = String(p.StartDate ?? "").trim().slice(0, 10);
            return {
              name: expandPhaseName(String(p.Title ?? p.Alias ?? "").trim()),
              order: Number(p.ItemOrder ?? p.StageStep ?? 0),
              startMs: parseScheduleDate(p.StartDate)?.getTime() ?? NaN,
              endMs: parseScheduleDate(p.DueDate ?? p.EndDate)?.getTime() ?? NaN,
              startDay: /^\d{4}-\d{2}-\d{2}$/.test(startDayRaw) ? startDayRaw : "",
            };
          })
          .filter((p) => p.name && !isNaN(p.startMs) && !isNaN(p.endMs) && p.endMs >= p.startMs)
          .sort((a, b) => a.order - b.order || a.startMs - b.startMs)
          .map((p, i) => ({ ...p, order: i }));
        setPhaseEntries(entries);
      })
      .catch(() => { if (!cancelled) setPhaseEntries([]); });
    return () => { cancelled = true; };
  }, [projectId, refreshToken, hideSchedule]);

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

  // Sort by role (groups same-color bars together), then by start date.
  const rows = useMemo(() => {
    const schedStartMs = parseMs(scheduleStart ? scheduleStart.slice(0, 10) : "");
    return filtered
      .map((a, i) => {
        const rawStart = parseMs(a.startDate);
        const startValid = !isNaN(rawStart) && rawStart > SENTINEL_CUTOFF_MS;
        const startMs = startValid ? rawStart : (!isNaN(schedStartMs) ? schedStartMs : NaN);
        const rawEnd = parseMs(a.endDate);
        const endMs = !isNaN(rawEnd) && rawEnd > SENTINEL_CUTOFF_MS ? rawEnd : NaN;
        return { a, key: a.resourceId || (a.name + i), startMs, endMs };
      })
      .sort((x, y) => {
        const rx = (x.a.role || "").toLowerCase(), ry = (y.a.role || "").toLowerCase();
        if (rx !== ry) return rx < ry ? -1 : 1;
        const sx = isNaN(x.startMs) ? Infinity : x.startMs, sy = isNaN(y.startMs) ? Infinity : y.startMs;
        if (sx !== sy) return sx - sy;
        return x.a.name.localeCompare(y.a.name);
      });
  }, [filtered, scheduleStart]);

  // Team totals for the summary strip (over the FILTERED set so a search
  // narrows the totals with it — the numbers always match the visible rows).
  const totals = useMemo(() => {
    let hours = 0, remaining = 0, pctSum = 0, pctN = 0, over = 0;
    for (const r of rows) {
      hours += r.a.eacHrs > 0 ? r.a.eacHrs : 0;
      remaining += r.a.etcHrs > 0 ? r.a.etcHrs : 0;
      if (r.a.pct > 0) { pctSum += r.a.pct; pctN++; }
      if (r.a.pct > 100) over++;
    }
    return { hours, remaining, avgPct: pctN ? pctSum / pctN : 0, over };
  }, [rows]);

  // Shared time range: min/max over member spans, widened by the project
  // schedule when present, snapped to whole months for clean axis labels.
  const range = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      if (!isNaN(r.startMs)) lo = Math.min(lo, r.startMs);
      if (!isNaN(r.endMs)) hi = Math.max(hi, r.endMs);
    }
    const ss = parseMs(scheduleStart ? scheduleStart.slice(0, 10) : "");
    const se = parseMs(scheduleEnd ? scheduleEnd.slice(0, 10) : "");
    if (!isNaN(ss) && ss > SENTINEL_CUTOFF_MS) lo = Math.min(lo, ss);
    if (!isNaN(se)) hi = Math.max(hi, se);
    // Widen by phase spans + open-position spans so the band header and the
    // dashed OPEN bars never get clipped off the axis.
    for (const p of phaseEntries) {
      if (p.startMs > SENTINEL_CUTOFF_MS) lo = Math.min(lo, p.startMs);
      hi = Math.max(hi, p.endMs);
    }
    for (const o of openRoles) {
      const os = parseMs((o.startDate || "").slice(0, 10));
      const oe = parseMs((o.endDate || "").slice(0, 10));
      if (!isNaN(os) && os > SENTINEL_CUTOFF_MS) lo = Math.min(lo, os);
      if (!isNaN(oe)) hi = Math.max(hi, oe);
    }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    if (hi <= lo) hi = lo + 30 * 86400_000;
    const start = new Date(lo); start.setDate(1); start.setHours(0, 0, 0, 0);
    const end = new Date(hi);
    end.setMonth(end.getMonth() + 1); end.setDate(1); end.setHours(0, 0, 0, 0);
    return { lo: start.getTime(), hi: end.getTime() };
  }, [rows, scheduleStart, scheduleEnd, phaseEntries, openRoles]);

  // Month tick positions along the axis (0–100%).
  const months = useMemo(() => {
    if (!range) return [];
    const out: { pct: number; label: string }[] = [];
    const d = new Date(range.lo);
    while (d.getTime() < range.hi) {
      const pct = ((d.getTime() - range.lo) / (range.hi - range.lo)) * 100;
      out.push({
        pct,
        label: d.toLocaleDateString("en-US", { month: "short" }) + (d.getMonth() === 0 || out.length === 0 ? ` '${String(d.getFullYear()).slice(2)}` : ""),
      });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [range]);
  // Thin out labels when the range is long (every 2nd/3rd… month).
  const labelStep = Math.max(1, Math.ceil(months.length / 14));

  const todayPct = useMemo(() => {
    if (!range) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const ms = t.getTime();
    if (ms < range.lo || ms > range.hi) return null;
    return ((ms - range.lo) / (range.hi - range.lo)) * 100;
  }, [range]);

  // Legend: unique roles present, in row order (already grouped by role).
  // Used only when the project has NO phase schedule (fallback coloring).
  const legendRoles = useMemo(() => {
    const seen = new Set<string>();
    const out: { role: string; color: string }[] = [];
    for (const r of rows) {
      const key = (r.a.role || "").trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role: r.a.role || "No role", color: roleColor(r.a.role) });
    }
    return out;
  }, [rows]);

  // Phase legend: the project's phases in schedule order (deduped by name).
  const legendPhases = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; color: PhaseColor }[] = [];
    phaseEntries.forEach((p, i) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name: p.name, color: resolvePhaseColor(p.name, i, phaseEntries.length) });
    });
    return out;
  }, [phaseEntries]);

  const hasPhases = phaseEntries.length > 0;

  if (allocations.length === 0 && openRoles.length === 0) return null;

  const pos = (ms: number) => range ? Math.max(0, Math.min(100, ((ms - range.lo) / (range.hi - range.lo)) * 100)) : 0;

  // Phase color on a given date. No schedule → "No Phase" tan; bars fall back
  // to the legacy role color instead (keeps unscheduled projects readable).
  const phaseColorAt = (ms: number): PhaseColor => {
    const cur = currentPhaseOf(phaseEntries, ms);
    return cur ? resolvePhaseColor(cur.name, cur.index, cur.total) : PHASE_COLORS["No Phase"];
  };
  const phaseNameAt = (ms: number): string => currentPhaseOf(phaseEntries, ms)?.name ?? "No Phase";
  const todayMs = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); })();

  // Open-position rows (dashed amber) rendered below the member rows.
  const openRows = openRoles.map((o, i) => {
    const os = parseMs((o.startDate || "").slice(0, 10));
    const oe = parseMs((o.endDate || "").slice(0, 10));
    return {
      o, key: `open-${o.groupId || o.allocationId || i}`,
      startMs: !isNaN(os) && os > SENTINEL_CUTOFF_MS ? os : NaN,
      endMs: !isNaN(oe) && oe > SENTINEL_CUTOFF_MS ? oe : NaN,
    };
  }).filter((r) => !q || (r.o.role || "").toLowerCase().includes(q) || (r.o.title || "").toLowerCase().includes(q) || "open".includes(q));

  const summaryStats: { icon: typeof Users; label: string; value: string; color: string }[] = [
    { icon: Users, label: "TEAM MEMBERS", value: String(rows.length), color: C.blue },
    ...(!hideHours && totals.hours > 0 ? [{ icon: Clock, label: "TOTAL HOURS", value: `${fmtHours(totals.hours)}h`, color: C.green }] : []),
    ...(!hideHours && totals.remaining > 0 ? [{ icon: Clock, label: "REMAINING", value: `${fmtHours(totals.remaining)}h`, color: "#A78BFA" }] : []),
    ...(!hideHours && totals.avgPct > 0 ? [{ icon: Gauge, label: "AVG ALLOCATION", value: `${Math.round(totals.avgPct)}%`, color: totals.avgPct > 100 ? OVER_AMBER : C.green }] : []),
    ...(totals.over > 0 ? [{ icon: AlertTriangle, label: "OVER 100%", value: String(totals.over), color: OVER_AMBER }] : []),
  ];

  return (
    <div>
      {filtered.length === 0 && q && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          padding: "24px 12px", color: C.textFaint, fontSize: 13,
        }}>
          <Search size={20} color={C.textFaint} style={{ opacity: 0.4 }} />
          <span>No members match <strong style={{ color: C.textMuted }}>"{searchQuery}"</strong></span>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{
          backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12,
          border: `1px solid ${C.border}`, overflow: "hidden",
        }}>
          {/* ── Summary strip: team totals ── */}
          <div style={{
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: 24,
            padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
            background: "linear-gradient(90deg, rgba(56,189,248,0.06), rgba(107,165,57,0.05) 55%, transparent)",
          }}>
            {summaryStats.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: s.color + "1C", border: `1px solid ${s.color}40`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <s.icon size={13} color={s.color} />
                </div>
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", color: C.textFaint }}>{s.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                </div>
              </div>
            ))}
            {todayPct !== null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: C.textMuted, marginLeft: "auto" }}>
                <span style={{ width: 2, height: 10, borderRadius: 1, backgroundColor: TODAY_RED, flexShrink: 0 }} />
                Today
              </span>
            )}
          </div>

          {/* ── Legend row: phase colors (falls back to role colors when the
                project has no phase schedule) ── */}
          <div style={{
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
            padding: "8px 16px", borderBottom: `1px solid ${C.border}`,
          }}>
            {hasPhases ? (
              <>
                {legendPhases.map((lp, i) => (
                  <span key={i} title={lp.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: C.textMuted }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: "50%", backgroundColor: lp.color.bg, flexShrink: 0,
                      border: lp.color.outline ? `2px solid ${lp.color.outline}` : "1px solid rgba(0,0,0,0.12)",
                      boxSizing: "border-box",
                    }} />
                    {lp.name}
                  </span>
                ))}
                {openRows.length > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: C.textMuted }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", border: `2px dashed ${OPEN_AMBER}`, flexShrink: 0, boxSizing: "border-box" }} />
                    Open position
                  </span>
                )}
              </>
            ) : (
              legendRoles.map((lr, i) => (
                <span key={i} title={lr.role} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: C.textMuted }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: lr.color, flexShrink: 0 }} />
                  {abbrevRole(lr.role)}
                </span>
              ))
            )}
          </div>

          {/* ── Phase band header: the project schedule projected onto the
                shared axis, each phase a colored segment (approved design) ── */}
          {range && hasPhases && (
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
              <div style={{
                width: LEFT_W, flexShrink: 0, borderRight: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", padding: "0 10px",
              }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", color: C.textFaint }}>PROJECT PHASES</span>
              </div>
              <div style={{ flex: 1, position: "relative", height: 26, minWidth: 0, overflow: "hidden" }}>
                {phaseEntries.map((p, i) => {
                  const l = pos(p.startMs);
                  const r = Math.max(pos(p.endMs + 86400_000), l + 0.4);
                  const c = resolvePhaseColor(p.name, i, phaseEntries.length);
                  return (
                    <div key={i} title={`${p.name} · ${fmtDate(p.startMs)} – ${fmtDate(p.endMs)}`} style={{
                      position: "absolute", left: `${l}%`, width: `${r - l}%`, top: 0, bottom: 0,
                      background: c.bg, color: c.text,
                      border: c.outline ? `1px solid ${c.outline}` : "none", boxSizing: "border-box",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden",
                      borderRight: "2px solid rgba(255,255,255,0.6)",
                    }}>{p.name}</div>
                  );
                })}
                {todayPct !== null && (
                  <span style={{ position: "absolute", left: `${todayPct}%`, top: 0, bottom: 0, width: 2, backgroundColor: TODAY_RED, opacity: 0.9, zIndex: 2 }} />
                )}
              </div>
            </div>
          )}

          {/* ── Month axis header ── */}
          {range && (
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: LEFT_W, flexShrink: 0, borderRight: `1px solid ${C.border}` }} />
              <div style={{ flex: 1, position: "relative", height: 22, minWidth: 0 }}>
                {months.map((m, i) => (
                  <React.Fragment key={i}>
                    <span style={{ position: "absolute", left: `${m.pct}%`, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.06)" }} />
                    {i % labelStep === 0 && m.pct < 97 && (
                      <span style={{
                        position: "absolute", left: `calc(${m.pct}% + 4px)`, top: 4,
                        fontSize: 9, fontWeight: 600, color: C.textFaint, whiteSpace: "nowrap",
                      }}>{m.label}</span>
                    )}
                  </React.Fragment>
                ))}
                {todayPct !== null && (
                  <>
                    <span style={{ position: "absolute", left: `${todayPct}%`, top: 0, bottom: 0, width: 2, backgroundColor: TODAY_RED, opacity: 0.9 }} />
                    <span style={{
                      position: "absolute", left: `${todayPct}%`, top: 3, transform: "translateX(-50%)",
                      background: TODAY_RED, color: "#fff", fontSize: 7.5, fontWeight: 700,
                      padding: "1px 4px", borderRadius: 3, whiteSpace: "nowrap", zIndex: 2,
                    }}>TODAY</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Member rows ── */}
          {rows.map(({ a, key, startMs, endMs }) => {
            const color = roleColor(a.role);
            const over = a.pct > 100;
            const isOpen = popup?.key === key;
            const initials = a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
            const hasSpan = range && !isNaN(startMs) && !isNaN(endMs) && endMs >= startMs;
            const barLeft = hasSpan ? pos(startMs) : 0;
            const barRight = hasSpan ? Math.max(pos(endMs + 86400_000), barLeft + 0.8) : 0; // end date inclusive
            // Phase-colored bars (approved design): bar base color = the phase
            // active today, clamped into the member's span (past members show
            // their last phase, future members their first). No schedule →
            // legacy role color.
            const barPhaseC = hasPhases && hasSpan
              ? phaseColorAt(Math.min(Math.max(todayMs, startMs), endMs))
              : null;
            const barPhaseName = hasPhases && hasSpan
              ? phaseNameAt(Math.min(Math.max(todayMs, startMs), endMs))
              : "";
            const barBase = barPhaseC ? barPhaseC.bg : color;
            // Weekly intensity segments (only when real weekly hours exist).
            const weeks = (!hideHours && a.weeklyHours && a.weeklyHours.length > 0) ? a.weeklyHours : null;
            const maxWk = weeks ? Math.max(...weeks.map((w) => w.hours), 1) : 1;
            const spanTitle = hasSpan
              ? `${a.name} · ${fmtDate(startMs)} – ${fmtDate(endMs)}${barPhaseName ? ` · ${barPhaseName}` : ""}${!hideHours && a.eacHrs > 0 ? ` · ${Math.round(a.eacHrs)}h` : ""}${!hideHours && a.pct > 0 ? ` · ${+a.pct.toFixed(0)}%` : ""}`
              : `${a.name} · no dates set`;
            // Labels on top of the bar. With weekly data: each week's hours
            // above its own segment (thinned when the weeks get too narrow to
            // fit a number). Without weekly data: a single total-hours label
            // anchored at the bar start (flips right when the bar starts too
            // far right for the label to fit inside the track).
            const wkLabels = weeks
              ? weeks
                  .map((w) => ({ ws: parseMs(String(w.week).slice(0, 10)), hours: w.hours }))
                  .filter((w) => !isNaN(w.ws) && w.hours > 0)
                  .sort((x, y) => x.ws - y.ws)
              : [];
            const rangeDays = range ? (range.hi - range.lo) / 86400_000 : 1;
            const weekPct = (7 / Math.max(rangeDays, 1)) * 100;
            // ~3.2% of the track is roughly what a 2-3 digit label needs.
            const wkLabelStep = Math.max(1, Math.ceil(3.2 / Math.max(weekPct, 0.001)));
            const barLabel = !weeks && !hideHours && (a.eacHrs > 0 || a.pct > 0)
              ? [a.eacHrs > 0 ? `${fmtHours(a.eacHrs)}h` : "", a.pct > 0 ? `${+a.pct.toFixed(0)}%` : ""].filter(Boolean).join(" · ")
              : "";
            const labelFlip = barLeft > 82;

            return (
              <div key={key} style={{ borderTop: `1px solid ${C.border}` }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    // If the click landed on the timeline track, translate the
                    // X position into a date so the popup opens at that month.
                    let focusDate: string | undefined;
                    const track = (e.currentTarget as HTMLElement).querySelector("[data-gantt-track]") as HTMLElement | null;
                    if (track && range) {
                      const rect = track.getBoundingClientRect();
                      if (rect.width > 0 && e.clientX >= rect.left && e.clientX <= rect.right) {
                        const frac = (e.clientX - rect.left) / rect.width;
                        const d = new Date(range.lo + frac * (range.hi - range.lo));
                        focusDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      }
                    }
                    setPopup({ key, focusDate });
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPopup({ key }); } }}
                  title={`${spanTitle} — click to open details`}
                  style={{ display: "flex", alignItems: "stretch", cursor: "pointer", background: isOpen ? "rgba(255,255,255,0.04)" : "transparent" }}
                >
                  {/* Frozen identity cell */}
                  <div style={{
                    width: LEFT_W, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 10px", borderRight: `1px solid ${C.border}`, minWidth: 0,
                  }}>
                    <div style={{
                      width: 27, height: 27, borderRadius: 14, flexShrink: 0,
                      background: `linear-gradient(135deg, ${color}30, ${color}14)`,
                      border: `1.5px solid ${color}66`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: `0 1px 4px ${color}33`,
                    }}>
                      <span style={{ color, fontWeight: 700, fontSize: 9.5 }}>{initials || "?"}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                        <DisabledMemberStatus enabled={a.enabled} userGuid={a.resourceId} tenantId={a.tenantId}
                          canManageStaff={canEdit} />
                        {a.isLocked && (
                          <span title="Locked — imports, schedule moves and hour edits can't change this member (unlock from the member popup)" style={{ display: "inline-flex", flexShrink: 0 }}>
                            <Lock size={9} color="#F59E0B" />
                          </span>
                        )}
                        {a.softAllocation && (
                          <span title="Soft allocation — tentative booking" style={{ fontSize: 7.5, fontWeight: 800, color: "#60A5FA", flexShrink: 0 }}>S</span>
                        )}
                        {a.nonChargeable && (
                          <span title="Non-chargeable" style={{ fontSize: 7.5, fontWeight: 800, color: "#94A3B8", flexShrink: 0 }}>NC</span>
                        )}
                      </div>
                      <div title={a.role || a.title || "Team Member"} style={{ fontSize: 10, color: C.textMuted, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {abbrevRole(a.role || a.title || "Team Member")}
                      </div>
                    </div>
                    {!hideHours && (
                      <div style={{ textAlign: "right", flexShrink: 0, lineHeight: 1.25 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: over ? OVER_AMBER : color }}>{+a.pct.toFixed(0)}%</div>
                        {a.eacHrs > 0 && <div style={{ fontSize: 9.5, fontWeight: 600, color: C.textMuted }}>{fmtHours(a.eacHrs)}h</div>}
                      </div>
                    )}
                    <Maximize2 size={11} color={C.textFaint} style={{ flexShrink: 0 }} />
                  </div>

                  {/* Timeline track */}
                  <div data-gantt-track style={{ flex: 1, position: "relative", minWidth: 0, height: ROW_H, alignSelf: "center" }}>
                    {/* month gridlines */}
                    {months.map((m, i) => (
                      <span key={i} style={{ position: "absolute", left: `${m.pct}%`, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
                    ))}
                    {/* today line */}
                    {todayPct !== null && (
                      <span style={{ position: "absolute", left: `${todayPct}%`, top: 0, bottom: 0, width: 2, backgroundColor: TODAY_RED, opacity: 0.55 }} />
                    )}
                    {hasSpan ? (
                      <>
                        {/* weekly hours on top of the bar — one number per week segment */}
                        {wkLabels.map((w, wi) => {
                          if (wi % wkLabelStep !== 0) return null;
                          const l = pos(w.ws), r = pos(w.ws + 7 * 86400_000);
                          if (r <= barLeft || l >= barRight) return null;
                          const center = (Math.max(l, barLeft) + Math.min(r, barRight)) / 2;
                          return (
                            <span key={`wl${wi}`} style={{
                              position: "absolute", top: 3, left: `${center}%`,
                              transform: "translateX(-50%)",
                              fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap", lineHeight: "13px",
                              color: over ? OVER_AMBER : (barPhaseC ? C.text : color),
                              // solid chip so the today/grid lines never cut through the text
                              background: "var(--rm-panel)", borderRadius: 4, padding: "0 3px",
                            }}>{Math.round(w.hours)}h</span>
                          );
                        })}
                        {/* fallback: total hours label when no weekly data exists */}
                        {barLabel && (
                          <span style={{
                            position: "absolute", top: 3,
                            ...(labelFlip
                              ? { right: `${100 - barRight}%` }
                              : { left: `${barLeft}%` }),
                            fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap", lineHeight: "13px",
                            color: over ? OVER_AMBER : (barPhaseC ? C.text : color),
                            background: "var(--rm-panel)", borderRadius: 4, padding: "0 3px",
                          }}>{barLabel}</span>
                        )}
                        <div style={{
                          position: "absolute", top: 21,
                          left: `${barLeft}%`, width: `${barRight - barLeft}%`,
                          height: 15, borderRadius: 8, overflow: "hidden",
                          backgroundColor: barBase + (weeks ? "26" : "00"),
                          border: over ? `1.5px solid ${OVER_AMBER}` : `1px solid ${barBase}40`,
                          boxShadow: `0 2px 6px ${barBase}30`,
                          boxSizing: "border-box",
                        }}>
                          {weeks ? (
                            weeks.map((w, wi) => {
                              const ws = parseMs(String(w.week).slice(0, 10));
                              if (isNaN(ws) || w.hours <= 0) return null;
                              const l = pos(ws), r = pos(ws + 7 * 86400_000);
                              // positions relative to the bar, not the track
                              const rel = (p: number) => ((p - barLeft) / Math.max(barRight - barLeft, 0.001)) * 100;
                              const segL = Math.max(0, rel(l)), segR = Math.min(100, rel(r));
                              if (segR <= segL) return null;
                              // Segment color = the phase active THAT week, so
                              // bars line up with the phase band header above.
                              const segColor = hasPhases ? phaseColorAt(ws).bg : color;
                              return (
                                <span key={wi} title={`${a.name} · week of ${fmtDate(ws)} · ${w.hours}h${hasPhases ? ` · ${phaseNameAt(ws)}` : ""}`} style={{
                                  position: "absolute", top: 0, bottom: 0,
                                  left: `${segL}%`, width: `${segR - segL}%`,
                                  backgroundColor: segColor,
                                  opacity: 0.3 + 0.7 * (w.hours / maxWk),
                                }} />
                              );
                            })
                          ) : (
                            <span style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, ${barBase}CC, ${barBase})` }} />
                          )}
                        </div>
                      </>
                    ) : (
                      <span style={{
                        position: "absolute", top: "50%", transform: "translateY(-50%)", left: 8,
                        fontSize: 9.5, color: C.textFaint, fontStyle: "italic",
                      }}>no dates set</span>
                    )}
                  </div>
                </div>

              </div>
            );
          })}

          {/* ── OPEN positions: dashed amber rows below the members (approved
                design) — unfilled demand rendered as a hollow dashed bar. ── */}
          {openRows.map(({ o, key, startMs, endMs }) => {
            const hasSpan = range && !isNaN(startMs) && !isNaN(endMs) && endMs >= startMs;
            const barLeft = hasSpan ? pos(startMs) : 0;
            const barRight = hasSpan ? Math.max(pos(endMs + 86400_000), barLeft + 0.8) : 0;
            const label = `OPEN · ${o.role || o.title || "Role"}`;
            const title = hasSpan
              ? `${label} · ${fmtDate(startMs)} – ${fmtDate(endMs)}${!hideHours && o.etcHrs > 0 ? ` · ${Math.round(o.etcHrs)}h needed` : ""}`
              : `${label} · no dates set`;
            return (
              <div key={key} style={{ borderTop: `1px solid ${C.border}` }}>
                <div title={title} style={{ display: "flex", alignItems: "stretch" }}>
                  {/* Frozen identity cell */}
                  <div style={{
                    width: LEFT_W, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 10px", borderRight: `1px solid ${C.border}`, minWidth: 0,
                  }}>
                    <div style={{
                      width: 27, height: 27, borderRadius: 14, flexShrink: 0,
                      border: `2px dashed ${OPEN_AMBER}`, boxSizing: "border-box",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ color: OPEN_AMBER, fontWeight: 700, fontSize: 11 }}>?</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: OPEN_AMBER, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                      {(o.title || o.bu) && (
                        <div title={o.title || o.bu} style={{ fontSize: 10, color: C.textMuted, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {o.title || o.bu}
                        </div>
                      )}
                    </div>
                    {!hideHours && o.etcHrs > 0 && (
                      <div style={{ textAlign: "right", flexShrink: 0, lineHeight: 1.25 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: OPEN_AMBER }}>{fmtHours(o.etcHrs)}h</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: C.textMuted }}>needed</div>
                      </div>
                    )}
                    {onRemoveOpenPosition && (o.raIds?.length ?? 0) > 0 && (
                      <button
                        title={`Remove this open ${o.role || "position"}`}
                        aria-label={`Remove open position ${o.role || o.title || ""}`}
                        onClick={() => setConfirmRemoveOpen(o)}
                        style={{
                          width: 24, height: 24, borderRadius: 7, padding: 0, flexShrink: 0, marginLeft: 4,
                          background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.4)",
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <X size={13} color={C.red} />
                      </button>
                    )}
                  </div>

                  {/* Timeline track */}
                  <div style={{ flex: 1, position: "relative", minWidth: 0, height: ROW_H, alignSelf: "center" }}>
                    {months.map((m, i) => (
                      <span key={i} style={{ position: "absolute", left: `${m.pct}%`, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
                    ))}
                    {todayPct !== null && (
                      <span style={{ position: "absolute", left: `${todayPct}%`, top: 0, bottom: 0, width: 2, backgroundColor: TODAY_RED, opacity: 0.55 }} />
                    )}
                    {hasSpan ? (
                      <div style={{
                        position: "absolute", top: 21,
                        left: `${barLeft}%`, width: `${barRight - barLeft}%`,
                        height: 15, borderRadius: 8,
                        border: `2px dashed ${OPEN_AMBER}`, boxSizing: "border-box",
                        background: `${OPEN_AMBER}14`,
                      }} />
                    ) : (
                      <span style={{
                        position: "absolute", top: "50%", transform: "translateY(-50%)", left: 8,
                        fontSize: 9.5, color: C.textFaint, fontStyle: "italic",
                      }}>no dates set</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmRemoveOpen && (
        <RemoveMemberConfirm
          target={{ kind: "open", role: confirmRemoveOpen.role, title: confirmRemoveOpen.title }}
          module={module ?? undefined}
          busy={removingOpen}
          onConfirm={async () => {
            if (removingOpen) return;
            setRemovingOpen(true);
            try {
              await onRemoveOpenPosition?.(confirmRemoveOpen);
              setConfirmRemoveOpen(null);
            } finally {
              setRemovingOpen(false);
            }
          }}
          onCancel={() => { if (!removingOpen) setConfirmRemoveOpen(null); }}
        />
      )}

      {/* ── Member detail POPUP: the same Schedule View grid that used to
            expand inline below the row (user request — the inline version
            crowded the page). Clicking a month on the bar passes focusDate
            so the grid opens scrolled to that month. ── */}
      {popup && (() => {
        const row = rows.find((r) => r.key === popup.key);
        // Member no longer in the list (reload removed them, or a new search
        // filtered them out) — drop the stale popup state instead of leaving
        // an invisible open popup behind.
        if (!row) { setTimeout(() => setPopup(null), 0); return null; }
        const { a } = row;
        const color = roleColor(a.role);
        const initials = a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
        const over = a.pct > 100;
        return (
          <div
            onClick={() => setPopup(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 300,
              background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(1240px, 96vw)", maxHeight: "88vh",
                display: "flex", flexDirection: "column",
                background: "var(--rm-panel)", border: `1px solid ${C.border}`,
                borderRadius: 14, boxShadow: "0 18px 60px rgba(0,0,0,0.5)", overflow: "hidden",
              }}
            >
              {/* Header: member identity + close */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
                padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
                background: `linear-gradient(90deg, ${color}14, transparent 60%)`,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 16, flexShrink: 0,
                  background: `linear-gradient(135deg, ${color}30, ${color}14)`,
                  border: `1.5px solid ${color}66`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ color, fontWeight: 700, fontSize: 11 }}>{initials || "?"}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                    {a.isLocked && (
                      <span title="Locked allocation — unlock from the FLAGS column in the grid below" style={{ display: "inline-flex", flexShrink: 0 }}>
                        <Lock size={11} color="#F59E0B" />
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500 }}>{a.role || a.title || "Team Member"}</div>
                </div>
                {!hideHours && (a.pct > 0 || a.eacHrs > 0) && (
                  <div style={{ marginLeft: "auto", textAlign: "right", lineHeight: 1.3, flexShrink: 0 }}>
                    {a.pct > 0 && <div style={{ fontSize: 13, fontWeight: 800, color: over ? OVER_AMBER : color }}>{+a.pct.toFixed(0)}%</div>}
                    {a.eacHrs > 0 && <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>{fmtHours(a.eacHrs)}h total</div>}
                  </div>
                )}
                {(onRemoveMember || onChangeResource) && (
                  <span style={{
                    marginLeft: (!hideHours && (a.pct > 0 || a.eacHrs > 0)) ? 8 : "auto", flexShrink: 0,
                    display: "inline-flex", alignItems: "center",
                  }}>
                    <MemberActionMenu
                      name={a.name}
                      size={16}
                      disabledNote={!canEdit ? (lockedNote ?? "You don't have permission to change this team") : undefined}
                      onChangeResource={onChangeResource ? () => { setPopup(null); onChangeResource(a); } : undefined}
                      onRemove={onRemoveMember ? () => setConfirmRemove(true) : undefined}
                    />
                  </span>
                )}
                <button
                  onClick={() => setPopup(null)}
                  aria-label="Close"
                  style={{
                    marginLeft: ((!hideHours && (a.pct > 0 || a.eacHrs > 0)) || onRemoveMember || onChangeResource) ? 8 : "auto", flexShrink: 0,
                    width: 28, height: 28, borderRadius: 8, cursor: "pointer",
                    background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <X size={14} color={C.textMuted} />
                </button>
              </div>

              {confirmRemove && (
                <RemoveMemberConfirm
                  target={{ kind: "member", name: a.name, role: a.role }}
                  module={module ?? undefined}
                  busy={removing}
                  onConfirm={async () => {
                    if (removing) return;
                    setRemoving(true);
                    try {
                      await onRemoveMember?.(a);
                      setConfirmRemove(false);
                      setPopup(null);
                    } finally {
                      setRemoving(false);
                    }
                  }}
                  onCancel={() => { if (!removing) setConfirmRemove(false); }}
                />
              )}

              {/* Body: exact same content the inline expansion showed */}
              <div style={{ overflow: "auto", padding: "12px 14px 16px" }}>
                {!hideHours ? (
                  <TeamScheduleGrid
                    projectId={projectId}
                    module={module}
                    reloadKey={refreshToken}
                    canEdit={canEdit}
                    onReload={onReload}
                    hideSchedule={hideSchedule}
                    soloMember={{ id: a.resourceId || undefined, name: a.name }}
                    focusDate={popup.focusDate}
                    canUnlock={canUnlock}
                    onToggleLock={onToggleLock}
                    onToggleFlag={onToggleFlag}
                  />
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { icon: Briefcase,  label: "Role",     value: a.role,     chipColor: "#60a5fa" },
                      { icon: Award,      label: "Title",    value: a.title,    chipColor: "#a78bfa" },
                      { icon: Building2,  label: "Dept",     value: a.dept,     chipColor: "#34d399" },
                      { icon: LayoutGrid, label: "Division", value: a.bu,       chipColor: "#fbbf24" },
                      { icon: Building2,  label: "BU",       value: a.memberBu, chipColor: "#f97316" },
                    ].filter((r) => r.value && r.value !== "—" && r.value.trim()).map((row2, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "4px 10px", borderRadius: 20,
                        background: row2.chipColor + "14", border: `1px solid ${row2.chipColor}40`,
                      }}>
                        <row2.icon size={10} color={row2.chipColor} />
                        <span style={{ fontSize: 9, color: row2.chipColor, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.8 }}>{row2.label}</span>
                        <span style={{ fontSize: 11, color: C.text, fontWeight: 500 }}>{row2.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
