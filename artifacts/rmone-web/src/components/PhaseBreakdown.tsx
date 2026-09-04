import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Pencil, Check, X, AlertTriangle, ExternalLink } from "lucide-react";
import {
  getFullProjectAllocations, getTaskData,
} from "@/lib/api";
import {
  type PhaseHourEntry, type AllocationsResponse, type WeekEntry,
  fmtWeekLabel, fmtDateLabel, fmtWeekKey, getPhaseTotal, derivePhaseHours, parseWeekKey,
  parseScheduleDate,
  computeEvenSpreadDraft, computeFlatDraft, hasLifecycleAssigned,
} from "@/lib/phaseHours";
import { readSectionSeed, writeSectionSeed } from "@/lib/projectDetailCache";
import { getBusinessRules, getPastEditRulesFor, useBusinessRulesVersion } from "@/lib/businessRules";
import { saveMemberWeeklyHours } from "@/lib/saveMemberWeeklyHours";
import { MAX_WEEKLY_HOURS } from "@/lib/weeklyHoursValidation";
import { useTheme } from "@/lib/theme";
import DateField from "@/components/DateField";
import { Z } from "@/lib/zLayers";

type RangeRow = { from: string; to: string; hours: string };
let rangeRowSeq = 0;
function newRangeRow(): RangeRow & { _id: number } {
  return { _id: ++rangeRowSeq, from: "", to: "", hours: "" };
}

/** Build an ISO week-patches map (YYYY-MM-DD → hours) from a PhaseHourEntry[].
 *  Each week key (DD-Mon-YY) is converted to ISO so saveMemberWeeklyHours can
 *  merge the patches onto fresh server truth at queue turn. */
function weekPatchesFromPhaseHours(entries: PhaseHourEntry[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const ph of entries) {
    for (const w of ph.weeks) {
      const d = parseWeekKey(w.key);
      if (!d) continue;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      map[iso] = (map[iso] ?? 0) + w.hours;
    }
  }
  return map;
}

/** Return all per-week max-168 violations in an entry list (for save gating). */
function findDraftViolations(entries: PhaseHourEntry[]): Array<{ key: string; hours: number }> {
  const out: Array<{ key: string; hours: number }> = [];
  for (const ph of entries) {
    for (const w of ph.weeks) {
      if (w.hours > MAX_WEEKLY_HOURS) out.push({ key: w.key, hours: w.hours });
    }
  }
  return out;
}

const C = {
  green: "var(--rm-green)",
  orange: "#E87722",
  red: "#F87171",
  text: "var(--rm-text)",
  muted: "var(--rm-text-muted)",
  mutedSoft: "var(--rm-text-faint)",
  surface: "var(--rm-panel-soft)",
  surfaceDeep: "var(--rm-bg)",
  border: "var(--rm-panel-border)",
};

/**
 * "Hours by Phase" matrix for ONE team member, shown inline in the expanded
 * team card. Phases run DOWN the rows, the project's weeks run ACROSS the
 * columns, and each cell holds the hours that phase carries in that week — a
 * professional timesheet-style grid. Uses the shared derivePhaseHours so it
 * stays in lockstep with the EditAllocationModal.
 *
 * When canEdit is set, the in-phase cells become directly editable: click
 * "Edit", type new hours straight into the grid, then "Save" writes them back
 * through the same weekly-allocation save path the modal uses.
 */
export function PhaseBreakdown({
  projectId, module, person, canEdit = false, onSaved, onSetupSchedule, refreshToken,
}: {
  projectId: string;
  /** Record module (PMM/OPM/LEM) — OPM/LEM follow the opportunity-side past-edit rules. */
  module?: string | null;
  person: { name: string; resourceId?: string; pct?: number; memberStart?: string; memberEnd?: string };
  canEdit?: boolean;
  onSaved?: (fetchTeam?: boolean) => void;
  onSetupSchedule?: () => void;
  // Bumped by the parent whenever something OUTSIDE this card changes this
  // member's allocation (e.g. Edit Assignment updates dates/role). Without
  // this, the card only refetches on its own internal reloadKey bump (its
  // own saves) — an external mutation left the dates changed but the hours
  // grid stale until a manual page refresh.
  refreshToken?: number;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";

  // Seed the very first render from the persisted per-project cache (the
  // same localStorage store the page's section cards use), so expanding a
  // team card on a return visit shows the hours grid INSTANTLY instead of
  // "Loading phase hours…". The fetch effect below still runs and swaps in
  // fresh data silently (it only shows the spinner when rawData is null).
  const [seeded] = useState(() => {
    try {
      const alloc = readSectionSeed<AllocationsResponse>("alloc", projectId);
      if (!alloc) return null;
      const schedRaw = readSectionSeed<unknown>("schedule", projectId);
      // Require BOTH seeds: deriving phase buckets without the schedule
      // lumps all hours into "Other / Unscheduled" until the silent refetch
      // corrects it — better to show the brief spinner in that rare case.
      // (An empty array IS a valid schedule seed — a project with no phases.)
      if (schedRaw == null) return null;
      const sched: any[] = Array.isArray(schedRaw)
        ? (schedRaw as any[])
        : Array.isArray((schedRaw as { Data?: unknown })?.Data)
          ? ((schedRaw as { Data: any[] }).Data)
          : [];
      const memberStart = person.memberStart ? parseScheduleDate(person.memberStart) : null;
      const memberEnd   = person.memberEnd   ? parseScheduleDate(person.memberEnd)   : null;
      return {
        rawData: alloc,
        lifecycleAssigned: hasLifecycleAssigned(sched),
        phaseHours: derivePhaseHours(alloc, sched, { ...person, memberStart, memberEnd }),
      };
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState<string | null>(null);
  const [phaseHours, setPhaseHours] = useState<PhaseHourEntry[]>(seeded?.phaseHours ?? []);
  const [rawData, setRawData] = useState<AllocationsResponse | null>(seeded?.rawData ?? null);
  const [lifecycleAssigned, setLifecycleAssigned] = useState(seeded?.lifecycleAssigned ?? false);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Inline-edit state.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PhaseHourEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rescaling, setRescaling] = useState(false);
  const [showDistributeMenu, setShowDistributeMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const distributeBtnRef = useRef<HTMLButtonElement>(null);
  const [showRangeEditor, setShowRangeEditor] = useState(false);
  const [rangeRows, setRangeRows] = useState<(RangeRow & { _id: number })[]>([]);
  // "Set specific hours per week" quick action — a single hours/week value
  // applied to every week at once, instead of opening the full per-week grid.
  const [showFlatInput, setShowFlatInput] = useState(false);
  const [flatHours, setFlatHours] = useState("");
  const [weekPopup, setWeekPopup] = useState<{ wk: string; rect: DOMRect } | null>(null);

  // Distribute the member's TOTAL allocated hours evenly across every week of
  // the project (total ÷ weeks), overriding whatever per-week values exist —
  // including lump-sum "Other / Unscheduled" hours, which get absorbed into the
  // uniform spread. Saves through saveMemberWeeklyHours so the weekPatches are
  // merged onto fresh server truth at queue turn (never a stale local snapshot).
  async function distributeEvenly() {
    if (weekKeys.length === 0 || grandTotal <= 0) return;
    // WHOLE hours per week: every week gets floor(total ÷ weeks), and the
    // first `extra` weeks get one hour more so the member's total stays
    // exactly the same (e.g. 3900h over 79 weeks → 29 weeks of 50h then
    // 50 weeks of 49h — never decimals like 49.36). If the total itself
    // has a fractional part, the LAST week absorbs it. Shared with the
    // Edit Assignment flow's automatic backward-extension rebalance via
    // computeEvenSpreadDraft, so both paths behave identically.
    const evenDraft = computeEvenSpreadDraft(phaseHours);
    if (!evenDraft) return;
    // Validate: even spread will always be ≤ grandTotal/1 ≤ reasonable, but
    // guard anyway — if the total itself exceeds 168 * weeks, each week will
    // be ≤ 168 (floor), so this check is a safety net.
    const violations = findDraftViolations(evenDraft);
    if (violations.length > 0) {
      setSaveError(`The evenly-distributed value (${violations[0].hours}h) exceeds the ${MAX_WEEKLY_HOURS}h per-week maximum. Lower the total hours first.`);
      return;
    }
    const weekPatches = weekPatchesFromPhaseHours(evenDraft);
    const memberId = person.resourceId ?? person.name;
    setRescaling(true);
    setSaveError(null);
    // Optimistic: show the evenly-spread numbers in the grid IMMEDIATELY —
    // the server write continues below and, on failure, the previous
    // numbers are restored with an error message.
    const prevHours = phaseHours;
    setPhaseHours(evenDraft);
    try {
      await saveMemberWeeklyHours({
        projectId,
        memberId,
        memberName: person.name,
        memberRole: "",
        weekPatches,
      });
      setReloadKey((k) => k + 1);
      onSaved?.();
    } catch (e) {
      setPhaseHours(prevHours);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRescaling(false);
    }
  }

  // "Set specific hours per week": stamp ONE hours/week value onto every
  // currently-known week at once (unlike Distribute evenly, the total is
  // free to change). Saves through saveMemberWeeklyHours so weekPatches are
  // merged onto fresh server truth at queue turn.
  async function applyFlatHours() {
    const n = Math.max(0, Math.round(Number(flatHours) || 0));
    if (weekKeys.length === 0 || !flatHours.trim()) return;
    // Max-168 validation: a flat value over 168h/week is not valid — keep it
    // visible in the input and show a persistent error instead of clamping.
    if (n > MAX_WEEKLY_HOURS) {
      setSaveError(`${n}h/week exceeds the ${MAX_WEEKLY_HOURS}h per-week maximum. Enter a value from 0 to ${MAX_WEEKLY_HOURS}.`);
      return;
    }
    const flatDraft = computeFlatDraft(phaseHours, n);
    if (!flatDraft) return;
    const weekPatches = weekPatchesFromPhaseHours(flatDraft);
    const memberId = person.resourceId ?? person.name;
    setRescaling(true);
    setSaveError(null);
    // Optimistic: close the input and show the new uniform numbers NOW;
    // restore the previous grid if the background save fails.
    setShowFlatInput(false);
    setFlatHours("");
    const prevHours = phaseHours;
    setPhaseHours(flatDraft);
    try {
      await saveMemberWeeklyHours({
        projectId,
        memberId,
        memberName: person.name,
        memberRole: "",
        weekPatches,
      });
      setReloadKey((k) => k + 1);
      onSaved?.();
    } catch (e) {
      setPhaseHours(prevHours);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRescaling(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Only show the "Loading phase hours…" spinner on the very FIRST fetch.
    // A reloadKey/refreshToken bump after a save already has good data on
    // screen (either the just-saved draft or the previous values) — blanking
    // it out to a spinner every time makes a fast save FEEL slow even when
    // the network round-trip itself is quick. Keep showing the current
    // numbers until the fresh ones arrive, then swap in place.
    if (!rawData) setLoading(true);
    setError(null);
    // The very first request after login can hit a COLD core2 connection
    // pool (30-60s+, warmed lazily per tenant — see startup-warmer). Rather
    // than surface that one-time slow start as a hard error, retry once
    // automatically before giving up, so users don't have to manually
    // refresh right after signing in.
    const isAbort = (e: unknown) =>
      e instanceof DOMException ? e.name === "AbortError"
        : (e as any)?.name === "AbortError";
    async function load(attempt: number): Promise<void> {
      try {
        const [allocRes, schedRes] = await Promise.allSettled([
          getFullProjectAllocations(projectId),
          getTaskData(projectId, "0"),
        ]);
        if (cancelled) return;
        if (allocRes.status !== "fulfilled") throw allocRes.reason;
        const data = allocRes.value as AllocationsResponse;
        const schedulePhasesRaw: any[] =
          schedRes.status === "fulfilled" && Array.isArray(schedRes.value)
            ? (schedRes.value as any[]) : [];
        setRawData(data);
        setLifecycleAssigned(hasLifecycleAssigned(schedulePhasesRaw));
        const memberStart = person.memberStart ? parseScheduleDate(person.memberStart) : null;
        const memberEnd   = person.memberEnd   ? parseScheduleDate(person.memberEnd)   : null;
        setPhaseHours(derivePhaseHours(data, schedulePhasesRaw, { ...person, memberStart, memberEnd }));
        // Persist the allocation payload so the NEXT card expansion (any
        // member of this project, even after a full page reload) renders
        // instantly from the seed. Never seed an all-empty payload — a
        // cold-pool timeout can return {} and an empty seed would flash
        // wrong zeros on the next visit.
        if ((data?.ExistingAllocations?.length ?? 0) > 0 || (data?.NewAllocations?.length ?? 0) > 0) {
          writeSectionSeed("alloc", projectId, data);
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (cancelled) return;
        if (attempt === 0 && isAbort(e)) {
          await load(1);
          return;
        }
        console.error("[PhaseBreakdown] load failed", person.name, e);
        setError(isAbort(e)
          ? "Still warming up the connection — please try again in a moment."
          : (e instanceof Error ? e.message : String(e)));
        setLoading(false);
      }
    }
    void load(0);
    return () => { cancelled = true; };
  }, [projectId, person.name, person.resourceId, reloadKey, refreshToken]);

  // The grid actually rendered: the draft while editing, otherwise the saved data.
  const view = editing ? draft : phaseHours;

  // Union of every week column across all phases, sorted chronologically →
  // the table's column headers.
  const weekKeys = useMemo(() => {
    const set = new Set<string>();
    for (const ph of view) for (const w of ph.weeks) set.add(w.key);
    return Array.from(set).sort((a, b) => {
      const da = parseWeekKey(a), db = parseWeekKey(b);
      if (!da || !db) return a.localeCompare(b);
      return da.getTime() - db.getTime();
    });
  }, [view]);

  // Per-phase {weekKey → hours} lookup + per-week column totals.
  const { rowMaps, colTotals, grandTotal } = useMemo(() => {
    const rowMaps = view.map((ph) => {
      const m: Record<string, number> = {};
      for (const w of ph.weeks) m[w.key] = (m[w.key] ?? 0) + w.hours;
      return m;
    });
    const colTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const m of rowMaps) {
      for (const k of Object.keys(m)) {
        colTotals[k] = (colTotals[k] ?? 0) + m[k];
        grandTotal += m[k];
      }
    }
    return { rowMaps, colTotals, grandTotal };
  }, [view]);

  // Business-rules subscription: re-render when admin saves new settings so
  // past-date lock and non-working-day indicators update without a page reload.
  useBusinessRulesVersion();
  const { nonWorkingDays: rawNwd, holidayDates: rawHolidays } = getBusinessRules();
  const { allowPastDateEdit, pastEditLimitWeeks } = getPastEditRulesFor(module);
  const nonWorkingDays: number[] = rawNwd ?? [0, 6];

  // Company holidays keyed by ISO date (YYYY-MM-DD) → label. Each entry is
  // either "YYYY-MM-DD" or "YYYY-MM-DD|Label"; a missing label falls back to
  // "Holiday". Built once per render so week-header day dots can highlight them.
  const holidayMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const raw of (rawHolidays ?? [])) {
      const [iso, ...rest] = raw.split("|");
      if (!iso) continue;
      const label = rest.join("|").trim() || "Holiday";
      m.set(iso, label);
    }
    return m;
  }, [rawHolidays]);

  // Monday that starts the CURRENT week (local time). Weeks with a Monday
  // strictly before this are "past" and are locked unless allowPastDateEdit.
  const thisWeekMonMs = useMemo(() => {
    const now = new Date();
    const dow = now.getDay(); // 0=Sun … 6=Sat
    const daysToMon = dow === 0 ? -6 : 1 - dow;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMon).getTime();
  }, []);

  // Per-column past flag: true when the week's Monday < this week's Monday.
  const weekIsPast = useMemo(
    () => weekKeys.map(wk => { const d = parseWeekKey(wk); return d ? d.getTime() < thisWeekMonMs : false; }),
    [weekKeys, thisWeekMonMs],
  );

  // The column nearest TODAY — the grid auto-scrolls here on load so the user
  // lands on the current week and can see what's happening now.
  const todayColIdx = useMemo(() => {
    if (weekKeys.length === 0) return -1;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let best = -1, bestDelta = Infinity;
    for (let i = 0; i < weekKeys.length; i++) {
      const d = parseWeekKey(weekKeys[i]);
      if (!d) continue;
      const delta = Math.abs(d.getTime() - today);
      if (delta < bestDelta) { bestDelta = delta; best = i; }
    }
    return best;
  }, [weekKeys]);

  // On load (and when the data/columns change), scroll today's column into the
  // middle of the viewport. Skipped while editing so we don't yank the grid.
  useEffect(() => {
    if (loading || editing) return;
    const cont = scrollRef.current;
    if (!cont || todayColIdx < 0) return;
    const cell = cont.querySelector<HTMLElement>(`th[data-colidx="${todayColIdx}"]`);
    if (!cell) return;
    const stickyW = 158; // width of the sticky "Phase" column
    const contRect = cont.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const visibleCenter = stickyW + (cont.clientWidth - stickyW) / 2;
    cont.scrollLeft += (cellRect.left - contRect.left) - visibleCenter + cellRect.width / 2;
  }, [todayColIdx, loading, editing, view.length]);

  function startEdit() {
    // A background save is still writing — starting a new edit now would
    // race it (and a failed save's rollback would clobber the new draft).
    if (saving) return;
    setSaveError(null);
    // Deep-clone so edits don't mutate the saved snapshot (Cancel reverts).
    setDraft(phaseHours.map((p) => ({ ...p, weeks: p.weeks.map((w) => ({ ...w })) })));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft([]);
    setSaveError(null);
    setShowRangeEditor(false);
    setRangeRows([]);
  }

  // "Set hours for a date range": opens the normal edit grid alongside a
  // small builder where the user adds one or more [From, To, Hours/week]
  // rows via "+"; Apply stamps that hours value onto every week between
  // From and To (inclusive) without touching weeks outside any row's range.
  function openRangeEditor() {
    startEdit();
    // Pre-fill the first row with the member's assignment dates so the user
    // doesn't have to type them — they can just fill in the hours/week value.
    const toHtmlDate = (iso: string | undefined) => {
      if (!iso) return "";
      const d = parseScheduleDate(iso);
      if (!d) return "";
      return d.toISOString().slice(0, 10);
    };
    // Default "From" to the current week's Monday so the dialog opens at
    // today's week, not the member's (often past) assignment start.
    const memberFromIso = toHtmlDate(person.memberStart);
    const memberToIso   = toHtmlDate(person.memberEnd);
    const todayMon = (() => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    const fromDefault = memberFromIso
      ? (todayMon >= memberFromIso && (!memberToIso || todayMon <= memberToIso)
          ? todayMon
          : memberFromIso)
      : todayMon;
    const firstRow = { ...newRangeRow(), from: fromDefault, to: memberToIso };
    setRangeRows([firstRow]);
    setShowRangeEditor(true);
  }

  function addRangeRow() {
    setRangeRows((prev) => [...prev, newRangeRow()]);
  }

  function removeRangeRow(id: number) {
    setRangeRows((prev) => prev.filter((r) => r._id !== id));
  }

  function updateRangeRow(id: number, field: keyof RangeRow, val: string) {
    setRangeRows((prev) => prev.map((r) => (r._id === id ? { ...r, [field]: val } : r)));
  }

  // Stamp every configured range's hours value onto the weeks it covers. If
  // several phases already carry a given week, the value is split evenly
  // across them (so column totals land exactly on what was typed); a week
  // untouched by any phase falls onto the last row (matches how new cells
  // land when typed directly into the grid).
  // Pure helper (no state writes) so both applyRangeRows (manual "Apply to
  // grid" click) and handleSave (auto-apply on "Save", see below) can stamp
  // the same range rows onto the same starting draft without a state-timing
  // race — `setDraft` is async, so handleSave can't just call applyRangeRows
  // and then immediately read `draft` in the same tick.
  function computeRangeApplied(base: PhaseHourEntry[], rows: RangeRow[]) {
    const skippedRows: string[] = [];
    let anyInvalidDates = false;
    let next = base.map((p) => ({ ...p, weeks: p.weeks.map((w) => ({ ...w })) }));
    const sortWeeks = (weeks: WeekEntry[]) => weeks.slice().sort((a, b) => {
      const da = parseWeekKey(a.key), db = parseWeekKey(b.key);
      if (!da || !db) return a.key.localeCompare(b.key);
      return da.getTime() - db.getTime();
    });
    for (const row of rows) {
      if (!row.from || !row.to) continue;
      const fromT = new Date(row.from).getTime();
      const toT = new Date(row.to).getTime();
      if (isNaN(fromT) || isNaN(toT) || toT < fromT) { anyInvalidDates = true; continue; }
      const hoursVal = Math.max(0, Math.round(Number(row.hours) || 0));
      let matchedAnyWeek = false;
      // Apply to existing weeks that fall in range
      for (const wk of weekKeys) {
        const d = parseWeekKey(wk);
        if (!d) continue;
        const t = d.getTime();
        if (t < fromT || t > toT) continue;
        matchedAnyWeek = true;
        const matchIdxs = next.map((p, i) => (p.weeks.some((w) => w.key === wk) ? i : -1)).filter((i) => i >= 0);
        if (matchIdxs.length > 0) {
          const share = Math.floor(hoursVal / matchIdxs.length);
          const extra = hoursVal - share * matchIdxs.length;
          matchIdxs.forEach((pi, idx) => {
            const add = share + (idx < extra ? 1 : 0);
            next[pi] = { ...next[pi], weeks: next[pi].weeks.map((w) => (w.key === wk ? { ...w, hours: add } : w)) };
          });
        } else if (next.length > 0) {
          const pi = next.length - 1;
          next[pi] = { ...next[pi], weeks: sortWeeks([...next[pi].weeks, { key: wk, hours: hoursVal }]) };
        }
      }
      // Synthesize new week columns for dates that fall OUTSIDE the existing grid.
      // Walk backwards from the first grid week (or forward from the last) in
      // 7-day steps — keeping alignment with the existing cadence — and add
      // synthetic week entries to the last phase (Other/Unscheduled).
      if (hoursVal > 0 && weekKeys.length > 0 && next.length > 0) {
        const firstWkT = parseWeekKey(weekKeys[0])!.getTime();
        const lastWkT  = parseWeekKey(weekKeys[weekKeys.length - 1])!.getTime();
        const weekMs   = 7 * 86400000;
        const lastPi   = next.length - 1;
        const existingSet = new Set(weekKeys);
        // Pre-grid gap: FROM is before the first grid week
        if (fromT < firstWkT) {
          let cursor = firstWkT - weekMs;
          while (cursor >= fromT) {
            if (cursor <= toT) {
              const wk = fmtWeekKey(new Date(cursor));
              if (!existingSet.has(wk) && !next[lastPi].weeks.some(w => w.key === wk)) {
                next[lastPi] = { ...next[lastPi], weeks: sortWeeks([...next[lastPi].weeks, { key: wk, hours: hoursVal }]) };
                matchedAnyWeek = true;
              }
            }
            cursor -= weekMs;
          }
        }
        // Post-grid gap: TO is after the last grid week
        if (toT > lastWkT + 6 * 86400000) {
          let cursor = lastWkT + weekMs;
          while (cursor <= toT) {
            const wk = fmtWeekKey(new Date(cursor));
            if (!existingSet.has(wk) && !next[lastPi].weeks.some(w => w.key === wk)) {
              next[lastPi] = { ...next[lastPi], weeks: sortWeeks([...next[lastPi].weeks, { key: wk, hours: hoursVal }]) };
              matchedAnyWeek = true;
            }
            cursor += weekMs;
          }
        }
      }
      if (!matchedAnyWeek) skippedRows.push(`${row.from} – ${row.to}`);
    }
    return { next, skippedRows, anyInvalidDates };
  }

  function hasPendingRangeInput() {
    return showRangeEditor && rangeRows.some((r) => r.from && r.to);
  }

  function setCellHours(phaseIdx: number, weekKey: string, val: string) {
    // Allow values over MAX_WEEKLY_HOURS to remain visible (the save is blocked
    // and an inline error is shown until corrected — never clamp silently).
    const raw = Number(val) || 0;
    const n = raw < 0 ? 0 : Math.round(raw);
    setDraft((prev) => prev.map((p, pi) => {
      if (pi !== phaseIdx) return p;
      // If the week is already part of this phase, update it in place.
      if (p.weeks.some((w) => w.key === weekKey)) {
        return { ...p, weeks: p.weeks.map((w) => (w.key === weekKey ? { ...w, hours: n } : w)) };
      }
      // Otherwise the user typed into a previously-locked (dot) cell — pull
      // that week into this phase, keeping the row sorted chronologically.
      const weeks: WeekEntry[] = [...p.weeks, { key: weekKey, hours: n }].sort((a, b) => {
        const da = parseWeekKey(a.key), db = parseWeekKey(b.key);
        if (!da || !db) return a.key.localeCompare(b.key);
        return da.getTime() - db.getTime();
      });
      return { ...p, weeks };
    }));
  }

  async function handleSave() {
    // "Save" alone should do everything: if the user typed a From/To/Hours
    // row but never clicked "Apply to grid" first, stamp it onto the draft
    // now so one click (Save) both applies AND persists — no more
    // apply-then-save two-step. Uses the SAME computeRangeApplied helper as
    // the manual "Apply to grid" button so the two paths can never drift.
    let finalDraft = draft;
    if (hasPendingRangeInput()) {
      const { next, skippedRows, anyInvalidDates } = computeRangeApplied(draft, rangeRows);
      finalDraft = next;
      setDraft(next);
      if (skippedRows.length > 0) {
        setSaveError(
          `No project weeks fall inside: ${skippedRows.join(", ")}. Those rows had no effect — ` +
          `check the range is within the project's schedule.`
        );
        return;
      }
      if (anyInvalidDates) {
        setSaveError("One or more rows have an invalid range (To date before From date, or missing dates). Fix or remove them before saving.");
        return;
      }
    }
    // Max-168 validation: block save when any week exceeds the limit.
    // Values over 168 remain visible in the grid with an inline error.
    const violations = findDraftViolations(finalDraft);
    if (violations.length > 0) {
      setSaveError(
        `${violations.length} week${violations.length > 1 ? "s exceed" : " exceeds"} the ${MAX_WEEKLY_HOURS}h per-week maximum ` +
        `(e.g. the week of ${violations[0].key}: ${violations[0].hours}h). Correct highlighted cells before saving.`
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    const weekPatches = weekPatchesFromPhaseHours(finalDraft);
    const memberId = person.resourceId ?? person.name;
    const hadExplicitDates = showRangeEditor && rangeRows.some(r => r.from && r.to);
    // Optimistic save: show the new numbers and close the editor NOW — the
    // server write continues in the background (a small "Saving…" chip in
    // the header shows while it's in flight). On failure the editor reopens
    // with the full draft intact, so nothing the user typed is ever lost.
    const prevHours = phaseHours;
    setPhaseHours(finalDraft);
    setEditing(false);
    setDraft([]);
    try {
      await saveMemberWeeklyHours({
        projectId,
        memberId,
        memberName: person.name,
        memberRole: "",
        weekPatches,
      });
      setReloadKey((k) => k + 1);
      onSaved?.(hadExplicitDates);
    } catch (e) {
      // Roll back the optimistic numbers and reopen the editor with the
      // user's draft so they can retry without retyping anything.
      setPhaseHours(prevHours);
      setDraft(finalDraft.map((p) => ({ ...p, weeks: p.weeks.map((w) => ({ ...w })) })));
      setEditing(true);
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Per-week violations in the current draft — computed each render so the Save
  // button and cell borders update immediately as the user corrects values.
  const draftViolations = useMemo(
    () => editing ? findDraftViolations(draft) : [],
    [editing, draft],
  );
  const hasDraftViolations = draftViolations.length > 0;
  // Set of violating week keys for fast per-cell lookup in the table body.
  const violatingWeekKeys = useMemo(
    () => new Set(draftViolations.map(v => v.key)),
    [draftViolations],
  );

  const cellPad = "5px 6px";
  const stickyLeft: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 1, background: C.surfaceDeep,
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 8, gap: 8,
      }}>
        <div style={{
          fontSize: 11, color: C.muted, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>Hours by Phase</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!loading && view.length > 0 && !(editing && showRangeEditor) && (
            <div style={{
              background: C.green, color: C.text, padding: "3px 10px",
              borderRadius: 12, fontSize: 12, fontWeight: 700,
            }}>Total: {grandTotal}h</div>
          )}
          {saving && !editing && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, fontWeight: 600, color: C.muted,
            }}>
              <Loader2 size={11} className="animate-spin" /> Saving…
            </div>
          )}
          {canEdit && allowPastDateEdit && !loading && !error && phaseHours.length > 0 && !editing && (
            <div style={{ position: "relative" }}>
              <button
                ref={distributeBtnRef}
                onClick={() => {
                  if (!showDistributeMenu && distributeBtnRef.current) {
                    const rect = distributeBtnRef.current.getBoundingClientRect();
                    setMenuPos({
                      top: rect.bottom + 4,
                      right: window.innerWidth - rect.right,
                    });
                  }
                  setShowDistributeMenu((v) => !v);
                }}
                disabled={rescaling || saving || weekKeys.length === 0}
                title={weekKeys.length === 0
                  ? "Add phase dates in the Schedule tab first — no weeks to schedule yet."
                  : "Choose how to set this member's weekly hours."}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: C.green, border: `1px solid ${C.green}`,
                  color: "#fff", padding: "4px 12px", borderRadius: 8,
                  fontSize: 11, fontWeight: 700,
                  cursor: (rescaling || saving || weekKeys.length === 0) ? "not-allowed" : "pointer",
                  opacity: (rescaling || saving || weekKeys.length === 0) ? 0.45 : 1,
                  boxShadow: weekKeys.length === 0 ? "none" : `0 0 8px ${C.green}55`,
                }}
              >
                {rescaling ? <Loader2 size={11} className="animate-spin" /> : null}
                Schedule Hours
              </button>
              {showDistributeMenu && !rescaling && menuPos && createPortal(
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: Z.MODAL }}
                    onClick={() => setShowDistributeMenu(false)}
                  />
                  <div style={{
                    position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: Z.MODAL_MENU,
                    background: C.surfaceDeep, border: `1px solid ${C.border}`,
                    borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    minWidth: 260, overflow: "hidden",
                  }}>
                    <button
                      onClick={() => { setShowDistributeMenu(false); setFlatHours(""); setShowFlatInput(true); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: "none", border: "none", cursor: "pointer",
                        padding: "10px 12px", color: C.text,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Uniform Weekly Hours</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        Type one hours/week value — it's applied to every week at once.
                      </div>
                    </button>
                    <div style={{ height: 1, background: C.border }} />
                    <button
                      onClick={() => { setShowDistributeMenu(false); openRangeEditor(); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: "none", border: "none", cursor: "pointer",
                        padding: "10px 12px", color: C.text,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Set hours for a date range</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        Pick a "From – To" date range and one hours/week value; add more
                        rows with + for different periods.
                      </div>
                    </button>
                    <div style={{ height: 1, background: C.border }} />
                    <button
                      onClick={() => { if (grandTotal > 0) { setShowDistributeMenu(false); distributeEvenly(); } }}
                      disabled={grandTotal <= 0}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: "none", border: "none",
                        cursor: grandTotal > 0 ? "pointer" : "default",
                        padding: "10px 12px", color: C.text,
                        opacity: grandTotal <= 0 ? 0.4 : 1,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Distribute evenly</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        {grandTotal > 0
                          ? `Spread ${grandTotal}h evenly across all ${weekKeys.length} weeks (≈${weekKeys.length > 0 ? Math.round(grandTotal / weekKeys.length) : 0}h/week).`
                          : "Set total hours first (via Edit Allocation), then distribute."}
                      </div>
                    </button>
                  </div>
                </>,
                document.body,
              )}
              {showFlatInput && !rescaling && createPortal(
                (() => {
                  const flatNum = Math.round(Number(flatHours) || 0);
                  const flatOverLimit = flatHours.trim() !== "" && flatNum > MAX_WEEKLY_HOURS;
                  const flatCanApply = flatHours.trim() !== "" && !flatOverLimit;
                  return (
                    <>
                      <div
                        style={{ position: "fixed", inset: 0, zIndex: Z.MODAL }}
                        onClick={() => setShowFlatInput(false)}
                      />
                      <div style={{
                        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                        zIndex: Z.MODAL_MENU, background: C.surfaceDeep, border: `1px solid ${C.border}`,
                        borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                        minWidth: 300, padding: 16,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                          Uniform Weekly Hours
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                          Applies to all {weekKeys.length} scheduled weeks for {person.name}.
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="number"
                            min={0}
                            autoFocus
                            value={flatHours}
                            onChange={(e) => setFlatHours(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && flatCanApply) applyFlatHours();
                              if (e.key === "Escape") setShowFlatInput(false);
                            }}
                            placeholder="e.g. 40"
                            style={{
                              flex: 1, background: C.surface,
                              border: `1px solid ${flatOverLimit ? C.red : C.border}`,
                              color: flatOverLimit ? C.red : C.text,
                              borderRadius: 8, padding: "8px 10px", fontSize: 13,
                            }}
                          />
                          <span style={{ fontSize: 11, color: C.mutedSoft }}>h/week</span>
                        </div>
                        {flatOverLimit && (
                          <div style={{
                            display: "flex", alignItems: "center", gap: 5,
                            marginTop: 6, fontSize: 11, color: C.red,
                          }}>
                            <AlertTriangle size={11} />
                            {`${flatNum}h exceeds the ${MAX_WEEKLY_HOURS}h per-week maximum.`}
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                          <button
                            onClick={() => setShowFlatInput(false)}
                            style={{
                              background: C.surface, border: `1px solid ${C.border}`,
                              color: C.text, padding: "6px 12px", borderRadius: 8,
                              fontSize: 11, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={applyFlatHours}
                            disabled={!flatCanApply}
                            style={{
                              background: flatCanApply ? C.green : C.surface,
                              border: `1px solid ${flatCanApply ? C.green : C.border}`,
                              color: C.text, padding: "6px 14px", borderRadius: 8,
                              fontSize: 11, fontWeight: 700,
                              cursor: flatCanApply ? "pointer" : "not-allowed",
                              opacity: flatCanApply ? 1 : 0.5,
                            }}
                          >
                            Apply to all weeks
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })(),
                document.body,
              )}
            </div>
          )}
          {canEdit && allowPastDateEdit && !loading && !error && phaseHours.length > 0 && !editing && (
            <button
              onClick={startEdit}
              disabled={saving}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: C.surface, border: `1px solid ${C.border}`,
                color: C.text, padding: "4px 10px", borderRadius: 8,
                fontSize: 11, fontWeight: 600,
                cursor: saving ? "default" : "pointer", opacity: saving ? 0.5 : 1,
              }}
            >
              <Pencil size={11} /> Edit Allocation
            </button>
          )}
          {canEdit && editing && !showRangeEditor && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={cancelEdit}
                disabled={saving}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: C.surface, border: `1px solid ${C.border}`,
                  color: C.text, padding: "4px 10px", borderRadius: 8,
                  fontSize: 11, fontWeight: 600,
                  cursor: saving ? "default" : "pointer", opacity: saving ? 0.5 : 1,
                }}
              >
                <X size={11} /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: C.green, border: "none",
                  color: C.text, padding: "4px 12px", borderRadius: 8,
                  fontSize: 11, fontWeight: 700,
                  cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && showRangeEditor && (
        <div style={{
          marginBottom: 10, padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 8, gap: 8,
          }}>
            <div style={{ fontSize: 11, color: C.mutedSoft }}>
              Set an hours/week value for a date range. Add more rows for other periods —
              weeks outside every range keep their current value.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {!loading && view.length > 0 && (
                <div style={{
                  background: C.green, color: C.text, padding: "3px 10px",
                  borderRadius: 12, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                }}>Total: {grandTotal}h</div>
              )}
              <button
                onClick={cancelEdit}
                disabled={saving}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: C.surface, border: `1px solid ${C.border}`,
                  color: C.text, padding: "4px 10px", borderRadius: 8,
                  fontSize: 11, fontWeight: 600,
                  cursor: saving ? "default" : "pointer", opacity: saving ? 0.5 : 1,
                }}
              >
                <X size={11} /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: C.green, border: "none",
                  color: C.text, padding: "4px 12px", borderRadius: 8,
                  fontSize: 11, fontWeight: 700,
                  cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rangeRows.map((row) => (
              <div key={row._id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: C.mutedSoft, width: 32 }}>From</span>
                <DateField
                  value={row.from}
                  onChange={(v) => updateRangeRow(row._id, "from", v)}
                  compact
                  wrapStyle={{ width: 130 }}
                  style={{
                    background: C.surfaceDeep, border: `1px solid ${C.border}`,
                    color: C.text, borderRadius: 6, padding: "4px 6px", fontSize: 11,
                  }}
                />
                <span style={{ fontSize: 10, color: C.mutedSoft, width: 14, textAlign: "center" }}>To</span>
                <DateField
                  value={row.to}
                  onChange={(v) => updateRangeRow(row._id, "to", v)}
                  compact
                  wrapStyle={{ width: 130 }}
                  style={{
                    background: C.surfaceDeep, border: `1px solid ${C.border}`,
                    color: C.text, borderRadius: 6, padding: "4px 6px", fontSize: 11,
                  }}
                />
                <input
                  type="number"
                  min={0}
                 
                  placeholder="Hrs/wk"
                  value={row.hours}
                  onChange={(e) => updateRangeRow(row._id, "hours", e.target.value)}
                  style={{
                    background: C.surfaceDeep, border: `1px solid ${C.border}`,
                    color: C.text, borderRadius: 6, padding: "4px 6px", fontSize: 11,
                    width: 70,
                  }}
                />
                <button
                  onClick={() => removeRangeRow(row._id)}
                  disabled={rangeRows.length <= 1}
                  title="Remove row"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.mutedSoft, width: 24, height: 24,
                    cursor: rangeRows.length <= 1 ? "default" : "pointer",
                    opacity: rangeRows.length <= 1 ? 0.4 : 1,
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <button
              onClick={addRangeRow}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "none", border: `1px dashed ${C.border}`, borderRadius: 6,
                color: C.mutedSoft, padding: "4px 8px", fontSize: 11, cursor: "pointer",
              }}
            >
              + Add date range
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
          <Loader2 size={14} color={C.green} className="animate-spin" />
          <span style={{ fontSize: 11, color: C.mutedSoft }}>Loading phase hours…</span>
        </div>
      )}

      {!loading && error && (
        <div style={{ fontSize: 11, color: C.orange }}>Couldn’t load phase hours.</div>
      )}

      {!loading && !error && phaseHours.length === 0 && !lifecycleAssigned && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 12px", borderRadius: 8,
          background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
          gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>No phase schedule</div>
            <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 2 }}>
              Set up a lifecycle to track hours by phase
            </div>
          </div>
          {onSetupSchedule && (
            <button
              onClick={onSetupSchedule}
              style={{
                display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                background: C.green, border: "none", borderRadius: 8,
                color: "#fff", padding: "6px 12px", fontSize: 11, fontWeight: 700,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              Set up schedule →
            </button>
          )}
        </div>
      )}

      {!loading && !error && phaseHours.length === 0 && lifecycleAssigned && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 12px", borderRadius: 8,
          background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
          gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Schedule dates not configured</div>
            <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 2 }}>
              Add phase dates to the schedule to track hours by phase
            </div>
          </div>
          {onSetupSchedule && (
            <button
              onClick={onSetupSchedule}
              style={{
                display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                background: "rgba(255,255,255,0.08)", border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.text, padding: "6px 12px",
                fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              Configure dates →
            </button>
          )}
        </div>
      )}

      {saveError && (
        <div style={{
          background: C.orange + "1a", border: `1px solid ${C.orange}55`,
          borderRadius: 8, padding: "6px 10px", marginBottom: 8,
          fontSize: 11, color: C.orange,
        }}>{saveError}</div>
      )}

      {/* Persistent max-168 violation notice — shown while editing and any cell
          exceeds MAX_WEEKLY_HOURS. The save button is blocked until fixed. */}
      {editing && hasDraftViolations && (
        <div style={{
          background: C.red + "1a", border: `1px solid ${C.red}55`,
          borderRadius: 8, padding: "6px 10px", marginBottom: 8,
          fontSize: 11, color: C.red,
          display: "flex", alignItems: "flex-start", gap: 6,
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {draftViolations.length === 1
              ? `The week of ${draftViolations[0].key} is set to ${draftViolations[0].hours}h — the maximum is ${MAX_WEEKLY_HOURS}h/week. Correct the highlighted cell to enable saving.`
              : `${draftViolations.length} weeks exceed ${MAX_WEEKLY_HOURS}h (e.g. ${draftViolations[0].key}: ${draftViolations[0].hours}h). Correct highlighted cells to enable saving.`}
          </span>
        </div>
      )}

      {/* Phase dates missing notice — phases are assigned but no start/end
          dates have been set, so there are no weekly columns to edit. */}
      {!loading && !error && phaseHours.length > 0 && weekKeys.length === 0 && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "10px 12px", borderRadius: 8, marginBottom: 8,
          background: "rgba(232,119,34,0.08)", border: `1px solid rgba(232,119,34,0.35)`,
        }}>
          <AlertTriangle size={14} color={C.orange} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
              Phase dates not set
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
              The phases above exist but have no start or end dates — so there are no weeks to allocate hours into.
              Add dates to each phase in the <strong style={{ color: C.text }}>Schedule tab</strong>, or switch to
              a schedule-free mode in Settings if this project doesn't use phase dates.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {onSetupSchedule && (
                <button
                  onClick={onSetupSchedule}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: C.green, border: "none", borderRadius: 7,
                    color: "#fff", padding: "5px 12px", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  Add dates in Schedule tab →
                </button>
              )}
              <a
                href="/configuration/organization"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  color: C.muted, fontSize: 11, fontWeight: 600,
                  textDecoration: "none", whiteSpace: "nowrap",
                  padding: "5px 10px", borderRadius: 7,
                  border: `1px solid ${C.border}`, background: C.surface,
                }}
              >
                <ExternalLink size={10} />
                Change to "Without Schedule" in Settings
              </a>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && view.length > 0 && (
        <div ref={scrollRef} style={{
          overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10,
        }}>
          <table style={{
            borderCollapse: "separate", borderSpacing: 0,
            width: "max-content", minWidth: "100%",
            fontSize: 11, color: C.text,
          }}>
            <thead>
              <tr>
                <th style={{
                  ...stickyLeft, textAlign: "left", padding: cellPad,
                  fontSize: 10, fontWeight: 700, color: C.muted,
                  textTransform: "uppercase", letterSpacing: 0.4,
                  borderBottom: `1px solid ${C.border}`, minWidth: 150,
                }}>Phase</th>
                {weekKeys.map((wk, i) => {
                  const [d, mo] = fmtWeekLabel(wk).split(" ");
                  const dt = parseWeekKey(wk);
                  const yy = dt ? String(dt.getFullYear()).slice(-2) : "";
                  const isToday = i === todayColIdx;
                  const isPast = weekIsPast[i];
                  const weekAge = isPast ? Math.floor((thisWeekMonMs - (parseWeekKey(wk)?.getTime() ?? thisWeekMonMs)) / (7 * 86400000)) : 0;
                  const isLocked = isPast && (!allowPastDateEdit || (pastEditLimitWeeks !== null && weekAge > pastEditLimitWeeks));
                  // Compute each of the 7 days for this week from the Monday key
                  // (Mon..Sun), flagging any that fall on a company holiday. Date
                  // math uses local-midnight setDate arithmetic so DST never skews
                  // the day. iso key is built from local getFullYear/Month/Date.
                  const weekMon = dt;
                  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
                  const dayHolidays = dayOrder.map((_dow, offset) => {
                    if (!weekMon) return null as { iso: string; label: string } | null;
                    const day = new Date(weekMon.getFullYear(), weekMon.getMonth(), weekMon.getDate() + offset);
                    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
                    const label = holidayMap.get(iso);
                    return label ? { iso, label } : null;
                  });
                  const holidayLines = dayHolidays
                    .filter((h): h is { iso: string; label: string } => h !== null)
                    .map(h => {
                      const [, mm, dd] = h.iso.split("-");
                      const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm) - 1] ?? "";
                      return `Holiday: ${h.label} (${monthName} ${Number(dd)})`;
                    });
                  const baseTitle = isToday
                    ? `${wk} (current week)`
                    : isLocked ? `${wk} (past — locked)` : wk;
                  const colTitle = holidayLines.length > 0
                    ? `${baseTitle}\n${holidayLines.join("\n")}`
                    : baseTitle;
                  const isActivePopup = weekPopup?.wk === wk;
                  return (
                    <th
                      key={wk}
                      data-colidx={i}
                      title={colTitle}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setWeekPopup((prev) => prev?.wk === wk ? null : { wk, rect });
                      }}
                      style={{
                        padding: cellPad, textAlign: "center", minWidth: 42,
                        fontWeight: 600, color: C.muted,
                        borderBottom: `1px solid ${C.border}`,
                        borderLeft: `1px solid ${C.border}`,
                        borderTop: isToday ? `2px solid ${C.green}` : undefined,
                        background: isActivePopup
                          ? C.green + "33"
                          : isToday ? C.green + "1f" : isPast ? "rgba(0,0,0,0.025)" : undefined,
                        lineHeight: 1.15, whiteSpace: "nowrap",
                        opacity: isLocked ? 0.65 : 1,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      <div style={{ fontSize: 12, color: isToday ? C.green : C.text, fontWeight: isToday ? 800 : 600 }}>{d}</div>
                      <div style={{ fontSize: 9, color: C.muted }}>{mo}{yy ? ` '${yy}` : ""}</div>
                      {nonWorkingDays.length > 0 && (
                        <div style={{ display: "flex", gap: 1, justifyContent: "center", marginTop: 2 }}>
                          {dayOrder.map((dow, offset) => {
                            const isOff = nonWorkingDays.includes(dow);
                            const isHoliday = dayHolidays[offset] !== null;
                            return (
                              <div key={dow} style={{
                                width: 4, height: 4, borderRadius: 1,
                                background: isHoliday ? "#f59e0b" : isOff ? "#e53535" : "#22a84a",
                              }} />
                            );
                          })}
                        </div>
                      )}
                      {isLocked && (
                        <div style={{ fontSize: 8, color: C.mutedSoft, marginTop: 1 }}>🔒</div>
                      )}
                    </th>
                  );
                })}
                <th style={{
                  position: "sticky", right: 0, background: C.surfaceDeep,
                  padding: cellPad, textAlign: "center", minWidth: 52,
                  fontSize: 10, fontWeight: 700, color: C.muted,
                  textTransform: "uppercase", letterSpacing: 0.4,
                  borderBottom: `1px solid ${C.border}`,
                  borderLeft: `1px solid ${C.border}`,
                }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {view.map((ph, ri) => {
                const phTotal = getPhaseTotal(ph);
                // Prefer the phase's ACTUAL schedule dates (what the Schedule tab
                // shows, e.g. "16 Jun") over the Monday-aligned first/last week
                // keys (which can read "15 Jun"). Fall back to the week range
                // only when the schedule dates aren't carried on the phase.
                const schedRange = (ph.phaseStart && ph.phaseEnd)
                  ? (() => {
                      const first = fmtDateLabel(ph.phaseStart);
                      const last = fmtDateLabel(ph.phaseEnd);
                      if (!first || !last) return "";
                      return first === last ? first : `${first} – ${last}`;
                    })()
                  : "";
                const range = schedRange || (ph.weeks.length > 0
                  ? (() => {
                      const first = fmtWeekLabel(ph.weeks[0].key);
                      const last = fmtWeekLabel(ph.weeks[ph.weeks.length - 1].key);
                      return first === last ? first : `${first} – ${last}`;
                    })()
                  : "");
                return (
                  <tr key={ph.stageStep}>
                    <td style={{
                      ...stickyLeft, padding: cellPad,
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: `3px solid ${ph.color}`,
                    }}>
                      <div style={{
                        fontWeight: 600, fontSize: 12,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        maxWidth: 160,
                      }}>{ph.phaseName}</div>
                      {range && (
                        <div style={{ fontSize: 9, color: C.mutedSoft, marginTop: 1 }}>{range}</div>
                      )}
                    </td>
                    {weekKeys.map((wk, ci) => {
                      const h = rowMaps[ri][wk];
                      const has = h !== undefined && h > 0;
                      const inPhase = rowMaps[ri][wk] !== undefined;
                      const cellIsPast = weekIsPast[ci];
                      const cellAge = cellIsPast ? Math.floor((thisWeekMonMs - (parseWeekKey(wk)?.getTime() ?? thisWeekMonMs)) / (7 * 86400000)) : 0;
                      const cellIsLocked = cellIsPast && (!allowPastDateEdit || (pastEditLimitWeeks !== null && cellAge > pastEditLimitWeeks));
                      if (editing) {
                        // Every cell is editable while editing — typing into a
                        // week outside this phase's schedule pulls it into the
                        // phase (see setCellHours). Out-of-schedule cells render
                        // a dimmed input so the phase's own weeks stay visible.
                        // Past-week cells are locked unless allowPastDateEdit.
                        return (
                          <td key={wk} style={{
                            padding: "2px 3px", textAlign: "center",
                            borderBottom: `1px solid ${C.border}`,
                            borderLeft: `1px solid ${C.border}`,
                            background: cellIsLocked
                              ? "rgba(0,0,0,0.025)"
                              : has ? C.green + "22" : "transparent",
                          }}>
                            <input
                              type="number"
                              inputMode="numeric"
                              className="rm-no-spin"
                              min={0}
                             
                              disabled={cellIsLocked}
                              value={h ?? 0}
                              onChange={(e) => setCellHours(ri, wk, e.target.value)}
                              onFocus={(e) => e.currentTarget.select()}
                              title={
                                cellIsLocked
                                  ? "Past week — locked (enable editing in Settings → Hours grid)"
                                  : inPhase ? undefined : "Outside this phase's scheduled dates"
                              }
                              style={{
                                width: 34, padding: "3px 2px", textAlign: "center",
                                background: C.surfaceDeep,
                                border: `1px solid ${C.border}`, borderRadius: 5,
                                color: C.text, fontWeight: 700, fontSize: 11,
                                fontFamily: "inherit",
                                opacity: cellIsLocked ? 0.35 : inPhase ? 1 : 0.55,
                                cursor: cellIsLocked ? "not-allowed" : undefined,
                              }}
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={wk} style={{
                          padding: cellPad, textAlign: "center",
                          borderBottom: `1px solid ${C.border}`,
                          borderLeft: `1px solid ${C.border}`,
                          color: has ? C.text : C.mutedSoft,
                          fontWeight: has ? 700 : 400,
                          background: has
                            ? C.green + "22"
                            : cellIsPast ? "rgba(0,0,0,0.015)" : "transparent",
                        }}>
                          {inPhase ? (has ? h : "0") : "·"}
                        </td>
                      );
                    })}
                    <td style={{
                      position: "sticky", right: 0, background: C.surfaceDeep,
                      padding: cellPad, textAlign: "center", fontWeight: 700,
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: `1px solid ${C.border}`,
                    }}>{phTotal}h</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{
                  ...stickyLeft, padding: cellPad, fontWeight: 700,
                  fontSize: 10, color: C.muted, textTransform: "uppercase",
                  letterSpacing: 0.4, borderTop: `2px solid ${C.border}`,
                }}>Total</td>
                {weekKeys.map((wk) => {
                  const t = colTotals[wk] ?? 0;
                  return (
                    <td key={wk} style={{
                      padding: cellPad, textAlign: "center", fontWeight: 700,
                      color: t > 0 ? C.green : C.mutedSoft,
                      borderTop: `2px solid ${C.border}`,
                      borderLeft: `1px solid ${C.border}`,
                    }}>{t || "·"}</td>
                  );
                })}
                <td style={{
                  position: "sticky", right: 0, background: C.surfaceDeep,
                  padding: cellPad, textAlign: "center", fontWeight: 800,
                  color: C.green, borderTop: `2px solid ${C.border}`,
                  borderLeft: `1px solid ${C.border}`,
                }}>{grandTotal}h</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editing && (
        <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 6 }}>
          Type hours directly into any cell, then Save. Cells outside a phase’s scheduled dates are dimmed but can still take hours.
        </div>
      )}

      {weekPopup && createPortal(
        (() => {
          const { wk, rect } = weekPopup;
          const mondayDate = parseWeekKey(wk);
          if (!mondayDate) return null;

          const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
          const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const days = [0,1,2,3,4,5,6].map((offset) => {
            const date = new Date(mondayDate);
            date.setDate(date.getDate() + offset);
            return { date, label: DAYS[offset], jsDay: date.getDay(), month: MONTHS[date.getMonth()] };
          });
          const enriched = days.map(day => ({ ...day, isOff: nonWorkingDays.includes(day.jsDay) }));

          const totalHours = colTotals[wk] ?? 0;
          const workingCount = enriched.filter(d => !d.isOff).length;
          const hpd = workingCount > 0 && totalHours > 0 ? totalHours / workingCount : 0;
          const hpdDisplay = hpd > 0 ? (Number.isInteger(hpd) ? String(hpd) : hpd.toFixed(1)) : null;

          const CARD_W = 54;
          const GAP = 6;
          const PAD_H = 16;
          const POPUP_W = 7 * CARD_W + 6 * GAP + PAD_H * 2;
          const POPUP_H_EST = 210;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          let left = rect.left + rect.width / 2 - POPUP_W / 2;
          left = Math.max(8, Math.min(left, vw - POPUP_W - 8));
          // Always prefer above the header so the popup never covers the grid.
          // Only fall back to below when there is not enough room above.
          const aboveTop = rect.top - POPUP_H_EST - 8;
          const top = aboveTop >= 8 ? aboveTop : rect.bottom + 8;

          const animId = "wk-popup-anim";

          return (
            <>
              <style>{`
                @keyframes ${animId} {
                  from { opacity: 0; transform: translateY(8px) scale(0.97); }
                  to   { opacity: 1; transform: translateY(0)   scale(1); }
                }
              `}</style>
              <div style={{ position:"fixed", inset:0, zIndex:Z.PAGE_OVERLAY }} onClick={() => setWeekPopup(null)} />
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position:"fixed", top, left, zIndex:Z.PAGE_OVERLAY_POPUP,
                  width: POPUP_W,
                  background: isDark
                    ? "linear-gradient(160deg,rgba(22,30,24,0.98) 0%,rgba(14,22,18,0.98) 100%)"
                    : "linear-gradient(160deg,#ffffff 0%,#f3f6f3 100%)",
                  border: isDark ? `1px solid ${C.green}44` : `1px solid ${C.green}55`,
                  borderRadius:16,
                  boxShadow: isDark
                    ? `0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px ${C.green}22, inset 0 1px 0 rgba(255,255,255,0.05)`
                    : `0 12px 40px rgba(0,0,0,0.14), 0 0 0 1px ${C.green}18`,
                  padding:`14px ${PAD_H}px 16px`,
                  animation:`${animId} 0.18s cubic-bezier(0.22,1,0.36,1) both`,
                }}
              >
                {/* Header */}
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:800, color:C.green, textTransform:"uppercase", letterSpacing:1.2, marginBottom:2 }}>
                      WEEK OF {enriched[0].date.getDate()} {enriched[0].month} {enriched[0].date.getFullYear()}
                    </div>
                    <div style={{ fontSize:11, color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)" }}>
                      {workingCount} working day{workingCount!==1?"s":""} · {7-workingCount} off
                    </div>
                  </div>
                  {totalHours > 0 && (
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:20, fontWeight:800, color:C.green, lineHeight:1 }}>{totalHours}h</div>
                      {hpdDisplay && <div style={{ fontSize:10, color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)", marginTop:2 }}>{hpdDisplay}h/day</div>}
                    </div>
                  )}
                </div>

                {/* Day cards — horizontal row */}
                <div style={{ display:"flex", gap:GAP }}>
                  {enriched.map(({ date, label, month, isOff }) => {
                    const dayH = !isOff && hpdDisplay ? hpdDisplay : null;
                    const isToday = (() => {
                      const n = new Date();
                      return date.getDate()===n.getDate() && date.getMonth()===n.getMonth() && date.getFullYear()===n.getFullYear();
                    })();
                    return (
                      <div key={label} style={{
                        flex:1, borderRadius:10,
                        background: isOff
                          ? "rgba(229,53,53,0.08)"
                          : isToday
                            ? `${C.green}28`
                            : isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                        border: isToday
                          ? `1px solid ${C.green}77`
                          : isOff
                            ? "1px solid rgba(229,53,53,0.22)"
                            : isDark ? `1px solid rgba(255,255,255,0.07)` : `1px solid rgba(0,0,0,0.09)`,
                        padding:"8px 4px 8px",
                        display:"flex", flexDirection:"column", alignItems:"center",
                        gap:2,
                        position:"relative",
                        overflow:"hidden",
                      }}>
                        {/* today accent bar */}
                        {isToday && (
                          <div style={{
                            position:"absolute", top:0, left:0, right:0, height:2,
                            background:C.green, borderRadius:"10px 10px 0 0",
                          }} />
                        )}
                        {/* Day abbr */}
                        <div style={{
                          fontSize:9, fontWeight:700, letterSpacing:0.5,
                          color: isOff ? "#e53535" : isToday ? C.green : isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
                          textTransform:"uppercase",
                        }}>{label}</div>
                        {/* Date number */}
                        <div style={{
                          fontSize:17, fontWeight:800, lineHeight:1.1,
                          color: isOff ? "rgba(229,53,53,0.7)" : isToday ? C.green : isDark ? "#fff" : "#111",
                        }}>{date.getDate()}</div>
                        {/* Month */}
                        <div style={{ fontSize:8, color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.35)", textTransform:"uppercase", letterSpacing:0.4 }}>
                          {month}
                        </div>
                        {/* Hours or OFF badge */}
                        <div style={{
                          marginTop:4, fontSize:10, fontWeight:700,
                          color: isOff ? "#e53535bb" : dayH ? C.green : "transparent",
                          background: isOff
                            ? "rgba(229,53,53,0.12)"
                            : dayH ? `${C.green}20` : "transparent",
                          borderRadius:6, padding:"1px 5px",
                          minWidth:24, textAlign:"center",
                          letterSpacing:0.2,
                        }}>
                          {isOff ? "OFF" : dayH ? `${dayH}h` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {totalHours === 0 && (
                  <div style={{ textAlign:"center", marginTop:10, fontSize:10, color: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)" }}>
                    No hours recorded this week
                  </div>
                )}
              </div>
            </>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
