import { AppTextInput } from "@/components/AppTextInput";
import React, { useEffect, useState } from "react";
import {
  Modal, View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  TextInput, Platform,
} from "react-native";
import { Feather } from "@/lib/icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBase, getProjectDetails, getProjectTeam, type ProjectTeamMember, type OpenRole } from "@/lib/api";
import { useRouter } from "expo-router";
import type { DecisionActionPayload } from "@/lib/decisionTypes";
import { fmtHours, fmtPct } from "@/lib/numberFormat";

const C = {
  bg: "#1F2D38",
  card: "#2A3D4D",
  surface: "rgba(255,255,255,0.04)",
  surfaceSel: "rgba(107,165,57,0.15)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.20)",
  green: "#6BA539",
  greenLt: "#A9C23F",
  orange: "#E87722",
  red: "#E03C3C",
  ink: "#F1F5F9",
  inkDim: "#94A3B8",
};

async function authHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem("rmone_token");
  const username = (await AsyncStorage.getItem("rmone_username")) ?? "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { "X-Username": username } : {}),
  };
}

/* Distinct bench-roles cache: shared across mounts of EngageSheet /
 * ApplySheet so opening a second picker doesn't refetch /candidate-roles
 * for the same session. */
type RoleOpt = { label: string; value: string; count: number };
type RolesPayload = { roles: RoleOpt[]; totalScanned: number };
let __rolesCache: RolesPayload | null = null;
let __rolesPromise: Promise<RolesPayload> | null = null;
async function fetchRoles(): Promise<RolesPayload> {
  // Empty results usually mean upstream failed / not signed in yet — let
  // the next picker open retry instead of permanently sticking on [].
  if (__rolesCache && __rolesCache.roles.length > 0) return __rolesCache;
  if (__rolesPromise) return __rolesPromise;
  __rolesPromise = (async () => {
    let result: RolesPayload = { roles: [], totalScanned: 0 };
    try {
      const headers = await authHeaders();
      const r = await fetch(`${getApiBase()}/api/decision/candidate-roles`, { headers });
      const data = await r.json().catch(() => ({}));
      result = {
        roles: Array.isArray(data.roles) ? data.roles : [],
        totalScanned: Number(data.totalScanned) || 0,
      };
    } catch {
      result = { roles: [], totalScanned: 0 };
    }
    __rolesCache = result;
    __rolesPromise = null;
    return result;
  })();
  return __rolesPromise;
}

/* Bench-candidates cache keyed by role query. /api/decision/candidates
 * round-trips RM ONE GetUserList — slow on a cold session. Cache per-role
 * so re-opening the sheet is instant, and expose `prefetchPickerData`
 * the SITREP card calls on mount so data is hot before the user taps
 * a chip. 60s TTL matches the server-side directory cache. */
type SheetCandidate = { id: string; name: string; email: string; role: string; dept: string; currentPct?: number; freeHours?: number };
type CandidatesPayload = { candidates: SheetCandidate[]; message?: string };
const __candidatesCache = new Map<string, { ts: number; data: CandidatesPayload }>();
const __candidatesPromise = new Map<string, Promise<CandidatesPayload>>();
const CANDIDATES_TTL_MS = 60_000;
async function fetchCandidates(role: string): Promise<CandidatesPayload> {
  const cached = __candidatesCache.get(role);
  if (cached && Date.now() - cached.ts < CANDIDATES_TTL_MS && cached.data.candidates.length > 0) return cached.data;
  const inflight = __candidatesPromise.get(role);
  if (inflight) return inflight;
  const p = (async () => {
    let data: CandidatesPayload = { candidates: [] };
    try {
      const headers = await authHeaders();
      const r = await fetch(
        `${getApiBase()}/api/decision/candidates?role=${encodeURIComponent(role)}&minFreeHours=0&limit=50`,
        { headers },
      );
      const j = await r.json().catch(() => ({}));
      data = {
        candidates: Array.isArray(j.candidates) ? j.candidates : [],
        message: j.message ? String(j.message) : undefined,
      };
    } catch (e) {
      data = { candidates: [], message: e instanceof Error ? e.message : String(e) };
    }
    __candidatesCache.set(role, { ts: Date.now(), data });
    __candidatesPromise.delete(role);
    return data;
  })();
  __candidatesPromise.set(role, p);
  return p;
}
export function getCachedCandidates(role: string): CandidatesPayload | undefined {
  const c = __candidatesCache.get(role);
  if (c && Date.now() - c.ts < CANDIDATES_TTL_MS) return c.data;
  return undefined;
}
/** Warm the picker caches in the background so opening a chip is instant. */
export function prefetchPickerData(): void {
  void fetchRoles();
  void fetchCandidates("");
}

/* Horizontal chip-row picker for bench roles. Mirrors the web
 * <RoleDropdown> but uses chips instead of a native <select> because
 * React Native's @react-native-picker/picker isn't installed and chips
 * give better one-tap discoverability on touch. `includeAll=true` adds
 * an "All roles" chip (value="") so Apply shows everyone by default. */
function RoleChips({
  value, onChange, includeAll,
}: { value: string; onChange: (v: string) => void; includeAll: boolean }) {
  const [roles, setRoles] = useState<RoleOpt[]>(__rolesCache?.roles ?? []);
  const [total, setTotal] = useState<number>(__rolesCache?.totalScanned ?? 0);
  useEffect(() => {
    let alive = true;
    fetchRoles().then(p => { if (alive) { setRoles(p.roles); setTotal(p.totalScanned); } });
    return () => { alive = false; };
  }, []);
  // "All roles" reflects the full candidate count, not the sum of role
  // buckets (most RM ONE users have no JobTitle, so they're missing from
  // any per-role bucket but still count as engageable people).
  const allCount = total || roles.reduce((a, r) => a + r.count, 0);
  const items: RoleOpt[] = [
    ...(includeAll ? [{ label: `All roles (${allCount})`, value: "", count: 0 }] : []),
    ...(value && !roles.some(r => r.value === value) ? [{ label: `${value} (custom)`, value, count: 0 }] : []),
    ...roles.map(r => ({ label: `${r.label} (${r.count})`, value: r.value, count: r.count })),
  ];
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: C.inkDim, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginBottom: 6 }}>
        FILTER ROLE
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
        {items.map(it => {
          const sel = it.value === value;
          return (
            <Pressable
              key={it.value || "__all__"}
              onPress={() => onChange(it.value)}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
                borderWidth: 1,
                borderColor: sel ? C.green : C.border,
                backgroundColor: sel ? C.surfaceSel : C.surface,
              }}
            >
              <Text style={{ color: sel ? C.greenLt : C.ink, fontSize: 12, fontWeight: sel ? "700" : "500" }}>
                {it.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function PickerSheet({
  open, onClose, title, subtitle, children,
  primaryLabel, primaryDisabled, busy, onPrimary, footerNote,
}: {
  open: boolean; onClose: () => void;
  title: string; subtitle?: string;
  children: React.ReactNode;
  primaryLabel: string; primaryDisabled?: boolean; busy?: boolean;
  onPrimary: () => void; footerNote?: string;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.title} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={s.subtitle} numberOfLines={3}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
              <Feather name="x" size={18} color={C.ink} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }}>
            {children}
          </ScrollView>
          <View style={s.footer}>
            <Text style={s.footerNote} numberOfLines={1}>{footerNote ?? ""}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={onClose} style={s.btnGhost}>
                <Text style={s.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onPrimary}
                disabled={primaryDisabled || busy}
                style={[s.btnPrimary, (primaryDisabled || busy) && { opacity: 0.5 }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather name="check" size={13} color="#FFFFFF" />
                )}
                <Text style={s.btnPrimaryText}>{primaryLabel}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ── Engage ──────────────────────────────────────────────────────────── */
type ProjectMix = { projectId: string; projectName: string; pct: number };
type Candidate = { id: string; name: string; email: string; role: string; dept: string; currentPct?: number; freeHours?: number; projects?: ProjectMix[] };

/* Inline project-mix chips shown under each person in the bench picker so the
 * user can see which projects make up their allocation at a glance. Shows the
 * busiest few; collapses the remainder into a "+N more" chip. Renders nothing
 * when the person is on the bench (no active projects).
 *
 * When `onOpenProject` is supplied each chip becomes a tappable Pressable that
 * jumps straight to that project's detail view. The chip lives inside the
 * candidate row (itself a Pressable); RN's responder system hands the touch to
 * the innermost Pressable, so a chip tap navigates without also selecting the
 * row. */
function ProjectMixRow({
  projects, max = 3, onOpenProject,
}: { projects?: ProjectMix[]; max?: number; onOpenProject?: (projectId: string) => void }) {
  if (!projects || projects.length === 0) return null;
  const shown = projects.slice(0, max);
  const extra = projects.length - shown.length;
  return (
    <View style={s.mixWrap}>
      {shown.map((p, i) => (
        <Pressable
          key={`${p.projectId}-${i}`}
          style={s.mixChip}
          disabled={!onOpenProject}
          onPress={onOpenProject ? () => onOpenProject(p.projectId) : undefined}
        >
          <Text style={s.mixChipText} numberOfLines={1}>
            {p.projectName} <Text style={s.mixChipPct}>{fmtPct(p.pct)}</Text>
          </Text>
        </Pressable>
      ))}
      {extra > 0 ? <Text style={s.mixMore}>+{extra} more</Text> : null}
    </View>
  );
}

/* ── Project quick-preview sheet ─────────────────────────────────────── */
function pvStr(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "null" || s === "undefined" ? "" : s;
}
function pvDate(v: unknown): string {
  const s = pvStr(v);
  if (!s) return "";
  const t = new Date(s).getTime();
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  if (d.getFullYear() < 1990) return ""; // drop 0001-01-01 placeholders
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${m} ${d.getDate()}, ${d.getFullYear()}`;
}

type PreviewState = {
  loading: boolean; err: string; name: string; status: string;
  start: string; end: string; team: ProjectTeamMember[]; openRoles: OpenRole[];
};

/* Compact bottom-sheet peek shown ON TOP of the open picker so the user
 * can glance at a project's context (status, schedule window, current
 * team / open roles) without losing their picker selection. Rendered as
 * a second Modal layered above the picker; closing it just unmounts the
 * peek and reveals the still-mounted picker underneath with state intact.
 * "Open full project" navigates to the detail screen for the full view. */
function ProjectPreviewSheet({
  projectId, onClose, onOpenFull,
}: { projectId: string; onClose: () => void; onOpenFull: (id: string) => void }) {
  const [st, setSt] = useState<PreviewState>({
    loading: true, err: "", name: "", status: "", start: "", end: "", team: [], openRoles: [],
  });

  useEffect(() => {
    let alive = true;
    setSt(s => ({ ...s, loading: true, err: "" }));
    (async () => {
      try {
        const [d, t] = await Promise.all([
          getProjectDetails(projectId).catch(() => null),
          getProjectTeam(projectId).catch(() => ({ team: [], openRoles: [] })),
        ]);
        if (!alive) return;
        const rec = (d ?? {}) as Record<string, unknown>;
        setSt({
          loading: false,
          err: d ? "" : "Couldn't load project details.",
          name: pvStr(rec.Title) || pvStr(rec.RecordTitle) || pvStr(rec.Name) || projectId,
          status: pvStr(rec.CRMProjectStatusChoice) || pvStr(rec.Status) || pvStr(rec.CRMOpportunityStatusChoice) || "—",
          start: pvDate(rec.TargetStartDate) || pvDate(rec.ActualStartDate),
          end: pvDate(rec.TargetCompletionDate) || pvDate(rec.ActualCompletionDate),
          team: Array.isArray(t?.team) ? t.team : [],
          openRoles: Array.isArray(t?.openRoles) ? t.openRoles : [],
        });
      } catch (e) {
        if (alive) setSt(s => ({ ...s, loading: false, err: e instanceof Error ? e.message : "Failed to load project." }));
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const scheduleWindow = st.start || st.end
    ? `${st.start || "—"} → ${st.end || "—"}`
    : "No schedule dates set";
  const shownTeam = st.team.slice(0, 6);
  const moreTeam = st.team.length - shownTeam.length;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.sheet, { height: "70%" }]}>
          <View style={s.header}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={s.pvKicker}>PROJECT PREVIEW</Text>
              <Text style={s.title} numberOfLines={2}>{st.loading ? "Loading…" : st.name}</Text>
              <Text style={s.subtitle} numberOfLines={1}>{projectId}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
              <Feather name="x" size={18} color={C.ink} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 16 }}>
            {st.loading ? (
              <ActivityIndicator color={C.green} style={{ marginVertical: 32 }} />
            ) : st.err ? (
              <Text style={{ color: C.red, fontSize: 12 }}>{st.err}</Text>
            ) : (
              <>
                <View style={{ flexDirection: "row" }}>
                  <View style={s.statusPill}>
                    <Text style={s.statusPillText}>{st.status}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <Feather name="calendar" size={15} color={C.inkDim} style={{ marginTop: 2 }} />
                  <View>
                    <Text style={s.pvLabel}>SCHEDULE</Text>
                    <Text style={s.pvValue}>{scheduleWindow}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <Feather name="users" size={15} color={C.inkDim} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={s.pvLabel}>TEAM ({st.team.length})</Text>
                      {st.openRoles.length > 0 ? (
                        <Text style={{ color: C.orange, fontSize: 10, fontWeight: "700" }}>
                          {st.openRoles.length} open
                        </Text>
                      ) : null}
                    </View>
                    {st.team.length === 0 ? (
                      <Text style={[s.pvValue, { color: C.inkDim }]}>No staffed team members.</Text>
                    ) : (
                      <View style={{ gap: 8, marginTop: 8 }}>
                        {shownTeam.map((m, i) => (
                          <View key={`${m.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: C.ink, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{m.name}</Text>
                              <Text style={{ color: C.inkDim, fontSize: 10 }} numberOfLines={1}>{m.role || m.title || "—"}</Text>
                            </View>
                            {m.pctAllocation != null ? (
                              <Text style={{ color: C.greenLt, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                                {Math.round(m.pctAllocation)}%
                              </Text>
                            ) : null}
                          </View>
                        ))}
                        {moreTeam > 0 ? <Text style={{ color: C.inkDim, fontSize: 10 }}>+{moreTeam} more</Text> : null}
                      </View>
                    )}
                  </View>
                </View>
              </>
            )}
          </ScrollView>

          <View style={s.footer}>
            <Pressable onPress={onClose} style={s.btnGhost}>
              <Feather name="arrow-left" size={13} color={C.ink} />
              <Text style={s.btnGhostText}>Back</Text>
            </Pressable>
            <Pressable onPress={() => onOpenFull(projectId)} style={s.btnPrimary}>
              <Feather name="external-link" size={13} color="#FFFFFF" />
              <Text style={s.btnPrimaryText}>Open full project</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function EngageSheet({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "engage_candidates" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  // Seed from prefetch cache when warm so the sheet renders instantly
  // on open instead of flashing a "Loading bench…" spinner.
  const seed = getCachedCandidates("");
  const [list, setList] = useState<Candidate[]>(seed?.candidates ?? []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(!seed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(seed?.message && (seed.candidates.length === 0) ? seed.message : "");
  // User-editable role filter — defaults to "" ("All roles") so the
  // dropdown lists every real RM ONE title.
  const [roleQuery, setRoleQuery] = useState("");
  const router = useRouter();
  // Tapping a project chip opens a compact in-place preview sheet instead
  // of navigating away, so the picker (and the user's selection) stays
  // mounted underneath. "Open full project" inside the preview navigates
  // to the detail screen for users who want the full view.
  const [previewId, setPreviewId] = useState("");
  const openProject = (projectId: string) => {
    if (projectId) setPreviewId(projectId);
  };
  const openFull = (projectId: string) => {
    if (!projectId) return;
    onClose();
    try { router.push(`/project/${encodeURIComponent(projectId)}`); } catch {}
  };

  useEffect(() => {
    let alive = true;
    const cached = getCachedCandidates(roleQuery);
    if (cached) {
      setList(cached.candidates);
      setErr(cached.candidates.length === 0 && cached.message ? cached.message : "");
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      const data = await fetchCandidates(roleQuery);
      if (!alive) return;
      setList(data.candidates);
      setPicked(new Set());
      setErr(data.candidates.length === 0 && data.message ? data.message : "");
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [roleQuery, payload.role, payload.count]);

  const toggle = (id: string) => {
    setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const submit = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const headers = await authHeaders();
      const recipients = list.filter(c => picked.has(c.id) && c.email).map(c => c.email);
      const r = await fetch(`${getApiBase()}/api/decision/engage-candidates`, {
        method: "POST", headers,
        body: JSON.stringify({ role: payload.role, count: picked.size, recipients }),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok !== false;
      if (!ok) {
        onResult({ ok: false, message: data.message || `Request failed (${r.status}).` });
      } else {
        const names = list.filter(c => picked.has(c.id)).map(c => c.name).join(", ");
        onResult({
          ok: true,
          message: data.message || `Engaged ${picked.size} candidate${picked.size === 1 ? "" : "s"}.`,
          sub: names ? `${names}${data.detail ? " · " + data.detail : ""}` : data.detail,
        });
      }
      onClose();
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : "Network error." });
      onClose();
    }
  };

  return (
    <>
    <PickerSheet
      open
      onClose={onClose}
      title={`Engage ${payload.role} candidates`}
      subtitle="Select people to email. RM ONE SaveAllocation isn't yet exposed — outreach lands in their inbox; finalize the soft alloc in the RM ONE portal."
      primaryLabel={picked.size > 0 ? `Engage ${picked.size}` : "Select 1+"}
      primaryDisabled={picked.size === 0}
      busy={busy}
      onPrimary={submit}
      footerNote={loading ? "Loading…" : `${list.length} candidate${list.length === 1 ? "" : "s"}`}
    >
      <RoleChips value={roleQuery} onChange={setRoleQuery} includeAll />
      {loading ? (
        <View style={{ alignItems: "center", paddingVertical: 32 }}>
          <ActivityIndicator color={C.green} />
        </View>
      ) : err ? (
        <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>
      ) : list.length === 0 ? (
        <Text style={{ color: C.inkDim, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>
          No "{roleQuery}" matches in the bench feed. Try a broader role above (e.g. "PM" or "Project Manager").
        </Text>
      ) : (
        list.map(c => {
          const isSel = picked.has(c.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => toggle(c.id)}
              style={[s.row, s.rowCol, isSel && s.rowSel]}
            >
              <View style={s.rowTop}>
                <View style={[s.checkbox, isSel && s.checkboxSel]}>
                  {isSel ? <Feather name="check" size={11} color="#FFFFFF" /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{c.name}</Text>
                  <Text style={s.rowMeta}>{c.role} · {c.dept}</Text>
                </View>
                {(c.freeHours != null || c.currentPct != null) ? (
                  <View style={{ alignItems: "flex-end" }}>
                    {c.freeHours != null ? <Text style={[s.rowVal, { color: C.greenLt }]}>{c.freeHours}h free</Text> : null}
                    {c.currentPct != null ? <Text style={s.rowMeta}>{c.currentPct}% allocated</Text> : null}
                  </View>
                ) : null}
              </View>
              <ProjectMixRow projects={c.projects} onOpenProject={openProject} />
            </Pressable>
          );
        })
      )}
    </PickerSheet>
    {previewId ? (
      <ProjectPreviewSheet projectId={previewId} onClose={() => setPreviewId("")} onOpenFull={openFull} />
    ) : null}
    </>
  );
}

/* ── Apply ───────────────────────────────────────────────────────────── */
type Allocation = { id: string; projectId: string; projectName: string; pct: number; hoursPerWeek: number; start: string; end: string };

export function ApplySheet({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "shift_allocation" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  // When the brief did not name a person (the common case for AI-
  // generated Apply chips like "Move bench resources to Healthcare"),
  // we surface a Step 1 person picker before loading allocations.
  const [person, setPerson] = useState(payload.personName);
  // Default "" → "All roles" so Step-1 shows every bench resource.
  const [roleQuery, setRoleQuery] = useState("");
  const [people, setPeople] = useState<Candidate[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);

  const [list, setList] = useState<Allocation[]>([]);
  const [pickedId, setPickedId] = useState("");
  const [hours, setHours] = useState(String(payload.hoursPerWeek));
  const [loadingAlloc, setLoadingAlloc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  // Tapping a project chip in the Step-1 person picker opens a compact
  // in-place preview sheet instead of navigating away, so the picker and
  // the user's selection stay mounted underneath.
  const [previewId, setPreviewId] = useState("");
  const openProject = (projectId: string) => {
    if (projectId) setPreviewId(projectId);
  };
  const openFull = (projectId: string) => {
    if (!projectId) return;
    onClose();
    try { router.push(`/project/${encodeURIComponent(projectId)}`); } catch {}
  };

  // Step 1: fetch bench candidates when no person is selected. Re-runs
  // when the user edits the role filter.
  useEffect(() => {
    if (person) return;
    let alive = true;
    setLoadingPeople(true);
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch(
          // roleQuery may be "" (All roles) — server permits empty role.
          `${getApiBase()}/api/decision/candidates?role=${encodeURIComponent(roleQuery)}&minFreeHours=0&limit=50`,
          { headers },
        );
        const data = await r.json().catch(() => ({}));
        if (!alive) return;
        setPeople(Array.isArray(data.candidates) ? data.candidates : []);
        if ((!data.candidates || data.candidates.length === 0) && data.message) setErr(String(data.message));
        else setErr("");
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingPeople(false);
      }
    })();
    return () => { alive = false; };
  }, [person, roleQuery]);

  // Step 2: fetch the selected person's allocations.
  useEffect(() => {
    if (!person) return;
    let alive = true;
    setLoadingAlloc(true);
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch(
          `${getApiBase()}/api/decision/person-allocations?personName=${encodeURIComponent(person)}`,
          { headers },
        );
        const data = await r.json().catch(() => ({}));
        if (!alive) return;
        const arr: Allocation[] = Array.isArray(data.allocations) ? data.allocations : [];
        setList(arr);
        const match = arr.find(a => a.projectId === payload.projectId);
        setPickedId(match ? match.id : arr[0]?.id ?? "");
        if (arr.length === 0 && data.message) setErr(String(data.message)); else setErr("");
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingAlloc(false);
      }
    })();
    return () => { alive = false; };
  }, [person, payload.projectId]);

  const submit = async () => {
    const row = list.find(a => a.id === pickedId);
    const h = Math.max(1, Math.min(40, Number(hours) || 0));
    if (!person || !row || h <= 0) return;
    setBusy(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${getApiBase()}/api/decision/shift-allocation`, {
        method: "POST", headers,
        body: JSON.stringify({ personName: person, projectId: row.projectId, hoursPerWeek: h }),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok !== false;
      onResult(ok
        ? { ok: true, message: data.message || `Shifted ${h}h/wk on ${row.projectName}.`, sub: data.detail }
        : { ok: false, message: data.message || `Request failed (${r.status}).` });
      onClose();
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : "Network error." });
      onClose();
    }
  };

  // Step 1 view: pick a person from the bench.
  if (!person) {
    return (
      <>
      <PickerSheet
        open onClose={onClose}
        title="Pick a person to shift"
        subtitle="Choose someone from the bench whose allocation you want to reduce."
        primaryLabel="Pick a person"
        primaryDisabled
        onPrimary={() => {}}
        footerNote={loadingPeople ? "Loading bench…" : `${people.length} candidate${people.length === 1 ? "" : "s"}`}
      >
        <RoleChips value={roleQuery} onChange={setRoleQuery} includeAll />
        {loadingPeople ? (
          <ActivityIndicator color={C.green} style={{ marginVertical: 32 }} />
        ) : err ? (
          <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>
        ) : people.length === 0 ? (
          <Text style={{ color: C.inkDim, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>
            No bench resources match "{roleQuery}". Try a different role.
          </Text>
        ) : people.map(c => (
          <Pressable key={c.id} onPress={() => setPerson(c.name)} style={[s.row, s.rowCol]}>
            <View style={s.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{c.name}</Text>
                <Text style={s.rowMeta}>{c.role} · {c.dept}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.rowVal, { color: C.greenLt }]}>{c.freeHours}h free</Text>
                <Text style={s.rowMeta}>{c.currentPct}% allocated</Text>
              </View>
            </View>
            <ProjectMixRow projects={c.projects} onOpenProject={openProject} />
          </Pressable>
        ))}
      </PickerSheet>
      {previewId ? (
        <ProjectPreviewSheet projectId={previewId} onClose={() => setPreviewId("")} onOpenFull={openFull} />
      ) : null}
      </>
    );
  }

  // Step 2 view: pick which of their allocations to reduce.
  return (
    <PickerSheet
      open onClose={onClose}
      title={`Shift ${person}'s allocation`}
      subtitle="Pick which active allocation to reduce, then confirm hours/week to free."
      primaryLabel={pickedId ? `Shift ${hours}h/wk` : "Pick a row"}
      primaryDisabled={!pickedId || !(Number(hours) > 0)}
      busy={busy} onPrimary={submit}
      footerNote={loadingAlloc ? "Loading…" : `${list.length} active row${list.length === 1 ? "" : "s"}`}
    >
      {!payload.personName && (
        <Pressable onPress={() => { setPerson(""); setList([]); setPickedId(""); }} style={{ marginBottom: 8 }}>
          <Text style={{ color: C.greenLt, fontSize: 12, fontWeight: "700" }}>← Change person</Text>
        </Pressable>
      )}
      {loadingAlloc ? (
        <ActivityIndicator color={C.green} style={{ marginVertical: 32 }} />
      ) : err ? (
        <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>
      ) : list.length === 0 ? (
        <Text style={{ color: C.inkDim, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>
          {person} has no active allocations to shift.
        </Text>
      ) : (
        <>
          {list.map(a => {
            const isSel = a.id === pickedId;
            return (
              <Pressable key={a.id} onPress={() => setPickedId(a.id)} style={[s.row, isSel && s.rowSel]}>
                <View style={[s.radio, isSel && s.radioSel]}>
                  {isSel ? <View style={s.radioDot} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{a.projectName}</Text>
                  <Text style={s.rowMeta}>
                    {a.projectId}{a.start ? ` · ${a.start}${a.end ? ` → ${a.end}` : ""}` : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.rowVal, { color: C.orange }]}>{fmtPct(a.pct)}</Text>
                  <Text style={s.rowMeta}>{fmtHours(a.hoursPerWeek)}h/wk</Text>
                </View>
              </Pressable>
            );
          })}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
            <Text style={{ color: C.inkDim, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 }}>
              HOURS / WEEK
            </Text>
            <AppTextInput
              value={hours} onChangeText={setHours} keyboardType="number-pad"
              style={s.input}
            />
          </View>
        </>
      )}
    </PickerSheet>
  );
}

/* ── Defer ───────────────────────────────────────────────────────────── */
type Pursuit = { recordId: string; title: string; module: string; stage: string; targetDate: string; closeDate: string; value: string };

export function DeferSheet({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "defer_pursuit" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  const [list, setList] = useState<Pursuit[]>([]);
  const [pickedId, setPickedId] = useState("");
  const [days, setDays] = useState(String(payload.days));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const headers = await authHeaders();
        const r = await fetch(`${getApiBase()}/api/decision/pursuits?status=open`, { headers });
        const data = await r.json().catch(() => ({}));
        if (!alive) return;
        const arr: Pursuit[] = Array.isArray(data.pursuits) ? data.pursuits : [];
        setList(arr);
        const norm = (s: string) => s.toLowerCase().trim();
        const target = norm(payload.pursuitName);
        const match = arr.find(p => p.recordId === payload.recordId)
          ?? arr.find(p => norm(p.title).includes(target) || target.includes(norm(p.title)));
        setPickedId(match ? match.recordId : arr[0]?.recordId ?? "");
        if (arr.length === 0 && data.message) setErr(String(data.message));
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
  }, [payload.pursuitName, payload.recordId]);

  const submit = async () => {
    const row = list.find(p => p.recordId === pickedId);
    const d = Math.max(1, Math.min(365, Number(days) || 0));
    if (!row || d <= 0) return;
    setBusy(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${getApiBase()}/api/decision/defer-pursuit`, {
        method: "POST", headers,
        body: JSON.stringify({ pursuitName: row.title, recordId: row.recordId, days: d }),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok !== false;
      onResult(ok
        ? { ok: true, message: data.message || `Pushed ${row.title} by ${d} days.`, sub: data.detail }
        : { ok: false, message: data.message || `Request failed (${r.status}).` });
      onClose();
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : "Network error." });
      onClose();
    }
  };

  return (
    <PickerSheet
      open onClose={onClose}
      title="Defer a pursuit"
      subtitle="Pick the pursuit to push and confirm by how many days."
      primaryLabel={pickedId ? `Push ${days}D` : "Pick a pursuit"}
      primaryDisabled={!pickedId || !(Number(days) > 0)}
      busy={busy} onPrimary={submit}
      footerNote={loading ? "Loading…" : `${list.length} open pursuit${list.length === 1 ? "" : "s"}`}
    >
      {loading ? (
        <ActivityIndicator color={C.green} style={{ marginVertical: 32 }} />
      ) : err ? (
        <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>
      ) : list.length === 0 ? (
        <Text style={{ color: C.inkDim, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>
          No open pursuits found.
        </Text>
      ) : (
        <>
          {list.map(p => {
            const isSel = p.recordId === pickedId;
            return (
              <Pressable key={p.recordId} onPress={() => setPickedId(p.recordId)} style={[s.row, isSel && s.rowSel]}>
                <View style={[s.radio, isSel && s.radioSel]}>
                  {isSel ? <View style={s.radioDot} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{p.title}</Text>
                  <Text style={s.rowMeta}>
                    {p.module} · {p.recordId} · {p.stage}{p.targetDate ? ` · target ${p.targetDate}` : ""}
                  </Text>
                </View>
                {p.value ? (
                  <Text style={[s.rowVal, { color: C.orange }]}>{p.value}</Text>
                ) : null}
              </Pressable>
            );
          })}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
            <Text style={{ color: C.inkDim, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 }}>DAYS</Text>
            <AppTextInput value={days} onChangeText={setDays} keyboardType="number-pad" style={s.input} />
          </View>
        </>
      )}
    </PickerSheet>
  );
}

/* ── Open requisition ────────────────────────────────────────────────── */
export function OpenReqSheet({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "open_requisition" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  const [title, setTitle] = useState(payload.title);
  const [closeInDays, setCloseInDays] = useState(String(payload.closeInDays));
  const [manager, setManager] = useState(payload.manager ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const d = Math.max(1, Math.min(365, Number(closeInDays) || 0));
    if (!title.trim() || d <= 0) return;
    setBusy(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${getApiBase()}/api/decision/open-requisition`, {
        method: "POST", headers,
        body: JSON.stringify({ title: title.trim(), closeInDays: d, manager: manager.trim() || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok !== false;
      onResult(ok
        ? { ok: true, message: data.message || `Requisition queued: ${title}.`, sub: data.detail }
        : { ok: false, message: data.message || `Request failed (${r.status}).` });
      onClose();
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : "Network error." });
      onClose();
    }
  };

  const FieldLabel = ({ children }: { children: React.ReactNode }) => (
    <Text style={{ color: C.inkDim, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginBottom: 4 }}>
      {children}
    </Text>
  );

  return (
    <PickerSheet
      open onClose={onClose}
      title="Open a new requisition"
      subtitle="RM ONE create-demand isn't yet exposed — TA will be emailed and you'll open the req in the RM ONE portal."
      primaryLabel="Send to TA"
      primaryDisabled={!title.trim() || !(Number(closeInDays) > 0)}
      busy={busy} onPrimary={submit}
    >
      <View style={{ gap: 12 }}>
        <View>
          <FieldLabel>REQUISITION TITLE</FieldLabel>
          <AppTextInput value={title} onChangeText={setTitle} style={s.input} />
        </View>
        <View>
          <FieldLabel>TARGET CLOSE (DAYS FROM TODAY)</FieldLabel>
          <AppTextInput
            value={closeInDays} onChangeText={setCloseInDays}
            keyboardType="number-pad" style={[s.input, { width: 120 }]}
          />
        </View>
        <View>
          <FieldLabel>HIRING MANAGER (OPTIONAL)</FieldLabel>
          <AppTextInput
            value={manager} onChangeText={setManager}
            placeholder="e.g. Jane Smith" placeholderTextColor={C.inkDim}
            style={s.input}
          />
        </View>
      </View>
    </PickerSheet>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    height: "88%", overflow: "hidden",
    borderTopWidth: 1, borderColor: C.borderStrong,
  },
  header: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderColor: C.border,
  },
  title: { color: C.ink, fontFamily: "Inter_700Bold", fontSize: 15, lineHeight: 19 },
  subtitle: { color: C.inkDim, fontFamily: "Inter_400Regular", fontSize: 11.5, lineHeight: 15, marginTop: 4 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center",
  },
  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderColor: C.border,
    backgroundColor: "rgba(0,0,0,0.18)",
    ...Platform.select({ ios: { paddingBottom: 24 }, default: {} }),
  },
  footerNote: { color: C.inkDim, fontFamily: "Inter_400Regular", fontSize: 11, flex: 1 },
  btnGhost: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  btnGhostText: { color: C.ink, fontFamily: "Inter_700Bold", fontSize: 12 },
  btnPrimary: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    backgroundColor: C.green,
  },
  btnPrimaryText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 12 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  rowSel: { backgroundColor: C.surfaceSel, borderColor: C.green },
  rowCol: { flexDirection: "column", alignItems: "stretch", gap: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowName: { color: C.ink, fontFamily: "Inter_700Bold", fontSize: 13 },
  rowMeta: { color: C.inkDim, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  rowVal: { fontFamily: "Inter_700Bold", fontSize: 12, fontVariant: ["tabular-nums"] },
  pvKicker: { color: C.inkDim, fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.6, marginBottom: 4 },
  statusPill: {
    backgroundColor: "rgba(107,165,57,0.18)", borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.border,
  },
  statusPillText: { color: C.greenLt, fontFamily: "Inter_700Bold", fontSize: 11 },
  pvLabel: { color: C.inkDim, fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.6 },
  pvValue: { color: C.ink, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  mixWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8, marginLeft: 28 },
  mixChip: {
    backgroundColor: C.surfaceSel, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: C.border, maxWidth: 180,
  },
  mixChipText: { color: C.inkDim, fontFamily: "Inter_400Regular", fontSize: 10 },
  mixChipPct: { color: C.greenLt, fontFamily: "Inter_700Bold", fontSize: 10 },
  mixMore: { color: C.inkDim, fontFamily: "Inter_400Regular", fontSize: 10, alignSelf: "center" },
  checkbox: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 1.5, borderColor: C.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  checkboxSel: { backgroundColor: C.green, borderColor: C.green },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: C.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  radioSel: { borderColor: C.green },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  input: {
    backgroundColor: "rgba(0,0,0,0.30)", color: C.ink,
    borderWidth: 1, borderColor: C.border, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
