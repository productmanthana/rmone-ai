import { useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Check, ChevronDown, ChevronUp, Plus, Minus, Shuffle, AlertTriangle } from "lucide-react";
import {
  getFullProjectAllocations, getTaskData, bustCache,
} from "@/lib/api";
import {
  type PhaseHourEntry, type AllocationRow, type AllocationsResponse,
  fmtWeekLabel, getPhaseTotal, derivePhaseHours, spreadTotalOverWeeks,
  matchMemberAlloc, parseWeekKey, toISODate,
} from "@/lib/phaseHours";
import type { ProjectMemberHoursUpdate } from "@/lib/teamCache";
import { getBusinessRules } from "@/lib/businessRules";
import { MAX_WEEK_HOURS, MAX_WEEK_HOURS_HINT } from "@/lib/utilGrid";
import { Z } from "@/lib/zLayers";
import {
  saveMemberWeeklyHours,
  NotOnTeamError,
  AllocationLockedError,
  SaveMismatchError,
} from "@/lib/saveMemberWeeklyHours";

const C = {
  bg: "var(--rm-panel)",
  bgDeep: "var(--rm-bg)",
  card: "var(--rm-panel-soft)",
  border: "var(--rm-panel-border)",
  borderSoft: "var(--rm-panel-border)",
  green: "var(--rm-green)",
  greenSoft: "var(--rm-green-soft)",
  orange: "#E87722",
  red: "#F87171",
  text: "var(--rm-text)",
  muted: "var(--rm-text-muted)",
  mutedSoft: "var(--rm-text-faint)",
  surface: "var(--rm-panel-soft)",
  surfaceLight: "var(--rm-panel-soft)",
  surfaceLighter: "var(--rm-panel-soft)",
  accent: "var(--rm-accent-blue)",
};

export interface EditAllocPerson {
  name: string;
  role: string;
  pct: number;
  resourceId?: string;
}

export function EditAllocationModal({
  person, projectId, projectName, onClose, onSaved, onSetupSchedule,
  noDatesDescription, setupScheduleLabel,
}: {
  person: EditAllocPerson;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSaved: (savedHours?: ProjectMemberHoursUpdate) => void;
  onSetupSchedule?: () => void;
  /** Overrides the "Phase dates not set" explanation — creation wizards use
      this to say "finish creating the record first" instead of pointing at
      the detail page's Schedule tab. */
  noDatesDescription?: string;
  /** Label for the onSetupSchedule button in the no-dates state. */
  setupScheduleLabel?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rawData, setRawData] = useState<AllocationsResponse | null>(null);
  const [phaseHours, setPhaseHours] = useState<PhaseHourEntry[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Tracks per-week input violations: keyed `${phaseIdx}:${weekIdx}` → true
  // when that input currently holds a value above MAX_WEEK_HOURS.  The value
  // stays VISIBLE so the user can see and correct it; every save path checks
  // this map to block committing invalid hours.
  const [weekErrors, setWeekErrors] = useState<Set<string>>(new Set());
  // Phase-total violation: true when the drafted phase total would spread to
  // a per-week value above MAX_WEEK_HOURS.
  const [totalDraftError, setTotalDraftError] = useState<string | null>(null);
  // Transient hint when a typed value hits the 168h/week physical ceiling —
  // kept for backward compat but no longer the primary gate (weekErrors is).
  const [capHint, setCapHint] = useState(false);
  const capHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCapHint = () => {
    setCapHint(true);
    if (capHintTimer.current) clearTimeout(capHintTimer.current);
    capHintTimer.current = setTimeout(() => setCapHint(false), 2600);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Fetch the weekly allocation grid AND the authoritative Project Phase
        // Schedule (/task-data — the same source the Schedule tab renders) in
        // parallel. The schedule is best-effort: if it fails we fall back to
        // deriving phases from objProjectLifeCycle below.
        const [allocRes, schedRes] = await Promise.allSettled([
          getFullProjectAllocations(projectId),
          getTaskData(projectId),
        ]);
        if (cancelled) return;
        if (allocRes.status !== "fulfilled") throw allocRes.reason;
        const data = allocRes.value as AllocationsResponse;
        setRawData(data);

        const schedulePhasesRaw: any[] =
          schedRes.status === "fulfilled" && Array.isArray(schedRes.value)
            ? (schedRes.value as any[]) : [];

        // Empty phases start at the Settings work-week hours per week (the
        // user asked for this explicitly: "check Settings first") — flagged
        // entries drive the disclosure note above the phase list.
        setPhaseHours(derivePhaseHours(data, schedulePhasesRaw, person, {
          defaultWeeklyHours: getBusinessRules().workWeekHours,
        }));
        // Fresh load: clear any stale week-error state from a previous open.
        setWeekErrors(new Set());
        setTotalDraftError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, person.name, person.resourceId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handler);
    setTimeout(() => closeRef.current?.focus(), 50);
    return () => window.removeEventListener("keydown", handler);
  }, [saving, onClose]);

  const memberAlloc = useMemo<AllocationRow | null>(
    () => matchMemberAlloc(rawData, person, projectId),
    [rawData, person.name, person.resourceId, person.pct, projectId],
  );

  const updateWeekHour = (phaseIdx: number, weekIdx: number, val: string) => {
    // Do NOT clamp: values above the limit stay visible so the user can correct
    // them.  The error key is set/cleared; all save paths check weekErrors.
    const parsed = Math.max(0, parseInt(val, 10) || 0);
    const errKey = `${phaseIdx}:${weekIdx}`;
    if (parsed > MAX_WEEK_HOURS) {
      flashCapHint();
      setWeekErrors(prev => { const s = new Set(prev); s.add(errKey); return s; });
    } else {
      setWeekErrors(prev => { if (!prev.has(errKey)) return prev; const s = new Set(prev); s.delete(errKey); return s; });
    }
    setPhaseHours((prev) => prev.map((p, pi) => {
      if (pi !== phaseIdx) return p;
      // Store the raw parsed value (may be above limit — shown in red, save blocked).
      const newWeeks = p.weeks.map((w, wi) =>
        wi === weekIdx ? { ...w, hours: parsed } : w
      );
      // Any manual edit adopts the phase: its hours (default or not) are now
      // the user's own numbers and will be saved without confirmation.
      return { ...p, weeks: newWeeks, defaulted: false };
    }));
  };

  // "Spread evenly" re-levels the CURRENT phase total across its weeks using
  // the shared fair distribution (see spreadTotalOverWeeks in lib/phaseHours).
  const spreadPhaseEvenly = (phaseIdx: number) => {
    setPhaseHours((prev) => prev.map((p, pi) => {
      if (pi !== phaseIdx) return p;
      const total = Math.round(getPhaseTotal(p));
      if (p.weeks.length === 0 || total === 0) return p;
      return { ...p, weeks: spreadTotalOverWeeks(p.weeks, total), defaulted: false };
    }));
  };

  // Editable phase total: type a new total for the phase and it is spread
  // evenly across the phase's weeks on commit (blur / Enter). Draft is local
  // so typing "560" doesn't respread at "5" and "56" along the way.
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  const commitTotalDraft = (phaseIdx: number) => {
    if (totalDraft == null) return;
    const raw = totalDraft.trim();
    setTotalDraft(null);
    setTotalDraftError(null);
    if (raw === "") return; // cleared the field = no change
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return; // invalid / negative = no change
    const parsed = Math.round(n); // whole hours: 10.5 → 11 (matches weekly inputs)
    setPhaseHours((prev) => prev.map((p, pi) => {
      if (pi !== phaseIdx) return p;
      // Phase-total ceiling: the spread can never give any week more than
      // 168h, so the total caps at weeks × 168.  Do NOT silently clamp —
      // show an error and leave the phase unchanged so the user can correct.
      const cap = p.weeks.length * MAX_WEEK_HOURS;
      if (parsed > cap) {
        setTotalDraftError(
          `${parsed}h across ${p.weeks.length} week${p.weeks.length !== 1 ? "s" : ""} would need more than ${MAX_WEEK_HOURS}h in a week — ${MAX_WEEK_HOURS_HINT}. The maximum for this phase is ${cap}h.`
        );
        return p; // leave unchanged
      }
      if (p.weeks.length === 0 || Math.round(getPhaseTotal(p)) === parsed) return p;
      return { ...p, weeks: spreadTotalOverWeeks(p.weeks, parsed), defaulted: false };
    }));
  };

  const totalPhaseHours = phaseHours.reduce((s, p) => s + getPhaseTotal(p), 0);

  // Phases still carrying UNTOUCHED editor defaults. Saving these silently
  // would ghost-write hours the user never entered, so Save asks first:
  // keep the defaults, or save only the phases the user actually adjusted.
  const untouchedDefaults = phaseHours.filter((p) => p.defaulted && getPhaseTotal(p) > 0);
  // Hours still sitting at untouched editor defaults are NOT saved. Rolling
  // them into a green "Total: Nh" badge read as a real allocation — users saw
  // "Total: 1045h" here while the team card honestly showed 0% — so the badge
  // must separate real (saved/typed) hours from unsaved suggestions.
  const defaultedTotal = untouchedDefaults.reduce((s, p) => s + getPhaseTotal(p), 0);
  const enteredTotal = totalPhaseHours - defaultedTotal;
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  // Guard against Enter+blur double-save: a ref is synchronously set to true
  // at the start of each save attempt and cleared when it completes, so a
  // rapid Enter→blur sequence that would otherwise fire handleSave twice is
  // collapsed to a single save.  Using a ref (not state) avoids a re-render.
  const saveInFlightRef = useRef(false);

  async function handleSave() {
    if (saveInFlightRef.current) return;
    if (untouchedDefaults.length > 0 && !confirmDefaults) {
      setConfirmDefaults(true);
      return;
    }
    saveInFlightRef.current = true;
    try {
      await doSave(phaseHours);
    } finally {
      saveInFlightRef.current = false;
    }
  }

  async function saveWithoutDefaults() {
    if (saveInFlightRef.current) return;
    // Untouched defaulted phases revert to their stored state (all zero) —
    // zero-hour weeks are dropped on save, so nothing is written for them.
    saveInFlightRef.current = true;
    try {
      await doSave(phaseHours.map((p) =>
        p.defaulted ? { ...p, weeks: p.weeks.map((w) => ({ ...w, hours: 0 })) } : p,
      ));
    } finally {
      saveInFlightRef.current = false;
    }
  }

  async function doSave(entries: PhaseHourEntry[]) {
    if (!memberAlloc) {
      setError("Could not find allocation record for this team member.");
      return;
    }
    // Block save when any week input holds an over-limit value — the input
    // stays visible so the user can see and correct it.
    if (weekErrors.size > 0) {
      setError(`One or more weekly values exceed ${MAX_WEEK_HOURS}h — the maximum is ${MAX_WEEK_HOURS}h/week (${MAX_WEEK_HOURS_HINT}). Correct the highlighted cells before saving.`);
      return;
    }
    // Belt-and-braces: verify all week values in entries directly.
    for (const ph of entries) {
      for (const w of ph.weeks) {
        if (w.hours > MAX_WEEK_HOURS) {
          setError(`${ph.phaseName} — ${w.key}: ${w.hours}h exceeds the ${MAX_WEEK_HOURS}h/week limit. Correct it before saving.`);
          return;
        }
      }
    }
    setSaving(true);
    setError(null);
    try {
      // Build the ISO week → hours map from every visible phase week.
      // All weeks from every phase are included (including zero-hour ones so
      // the server can clear previously-set hours).
      const weekPatches: Record<string, number> = {};
      for (const ph of entries) {
        for (const w of ph.weeks) {
          const d = parseWeekKey(w.key);
          if (!d) continue;
          const iso = toISODate(d);
          weekPatches[iso] = (weekPatches[iso] ?? 0) + w.hours;
        }
      }

      // saveMemberWeeklyHours serializes the write through the shared
      // memberWriteQueue so this modal never races a concurrent grid write
      // for the same person.  At queue turn it fetches fresh server truth
      // and merges weekPatches onto it — preserving any weeks the modal
      // didn't show (e.g. out-of-range weeks in other phases).
      const memberId = person.resourceId ?? person.name;
      const result = await saveMemberWeeklyHours({
        projectId,
        memberId,
        memberName: person.name,
        memberRole: person.role,
        weekPatches,
      });

      // Build the onSaved readback from the confirmed server map.
      const confirmedWeekMap = result.confirmedWeekMap;
      const today = new Date();
      today.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      const currentMonday = toISODate(today);
      const confirmedReadback: ProjectMemberHoursUpdate = {
        memberId,
        weeklyHours: Object.entries(confirmedWeekMap)
          .filter(([, hours]) => hours > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([week, hours]) => ({ week, hours })),
        eacHrs: Object.values(confirmedWeekMap).reduce((total, hours) => total + Math.max(0, hours), 0),
        etcHrs: Object.entries(confirmedWeekMap)
          .filter(([week]) => week >= currentMonday)
          .reduce((total, [, hours]) => total + Math.max(0, hours), 0),
      };

      bustCache("resource-allocations:");
      onSaved(confirmedReadback);
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      // Translate well-known error classes into user-friendly messages where
      // the generic message isn't already clear enough.
      if (e instanceof NotOnTeamError || msg.includes("NOT_ON_TEAM")) {
        msg =
          "This person was removed from the project in another session. " +
          "Refresh to see the updated team before editing hours.";
      } else if (e instanceof AllocationLockedError) {
        // AllocationLockedError message is already user-friendly; pass through.
      } else if (e instanceof SaveMismatchError) {
        // SaveMismatchError message is already user-friendly; pass through.
      }
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const initials =
    person.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  // Phases can exist without dates (schedule not set up yet) — in that case
  // there are no weekly buckets to type hours into, so editing is impossible.
  const hasWeeks = phaseHours.some((p) => p.weeks.length > 0);
  // canSave also blocks when any week input holds an over-limit value, so the
  // Save button greys out immediately (the click path also checks weekErrors
  // in doSave for belt-and-braces, but a disabled button is cleaner UX).
  const canSave = !!memberAlloc && phaseHours.length > 0 && hasWeeks && weekErrors.size === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit allocation"
      onClick={() => { if (!saving) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 16, width: "100%", maxWidth: 540,
          maxHeight: "90vh", display: "flex", flexDirection: "column",
          color: C.text,
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 18,
              background: C.greenSoft, color: C.green,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 13,
            }}>{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{person.name}</div>
              <div style={{
                fontSize: 11, color: C.muted, marginTop: 1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                maxWidth: 380,
              }}>{person.role || "Team Member"} · {projectName}</div>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            style={{
              background: "transparent", border: "none",
              cursor: saving ? "default" : "pointer",
              color: C.muted, padding: 4, display: "flex", alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          padding: "14px 20px", overflowY: "auto", flex: 1, minHeight: 0,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10,
          }}>
            <div style={{
              fontSize: 11, color: C.muted, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: 0.5,
            }}>Hours by Phase</div>
            {defaultedTotal > 0 ? (
              <div
                title="Suggested hours are not saved until you press Save and confirm them."
                style={{
                  background: C.orange + "22", color: C.orange,
                  border: `1px solid ${C.orange}55`, padding: "4px 10px",
                  borderRadius: 12, fontSize: 12, fontWeight: 700,
                }}
              >
                {enteredTotal > 0
                  ? `Total: ${enteredTotal}h + ${defaultedTotal}h suggested (not saved)`
                  : `Suggested: ${totalPhaseHours}h — not saved yet`}
              </div>
            ) : (
              <div style={{
                background: C.green, color: C.text, padding: "4px 10px",
                borderRadius: 12, fontSize: 12, fontWeight: 700,
              }}>Total: {totalPhaseHours}h</div>
            )}
          </div>

          {(capHint || weekErrors.size > 0) && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6,
              fontSize: 11, color: C.red, marginTop: 6,
              background: "rgba(239,68,68,0.08)", border: `1px solid rgba(239,68,68,0.35)`,
              borderRadius: 6, padding: "6px 10px",
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {weekErrors.size > 0
                  ? `${weekErrors.size} week${weekErrors.size !== 1 ? "s" : ""} exceed${weekErrors.size === 1 ? "s" : ""} ${MAX_WEEK_HOURS}h — ${MAX_WEEK_HOURS_HINT}. The highlighted cells must be corrected before saving.`
                  : `Exceeds ${MAX_WEEK_HOURS}h/week — ${MAX_WEEK_HOURS_HINT}.`}
              </span>
            </div>
          )}
          {totalDraftError && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6,
              fontSize: 11, color: C.red, marginTop: 6,
              background: "rgba(239,68,68,0.08)", border: `1px solid rgba(239,68,68,0.35)`,
              borderRadius: 6, padding: "6px 10px",
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{totalDraftError}</span>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 20 }}>
              <Loader2 size={20} color={C.green} className="animate-spin" />
              <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 6 }}>
                Loading allocation data…
              </div>
            </div>
          )}

          {!loading && phaseHours.length === 0 && (
            <div style={{
              background: C.orange + "20", border: `1px solid ${C.orange}55`,
              borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 8,
              fontSize: 12, color: C.orange,
            }}>
              No phase schedule found. Assign a lifecycle first to enable phase hours editing.
              {onSetupSchedule && (
                <button
                  onClick={() => { onClose(); onSetupSchedule(); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    marginLeft: 8, fontSize: 12, fontWeight: 700,
                    color: C.orange, background: "none", border: "none",
                    cursor: "pointer", padding: 0, textDecoration: "underline",
                  }}
                >
                  Go to Schedule →
                </button>
              )}
            </div>
          )}

          {/* Phase dates missing — same explanation the expanded team card
              shows ("Phase dates not set"), so the messaging is consistent
              everywhere editing is impossible. The editable rows are hidden:
              with zero weeks they can't accept any hours. */}
          {!loading && phaseHours.length > 0 && !hasWeeks && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "10px 12px", borderRadius: 8, marginTop: 8, marginBottom: 8,
              background: "rgba(232,119,34,0.08)", border: "1px solid rgba(232,119,34,0.35)",
            }}>
              <AlertTriangle size={14} color={C.orange} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
                  Phase dates not set
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
                  {noDatesDescription
                    ?? <>The phases exist but have no start or end dates — so there are no weeks to allocate hours into. Add dates to each phase in the <strong style={{ color: C.text }}>Schedule tab</strong> first.</>}
                </div>
                {onSetupSchedule && (
                  <button
                    onClick={() => { onClose(); onSetupSchedule(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, marginTop: 8,
                      background: C.green, border: "none", borderRadius: 7,
                      color: "#fff", padding: "5px 12px", fontSize: 11, fontWeight: 700,
                      cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {setupScheduleLabel ?? "Add dates in Schedule tab →"}
                  </button>
                )}
              </div>
            </div>
          )}

          {!loading && phaseHours.length > 0 && hasWeeks && phaseHours.some((p) => p.defaulted) && (
            <div style={{
              background: C.surfaceLight, border: `1px solid ${C.borderSoft}`,
              borderRadius: 8, padding: "8px 10px", marginBottom: 8,
              fontSize: 11, color: C.muted, lineHeight: 1.5,
            }}>
              Phases with no saved hours start at{" "}
              <strong style={{ color: C.red }}>
                {getBusinessRules().workWeekHours}h/week — your work week, set by
                your admin in Settings
              </strong>. Adjust any week — or type a new
              phase total to spread it evenly. Defaults you don't touch are
              only saved if you confirm when saving.
            </div>
          )}

          {!loading && phaseHours.length > 0 && hasWeeks && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {phaseHours.map((ph, i) => {
                const phTotal = getPhaseTotal(ph);
                const isExp = expandedPhase === i;
                return (
                  <div key={ph.stageStep}>
                    <button
                      onClick={() => { setTotalDraft(null); setExpandedPhase(isExp ? null : i); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center",
                        background: C.surfaceLight, borderRadius: 10, padding: 10,
                        borderLeft: `3px solid ${ph.color}`, border: "none",
                        borderTop: `1px solid ${C.borderSoft}`,
                        borderRight: `1px solid ${C.borderSoft}`,
                        borderBottom: `1px solid ${C.borderSoft}`,
                        color: C.text, cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: 13,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{ph.phaseName}</div>
                        <div style={{
                          fontSize: 10, color: C.mutedSoft, marginTop: 2,
                        }}>
                          {ph.weeks.length > 0
                            ? (() => {
                                const first = fmtWeekLabel(ph.weeks[0].key);
                                const last = fmtWeekLabel(ph.weeks[ph.weeks.length - 1].key);
                                return first === last ? first : `${first} – ${last}`;
                              })()
                            : `${ph.weeks.length} week${ph.weeks.length !== 1 ? "s" : ""}`}
                          {" — click to edit"}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {ph.defaulted && phTotal > 0 && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: C.orange,
                            textTransform: "uppercase", letterSpacing: 0.4,
                          }}>suggested</span>
                        )}
                        <div style={{
                          width: 50, padding: "2px 0", textAlign: "center",
                          background: C.surface, borderRadius: 6,
                          fontWeight: 700, fontSize: 14,
                          color: ph.defaulted ? C.muted : undefined,
                        }}>{phTotal}</div>
                        {isExp
                          ? <ChevronUp size={14} color={C.mutedSoft} />
                          : <ChevronDown size={14} color={C.mutedSoft} />}
                      </div>
                    </button>

                    {isExp && (
                      <div style={{
                        background: C.surfaceLighter, borderRadius: 8,
                        marginTop: 2, padding: "4px 6px",
                        borderLeft: `3px solid ${ph.color}60`,
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between", gap: 8,
                          padding: "4px 6px 2px",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: C.mutedSoft }}>
                              Phase total
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={totalDraft ?? String(phTotal)}
                              onChange={(e) => { setTotalDraft(e.target.value); setTotalDraftError(null); }}
                              onBlur={() => commitTotalDraft(i)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              aria-label={`Total hours for ${ph.phaseName}`}
                              style={{
                                width: 56, padding: "2px 0", textAlign: "center",
                                background: C.surface, border: `1px solid ${C.borderSoft}`,
                                borderRadius: 5, color: C.text, fontWeight: 700,
                                fontSize: 12, fontFamily: "inherit",
                              }}
                            />
                            <span style={{ fontSize: 10, color: C.mutedSoft }}>
                              h — spreads evenly
                            </span>
                          </div>
                          {ph.weeks.length > 1 && phTotal > 0 && (
                            <button
                              onClick={() => spreadPhaseEvenly(i)}
                              title={`Spread ${phTotal}h evenly across ${ph.weeks.length} weeks`}
                              style={{
                                display: "flex", alignItems: "center", gap: 4,
                                fontSize: 10, fontWeight: 600,
                                color: C.accent, background: "transparent",
                                border: `1px solid ${C.accent}40`, borderRadius: 6,
                                padding: "3px 8px", cursor: "pointer",
                              }}
                            >
                              <Shuffle size={10} />
                              Spread evenly
                            </button>
                          )}
                        </div>
                        {ph.weeks.map((wk, wi) => {
                          const wkErrKey = `${i}:${wi}`;
                          const wkHasErr = weekErrors.has(wkErrKey);
                          return (
                          <div key={wk.key} style={{
                            display: "flex", alignItems: "center",
                            padding: "6px", borderBottom: wi < ph.weeks.length - 1
                              ? `1px solid ${C.surfaceLight}` : "none",
                            background: wkHasErr ? "rgba(239,68,68,0.06)" : "transparent",
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                fontSize: 12, fontWeight: 500,
                                color: wkHasErr ? C.red : C.text,
                              }}>{fmtWeekLabel(wk.key)}</div>
                              <div style={{
                                fontSize: 9, color: C.mutedSoft, marginTop: 1,
                              }}>{wk.key}</div>
                              {wkHasErr && (
                                <div style={{ fontSize: 9, color: C.red, marginTop: 1 }}>
                                  max {MAX_WEEK_HOURS}h
                                </div>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <button
                                onClick={() => updateWeekHour(i, wi, String(Math.max(0, wk.hours - 4)))}
                                style={{
                                  width: 24, height: 24, borderRadius: 12,
                                  background: C.surface, border: "none",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  color: C.mutedSoft, cursor: "pointer",
                                }}
                              ><Minus size={10} /></button>
                              <input
                                type="number"
                                min={0}
                                value={wk.hours}
                                onChange={(e) => updateWeekHour(i, wi, e.target.value)}
                                style={{
                                  width: 42, padding: "1px 0", textAlign: "center",
                                  background: C.surface,
                                  border: wkHasErr ? `1px solid ${C.red}` : "none",
                                  borderRadius: 5,
                                  color: wkHasErr ? C.red : C.text,
                                  fontWeight: 600, fontSize: 14,
                                  fontFamily: "inherit",
                                }}
                              />
                              <button
                                onClick={() => updateWeekHour(i, wi, String(wk.hours + 4))}
                                style={{
                                  width: 24, height: 24, borderRadius: 12,
                                  background: C.surface, border: "none",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  color: C.mutedSoft, cursor: "pointer",
                                }}
                              ><Plus size={10} /></button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !memberAlloc && (
            <div style={{
              background: C.orange + "20", border: `1px solid ${C.orange}55`,
              borderRadius: 8, padding: 10, marginTop: 8,
              fontSize: 12, color: C.orange,
            }}>
              Could not match this member in allocation records.
            </div>
          )}

          {error && (
            <div style={{
              background: C.red + "22", border: `1px solid ${C.red}55`,
              borderRadius: 8, padding: "8px 10px", marginTop: 10,
              fontSize: 12, color: C.red,
            }}>{error}</div>
          )}

          {confirmDefaults && untouchedDefaults.length > 0 && (
            <div style={{
              background: "rgba(232,119,34,0.08)", border: "1px solid rgba(232,119,34,0.35)",
              borderRadius: 8, padding: "10px 12px", marginTop: 10,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                Keep the default hours for phases you didn't adjust?
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
                {untouchedDefaults.map((p) => (
                  <div key={p.stageStep}>
                    {p.phaseName}: {getPhaseTotal(p)}h ({p.weeks.length} week{p.weeks.length !== 1 ? "s" : ""} × {getBusinessRules().workWeekHours}h)
                  </div>
                ))}
              </div>
              {enteredTotal === 0 && (
                <div style={{ fontSize: 11, color: C.orange, marginTop: 6, fontWeight: 600, lineHeight: 1.5 }}>
                  Every phase is still a suggestion — if you skip them, no hours
                  are saved and this member stays at 0% allocation.
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: "5px 12px", borderRadius: 7, border: "none",
                    background: C.green, color: "#fff", fontSize: 11, fontWeight: 700,
                    cursor: saving ? "default" : "pointer",
                  }}
                >Yes, save with defaults</button>
                <button
                  onClick={saveWithoutDefaults}
                  disabled={saving}
                  style={{
                    padding: "5px 12px", borderRadius: 7,
                    background: "transparent", border: `1px solid ${C.borderSoft}`,
                    color: C.text, fontSize: 11, fontWeight: 600,
                    cursor: saving ? "default" : "pointer",
                  }}
                >No, skip those phases</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${C.borderSoft}`,
          display: "flex", gap: 10,
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              background: C.surface, border: `1px solid ${C.borderSoft}`,
              color: C.text, fontSize: 13, fontWeight: 600,
              cursor: saving ? "default" : "pointer",
            }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !canSave}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10,
              background: C.green, border: "none",
              color: C.text, fontSize: 13, fontWeight: 700,
              cursor: (saving || loading || !canSave) ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: (saving || loading || !canSave) ? 0.5 : 1,
            }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
