import React, { useEffect, useState } from "react";
import { fmtPct } from "@/lib/utils";
import { useLocation } from "wouter";
import { X, Check, Loader2, Calendar, Users, UserPlus, ExternalLink, ArrowLeft } from "lucide-react";
import type { DecisionActionPayload } from "./parseBlocks";
import { getProjectDetails, getProjectTeam, type ProjectTeamMember, type OpenRole } from "@/lib/api";

const DS = {
  dark: "#1F2D38",
  darkDeep: "#162028",
  card: "#2A3D4D",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.20)",
  green: "#6BA539",
  greenLt: "#A9C23F",
  orange: "#E87722",
  red: "#E03C3C",
  textOn: "#F1F5F9",
  textDim: "#94A3B8",
};

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("rmone_token");
  const username = window.localStorage.getItem("rmone_username") ?? "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { "X-Username": username } : {}),
  };
}

/* Distinct bench-roles cache: shared across mounts of EngagePicker /
 * ApplyPicker so opening a second picker doesn't refetch /candidate-roles
 * for the same session. Cleared implicitly on hard reload. */
type RolesPayload = { roles: { label: string; value: string; count: number }[]; totalScanned: number };
let __rolesCache: RolesPayload | null = null;
let __rolesPromise: Promise<RolesPayload> | null = null;
async function fetchRoles(): Promise<RolesPayload> {
  // Only treat the cache as authoritative when it has at least one role —
  // an empty result usually means the upstream call failed / wasn't signed
  // in yet, and we want the next picker open to retry instead of showing
  // a permanently empty dropdown.
  if (__rolesCache && __rolesCache.roles.length > 0) return __rolesCache;
  if (__rolesPromise) return __rolesPromise;
  __rolesPromise = (async () => {
    let result: RolesPayload = { roles: [], totalScanned: 0 };
    try {
      const r = await fetch(`/api/decision/candidate-roles`, { headers: authHeaders() });
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

/* Shared role-dropdown used by Engage (free people for outreach) and
 * Apply Step-1 (pick a person to shift). Populated from the live bench
 * feed via /api/decision/candidate-roles. `includeAll=true` adds an
 * "All roles" option (value="") so Apply can show every bench resource
 * by default. */
function RoleDropdown({
  value, onChange, includeAll,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAll: boolean;
}) {
  const [roles, setRoles] = useState<RolesPayload["roles"]>(__rolesCache?.roles ?? []);
  const [total, setTotal] = useState<number>(__rolesCache?.totalScanned ?? 0);
  useEffect(() => {
    let alive = true;
    fetchRoles().then(p => { if (alive) { setRoles(p.roles); setTotal(p.totalScanned); } });
    return () => { alive = false; };
  }, []);
  // "All roles" should reflect the full candidate count, not the sum of
  // role buckets — most RM ONE users don't have a JobTitle filled in, so
  // the bucket sum is much smaller than the actual people count.
  const allCount = total || roles.reduce((a, r) => a + r.count, 0);
  return (
    <div className="flex items-center gap-3 mb-3">
      <label className="text-[10px] font-bold tracking-wide" style={{ color: DS.textDim }}>FILTER ROLE</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md px-3 py-1.5 text-[13px] flex-1"
        style={{ background: "rgba(0,0,0,0.30)", color: DS.textOn, border: `1px solid ${DS.border}` }}
      >
        {includeAll && <option value="">All roles ({allCount})</option>}
        {value && !roles.some(r => r.value === value) && (
          <option value={value}>{value} (custom)</option>
        )}
        {roles.map(r => (
          <option key={r.value} value={r.value}>{r.label} ({r.count})</option>
        ))}
      </select>
    </div>
  );
}

/* Bench-candidates cache keyed by role query. The Engage picker hits
 * /api/decision/candidates which round-trips RM ONE GetUserList — slow
 * on a cold session. Cache per-role so re-opening the picker (or
 * switching roles back) is instant, and expose a `prefetchPickerData`
 * that the SITREP card calls on mount so the data is hot before the
 * user ever taps a chip. 60s TTL matches the server-side directory
 * cache. */
type CandidatesPayload = { candidates: Candidate[]; message?: string };
const __candidatesCache = new Map<string, { ts: number; data: CandidatesPayload }>();
const __candidatesPromise = new Map<string, Promise<CandidatesPayload>>();
const CANDIDATES_TTL_MS = 60_000;
async function fetchCandidates(role: string, opts?: { force?: boolean }): Promise<CandidatesPayload> {
  const key = role;
  const cached = __candidatesCache.get(key);
  if (!opts?.force && cached && Date.now() - cached.ts < CANDIDATES_TTL_MS && cached.data.candidates.length > 0) {
    return cached.data;
  }
  const inflight = __candidatesPromise.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    let data: CandidatesPayload = { candidates: [] };
    try {
      const url = `/api/decision/candidates?role=${encodeURIComponent(role)}&minFreeHours=0&limit=50`;
      const r = await fetch(url, { headers: authHeaders() });
      const j = await r.json().catch(() => ({}));
      data = {
        candidates: Array.isArray(j.candidates) ? j.candidates : [],
        message: j.message ? String(j.message) : undefined,
      };
    } catch (e) {
      data = { candidates: [], message: e instanceof Error ? e.message : String(e) };
    }
    __candidatesCache.set(key, { ts: Date.now(), data });
    __candidatesPromise.delete(key);
    return data;
  })();
  __candidatesPromise.set(key, p);
  return p;
}
export function getCachedCandidates(role: string): CandidatesPayload | undefined {
  const c = __candidatesCache.get(role);
  if (c && Date.now() - c.ts < CANDIDATES_TTL_MS) return c.data;
  return undefined;
}
/** Warm the picker caches in the background so opening a chip is
 *  instant. Safe to call repeatedly — fetches dedupe on the in-flight
 *  promise map and the TTL cache. */
export function prefetchPickerData(): void {
  void fetchRoles();
  void fetchCandidates("");
}

/* Shared dark modal shell — RM ONE-styled overlay + header + footer.
 * Children render the picker body. Footer shows Cancel + primary CTA. */
export function PickerModal({
  open, onClose, title, subtitle, children,
  primaryLabel, primaryDisabled, busy, onPrimary, footerNote,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  primaryLabel: string;
  primaryDisabled?: boolean;
  busy?: boolean;
  onPrimary: () => void;
  footerNote?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.65)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl w-full max-w-2xl flex flex-col max-h-[88vh] overflow-hidden"
        style={{
          background: `linear-gradient(180deg, ${DS.card} 0%, ${DS.darkDeep} 100%)`,
          border: `1px solid ${DS.borderStrong}`,
          boxShadow: "0 30px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-start justify-between gap-4 px-5 py-4"
          style={{ borderBottom: `1px solid ${DS.border}` }}
        >
          <div className="min-w-0">
            <div className="text-[15px] font-bold leading-tight" style={{ color: DS.textOn }}>
              {title}
            </div>
            {subtitle && (
              <div className="text-[12px] mt-1" style={{ color: DS.textDim }}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 shrink-0 hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={18} color="rgba(255,255,255,0.85)" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ borderTop: `1px solid ${DS.border}`, backgroundColor: "rgba(0,0,0,0.18)" }}
        >
          <div className="text-[11px]" style={{ color: DS.textDim }}>{footerNote ?? ""}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onPrimary}
              disabled={primaryDisabled || busy}
              className="rounded-md px-4 py-1.5 text-[12px] font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: DS.green }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Engage picker ─────────────────────────────────────────────────────── */
type ProjectMix = { projectId: string; projectName: string; pct: number };
type Candidate = { id: string; name: string; email: string; role: string; dept: string; currentPct?: number; freeHours?: number; projects?: ProjectMix[] };

/* Inline project-mix chips shown under each person in the bench picker so the
 * user can see which projects make up their allocation at a glance. Shows the
 * busiest few; collapses the remainder into a "+N more" chip. Renders nothing
 * when the person is on the bench (no active projects).
 *
 * When `onOpenProject` is supplied each chip becomes tappable and jumps
 * straight to that project's detail view. The chip lives inside the candidate
 * row (itself a <button>), so we render the chip as a span with role="button"
 * and stop propagation to avoid nested-button DOM and to keep the tap from
 * toggling the row's selection. */
function ProjectMixRow({
  projects, max = 3, onOpenProject,
}: { projects?: ProjectMix[]; max?: number; onOpenProject?: (projectId: string) => void }) {
  if (!projects || projects.length === 0) return null;
  const shown = projects.slice(0, max);
  const extra = projects.length - shown.length;
  const interactive = !!onOpenProject;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5 pl-[26px]">
      {shown.map((p, i) => (
        <span
          key={`${p.projectId}-${i}`}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          onClick={interactive ? (e) => { e.stopPropagation(); onOpenProject!(p.projectId); } : undefined}
          onKeyDown={interactive ? (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpenProject!(p.projectId); }
          } : undefined}
          className={`text-[10px] rounded px-1.5 py-0.5 tabular-nums truncate max-w-[180px] inline-flex items-center gap-1 ${interactive ? "cursor-pointer hover:bg-white/15 transition-colors" : ""}`}
          style={{ background: "rgba(255,255,255,0.06)", color: DS.textDim, border: `1px solid ${DS.border}` }}
          title={interactive ? `Open ${p.projectName} (${fmtPct(p.pct)})` : `${p.projectName} · ${fmtPct(p.pct)}`}
        >
          {p.projectName} <span style={{ color: DS.greenLt }}>{fmtPct(p.pct)}</span>
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] rounded px-1.5 py-0.5" style={{ color: DS.textDim }}>
          +{extra} more
        </span>
      )}
    </div>
  );
}

/* ── Project quick-preview overlay ─────────────────────────────────────── */
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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type PreviewState = {
  loading: boolean;
  err: string;
  name: string;
  status: string;
  start: string;
  end: string;
  team: ProjectTeamMember[];
  openRoles: OpenRole[];
};

/* Compact project preview shown ON TOP of the open picker so the user can
 * glance at a project's context (status, schedule window, current team /
 * open roles) without losing their picker selection. Layered above the
 * picker (z-[130]); closing it just unmounts the overlay and reveals the
 * still-mounted picker underneath with state intact. "Open full project"
 * navigates away as before for users who want the full detail page. */
function ProjectPreviewOverlay({
  projectId, onClose, onOpenFull,
}: { projectId: string; onClose: () => void; onOpenFull: (id: string) => void }) {
  const [st, setSt] = useState<PreviewState>({
    loading: true, err: "", name: "", status: "", start: "", end: "", team: [], openRoles: [],
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl w-full max-w-md flex flex-col max-h-[82vh] overflow-hidden"
        style={{
          background: `linear-gradient(180deg, ${DS.card} 0%, ${DS.darkDeep} 100%)`,
          border: `1px solid ${DS.borderStrong}`,
          boxShadow: "0 30px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${DS.border}` }}>
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-wide mb-1" style={{ color: DS.textDim }}>PROJECT PREVIEW</div>
            <div className="text-[15px] font-bold leading-tight truncate" style={{ color: DS.textOn }}>
              {st.loading ? "Loading…" : st.name}
            </div>
            <div className="text-[11px] mt-1" style={{ color: DS.textDim }}>{projectId}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 shrink-0 hover:bg-white/10 transition-colors" aria-label="Close preview">
            <X size={18} color="rgba(255,255,255,0.85)" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {st.loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin" color={DS.textDim} />
            </div>
          )}
          {!st.loading && st.err && (
            <div className="text-[12px] py-3" style={{ color: DS.red }}>{st.err}</div>
          )}
          {!st.loading && !st.err && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-[11px] font-bold rounded-full px-2.5 py-1"
                  style={{ background: "rgba(107,165,57,0.18)", color: DS.greenLt, border: `1px solid ${DS.border}` }}
                >
                  {st.status}
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                <Calendar size={15} color={DS.textDim} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-bold tracking-wide" style={{ color: DS.textDim }}>SCHEDULE</div>
                  <div className="text-[13px] mt-0.5 tabular-nums" style={{ color: DS.textOn }}>{scheduleWindow}</div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Users size={15} color={DS.textDim} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] font-bold tracking-wide" style={{ color: DS.textDim }}>
                      TEAM ({st.team.length})
                    </div>
                    {st.openRoles.length > 0 && (
                      <span className="text-[10px] inline-flex items-center gap-1" style={{ color: DS.orange }}>
                        <UserPlus size={11} /> {st.openRoles.length} open
                      </span>
                    )}
                  </div>
                  {st.team.length === 0 ? (
                    <div className="text-[12px] mt-1" style={{ color: DS.textDim }}>No staffed team members.</div>
                  ) : (
                    <div className="flex flex-col gap-1.5 mt-2">
                      {shownTeam.map((m, i) => (
                        <div key={`${m.name}-${i}`} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold truncate" style={{ color: DS.textOn }}>{m.name}</div>
                            <div className="text-[10px] truncate" style={{ color: DS.textDim }}>
                              {m.role || m.title || "—"}
                            </div>
                          </div>
                          {m.pctAllocation != null && (
                            <div className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: DS.greenLt }}>
                              {Math.round(m.pctAllocation)}%
                            </div>
                          )}
                        </div>
                      ))}
                      {moreTeam > 0 && (
                        <div className="text-[10px]" style={{ color: DS.textDim }}>+{moreTeam} more</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ borderTop: `1px solid ${DS.border}`, backgroundColor: "rgba(0,0,0,0.18)" }}
        >
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 text-white/80 hover:bg-white/10 transition-colors"
          >
            <ArrowLeft size={13} /> Back to picker
          </button>
          <button
            onClick={() => onOpenFull(projectId)}
            className="rounded-md px-4 py-1.5 text-[12px] font-bold text-white inline-flex items-center gap-1.5"
            style={{ backgroundColor: DS.green }}
          >
            <ExternalLink size={13} /> Open full project
          </button>
        </div>
      </div>
    </div>
  );
}

export function EngagePicker({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "engage_candidates" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  // Seed from the prefetch cache when warm so the picker renders the
  // candidate list instantly on open instead of flashing a "Loading
  // bench…" spinner. Falls through to the regular fetch when cold or
  // role changes.
  const seed = getCachedCandidates("");
  const [list, setList] = useState<Candidate[]>(seed?.candidates ?? []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(!seed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>(seed?.message && (seed.candidates.length === 0) ? seed.message : "");
  // User-editable role filter so the picker isn't a dead-end when the
  // synthesised role token (e.g. "Sr PM") finds zero matches. Defaults to
  // "" ("All roles") so the dropdown lists every real RM ONE title and
  // the candidate list isn't empty when the chip's role token doesn't
  // match anyone — user can then narrow down themselves.
  const [roleQuery, setRoleQuery] = useState("");
  const [, navigate] = useLocation();
  // Tapping a project chip opens a compact in-place preview overlay
  // instead of navigating away, so the picker (and the user's selection)
  // stays mounted underneath. "Open full project" inside the preview
  // navigates to the detail page for users who want the full view.
  const [previewId, setPreviewId] = useState("");
  const openProject = (projectId: string) => {
    if (projectId) setPreviewId(projectId);
  };
  const openFull = (projectId: string) => {
    if (!projectId) return;
    onClose();
    navigate(`/project/${encodeURIComponent(projectId)}`);
  };

  useEffect(() => {
    let alive = true;
    // Show cached data immediately if available; only spin when cold.
    const cached = getCachedCandidates(roleQuery);
    if (cached) {
      setList(cached.candidates);
      setErr(cached.candidates.length === 0 && cached.message ? cached.message : "");
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      // minFreeHours=0 → include everyone matching the role.
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
    setPicked(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const submit = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const recipients = list.filter(c => picked.has(c.id) && c.email).map(c => c.email);
      const r = await fetch(`/api/decision/engage-candidates`, {
        method: "POST",
        headers: authHeaders(),
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
    <PickerModal
      open
      onClose={onClose}
      title={`Engage ${payload.role} candidates`}
      subtitle={`Select people to email. RM ONE SaveAllocation isn't yet exposed — outreach lands in their inbox; finalize the soft alloc in the RM ONE portal.`}
      primaryLabel={picked.size > 0 ? `Engage ${picked.size}` : "Select at least 1"}
      primaryDisabled={picked.size === 0}
      busy={busy}
      onPrimary={submit}
      footerNote={loading ? "Loading…" : `${list.length} candidate${list.length === 1 ? "" : "s"} found`}
    >
      <RoleDropdown value={roleQuery} onChange={setRoleQuery} includeAll />
      {loading && <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>Loading bench…</div>}
      {!loading && err && <div className="text-[12px] py-3" style={{ color: DS.red }}>{err}</div>}
      {!loading && list.length === 0 && !err && (
        <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>
          {roleQuery
            ? `No "${roleQuery}" matches in the bench feed. Pick a different role above, or choose "All roles".`
            : `No bench resources returned from RM ONE yet. Try refreshing once you're signed in.`}
        </div>
      )}
      {!loading && list.length > 0 && (
        <div className="flex flex-col gap-2">
          {list.map(c => {
            const isSel = picked.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="text-left rounded-lg px-3 py-2.5 transition-colors"
                style={{
                  background: isSel ? "rgba(107,165,57,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isSel ? DS.green : DS.border}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                    style={{
                      background: isSel ? DS.green : "transparent",
                      border: `1.5px solid ${isSel ? DS.green : DS.borderStrong}`,
                    }}
                  >
                    {isSel && <Check size={11} color="#FFFFFF" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold" style={{ color: DS.textOn }}>{c.name}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: DS.textDim }}>
                      {c.role} · {c.dept}
                    </div>
                  </div>
                  {(c.freeHours != null || c.currentPct != null) && (
                    <div className="text-right shrink-0">
                      {c.freeHours != null && (
                        <div className="text-[12px] font-bold tabular-nums" style={{ color: DS.greenLt }}>
                          {c.freeHours}h free
                        </div>
                      )}
                      {c.currentPct != null && (
                        <div className="text-[10px] tabular-nums" style={{ color: DS.textDim }}>
                          {fmtPct(c.currentPct)} allocated
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <ProjectMixRow projects={c.projects} onOpenProject={openProject} />
              </button>
            );
          })}
        </div>
      )}
    </PickerModal>
    {previewId && (
      <ProjectPreviewOverlay
        projectId={previewId}
        onClose={() => setPreviewId("")}
        onOpenFull={openFull}
      />
    )}
    </>
  );
}

/* ── Apply picker ──────────────────────────────────────────────────────── */
type Allocation = { id: string; projectId: string; projectName: string; pct: number; hoursPerWeek: number; start: string; end: string };

export function ApplyPicker({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "shift_allocation" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  // When the brief did not name a person, surface a Step 1 person picker
  // before loading allocations.
  const [person, setPerson] = useState(payload.personName);
  // Default to "" → "All roles" so the picker shows everyone on the bench
  // immediately (the user said the chip should expose every role up-front).
  const [roleQuery, setRoleQuery] = useState("");
  const [people, setPeople] = useState<Candidate[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);

  const [list, setList] = useState<Allocation[]>([]);
  const [pickedId, setPickedId] = useState<string>("");
  const [hours, setHours] = useState<number>(payload.hoursPerWeek);
  const [loadingAlloc, setLoadingAlloc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [, navigate] = useLocation();
  // Tapping a project chip in the Step-1 person picker opens a compact
  // in-place preview overlay instead of navigating away, so the picker
  // and the user's selection stay mounted underneath.
  const [previewId, setPreviewId] = useState("");
  const openProject = (projectId: string) => {
    if (projectId) setPreviewId(projectId);
  };
  const openFull = (projectId: string) => {
    if (!projectId) return;
    onClose();
    navigate(`/project/${encodeURIComponent(projectId)}`);
  };

  // Step 1: fetch bench when no person is selected.
  useEffect(() => {
    if (person) return;
    let alive = true;
    setLoadingPeople(true);
    (async () => {
      try {
        // roleQuery may be "" (All roles) — server now permits empty role.
        const url = `/api/decision/candidates?role=${encodeURIComponent(roleQuery)}&minFreeHours=0&limit=50`;
        const r = await fetch(url, { headers: authHeaders() });
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

  // Step 2: fetch this person's allocations.
  useEffect(() => {
    if (!person) return;
    let alive = true;
    setLoadingAlloc(true);
    (async () => {
      try {
        const r = await fetch(
          `/api/decision/person-allocations?personName=${encodeURIComponent(person)}`,
          { headers: authHeaders() },
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
    if (!person || !row) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/decision/shift-allocation`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          personName: person,
          projectId: row.projectId,
          hoursPerWeek: hours,
        }),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok !== false;
      onResult(ok
        ? { ok: true, message: data.message || `Shifted ${hours}h/wk on ${row.projectName}.`, sub: data.detail }
        : { ok: false, message: data.message || `Request failed (${r.status}).` });
      onClose();
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : "Network error." });
      onClose();
    }
  };

  // Step 1 view.
  if (!person) {
    return (
      <>
      <PickerModal
        open
        onClose={onClose}
        title="Pick a person to shift"
        subtitle="Choose someone from the bench whose allocation you want to reduce."
        primaryLabel="Pick a person"
        primaryDisabled
        onPrimary={() => {}}
        footerNote={loadingPeople ? "Loading bench…" : `${people.length} candidate${people.length === 1 ? "" : "s"}`}
      >
        <RoleDropdown value={roleQuery} onChange={setRoleQuery} includeAll />
        {loadingPeople && <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>Loading bench…</div>}
        {!loadingPeople && err && <div className="text-[12px] py-3" style={{ color: DS.red }}>{err}</div>}
        {!loadingPeople && people.length === 0 && !err && (
          <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>
            No bench resources match "{roleQuery}". Try a different role.
          </div>
        )}
        {!loadingPeople && people.length > 0 && (
          <div className="flex flex-col gap-2">
            {people.map(c => (
              <button
                key={c.id}
                onClick={() => setPerson(c.name)}
                className="text-left rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5"
                style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}` }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold" style={{ color: DS.textOn }}>{c.name}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: DS.textDim }}>{c.role} · {c.dept}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-bold tabular-nums" style={{ color: DS.greenLt }}>{c.freeHours}h free</div>
                    <div className="text-[10px] tabular-nums" style={{ color: DS.textDim }}>{c.currentPct}% allocated</div>
                  </div>
                </div>
                <ProjectMixRow projects={c.projects} onOpenProject={openProject} />
              </button>
            ))}
          </div>
        )}
      </PickerModal>
      {previewId && (
        <ProjectPreviewOverlay
          projectId={previewId}
          onClose={() => setPreviewId("")}
          onOpenFull={openFull}
        />
      )}
      </>
    );
  }

  return (
    <PickerModal
      open
      onClose={onClose}
      title={`Shift ${person}'s allocation`}
      subtitle="Pick which active allocation to reduce, then confirm the hours/week to free up."
      primaryLabel={pickedId ? `Shift ${hours}h/wk` : "Pick a row"}
      primaryDisabled={!pickedId || hours <= 0}
      busy={busy}
      onPrimary={submit}
      footerNote={loadingAlloc ? "Loading allocations…" : `${list.length} active row${list.length === 1 ? "" : "s"}`}
    >
      {!payload.personName && (
        <button
          onClick={() => { setPerson(""); setList([]); setPickedId(""); }}
          className="text-[12px] font-bold mb-3"
          style={{ color: DS.greenLt }}
        >
          ← Change person
        </button>
      )}
      {loadingAlloc && <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>Loading allocations…</div>}
      {!loadingAlloc && err && <div className="text-[12px] py-3" style={{ color: DS.red }}>{err}</div>}
      {!loadingAlloc && list.length === 0 && !err && (
        <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>
          {person} has no active allocations to shift.
        </div>
      )}
      {!loadingAlloc && list.length > 0 && (
        <>
          <div className="flex flex-col gap-2 mb-4">
            {list.map(a => {
              const isSel = a.id === pickedId;
              return (
                <button
                  key={a.id}
                  onClick={() => setPickedId(a.id)}
                  className="text-left rounded-lg px-3 py-2.5 transition-colors"
                  style={{
                    background: isSel ? "rgba(107,165,57,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isSel ? DS.green : DS.border}`,
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: isSel ? DS.green : "transparent",
                        border: `1.5px solid ${isSel ? DS.green : DS.borderStrong}`,
                      }}
                    >
                      {isSel && <div style={{ width: 6, height: 6, background: "#FFF", borderRadius: 3 }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold" style={{ color: DS.textOn }}>{a.projectName}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: DS.textDim }}>
                        {a.projectId}{a.start && ` · ${a.start}${a.end ? ` → ${a.end}` : ""}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[12px] font-bold tabular-nums" style={{ color: DS.orange }}>
                        {fmtPct(a.pct)}
                      </div>
                      <div className="text-[10px] tabular-nums" style={{ color: DS.textDim }}>
                        {a.hoursPerWeek}h/wk
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-bold tracking-wide" style={{ color: DS.textDim }}>HOURS / WEEK TO FREE</label>
            <input
              type="number" min={1} max={40} value={hours}
              onChange={(e) => setHours(Math.max(1, Math.min(40, Number(e.target.value) || 0)))}
              className="rounded-md px-3 py-1.5 text-[13px] font-bold tabular-nums w-20"
              style={{ background: "rgba(0,0,0,0.30)", color: DS.textOn, border: `1px solid ${DS.border}` }}
            />
          </div>
        </>
      )}
    </PickerModal>
  );
}

/* ── Defer picker ──────────────────────────────────────────────────────── */
type Pursuit = { recordId: string; title: string; module: string; stage: string; targetDate: string; closeDate: string; value: string };

export function DeferPicker({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "defer_pursuit" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  const [list, setList] = useState<Pursuit[]>([]);
  const [pickedId, setPickedId] = useState<string>("");
  const [days, setDays] = useState<number>(payload.days);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/decision/pursuits?status=open`, { headers: authHeaders() });
        const data = await r.json().catch(() => ({}));
        if (!alive) return;
        const arr: Pursuit[] = Array.isArray(data.pursuits) ? data.pursuits : [];
        setList(arr);
        // Default selection: payload.recordId, else fuzzy match by name, else first.
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
    if (!row) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/decision/defer-pursuit`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ pursuitName: row.title, recordId: row.recordId, days }),
      });
      const data = await r.json().catch(() => ({}));
      const ok = r.ok && data.ok !== false;
      onResult(ok
        ? { ok: true, message: data.message || `Pushed ${row.title} by ${days} days.`, sub: data.detail }
        : { ok: false, message: data.message || `Request failed (${r.status}).` });
      onClose();
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : "Network error." });
      onClose();
    }
  };

  return (
    <PickerModal
      open
      onClose={onClose}
      title="Defer a pursuit"
      subtitle="Pick the pursuit to push and confirm by how many days."
      primaryLabel={pickedId ? `Push ${days}D` : "Pick a pursuit"}
      primaryDisabled={!pickedId || days <= 0}
      busy={busy}
      onPrimary={submit}
      footerNote={loading ? "Loading pursuits…" : `${list.length} open pursuit${list.length === 1 ? "" : "s"}`}
    >
      {loading && <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>Loading pursuits…</div>}
      {!loading && err && <div className="text-[12px] py-3" style={{ color: DS.red }}>{err}</div>}
      {!loading && list.length === 0 && !err && (
        <div className="text-center py-10 text-[12px]" style={{ color: DS.textDim }}>No open pursuits found.</div>
      )}
      {!loading && list.length > 0 && (
        <>
          <div className="flex flex-col gap-2 mb-4 max-h-[42vh] overflow-auto">
            {list.map(p => {
              const isSel = p.recordId === pickedId;
              return (
                <button
                  key={p.recordId}
                  onClick={() => setPickedId(p.recordId)}
                  className="text-left rounded-lg px-3 py-2.5 transition-colors"
                  style={{
                    background: isSel ? "rgba(107,165,57,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isSel ? DS.green : DS.border}`,
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: isSel ? DS.green : "transparent",
                        border: `1.5px solid ${isSel ? DS.green : DS.borderStrong}`,
                      }}
                    >
                      {isSel && <div style={{ width: 6, height: 6, background: "#FFF", borderRadius: 3 }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold" style={{ color: DS.textOn }}>{p.title}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: DS.textDim }}>
                        {p.module} · {p.recordId} · {p.stage}
                        {p.targetDate && ` · target ${p.targetDate}`}
                      </div>
                    </div>
                    {p.value && (
                      <div className="text-[12px] font-bold tabular-nums shrink-0" style={{ color: DS.orange }}>
                        {p.value}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-bold tracking-wide" style={{ color: DS.textDim }}>DAYS TO PUSH</label>
            <input
              type="number" min={1} max={365} value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 0)))}
              className="rounded-md px-3 py-1.5 text-[13px] font-bold tabular-nums w-20"
              style={{ background: "rgba(0,0,0,0.30)", color: DS.textOn, border: `1px solid ${DS.border}` }}
            />
          </div>
        </>
      )}
    </PickerModal>
  );
}

/* ── Open requisition form ─────────────────────────────────────────────── */
export function OpenReqForm({
  payload, onClose, onResult,
}: {
  payload: Extract<DecisionActionPayload, { kind: "open_requisition" }>;
  onClose: () => void;
  onResult: (r: { ok: boolean; message: string; sub?: string }) => void;
}) {
  const [title, setTitle] = useState(payload.title);
  const [closeInDays, setCloseInDays] = useState(payload.closeInDays);
  const [manager, setManager] = useState(payload.manager ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/decision/open-requisition`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title: title.trim(), closeInDays, manager: manager.trim() || undefined }),
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

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold tracking-wide" style={{ color: DS.textDim }}>{label}</label>
      {children}
    </div>
  );

  return (
    <PickerModal
      open
      onClose={onClose}
      title="Open a new requisition"
      subtitle="RM ONE create-demand isn't yet exposed — Talent Acquisition will be emailed and you'll open the req in the RM ONE portal."
      primaryLabel="Send to TA"
      primaryDisabled={!title.trim() || closeInDays <= 0}
      busy={busy}
      onPrimary={submit}
    >
      <div className="flex flex-col gap-3">
        <Field label="REQUISITION TITLE">
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            className="rounded-md px-3 py-2 text-[13px]"
            style={{ background: "rgba(0,0,0,0.30)", color: DS.textOn, border: `1px solid ${DS.border}` }}
          />
        </Field>
        <Field label="TARGET CLOSE (DAYS FROM TODAY)">
          <input
            type="number" min={1} max={365} value={closeInDays}
            onChange={(e) => setCloseInDays(Math.max(1, Math.min(365, Number(e.target.value) || 0)))}
            className="rounded-md px-3 py-2 text-[13px] tabular-nums w-32"
            style={{ background: "rgba(0,0,0,0.30)", color: DS.textOn, border: `1px solid ${DS.border}` }}
          />
        </Field>
        <Field label="HIRING MANAGER (OPTIONAL)">
          <input
            type="text" value={manager} onChange={(e) => setManager(e.target.value)}
            placeholder="e.g. Jane Smith"
            className="rounded-md px-3 py-2 text-[13px]"
            style={{ background: "rgba(0,0,0,0.30)", color: DS.textOn, border: `1px solid ${DS.border}` }}
          />
        </Field>
      </div>
    </PickerModal>
  );
}
