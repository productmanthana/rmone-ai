import { AppTextInput } from "@/components/AppTextInput";
import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, Modal, Pressable, TextInput, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { Feather } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { Colors, themed } from "@/constants/colors";
import { globalAlert } from "@/lib/inAppAlert";
import {
  getFullProjectAllocations, getTaskData, updateHoursAllocation,
  bustCache, bustCacheByPrefix,
} from "@/lib/api";
import { findPersonRow } from "@/lib/matchMemberAlloc";
import { fmtHours } from "@/lib/numberFormat";

export interface EditAllocPerson {
  name: string;
  role: string;
  pct: number;
  resourceId?: string;
  /** Secondary label shown only when two team members share the same display
   *  name (job title, email username, or last 4 of GUID as fallback). */
  disambiguator?: string;
}

// Physical ceiling for one person-week: 7 days × 24h. Mirrors the web
// editors and the server's saveWeeklyHoursRds gate (the source of truth) —
// clamping here is UX only, for instant feedback at the keyboard.
const MAX_WEEK_HOURS = 168;
const MAX_WEEK_HOURS_HINT = "a week has at most 168 hours";

interface WeekEntry {
  key: string;
  hours: number;
}

interface PhaseHourEntry {
  phaseName: string;
  stageStep: number;
  color: string;
  weeks: WeekEntry[];
}

const fmtWeekLabel = (wk: string) => {
  const parts = wk.split("-");
  return `${parts[0]} ${parts[1]}`;
};

const PHASE_ABBR_MAP: Record<string, string> = {
  "PD": "Pre-Design",
  "SD": "Schematic Design",
  "DD": "Design Development",
  "CD": "Construction Documents",
  "BP": "Bidding & Permitting",
  "BN": "Bidding & Negotiation",
  "CA": "Construction Administration",
  "PCA": "Pre-Construction Administration",
};

const expandPhaseName = (raw: string): string => {
  const t = (raw ?? "").trim();
  if (!t) return t;
  const direct = PHASE_ABBR_MAP[t.toUpperCase()];
  if (direct) return direct;
  const m = t.match(/^([A-Za-z]{2,4})(\s*[-(\s].*)$/);
  if (m) {
    const expanded = PHASE_ABBR_MAP[m[1].toUpperCase()];
    if (expanded) return `${expanded}${m[2]}`;
  }
  return t;
};

/** Parse a weekly column key "DD-Mon-YY" → Date (local midnight). */
function parseWeekKey(s: string): Date | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(s);
  if (!m) return null;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const mo = months[m[2]];
  if (mo === undefined) return null;
  return new Date(2000 + Number(m[3]), mo, Number(m[1]));
}

/** Parse an RM ONE schedule date (ISO date/datetime or "YYYY-MM-DD") → Date at
 *  LOCAL midnight so comparisons line up with parseWeekKey. Returns null for
 *  empty / sentinel ("0001-…") values. */
function parseScheduleDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("0001")) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function EditAllocationModal({ person, projectId, onClose, onSaved, canManageStaff = false }: {
  person: EditAllocPerson;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
  /** All allocation/hour mutations require this capability; fail closed. */
  canManageStaff?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [rawData, setRawData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [phaseHours, setPhaseHours] = useState<PhaseHourEntry[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  // Transient hint when a typed value hits the 168h/week physical ceiling —
  // the input clamps and this line explains why.
  const [capHint, setCapHint] = useState(false);
  const capHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCapHint = () => {
    setCapHint(true);
    if (capHintTimer.current) clearTimeout(capHintTimer.current);
    capHintTimer.current = setTimeout(() => setCapHint(false), 2600);
  };

  useEffect(() => {
    (async () => {
      try {
        // Fetch the weekly grid AND the authoritative Project Phase Schedule
        // (/task-data — the same source the Schedule tab renders) in parallel.
        // The schedule is best-effort: on failure we fall back to deriving
        // phases from objProjectLifeCycle below.
        const [data, schedRes] = await Promise.all([
          getFullProjectAllocations(projectId),
          getTaskData(projectId).catch(() => null),
        ]);
        setRawData(data);
        const schedulePhasesRaw: any[] = Array.isArray(schedRes) ? (schedRes as any[]) : [];

        const phases: any[] = (data as any)?.objProjectLifeCycle ?? [];
        const eaList: any[] = (data as any)?.ExistingAllocations ?? [];
        const naList: any[] = (data as any)?.NewAllocations ?? [];

        // GUID-aware matching: id match wins outright, name-only match is
        // refused when both sides are GUID-shaped but differ (duplicate
        // same-name accounts). Uses the shared findPersonRow helper so the
        // logic stays in sync with the web phaseHours.ts matchMemberAlloc.
        const matchFn = (r: any) => !!findPersonRow([r], person);
        const memberRows = [...naList.filter(matchFn), ...eaList.filter(matchFn)];
        const summaryRow = naList.find(r => !(r.AssignedToName ?? "").trim());
        const memberRow = memberRows[0] ?? summaryRow;

        if (memberRow || summaryRow) {
          const dateKeyRe = /^\d{2}-[A-Za-z]{3}-\d{2}$/;
          const weekKeysSet = new Set<string>();
          for (const row of [...memberRows, summaryRow].filter(Boolean) as any[]) {
            for (const k of Object.keys(row)) {
              if (dateKeyRe.test(k) && !k.includes("_")) weekKeysSet.add(k);
            }
          }
          const weekDateKeys = Array.from(weekKeysSet).sort((a, b) => {
            const da = parseWeekKey(a), db = parseWeekKey(b);
            if (!da || !db) return 0;
            return da.getTime() - db.getTime();
          });
          const stageSource = summaryRow ?? memberRow;

          let entries: PhaseHourEntry[] = [];

          // PRIMARY — authoritative Project Phase Schedule (/task-data) mapped
          // to weeks by DATE-RANGE overlap, so the phase list matches the real
          // RM ONE Schedule tab exactly (names, order, week counts).
          const sched = schedulePhasesRaw
            .map((p: any) => ({
              title: expandPhaseName(String(p.Title ?? p.Alias ?? "").trim()),
              step: Number(p.StageStep ?? p.ItemOrder ?? 0),
              start: parseScheduleDate(p.StartDate),
              due: parseScheduleDate(p.DueDate ?? p.EndDate),
            }))
            .filter((p) => p.title && p.start && p.due)
            .sort((a, b) => a.step - b.step);

          if (sched.length > 0) {
            const buckets = sched.map((p) => ({ ...p, color: "", weeks: [] as WeekEntry[] }));
            const otherWeeks: WeekEntry[] = [];
            for (const wk of weekDateKeys) {
              const wkStart = parseWeekKey(wk);
              const wkEnd = wkStart ? new Date(wkStart.getTime() + 6 * 864e5) : null;
              // Sum hours across ALL matching member records (RM ONE stores
              // per-week records separately after a save).
              let hours = 0;
              for (const row of memberRows) {
                const v = Number(row[wk] ?? 0);
                if (!isNaN(v)) hours += v;
              }
              let placed = false;
              if (wkStart && wkEnd) {
                for (const b of buckets) {
                  // Overlap: week span [wkStart, wkEnd] ∩ phase [start, due]
                  if (wkStart <= b.due! && wkEnd >= b.start!) {
                    b.weeks.push({ key: wk, hours });
                    if (!b.color) b.color = String(stageSource?.[`${wk}_stageColor`] ?? "") || "#6BA539";
                    placed = true;
                    break;
                  }
                }
              }
              if (!placed) otherWeeks.push({ key: wk, hours });
            }
            for (const b of buckets) {
              if (b.weeks.length > 0) {
                entries.push({ phaseName: b.title, stageStep: b.step, color: b.color || Colors.green, weeks: b.weeks });
              }
            }
            if (otherWeeks.some(w => w.hours > 0)) {
              entries.push({ phaseName: "Other / Unscheduled", stageStep: -1, color: Colors.green, weeks: otherWeeks });
            }
          }

          // FALLBACK — derive from objProjectLifeCycle + per-week _stageStep
          // markers only when /task-data captured no real phase. Number() the
          // step keys so mixed string/number markers still match phases.
          if (!entries.some(e => e.stageStep >= 0) && phases.length > 0) {
            entries = [];
            const stageMap = new Map<number, { name: string; color: string; weeks: WeekEntry[] }>();
            for (const p of phases) {
              const step = Number(p.StageStep ?? p.ItemOrder ?? 0);
              if (!isFinite(step)) continue;
              stageMap.set(step, { name: expandPhaseName(p.Title ?? `Phase ${step}`), color: "", weeks: [] });
            }
            for (const wk of weekDateKeys) {
              const stepRaw = stageSource?.[`${wk}_stageStep`] ?? memberRow?.[`${wk}_stageStep`];
              const step = stepRaw !== undefined && stepRaw !== null ? Number(stepRaw) : NaN;
              const color = stageSource?.[`${wk}_stageColor`] ?? stageSource?.[`P${step}_stageColor`] ?? "#6BA539";
              let hours = 0;
              for (const row of memberRows) {
                const v = Number(row[wk] ?? 0);
                if (!isNaN(v)) hours += v;
              }
              if (isFinite(step) && stageMap.has(step)) {
                const entry = stageMap.get(step)!;
                entry.weeks.push({ key: wk, hours });
                if (!entry.color) entry.color = color;
              }
            }
            for (const [step, info] of stageMap) {
              if (info.weeks.length > 0) {
                entries.push({
                  phaseName: info.name,
                  stageStep: step,
                  color: info.color || Colors.green,
                  weeks: info.weeks,
                });
              }
            }
            entries.sort((a, b) => a.stageStep - b.stageStep);
          }

          setPhaseHours(entries);
        }
      } catch (e) {
        console.log("EditAllocationModal: Failed to load:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  // GUID-aware matching for the save path — uses the same findPersonRow helper
  // as the useEffect above so both paths are always in sync.
  const existingAllocs: any[] = rawData?.ExistingAllocations ?? [];
  const newAllocsArr: any[] = rawData?.NewAllocations ?? [];
  let memberAlloc = findPersonRow(existingAllocs, person) as any;
  if (!memberAlloc) {
    const newRec = findPersonRow(newAllocsArr, person);
    if (newRec) memberAlloc = { ...newRec, Percentage: 0, IsModified: true };
  }
  // Final fallback: synthesize from the `person` prop so Save is never blocked
  // when the upstream allocation list doesn't contain a perfect-match row yet
  // (e.g. just-allocated members, name spelling variants). The proxy will fill
  // in template fields via UpdateBatchCRMAllocationsWeeklyUsingSP.
  if (!memberAlloc && rawData) {
    memberAlloc = {
      ID: 0,
      ProjectID: projectId,
      AssignedTo: person.resourceId ?? "",
      AssignedToName: person.name,
      PctAllocation: person.pct ?? 0,
      Percentage: 0,
      IsModified: true,
    };
  }

  const updateWeekHour = (phaseIdx: number, weekIdx: number, val: string) => {
    // Weekly ceiling: a person-week can never exceed 168h (7×24) — the same
    // gate the server enforces on save; clamping here gives instant feedback.
    const parsed = Math.max(0, parseInt(val, 10) || 0);
    if (parsed > MAX_WEEK_HOURS) flashCapHint();
    setPhaseHours(prev => {
      const next = prev.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const newWeeks = p.weeks.map((w, wi) =>
          wi === weekIdx ? { ...w, hours: Math.min(MAX_WEEK_HOURS, parsed) } : w
        );
        return { ...p, weeks: newWeeks };
      });
      return next;
    });
  };

  const updatePhaseHourTotal = (phaseIdx: number, val: string) => {
    setPhaseHours(prev => {
      const next = prev.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        let total = Math.max(0, parseInt(val, 10) || 0);
        // Spread ceiling: the phase total can never give any week more than
        // 168h, so it caps at weeks × 168 (mirrors the server's weekly gate).
        const totalCap = p.weeks.length * MAX_WEEK_HOURS;
        if (total > totalCap) { total = totalCap; flashCapHint(); }
        const weekCount = p.weeks.length;
        if (weekCount === 0) return p;
        const perWeek = Math.floor(total / weekCount);
        let remainder = total - perWeek * weekCount;
        const newWeeks = p.weeks.map((w, wi) => ({
          ...w,
          hours: perWeek + (wi === weekCount - 1 ? remainder : 0),
        }));
        return { ...p, weeks: newWeeks };
      });
      return next;
    });
  };

  const getPhaseTotal = (ph: PhaseHourEntry) => ph.weeks.reduce((s, w) => s + w.hours, 0);
  const totalPhaseHours = phaseHours.reduce((s, p) => s + getPhaseTotal(p), 0);

  const handleSaveHours = async () => {
    if (!canManageStaff) {
      globalAlert("View only", "You do not have permission to manage project staff.");
      return;
    }
    if (!memberAlloc) {
      globalAlert("Error", "Could not find allocation record for this team member.");
      return;
    }
    setSaving(true);
    try {
      const allocations: any[] = [];
      const monthMap: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

      const baseFields: Record<string, any> = {};
      const skipKeys = new Set(["AllocationStartDate", "AllocationEndDate", "AllocationHour", "isChanged"]);
      for (const k of Object.keys(memberAlloc)) {
        if (!skipKeys.has(k) && !k.includes("_stageStep") && !k.includes("_stageColor") && !/^\d{2}-[A-Za-z]{3}-\d{2}$/.test(k)) {
          baseFields[k] = memberAlloc[k];
        }
      }

      for (const ph of phaseHours) {
        for (const wk of ph.weeks) {
          const parts = wk.key.split("-");
          const yr = "20" + parts[2];
          const mo = monthMap[parts[1]] ?? "01";
          const dy = parts[0];
          const startDate = `${yr}-${mo}-${dy}T00:00:00`;
          const sd = new Date(`${yr}-${mo}-${dy}`);
          const ed = new Date(sd);
          ed.setDate(ed.getDate() + 6);
          const endDate = `${ed.getFullYear()}-${String(ed.getMonth()+1).padStart(2,"0")}-${String(ed.getDate()).padStart(2,"0")}T00:00:00`;

          allocations.push({
            ...baseFields,
            AllocationStartDate: startDate,
            AllocationEndDate: endDate,
            AllocationHour: wk.hours,
            isChanged: true,
          });
        }
      }

      await updateHoursAllocation({
        ProjectID: projectId,
        OverrideAllocations: false,
        IsAllocationSplitted: false,
        IsMiscellaneousAllocation: false,
        CalledFrom: "WeeklyTeamTab",
        TaskId: 0,
        Allocations: allocations,
      });
      bustCacheByPrefix("resource-allocations:");
      bustCache();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (e: any) {
      const raw: string = e?.message || "Unknown error";
      const msg = raw.includes("NOT_ON_TEAM")
        ? "This person was removed from the project in another session. Refresh to see the updated team before editing hours."
        : raw;
      globalAlert("Update Failed", msg);
    } finally {
      setSaving(false);
    }
  };

  const initials = person.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const canSave = !!memberAlloc && phaseHours.length > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable style={st.overlay} onPress={onClose}>
          <Pressable style={st.sheet} onPress={() => {}}>
            <View style={st.handle} />
            <Text style={st.title}>Edit Allocation</Text>

            <View style={st.memberRow}>
              <View style={[st.avatar, { backgroundColor: Colors.green + "20" }]}>
                <Text style={[st.avatarText, { color: Colors.green }]}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.memberName}>{person.name}</Text>
                <Text style={st.memberRole}>{person.role || "Team Member"}</Text>
                {person.disambiguator ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 }}>
                    <Feather name="tag" size={9} color={Colors.textMuted} />
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>
                      {person.disambiguator}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>


            {(
              <>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Text style={st.label}>Hours by Phase</Text>
                  <View style={{ backgroundColor: Colors.green, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText }}>Total: {fmtHours(totalPhaseHours)}h</Text>
                  </View>
                </View>
                {capHint && (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.orange }}>
                      Capped at {MAX_WEEK_HOURS}h/week — {MAX_WEEK_HOURS_HINT}.
                    </Text>
                  </View>
                )}
                {!loading && phaseHours.length > 0 && (
                  <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                    {phaseHours.map((ph, i) => {
                      const phTotal = getPhaseTotal(ph);
                      const isExp = expandedPhase === i;
                      return (
                        <View key={ph.stageStep} style={{ marginBottom: 6 }}>
                          <Pressable
                            onPress={() => { setExpandedPhase(isExp ? null : i); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                            style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: ph.color }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }} numberOfLines={1}>{ph.phaseName}</Text>
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, marginTop: 2 }}>{ph.weeks.length} week{ph.weeks.length !== 1 ? "s" : ""} — tap to edit</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <View style={[st.phaseInput, { justifyContent: "center" }]}>
                                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.cardText, textAlign: "center" }}>{phTotal}</Text>
                              </View>
                              <Feather name={isExp ? "chevron-up" : "chevron-down"} size={14} color={Colors.textMuted} style={{ marginLeft: 4 }} />
                            </View>
                          </Pressable>

                          {isExp && (
                            <View style={{ backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 8, marginTop: 2, paddingVertical: 4, paddingHorizontal: 6, borderLeftWidth: 3, borderLeftColor: ph.color + "60" }}>
                              {ph.weeks.map((wk, wi) => (
                                <View key={wk.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: wi < ph.weeks.length - 1 ? 1 : 0, borderBottomColor: "rgba(255,255,255,0.04)" }}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary }}>{fmtWeekLabel(wk.key)}</Text>
                                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted, marginTop: 1 }}>{wk.key}</Text>
                                  </View>
                                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                      <Pressable disabled={!canManageStaff} onPress={() => updateWeekHour(i, wi, String(Math.max(0, wk.hours - 4)))} style={[st.weekStepBtn, !canManageStaff && { opacity: 0.45 }]}>
                                      <Feather name="minus" size={10} color={Colors.textMuted} />
                                    </Pressable>
                                      <AppTextInput
                                      style={st.weekInput}
                                      value={String(wk.hours)}
                                      onChangeText={(v) => updateWeekHour(i, wi, v)}
                                        editable={canManageStaff}
                                      keyboardType="number-pad"
                                      maxLength={4}
                                      selectTextOnFocus
                                    />
                                      <Pressable disabled={!canManageStaff} onPress={() => updateWeekHour(i, wi, String(wk.hours + 4))} style={[st.weekStepBtn, !canManageStaff && { opacity: 0.45 }]}>
                                      <Feather name="plus" size={10} color={Colors.textMuted} />
                                    </Pressable>
                                  </View>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
                {!loading && phaseHours.length === 0 && (
                  <View style={{ backgroundColor: Colors.orange + "15", borderRadius: 8, padding: 10, marginVertical: 8 }}>
                    <Text style={{ fontSize: 12, color: Colors.orange }}>No phase schedule found. Assign a lifecycle first to enable phase hours editing.</Text>
                  </View>
                )}
              </>
            )}

            {loading && (
              <View style={{ alignItems: "center", marginVertical: 8 }}>
                <ActivityIndicator size="small" color={Colors.green} />
                <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 4 }}>Loading allocation data...</Text>
              </View>
            )}
            {!loading && !memberAlloc && (
              <View style={{ backgroundColor: Colors.orange + "15", borderRadius: 8, padding: 10, marginVertical: 8 }}>
                <Text style={{ fontSize: 12, color: Colors.orange }}>Could not match this member in allocation records.</Text>
              </View>
            )}

            <View style={st.btns}>
              <Pressable style={st.cancelBtn} onPress={onClose}>
                <Text style={st.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[st.saveBtn, (saving || loading || !canSave || !canManageStaff) && { opacity: 0.5 }]}
                onPress={handleSaveHours}
                disabled={saving || loading || !canSave || !canManageStaff}
              >
                {saving ? <ActivityIndicator size="small" color="#FFF" /> : (
                  <>
                    <Feather name="check" size={14} color="#FFF" />
                    <Text style={st.saveText}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = themed(() => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" } as any,
  sheet: { backgroundColor: Colors.darkCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: Colors.border } as any,
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", alignSelf: "center", marginBottom: 16 } as any,
  title: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.cardText, textAlign: "center", marginBottom: 20 } as any,
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20, padding: 12, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12 } as any,
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" } as any,
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 14 } as any,
  memberName: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary } as any,
  memberRole: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 } as any,
  label: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 } as any,
  inputRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 } as any,
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border } as any,
  pctInput: { fontFamily: "Inter_700Bold", fontSize: 32, color: Colors.cardText, textAlign: "center", width: 80, paddingVertical: 4 } as any,
  pctSign: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.textMuted } as any,
  quickRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 20 } as any,
  quickBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "transparent" } as any,
  quickBtnActive: { backgroundColor: Colors.green + "20", borderColor: Colors.green } as any,
  quickText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary } as any,
  quickTextActive: { color: Colors.green } as any,
  phaseStepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" } as any,
  phaseInput: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText, textAlign: "center", width: 50, paddingVertical: 2, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 6 } as any,
  weekStepBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" } as any,
  weekInput: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText, textAlign: "center", width: 42, paddingVertical: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 5 } as any,
  btns: { flexDirection: "row", gap: 12, marginTop: 12 } as any,
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center" } as any,
  cancelText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textSecondary } as any,
  saveBtn: { flex: 1, flexDirection: "row", gap: 6, paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.green, alignItems: "center", justifyContent: "center" } as any,
  saveText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#FFF" } as any,
}));
