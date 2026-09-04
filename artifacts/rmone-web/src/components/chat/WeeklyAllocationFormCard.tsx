/**
 * WeeklyAllocationFormCard — interactive web port of the mobile widget at
 * artifacts/rmone-mobile/app/(tabs)/chat.tsx WeeklyAllocationFormCard
 * (~lines 910-2300).
 *
 * Features ported from mobile:
 *  - Per-week editable hours grid built from objProjectLifeCycle + person rows
 *  - Fuzzy/Levenshtein name matching against ExistingAllocations + NewAllocations
 *  - Business Unit / Role / Title picker dropdowns
 *  - New-member two-step flow: pick BU/Role/Title -> explicit "Save assignment"
 *    (assignResource via a DETERMINISTIC exact-name GUID lookup + duplicate
 *    guard) -> then the hours-by-phase editor appears. handleSave never
 *    auto-assigns (it refuses to write hours for someone not on the project).
 *  - Per-week unique IDs, dupe zeroing, ghost-hours fix
 *  - EAC / ETC summary tiles
 *  - Minus / plus quick controls beside each input
 *
 * Intentionally NOT ported (out of scope for this iteration):
 *  - Cost rate derivation / ETC Cost cell
 *  - Prefill modes (totalSet, perWeekSet, eachPhaseSet, clearAll, autosave)
 *  - Per-message dedup / global pendingPhaseEdits cache
 */
import React from "react";
import { fmtHours, fmtPct } from "@/lib/utils";
import {
  Loader2, Save, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Minus, Plus, X, Search, Lock as LockIcon, ArrowRight,
} from "lucide-react";
import {
  getFullProjectAllocations, assignResource,
  getDivisions, getProjectDivisionRoles, getUserList, getTaskData,
  getRolesByBU, getJobTitlesByRole, getBusinessUnits, buildTitleOptions,
  getPersonOrgDefaults, getProjectTeam,
} from "@/lib/api";
import { notifyMemberWrite } from "@/lib/memberWriteQueue";
import { saveMemberWeeklyHours } from "@/lib/saveMemberWeeklyHours";
import { MAX_WEEKLY_HOURS } from "@/lib/weeklyHoursValidation";
import type { PersonOrgDefaults } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { refreshProjectTeamCache } from "@/lib/teamCache";
import { withSuggestedTitleOptions } from "@/lib/standardTitles";
import type { AssignRole, AssignTitle } from "@/lib/api";
import { getBusinessRules } from "@/lib/businessRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import { Z } from "@/lib/zLayers";

const C = {
  green: "#6BA539",
  greenSoft: "#E8F2D9",
  greenInk: "#3D6B1E",
  orange: "#E87722",
  orangeSoft: "#FBEADB",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  borderSoft: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  bgDark: "#253746",
  bgDarker: "#1B2832",
  red: "#E03C3C",
  redSoft: "#FDECEC",
  amber: "#E8A33D",
  amberSoft: "#FBF1E0",
};

interface WAWeek { key: string; hours: number; }
interface WAPhase { phaseName: string; stageStep: number; color: string; weeks: WAWeek[]; }

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

/** Parse an RM ONE schedule date (ISO date/datetime or "YYYY-MM-DD") → Date.
 *  Returns null for empty / sentinel ("0001-…") values. Builds a LOCAL
 *  midnight date from the date part so comparisons line up with parseWeekKey
 *  (also local midnight) instead of drifting a day from UTC-based parsing. */
function parseScheduleDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("0001")) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** FALLBACK phase builder: derive phases from objProjectLifeCycle + per-week
 *  _stageStep markers. Used only when the authoritative /task-data Phase
 *  Schedule is unavailable. (This is the pre-existing behaviour.) */
function buildPhasesFromLifecycle(args: {
  lifecycle: any[]; weekDateKeys: string[]; weekSource: any;
  summaryRow: any; personRows: any[];
}): WAPhase[] {
  const { lifecycle, weekDateKeys, weekSource, summaryRow, personRows } = args;
  const entries: WAPhase[] = [];
  const stageMap = new Map<number, { name: string; color: string; weeks: WAWeek[] }>();
  for (const p of lifecycle) {
    const stepRaw = p.StageStep ?? p.ItemOrder ?? 0;
    const step = Number(stepRaw);
    if (!isFinite(step)) continue;
    stageMap.set(step, { name: p.Title ?? `Phase ${step}`, color: "", weeks: [] });
  }
  const stageSource = summaryRow ?? weekSource;
  const otherEntry = { name: "Other / Unscheduled", color: C.green, weeks: [] as WAWeek[] };
  for (const wk of weekDateKeys) {
    const stepRaw = stageSource[`${wk}_stageStep`] ?? weekSource[`${wk}_stageStep`];
    const step = stepRaw !== undefined && stepRaw !== null ? Number(stepRaw) : NaN;
    const color = stageSource[`${wk}_stageColor`] ?? stageSource[`P${step}_stageColor`] ?? C.green;
    let hours = 0;
    for (const row of personRows) {
      const v = Number(row[wk] ?? 0);
      if (!isNaN(v)) hours += v;
    }
    if (isFinite(step) && stageMap.has(step)) {
      const entry = stageMap.get(step)!;
      entry.weeks.push({ key: wk, hours });
      if (!entry.color) entry.color = color;
    } else {
      otherEntry.weeks.push({ key: wk, hours });
    }
  }
  for (const [step, info] of stageMap) {
    if (info.weeks.length > 0) {
      entries.push({ phaseName: info.name, stageStep: step, color: info.color || C.green, weeks: info.weeks });
    }
  }
  entries.sort((a, b) => a.stageStep - b.stageStep);
  if (otherEntry.weeks.some(w => w.hours > 0)) {
    entries.push({ phaseName: otherEntry.name, stageStep: -1, color: otherEntry.color, weeks: otherEntry.weeks });
  }
  return entries;
}
interface BUOption { id: string; label: string; buId?: string }

interface Props {
  personName: string;
  projectId: string;
  projectName: string;
  prefill?: { phase: string; mode: "add" | "subtract" | "set"; hours: number }[];
  totalSet?: number;
  perWeekSet?: number;
  eachPhaseSet?: number;
  clearAll?: boolean;
  autosave?: boolean;
  /** Stable per-message identifier so re-mounts of the SAME tag dedup, but a
   *  user re-asking the same thing in a NEW message always re-applies. */
  messageKey?: string | number;
  /** When true all inputs and the Save button are disabled. */
  readOnly?: boolean;
  /** When true the person is already on the project team — skip the
   *  "NEW MEMBER · Assignment Details" setup form and go straight to
   *  the hours editor. Useful when the server already confirmed membership
   *  before opening the card (e.g. the "already assigned" shortcut). */
  alreadyAssigned?: boolean;
  /** Send a chat message on behalf of the user (used for inline CTA actions). */
  onSend?: (msg: string) => void;
}

// ── prefill helpers (port of mobile chat.tsx:836-905) ──────────────────────

/** Stable signature of the prefill payload for de-dup on re-mount. */
function prefillSig(
  prefill?: { phase: string; mode: "add" | "subtract" | "set"; hours: number }[],
  totalSet?: number,
  clearAll?: boolean,
  autosave?: boolean,
  perWeekSet?: number,
  eachPhaseSet?: number,
): string {
  const parts: string[] = [];
  if (clearAll) parts.push("clear");
  if (prefill && prefill.length > 0) {
    parts.push(prefill.map(p => `${p.phase}:${p.mode}:${p.hours}`).join("|"));
  }
  if (typeof totalSet === "number") parts.push(`total:${totalSet}`);
  if (typeof perWeekSet === "number") parts.push(`perweek:${perWeekSet}`);
  if (typeof eachPhaseSet === "number") parts.push(`eachphase:${eachPhaseSet}`);
  if (autosave) parts.push("autosave");
  return parts.join(";");
}

/** Distribute `target` hours across `weeks` evenly, with remainder on the
 *  last week. mode = "set" replaces; "add"/"subtract" delta the existing
 *  per-week values (clamped at 0 for subtract). */
function distributeAcross(
  weeks: WAWeek[],
  target: number,
  mode: "add" | "subtract" | "set",
): WAWeek[] {
  if (weeks.length === 0) return weeks;
  if (mode === "set") {
    const per = Math.floor(target / weeks.length);
    const rem = target - per * weeks.length;
    return weeks.map((w, i) => ({ ...w, hours: per + (i === weeks.length - 1 ? rem : 0) }));
  }
  if (mode === "add") {
    const per = Math.floor(target / weeks.length);
    const rem = target - per * weeks.length;
    return weeks.map((w, i) => ({
      ...w, hours: Math.max(0, w.hours + per + (i === weeks.length - 1 ? rem : 0)),
    }));
  }
  // subtract: take `target` total off the phase, proportionally, clamped at 0.
  const cur = weeks.reduce((s, w) => s + w.hours, 0);
  if (cur <= 0) return weeks;
  const take = Math.min(target, cur);
  const scale = (cur - take) / cur;
  let assigned = 0;
  return weeks.map((w, i) => {
    let v = Math.round(w.hours * scale);
    if (i === weeks.length - 1) v = Math.max(0, (cur - take) - assigned);
    assigned += v;
    return { ...w, hours: v };
  });
}

// ───────── name matching (port of mobile normalize/fuzzy/lev) ─────────

const normalize = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[\-_.''`]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const lev = (a: string, b: string): number => {
  if (!a || !b) return Math.max(a.length, b.length);
  const m = a.length, n = b.length;
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
};

function makeMatcher(personName: string) {
  const normName = normalize(personName);
  const normNameTokens = normName.split(" ").filter(Boolean);
  const fuzzy = (cand: string) => {
    const c = normalize(cand);
    if (!c || !normName) return false;
    if (c === normName) return true;
    if (c.includes(normName) || normName.includes(c)) return true;
    const cTokens = c.split(" ").filter(Boolean);
    if (normNameTokens.length >= 2 && cTokens.length >= 2) {
      const allMatch = normNameTokens.every(t =>
        cTokens.some(ct => ct === t || (t.length >= 3 && ct.length >= 3 && lev(t, ct) <= 1))
      );
      if (allMatch) return true;
    }
    const cFirst = cTokens[0] || "";
    const tFirst = normNameTokens[0] || "";
    if (cFirst && tFirst && lev(cFirst, tFirst) <= 2) return true;
    return false;
  };
  return (r: any) => {
    const n = String(r?.AssignedToName ?? "").trim();
    if (fuzzy(n)) return true;
    const full = `${r?.FirstName ?? ""} ${r?.LastName ?? ""}`.trim();
    if (fuzzy(full)) return true;
    if (fuzzy(String(r?.FirstName ?? "").trim())) return true;
    return false;
  };
}

const monthMap: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

const wkLabel = (wk: string) => {
  const p = wk.split("-");
  return `${p[1]} ${p[0]}`;
};

// Returns Monday-of-current-week as YYYY-MM-DD for ETC cutoff calculation.
const currentMondayISO = (): string => {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // back to Monday
  today.setDate(today.getDate() + offset);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const wkToISO = (wk: string) => {
  const p = wk.split("-");
  return `20${p[2]}-${monthMap[p[1]] ?? "01"}-${p[0]}`;
};

// ─────────────────── component ───────────────────

export function WeeklyAllocationFormCard({
  personName, projectId, projectName,
  prefill, totalSet, perWeekSet, eachPhaseSet, clearAll, autosave, messageKey,
  readOnly, alreadyAssigned, onSend,
}: Props) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [personOrg, setPersonOrg] = React.useState<PersonOrgDefaults | null>(null);

  React.useEffect(() => {
    if (!personName) return;
    getPersonOrgDefaults(personName)
      .then(d => { if (d.found) setPersonOrg(d); })
      .catch(() => {});
  }, [personName]);
  const [phases, setPhases] = React.useState<WAPhase[]>([]);
  const [rawData, setRawData] = React.useState<any>(null);
  const [memberAlloc, setMemberAlloc] = React.useState<any>(null);
  const [foundOnProject, setFoundOnProject] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  /** Set when autosave=true AND a prefill applied successfully. The
   *  effect below watches this flag and fires handleSave() once render settles. */
  const [pendingAutoSave, setPendingAutoSave] = React.useState(false);
  const autoSaveFiredRef = React.useRef(false);
  /** Per-cell max-168 violations: "stageStep:weekKey" → error message. */
  const [weekErrors, setWeekErrors] = React.useState<Record<string, string>>({});
  /** Per-instance dedup so a re-render of THIS card with the same sig
   *  doesn't double-apply (e.g. add 5h becoming +10h on remount). */
  const appliedPrefillSigsRef = React.useRef<Set<string>>(new Set());

  // Picker state
  const [bus, setBus] = React.useState<BUOption[]>([]);
  const [buEntities, setBuEntities] = React.useState<BUOption[]>([]);
  const [roleRows, setRoleRows] = React.useState<any[]>([]);
  const [waBusinessUnit, setWaBusinessUnit] = React.useState("");
  const [waBU, setWaBU] = React.useState("");
  const [waRole, setWaRole] = React.useState("");
  const [waTitle, setWaTitle] = React.useState("");
  // Specific JobTitle.ID so two identically-named titles in different
  // departments resolve to the right record on write. Empty for fallback opts.
  const [waTitleId, setWaTitleId] = React.useState("");
  const [picker, setPicker] = React.useState<"businessUnit" | "bu" | "role" | "title" | null>(null);
  const [pickerSearch, setPickerSearch] = React.useState("");
  const [peopleTitles, setPeopleTitles] = React.useState<string[]>([]);
  // Official BU→Role→Title cascade (same source as AssignmentSetupCard). The
  // project-division-roles blob only carries the roles already on the project,
  // so it shows just a few; getRolesByBU returns the full BU role catalog.
  const [apiRoles, setApiRoles] = React.useState<AssignRole[]>([]);
  const [apiTitles, setApiTitles] = React.useState<AssignTitle[]>([]);
  /** false = hard/EAC (confirmed), true = soft/NC (tentative/pre-award).
   *  Only surfaced as a toggle for OPM (opportunity) projects since NC vs EAC
   *  is the key distinction in pre-award resource planning. */
  const [softAlloc, setSoftAlloc] = React.useState(false);
  const isOppProject = projectId.toUpperCase().startsWith("OPM-");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
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
        const data = allocRes.value as any;
        const schedulePhasesRaw: any[] =
          schedRes.status === "fulfilled" && Array.isArray(schedRes.value)
            ? (schedRes.value as any[]) : [];
        setRawData(data);

        const lifecycle: any[] = data?.objProjectLifeCycle ?? [];
        const eaList: any[] = data?.ExistingAllocations ?? [];
        const naList: any[] = data?.NewAllocations ?? [];
        const matchFn = makeMatcher(personName);

        const member = naList.find(matchFn) || eaList.find(matchFn);
        const summaryRow = naList.find((r: any) => !(r.AssignedToName ?? "").trim());
        const personFound = !!member;
        const weekSource = member ?? summaryRow;
        setFoundOnProject(personFound);
        // When the card mounts and the person is already on the project (put
        // there by the chat's assign_person tool moments before), invalidate
        // the team cache so the Team modal reflects the new member immediately.
        if (personFound) {
          refreshProjectTeamCache(queryClient, projectId);
          queryClient.invalidateQueries({ queryKey: ["project-allocations-raw", projectId] });
        }
        setMemberAlloc(member ?? null);
        // Seed soft/NC toggle from the existing allocation row so the user
        // sees the correct current type when editing an existing assignment.
        setSoftAlloc(String(member?.SoftAllocation ?? "false").toLowerCase() === "true");

        // ── Build phases × weeks matrix ──
        //
        // PRIMARY: map each week to a phase from the authoritative Project
        // Phase Schedule (/task-data) by DATE-RANGE overlap, so the "HOURS BY
        // PHASE" list matches the real RM ONE Schedule tab exactly (names,
        // order and week counts). objProjectLifeCycle is NOT used here because
        // it carries lifecycle/workflow stages (e.g. "Forecast Conversion")
        // whose titles and step indexes don't match the real phase schedule.
        //
        // FALLBACK: if /task-data is unavailable or yields no usable phases,
        // derive phases from objProjectLifeCycle + per-week _stageStep markers
        // (the previous behaviour) via buildPhasesFromLifecycle().
        let entries: WAPhase[] = [];
        const personRows = personFound
          ? [...naList.filter(matchFn), ...eaList.filter(matchFn)]
          : [];

        // Parse the authoritative Phase Schedule regardless of whether the
        // person has existing allocation rows. We need sched available for
        // the synthetic-week fallback below (fresh 0% assignments have no
        // week columns at all, so weekDateKeys is empty).
        const sched = schedulePhasesRaw
          .map((p: any) => ({
            title: String(p.Title ?? p.Alias ?? "").trim(),
            step: Number(p.StageStep ?? p.ItemOrder ?? 0),
            start: parseScheduleDate(p.StartDate),
            due: parseScheduleDate(p.DueDate ?? p.EndDate),
          }))
          .filter((p) => p.title && p.start && p.due)
          .sort((a, b) => a.step - b.step);

        if (weekSource) {
          const weekDateKeys = Object.keys(weekSource).filter((k: string) =>
            /^\d{2}-[A-Za-z]{3}-\d{2}$/.test(k) && !k.includes("_")
          );

          // PRIMARY — authoritative Phase Schedule via date-range mapping.
          if (sched.length > 0) {
            const buckets = sched.map((p) => ({ ...p, color: "", weeks: [] as WAWeek[] }));
            const otherWeeks: WAWeek[] = [];
            for (const wk of weekDateKeys) {
              const wkStart = parseWeekKey(wk);
              const wkEnd = wkStart ? new Date(wkStart.getTime() + 6 * 864e5) : null;
              let hours = 0;
              for (const row of personRows) {
                const v = Number(row[wk] ?? 0);
                if (!isNaN(v)) hours += v;
              }
              let placed = false;
              if (wkStart && wkEnd) {
                for (const b of buckets) {
                  // Overlap test: week span [wkStart, wkEnd] ∩ phase [start, due]
                  if (wkStart <= b.due! && wkEnd >= b.start!) {
                    b.weeks.push({ key: wk, hours });
                    if (!b.color) b.color = String(weekSource[`${wk}_stageColor`] ?? "") || C.green;
                    placed = true;
                    break;
                  }
                }
              }
              if (!placed) otherWeeks.push({ key: wk, hours });
            }
            for (const b of buckets) {
              if (b.weeks.length > 0) {
                entries.push({ phaseName: b.title, stageStep: b.step, color: b.color || C.green, weeks: b.weeks });
              }
            }
            if (otherWeeks.some((w) => w.hours > 0)) {
              entries.push({ phaseName: "Other / Unscheduled", stageStep: -1, color: C.green, weeks: otherWeeks });
            }
          }

          // FALLBACK — no authoritative phase captured any week.
          const hasRealPhase = entries.some((e) => e.stageStep >= 0);
          if (!hasRealPhase && lifecycle.length > 0) {
            entries = buildPhasesFromLifecycle({
              lifecycle, weekDateKeys, weekSource, summaryRow, personRows,
            });
          }
        }

        // SYNTHETIC WEEKS — person has no week columns yet (fresh 0% assignment)
        // but the project has a phase schedule. Generate week slots from the
        // phase date ranges so the user can immediately enter hours without
        // being told to "assign a lifecycle" (the lifecycle already exists).
        if (entries.length === 0 && sched.length > 0) {
          const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const mondaysBetween = (start: Date, due: Date): string[] => {
            const keys: string[] = [];
            const d = new Date(start);
            // Roll back to the Monday on-or-before start
            const dow = d.getDay();
            if (dow !== 1) d.setDate(d.getDate() - ((dow + 6) % 7));
            // Include the extra week that covers the due date
            const limit = new Date(due.getTime() + 7 * 864e5);
            while (d <= limit) {
              const dd = String(d.getDate()).padStart(2, "0");
              const mon = MONTHS[d.getMonth()];
              const yy = String(d.getFullYear()).slice(-2);
              keys.push(`${dd}-${mon}-${yy}`);
              d.setDate(d.getDate() + 7);
            }
            return keys;
          };
          for (const p of sched) {
            const wks = mondaysBetween(p.start!, p.due!).map((key) => {
              let hours = 0;
              for (const row of personRows) {
                const v = Number(row[key] ?? 0);
                if (!isNaN(v)) hours += v;
              }
              return { key, hours };
            });
            if (wks.length > 0) {
              entries.push({ phaseName: p.title, stageStep: p.step, color: C.green, weeks: wks });
            }
          }
        }

        // ── Apply chat-driven prefill / total / perweek / eachphase / clear ──
        // Port of mobile chat.tsx:1322-1500. Order matters:
        //   1. clearAll  → zero everything
        //   2. prefill[] → per-phase add/sub/set
        //   3. totalSet  → proportional rescale to N
        //   4. perWeekSet → set every active week to N
        //   5. eachPhaseSet → set each phase total to N (distributed)
        let workingEntries = entries.map(p => ({ ...p, weeks: p.weeks.map(w => ({ ...w })) }));
        let prefillNote = "";

        const sig = prefillSig(prefill, totalSet, clearAll, autosave, perWeekSet, eachPhaseSet);
        const sigKey = sig ? `${personName}|${projectId}|${messageKey ?? "0"}|${sig}` : "";
        const hasStackingOp = !!(prefill && prefill.some(p => p.mode === "add" || p.mode === "subtract"));
        const alreadyApplied = !!(hasStackingOp && sigKey && appliedPrefillSigsRef.current.has(sigKey));

        let clearedTotal = 0;
        if (clearAll && !alreadyApplied) {
          clearedTotal = workingEntries.reduce(
            (s, p) => s + p.weeks.reduce((ss, w) => ss + (w.hours || 0), 0), 0,
          );
          workingEntries = workingEntries.map(p => ({
            ...p, weeks: p.weeks.map(w => ({ ...w, hours: 0 })),
          }));
        }

        if (prefill && prefill.length > 0 && !alreadyApplied) {
          const appliedSummaries: string[] = [];
          const missed: string[] = [];
          const normPhase = (s: string) =>
            s.toLowerCase().replace(/[-_/.,()[\]{}&]+/g, " ").replace(/\s+/g, " ").trim();
          for (const edit of prefill) {
            const target = normPhase(edit.phase);
            const idx = workingEntries.findIndex(p => {
              const np = normPhase(p.phaseName);
              return np.includes(target) || target.includes(np);
            });
            if (idx >= 0 && workingEntries[idx].weeks.length > 0) {
              const beforeTotal = workingEntries[idx].weeks.reduce((s, w) => s + (w.hours || 0), 0);
              workingEntries = workingEntries.map((p, pi) =>
                pi !== idx ? p : { ...p, weeks: distributeAcross(p.weeks, edit.hours, edit.mode) }
              );
              const afterTotal = workingEntries[idx].weeks.reduce((s, w) => s + (w.hours || 0), 0);
              const phaseLabel = workingEntries[idx].phaseName;
              if (edit.mode === "set") {
                appliedSummaries.push(`Set ${phaseLabel} to ${edit.hours}h (was ${beforeTotal}h → now ${afterTotal}h)`);
              } else {
                const verb = edit.mode === "subtract" ? "Removed" : "Added";
                appliedSummaries.push(`${verb} ${edit.hours}h ${edit.mode === "subtract" ? "from" : "to"} ${phaseLabel} (${beforeTotal}h → ${afterTotal}h)`);
              }
            } else {
              missed.push(edit.phase);
            }
          }
          if (appliedSummaries.length > 0) {
            const tail = autosave ? " Saving…" : " Review and tap Save Allocation.";
            const missTail = missed.length > 0 ? ` (could not find: ${missed.join(", ")})` : "";
            const clearLead = clearAll ? `Cleared all phases (was ${clearedTotal}h); ` : "";
            prefillNote = `${clearLead}${appliedSummaries.join("; ")}${missTail}.${tail}`;
            // Per UX request: do NOT auto-expand any phase on load — the user
            // taps the phase header to expand.
            if (autosave) setPendingAutoSave(true);
          } else {
            prefillNote = `Could not find phase matching "${missed.join(", ")}" — set hours manually.`;
          }
        }

        if (clearAll && !alreadyApplied && (!prefill || prefill.length === 0) && typeof totalSet !== "number") {
          const tail = autosave ? " Saving…" : " Review and tap Save Allocation.";
          prefillNote = `Cleared all phases (was ${clearedTotal}h).${tail}`;
          if (autosave) setPendingAutoSave(true);
        }

        if (typeof totalSet === "number" && totalSet >= 0 && !alreadyApplied) {
          const allWeeks: { phaseIdx: number; weekIdx: number; cur: number }[] = [];
          workingEntries.forEach((p, pi) => {
            if (p.stageStep < 0) return;
            p.weeks.forEach((w, wi) => allWeeks.push({ phaseIdx: pi, weekIdx: wi, cur: w.hours || 0 }));
          });
          const beforeTotal = allWeeks.reduce((s, w) => s + w.cur, 0);
          const newWeeks = workingEntries.map(p => ({ ...p, weeks: p.weeks.map(w => ({ ...w })) }));
          if (allWeeks.length > 0) {
            if (beforeTotal > 0) {
              const scale = totalSet / beforeTotal;
              let assigned = 0;
              allWeeks.forEach((aw, idx) => {
                let v = Math.round(aw.cur * scale);
                if (idx === allWeeks.length - 1) v = Math.max(0, totalSet - assigned);
                assigned += v;
                newWeeks[aw.phaseIdx].weeks[aw.weekIdx].hours = v;
              });
            } else {
              const per = Math.floor(totalSet / allWeeks.length);
              const rem = totalSet - per * allWeeks.length;
              allWeeks.forEach((aw, idx) => {
                newWeeks[aw.phaseIdx].weeks[aw.weekIdx].hours = per + (idx === allWeeks.length - 1 ? rem : 0);
              });
            }
            workingEntries = newWeeks;
            const tail = autosave ? " Saving…" : " Review and tap Save Allocation.";
            prefillNote = `Set overall total to ${totalSet}h (was ${beforeTotal}h).${tail}`;
            if (autosave) setPendingAutoSave(true);
          }
        }

        if (typeof perWeekSet === "number" && perWeekSet >= 0 && !alreadyApplied) {
          let touchedWeeks = 0;
          const newWeeks = workingEntries.map(p => {
            if (p.stageStep < 0) return { ...p, weeks: p.weeks.map(w => ({ ...w })) };
            return {
              ...p,
              weeks: p.weeks.map(w => { touchedWeeks += 1; return { ...w, hours: perWeekSet }; }),
            };
          });
          workingEntries = newWeeks;
          const tail = autosave ? " Saving…" : " Review and tap Save Allocation.";
          const newTotal = perWeekSet * touchedWeeks;
          prefillNote = `Set every week to ${perWeekSet}h across ${touchedWeeks} weeks (total: ${newTotal}h).${tail}`;
          if (autosave) setPendingAutoSave(true);
        }

        if (typeof eachPhaseSet === "number" && eachPhaseSet >= 0 && !alreadyApplied) {
          let touchedPhases = 0;
          const newWeeks = workingEntries.map(p => {
            if (p.stageStep < 0) return { ...p, weeks: p.weeks.map(w => ({ ...w })) };
            if (p.weeks.length === 0) return { ...p, weeks: p.weeks.map(w => ({ ...w })) };
            touchedPhases += 1;
            return { ...p, weeks: distributeAcross(p.weeks, eachPhaseSet, "set") };
          });
          workingEntries = newWeeks;
          const tail = autosave ? " Saving…" : " Review and tap Save Allocation.";
          const newTotal = eachPhaseSet * touchedPhases;
          prefillNote = `Set each phase to ${eachPhaseSet}h across ${touchedPhases} phases (total: ${newTotal}h).${tail}`;
          if (autosave) setPendingAutoSave(true);
        }

        // Bare-save path: autosave w/ no prefill (e.g. user said "great save")
        if (autosave && !prefill && typeof totalSet !== "number"
            && typeof perWeekSet !== "number" && typeof eachPhaseSet !== "number" && !clearAll) {
          setPendingAutoSave(true);
        }

        if (sigKey) appliedPrefillSigsRef.current.add(sigKey);

        setPhases(workingEntries);
        // Per UX request: every phase starts collapsed on load. The user can
        // tap a phase header to expand it. (Was: auto-expanded the first phase
        // with hours, or the first phase if none had hours.)

        if (prefillNote) {
          const isFailure = prefillNote.startsWith("Could not find phase");
          if (isFailure) { setError(prefillNote); setNotice(""); }
          else            { setNotice(prefillNote); setError(""); }
        }

        // Load BU / Role / Title pickers in parallel
        try {
          const [divs, projRoles, users, buRaw] = await Promise.all([
            getDivisions().catch(() => [] as any[]),
            getProjectDivisionRoles(projectId).catch(() => [] as any[]),
            getUserList().catch(() => [] as any[]),
            getBusinessUnits().catch(() => [] as any[]),
          ]);
          if (cancelled) return;
          const projRolesArr = Array.isArray(projRoles) ? projRoles as any[] : [];
          // Real Business Unit entities — optional top tier that groups
          // divisions. Picking one narrows the Division list; the allocation is
          // still written against the Division (DivisionLookup/DivisionName).
          const buEnts: BUOption[] = (Array.isArray(buRaw) ? buRaw as any[] : [])
            .map((b) => ({
              id: String(b.ID ?? b.Id ?? ""),
              label: String(b.ShortName ?? b.Title ?? b.Name ?? "").trim(),
            }))
            .filter((b) => b.id && b.label);
          setBuEntities(buEnts);
          // Authoritative divisions index (id → ShortName + Title + parent BU).
          // The BU label MUST come from the real division ShortName — never from
          // a role row's Title (that is the role title, not the BU).
          const divsById = new Map<string, { short: string; title: string; buId: string }>();
          for (const d of (Array.isArray(divs) ? divs : [])) {
            const id = String((d as any).ID ?? (d as any).Id ?? "");
            if (!id) continue;
            divsById.set(id, {
              short: String((d as any).ShortName ?? "").trim(),
              title: String((d as any).Title ?? "").trim(),
              buId: String((d as any).BusinessUnitIdLookup ?? "").trim(),
            });
          }
          // Project BUs — ONE entry per distinct division (dedup by id). A
          // project-division-roles blob returns one row per division+role, so
          // mapping rows 1:1 would show duplicate BUs (e.g. "MEP" repeated).
          const projBUs: BUOption[] = [];
          const seenProjBu = new Set<string>();
          for (const r of projRolesArr) {
            const id = String(r.DivisionIDLookup ?? r.DivisionID ?? "");
            if (!id || seenProjBu.has(id)) continue;
            const fromIdx = divsById.get(id);
            const short = (fromIdx?.short || String(r.DivisionShortName ?? "").trim()).trim();
            if (!short) continue;
            const title = fromIdx?.title || "";
            seenProjBu.add(id);
            projBUs.push({ id, buId: fromIdx?.buId || "", label: title && title !== short ? `${short} - ${title}` : short });
          }
          const allBUs: BUOption[] = Array.from(divsById.entries())
            .map(([id, d]) => ({
              id,
              buId: d.buId || "",
              label: d.short ? (d.title && d.title !== d.short ? `${d.short} - ${d.title}` : d.short) : (d.title || "—"),
            }))
            .filter(b => b.id && b.label !== "—");
          setBus(projBUs.length ? projBUs : allBUs);
          setRoleRows(projRolesArr);

          // Pre-fill from existing assignment when available
          const titleOf = (r: any) => {
            const t = String(r?.Title ?? "").trim();
            if (t) return t;
            const jtn = String(r?.JobTitleName ?? "").trim();
            if (jtn) return jtn;
            return String(r?.JobProfile ?? "").trim();
          };
          const buListNow = projBUs.length ? projBUs : allBUs;
          const existingBuName = personFound ? String(member?.DivisionName ?? "").trim() : "";
          const existingRole = personFound ? String(member?.TypeName ?? "").trim() : "";
          const existingTitle = personFound ? titleOf(member) : "";
          const buMatch = existingBuName
            ? buListNow.find(b => b.label.split(" - ")[0].trim().toLowerCase() === existingBuName.toLowerCase())
            : null;
          const initialBU = buMatch ? buMatch.id : "";
          if (initialBU) {
            setWaBU(initialBU);
            if (buMatch?.buId) setWaBusinessUnit(buMatch.buId);
          }
          if (existingRole) setWaRole(existingRole);
          if (existingTitle) setWaTitle(existingTitle);

          // For new members try to seed Role from the personName itself if it
          // matches one of the project roles (e.g. "Electrical Engineer").
          if (!personFound && !existingRole) {
            const candidate = projRolesArr.find((r: any) =>
              String(r.Name ?? r.RoleName ?? r.TypeName ?? "").trim().toLowerCase() === personName.trim().toLowerCase()
            );
            if (candidate) setWaRole(String(candidate.Name ?? candidate.RoleName ?? candidate.TypeName ?? ""));
          }

          const userArr = Array.isArray(users) ? users as any[] : [];
          const titlesSet = new Set<string>();
          for (const x of userArr) {
            const t = String(x.JobProfile ?? "").trim();
            const enabled = x.Enabled !== false;
            const deleted = x.Deleted === true;
            if (t && enabled && !deleted) titlesSet.add(t);
          }
          setPeopleTitles(Array.from(titlesSet).sort());
        } catch {/* picker load is best-effort */}
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load allocation data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-run when projectId/personName changes OR the prefill payload changes.
    // Without including the prefill signature, a follow-up message like
    // "make total 40h" that re-emits the same person×project tag with a NEW
    // prefill never triggers a reload — the widget keeps showing the
    // previously-loaded server hours and the user thinks the request was ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personName, projectId, prefillSig(prefill, totalSet, clearAll, autosave, perWeekSet, eachPhaseSet), autosave, messageKey]);

  const updateWeek = (stageStep: number, weekKey: string, value: string | number) => {
    // Allow values over MAX_WEEKLY_HOURS to remain visible — the save is blocked
    // and an inline error is shown until corrected. Never clamp silently.
    const raw = typeof value === "number" ? value : (value === "" ? 0 : Number(value) || 0);
    const num = raw < 0 ? 0 : (typeof value === "number" ? Math.max(0, raw) : Math.round(raw));
    setPhases(prev => prev.map(ph => {
      if (ph.stageStep !== stageStep) return ph;
      return { ...ph, weeks: ph.weeks.map(w => w.key === weekKey ? { ...w, hours: num } : w) };
    }));
    const errKey = `${stageStep}:${weekKey}`;
    if (num > MAX_WEEKLY_HOURS) {
      setWeekErrors(prev => ({ ...prev, [errKey]: `${num}h exceeds the ${MAX_WEEKLY_HOURS}h per-week maximum.` }));
    } else {
      setWeekErrors(prev => {
        const next = { ...prev };
        delete next[errKey];
        return next;
      });
    }
    setNotice("");
  };

  const togglePhase = (step: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step); else next.add(step);
      return next;
    });
  };

  const phaseTotal = (ph: WAPhase) => ph.weeks.reduce((s, w) => s + w.hours, 0);
  const grandTotal = phases.reduce((s, p) => s + phaseTotal(p), 0);
  const hasWeekErrors = Object.keys(weekErrors).length > 0;

  // A NEW member must be SAVED (assigned to the project) BEFORE the
  // hours-by-phase editor appears — handleSave refuses to write hours for
  // someone who isn't on the project yet. Existing members are always ready.
  // alreadyAssigned=true is passed from the server when it already confirmed
  // the person is on the team (e.g. the "already on team" shortcut path),
  // so we bypass the setup form even if the allocation grid hasn't loaded yet.
  const assignmentReady = foundOnProject || !!alreadyAssigned;
  // Flexible hierarchy: when the Division tier is hidden, the Division picker
  // disappears and the save path resolves a hidden bridge division instead.
  const divTierOn = getBusinessRules().showDivision;
  // Show the explicit "Save assignment" step once a new member has BU + Role
  // + Title chosen but isn't on the project yet.
  const canSaveAssignment = !foundOnProject && (!divTierOn || !!waBU) && !!waRole && !!waTitle;

  // ETC = hours in weeks whose Monday is on/after current Monday.
  const etcCutoff = React.useMemo(() => currentMondayISO(), []);
  const etcHours = React.useMemo(() => {
    let sum = 0;
    for (const ph of phases) {
      for (const w of ph.weeks) {
        if (wkToISO(w.key) >= etcCutoff) sum += w.hours;
      }
    }
    return sum;
  }, [phases, etcCutoff]);

  // ───── derived picker option lists ─────
  // BU is the optional top tier; picking one narrows the Division list. The
  // allocation is still written against the Division (DivisionLookup).
  const filteredDivisions = React.useMemo(
    () => (waBusinessUnit ? bus.filter(b => b.buId === waBusinessUnit) : bus),
    [bus, waBusinessUnit]
  );
  const buShort = (bus.find(b => b.id === waBU)?.label || "").split(" - ")[0].toLowerCase();
  const filteredRoles = !buShort ? roleRows : roleRows.filter((r: any) => {
    const rb = String(r.DivisionShortName ?? r.ShortName ?? r.BU ?? r.BusinessUnit ?? "").toLowerCase();
    return !rb || rb === buShort;
  });
  // OFFICIAL cascade — fetch the full Role catalog whenever the BU changes.
  // With the Division tier hidden there is no division pick — load the full
  // tenant role catalogue via the "all" sentinel (server ignores the key).
  React.useEffect(() => {
    const divKey = waBU || (!getBusinessRules().showDivision ? "all" : "");
    if (!divKey) { setApiRoles([]); return; }
    let cancelled = false;
    getRolesByBU(divKey)
      .then(rows => { if (!cancelled) setApiRoles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiRoles([]); });
    return () => { cancelled = true; };
  }, [waBU]);

  const selectedRoleId = React.useMemo(() => {
    const m = apiRoles.find(r => r.name === waRole);
    return m ? m.id : "";
  }, [apiRoles, waRole]);

  // OFFICIAL cascade — fetch ALL tenant titles whenever a Role is chosen.
  // Pass "" as divisionIdLookup so the server returns the full catalogue
  // (sorted with role-matched titles first) rather than just those linked
  // to the selected division.
  React.useEffect(() => {
    if (!selectedRoleId) { setApiTitles([]); return; }
    let cancelled = false;
    getJobTitlesByRole("", selectedRoleId)
      .then(rows => { if (!cancelled) setApiTitles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiTitles([]); });
    return () => { cancelled = true; };
  }, [selectedRoleId]);

  const roleOptions = React.useMemo(() => {
    // Prefer the official, complete BU role catalog from getRolesByBU.
    if (apiRoles.length > 0) {
      return Array.from(new Set(apiRoles.map(r => r.name).filter(Boolean))).sort();
    }
    const set = new Set<string>();
    for (const r of filteredRoles) {
      const v = String((r as any).Name ?? (r as any).RoleName ?? (r as any).TypeName ?? "").trim();
      if (v) set.add(v);
    }
    // Mobile parity: when the project's role catalog has no rows that
    // match the selected Business Unit (DivisionShortName mismatch, or
    // the BU simply has no project-specific roles defined), fall back
    // to the global title pool so the user always sees something to
    // pick — matches the mobile behavior at chat.tsx:2165.
    if (set.size === 0) {
      for (const t of peopleTitles) set.add(t);
    }
    return Array.from(set).sort();
  }, [apiRoles, filteredRoles, peopleTitles]);
  const titleOptions = React.useMemo<{ id: string; name: string; label: string }[]>(() => {
    // Prefer the official Title catalog for the chosen BU + Role. Identically
    // named titles in different departments stay distinct and get labelled.
    // Standard suggested titles always lead the list (name-as-id options; the
    // onPick guard keeps waTitleId empty so the title flows by name only).
    if (apiTitles.length > 0) {
      return withSuggestedTitleOptions(buildTitleOptions(apiTitles));
    }
    const set = new Set<string>();
    for (const t of peopleTitles) set.add(t);
    for (const r of roleRows) {
      const v = String((r as any).Title ?? (r as any).JobTitle ?? (r as any).Name ?? (r as any).RoleName ?? (r as any).TypeName ?? "").trim();
      if (v) set.add(v);
    }
    return withSuggestedTitleOptions(Array.from(set).sort().map((n) => ({ id: n, name: n, label: n })));
  }, [apiTitles, peopleTitles, roleRows]);

  // ── Autosave: fire handleSave once after the prefill applied + the picker
  // state has settled. Saving with a missing BU/Role still surfaces the same
  // user-facing error as a manual click. We guard with autoSaveFiredRef so a
  // re-render of THIS card cannot fire it twice.
  React.useEffect(() => {
    if (!pendingAutoSave) return;
    if (loading || saving) return;
    if (autoSaveFiredRef.current) return;
    if (phases.length === 0) return;
    autoSaveFiredRef.current = true;
    setPendingAutoSave(false);
    // Defer one tick so any picker-state effects above can paint first.
    const t = setTimeout(() => { handleSave(); }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSave, loading, saving, phases.length]);

  // ── New-member assignment: persist the chosen Business Unit / Role / Title
  // to the project BEFORE revealing the hours-by-phase editor. handleSave
  // refuses to write hours for someone who isn't on the project yet, so a
  // brand-new member must be assigned first. This calls the same endpoint the
  // assistant's assign_person tool uses, and only runs when the member is
  // genuinely NOT on the project (foundOnProject === false) — so it cannot
  // duplicate an assignment the assistant already made.
  const handleAssignNewMember = async () => {
    setError(""); setNotice("");
    if ((divTierOn && !waBU) || !waRole || !waTitle) {
      setError(divTierOn ? "Pick a Division, Role and Title first." : "Pick a Role and Title first.");
      return;
    }
    setAssigning(true);
    try {
      // Resolve the person's GUID from the staff directory by an EXACT,
      // normalized full-name match. Fuzzy matching could silently assign the
      // WRONG person when names are similar, so a missing or ambiguous match
      // blocks and defers to the assistant.
      let users: any[] = [];
      try { users = (await getUserList()) as any[]; } catch {/* handled below */}
      const target = normalize(personName);
      const exactMatches = (Array.isArray(users) ? users : []).filter(
        (u: any) => normalize(String(u?.Name ?? "")) === target && String(u?.Id ?? "").trim()
      );
      if (exactMatches.length === 0) {
        setError(`Couldn't find ${personName} in the staff directory. Ask the assistant to assign ${personName} to the project first.`);
        setAssigning(false);
        return;
      }
      if (exactMatches.length > 1) {
        setError(`More than one person named ${personName} is in the directory. Ask the assistant to assign ${personName} so the correct one is chosen.`);
        setAssigning(false);
        return;
      }
      const userRow = exactMatches[0];
      const personGuid = String(userRow.Id).trim();
      const guidLc = personGuid.toLowerCase();

      // Division id + display name to persist. With the Division tier hidden
      // there is no pick — resolve the hidden bridge division for the selected
      // BU (or the tenant-wide bridge) so the org FK chain stays connected.
      let divisionId = waBU;
      let buShortName = (bus.find(b => b.id === waBU)?.label ?? "").split(" - ")[0] || "";
      if (!divTierOn && !divisionId) {
        try {
          divisionId = await resolveDivisionForSave("", waBusinessUnit);
        } catch (e: any) {
          setError(e?.message || "Could not link this assignment to the organization. Please try again.");
          setAssigning(false);
          return;
        }
        buShortName = (bus.find(b => b.id === divisionId)?.label ?? "").split(" - ")[0]
          || (buEntities.find(b => b.id === waBusinessUnit)?.label ?? "")
          || "";
      }
      const normS = (s: any) => String(s ?? "").trim().toLowerCase();
      const sameAssignment = (r: any) =>
        normS(r.AssignedTo) === guidLc &&
        normS(r.DivisionName) === normS(buShortName) &&
        normS(r.TypeName) === normS(waRole) &&
        (normS(r.Title) === normS(waTitle) || normS(r.JobTitleName) === normS(waTitle));

      // Duplicate guard: re-read the live allocations and SKIP the POST if this
      // person is already on the project with these exact details — just reveal
      // hours instead of creating a duplicate team row.
      try {
        const pre = await getFullProjectAllocations(projectId) as any;
        const preRows: any[] = [...(pre?.NewAllocations ?? []), ...(pre?.ExistingAllocations ?? [])];
        const dupe = preRows.find(sameAssignment);
        if (dupe) {
          setRawData(pre);
          setMemberAlloc(dupe);
          setFoundOnProject(true);
          setNotice(`${userRow.Name} is already on the project. Enter hours by phase below.`);
          setAssigning(false);
          return;
        }
      } catch {/* best-effort guard; proceed to assign */}

      // Placeholder allocation row spanning the project's phase schedule —
      // earliest week start to latest week end.
      const weekISOs: string[] = [];
      for (const ph of phases) for (const w of ph.weeks) weekISOs.push(wkToISO(w.key));
      weekISOs.sort();
      const firstISO = weekISOs[0];
      const lastISO = weekISOs[weekISOs.length - 1];
      const startDate = firstISO ? `${firstISO}T00:00:00` : undefined;
      const endDate = (() => {
        if (!lastISO) return undefined;
        const sd = new Date(lastISO);
        sd.setDate(sd.getDate() + 6);
        return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}T00:00:00`;
      })();

      await assignResource({
        ProjectID: projectId,
        Allocations: [{
          AllocationStartDate: startDate,
          AllocationEndDate: endDate,
          AssignedTo: personGuid,
          AssignedToName: userRow?.Name || personName,
          ID: 0,
          PctAllocation: 0,
          ProjectID: projectId,
          TemplateID: 0,
          Title: waTitle || null,
          JobTitleName: waTitle || null,
          JobTitleId: waTitleId || undefined,
          DivisionName: buShortName || null,
          DivisionLookup: Number(divisionId) || 0,
          Type: "",
          TypeName: waRole,
          SoftAllocation: softAlloc ? "True" : "False",
          NonChargeable: false,
          IsResourceDisabled: false,
          IsResourceOverAllocated: false,
          IsPreconStage: false,
        }],
      });

      // Re-fetch so the member now resolves as on-project; this flips
      // foundOnProject → true and reveals the hours-by-phase editor.
      let found: any = null;
      try {
        const fresh = await getFullProjectAllocations(projectId) as any;
        const freshRows: any[] = [...(fresh?.NewAllocations ?? []), ...(fresh?.ExistingAllocations ?? [])];
        found = freshRows.find((r: any) => normS(r.AssignedTo) === guidLc) || null;
        if (found) { setRawData(fresh); }
      } catch {/* fall through to synthetic alloc below */}

      if (!found) {
        // RM ONE hasn't surfaced the new row yet (read-after-write lag).
        // Seed a synthetic allocation from the chosen fields so handleSave has
        // a valid base row and the user isn't blocked from entering hours.
        found = {
          AssignedTo: personGuid,
          AssignedToName: userRow?.Name || personName,
          DivisionName: buShortName,
          DivisionLookup: Number(divisionId) || 0,
          TypeName: waRole,
          Title: waTitle,
          JobTitleName: waTitle,
          SoftAllocation: softAlloc ? "True" : "False",
        };
      }
      setMemberAlloc(found);
      setFoundOnProject(true);
      setNotice(`Added ${userRow?.Name || personName} to the project. Now enter hours by phase below.`);
      // Push a FRESH team snapshot into the cache so the Team modal / project
      // list reflects the newly assigned member immediately without a refresh.
      refreshProjectTeamCache(queryClient, projectId);
      queryClient.invalidateQueries({ queryKey: ["project-allocations-raw", projectId] });
    } catch (e: any) {
      setError(e?.message || "Couldn't save the assignment.");
    } finally {
      setAssigning(false);
    }
  };

  const handleSave = async () => {
    setError(""); setNotice("");

    // Block save immediately when any cell exceeds the max-168 limit.
    if (hasWeekErrors) {
      const firstErr = Object.values(weekErrors)[0] ?? `A weekly value exceeds ${MAX_WEEKLY_HOURS}h.`;
      setError(firstErr);
      return;
    }

    setSaving(true);
    let memberIdForFailure = personName;
    try {
      // Build the ISO weekPatches map from phases: DD-Mon-YY → YYYY-MM-DD.
      // saveMemberWeeklyHours merges this onto fresh server truth at queue
      // turn — never a stale pre-built snapshot.
      const weekPatches: Record<string, number> = {};
      for (const ph of phases) {
        for (const w of ph.weeks) {
          const isoKey = wkToISO(w.key); // "YYYY-MM-DD"
          weekPatches[isoKey] = (weekPatches[isoKey] ?? 0) + w.hours;
        }
      }

      // Resolve identity from the authoritative team, not from the fuzzy row
      // matcher used only to populate this card. A fuzzy allocation-row match
      // can point at the wrong same/near-named person; once that wrong GUID is
      // supplied, even the shared writer must (correctly) trust it.
      const freshTeam = (await getProjectTeam(projectId, true)).team;
      const exactName = normalize(personName);
      const exactMatches = freshTeam.filter(member => normalize(member.name) === exactName);
      const rowGuid = String((memberAlloc as any)?.AssignedTo ?? "").trim().toLowerCase();
      const exactRowMember = rowGuid
        ? exactMatches.find(member => String(member.resourceId ?? "").trim().toLowerCase() === rowGuid)
        : undefined;
      const authoritativeMember = exactRowMember ?? (exactMatches.length === 1 ? exactMatches[0] : undefined);
      if (!authoritativeMember) {
        if (exactMatches.length > 1) {
          throw new Error(`More than one team member is named ${personName}. Open the person's project allocation directly so the correct account is used.`);
        }
        throw new Error(`${personName} is not on this project's team.`);
      }
      const memberId = String(authoritativeMember.resourceId ?? "").trim() || authoritativeMember.name;
      memberIdForFailure = memberId;
      const memberRole = waRole || authoritativeMember.role || String((memberAlloc as any)?.TypeName ?? "").trim();

      const savedPhases = phases.map(p => ({ name: p.phaseName, hours: phaseTotal(p) })).filter(p => p.hours > 0);
      const breakdown = savedPhases.map(p => `${p.name} ${fmtHours(p.hours)}h`).join(", ");
      const nonZeroCount = savedPhases.length;

      // saveMemberWeeklyHours serializes through the per-member write queue,
      // force-fetches fresh team at queue turn, validates all weeks, POSTs
      // via buildDirectWeeklyAllocations, and notifies listeners.
      await saveMemberWeeklyHours({
        projectId,
        memberId,
        memberName: personName,
        memberRole,
        weekPatches,
      });

      setNotice(`Saved — ${grandTotal}h total across ${nonZeroCount} phase${nonZeroCount === 1 ? "" : "s"}${breakdown ? `: ${breakdown}` : ""}.`);
    } catch (e: any) {
      // notifyMemberWrite with null so the TeamScheduleGrid can flag this
      // member for a re-read rather than trusting a stale base.
      try {
        notifyMemberWrite(projectId, { memberId: memberIdForFailure, weekMap: null, ok: false });
      } catch { /* best-effort — listener bugs must not mask the real error */ }
      setError(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────── render ───────────────────

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: 13 }}>
          <Loader2 size={14} className="rmone-spin" />
          Loading allocation for {personName}…
        </div>
      </div>
    );
  }

  const initials = (personName || "?").trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");

  return (
    <div style={cardStyle}>
      {/* ── Hero header ── gradient (dark blue → green tint) so the
          assignment context reads as a defined section header instead of
          a wall of grey text. Mirrors the PersonProfileCard treatment. */}
      <div style={{
        margin: "-12px -12px 10px",
        padding: "16px 18px",
        background: `linear-gradient(135deg, ${C.bgDark} 0%, ${C.bgDarker} 60%, ${C.green}40 100%)`,
        color: "#fff",
        display: "flex", alignItems: "center", gap: 12,
        borderRadius: "12px 12px 0 0",
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 22,
          background: "rgba(255,255,255,0.16)",
          color: "#fff",
          border: "2px solid rgba(255,255,255,0.28)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 15, flexShrink: 0,
          letterSpacing: -0.3,
        }}>{initials || "•"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 700,
            letterSpacing: 0.8, textTransform: "uppercase",
          }}>
            Edit weekly allocation
          </div>
          <div style={{
            fontSize: 16, fontWeight: 700, color: "#fff",
            lineHeight: 1.2, marginTop: 3, letterSpacing: -0.2,
          }}>
            {personName}
          </div>
          <div style={{
            fontSize: 11.5, color: "rgba(255,255,255,0.78)", marginTop: 4,
            lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            <span style={{
              display: "inline-block",
              padding: "1px 7px", borderRadius: 4,
              background: "rgba(255,255,255,0.16)",
              fontSize: 10.5, fontWeight: 700, color: "#fff",
              marginRight: 6, verticalAlign: "middle",
            }}>{projectId}</span>
            {projectName ? projectName : ""}
          </div>
          {/* Org chips — BU / Division / Department */}
          {personOrg && (personOrg.businessUnit || personOrg.divisionName || personOrg.departmentName) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {[
                { label: "BU", value: personOrg.businessUnit },
                { label: "Div", value: divTierOn ? personOrg.divisionName : "" },
                { label: "Dept", value: personOrg.departmentName },
              ].filter(x => x.value).map(({ label, value }) => (
                <span key={label} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 20,
                  background: "rgba(255,255,255,0.13)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  fontSize: 10.5, color: "rgba(255,255,255,0.9)",
                }}>
                  <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 700, fontSize: 9.5, letterSpacing: 0.5 }}>{label}</span>
                  {value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Summary tiles — EAC/NC vs ETC at a glance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 0 }}>
        <SummaryTile
          label={softAlloc ? "NC Hrs" : "EAC Hrs"}
          value={`${grandTotal}h`}
          accent={softAlloc ? C.orange : C.green}
          sub={softAlloc
            ? (grandTotal > 0 ? "Not confirmed (tentative)" : "No hours yet")
            : (grandTotal > 0 ? "Estimate at completion" : "No hours yet")}
        />
        <SummaryTile label="ETC Hrs" value={`${etcHours}h`} accent={C.orange}
          sub={etcHours > 0 ? "Remaining to go" : "Nothing remaining"} />
      </div>

      {/* ── Assignment Details (BU / Role / Title pickers) ── */}
      {phases.length > 0 && !assignmentReady && (
        <div style={{
          marginTop: 10, padding: 10, background: C.greenSoft + "55",
          border: `1px solid ${C.green}33`, borderRadius: 10,
        }}>
          <div style={{
            fontSize: 10.5, color: C.greenInk, fontWeight: 700,
            letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6,
          }}>
            {!foundOnProject ? "New Member · Assignment Details" : "Assignment Details"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {buEntities.length > 0 && (
              <PickerField
                label="Business Unit"
                value={buEntities.find(b => b.id === waBusinessUnit)?.label || ""}
                onClick={() => { setPicker("businessUnit"); setPickerSearch(""); }}
              />
            )}
            {divTierOn && (
              <PickerField
                label="Division *"
                value={bus.find(b => b.id === waBU)?.label || ""}
                onClick={() => { setPicker("bu"); setPickerSearch(""); }}
              />
            )}
            <PickerField
              label="Role *"
              value={waRole}
              disabled={divTierOn && !waBU}
              onClick={() => (!divTierOn || waBU) ? (setPicker("role"), setPickerSearch("")) : setError("Pick a Division first.")}
            />
            <PickerField
              label="Title *"
              value={waTitle}
              disabled={divTierOn && !waBU}
              onClick={() => (!divTierOn || waBU) ? (setPicker("title"), setPickerSearch("")) : setError("Pick a Division first.")}
            />
            {isOppProject && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 10.5, color: C.greenInk, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 0 }}>
                  Type
                </span>
                <div style={{ display: "flex", gap: 5, flex: 1, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setSoftAlloc(false)}
                    style={{
                      padding: "3px 10px", fontSize: 11.5, borderRadius: 6, fontWeight: 600, cursor: "pointer",
                      background: !softAlloc ? C.green : "rgba(255,255,255,0.06)",
                      color: !softAlloc ? "#fff" : "#b0b8c8",
                      border: `1px solid ${!softAlloc ? C.green : C.border}`,
                    }}
                  >EAC (Confirmed)</button>
                  <button
                    onClick={() => setSoftAlloc(true)}
                    style={{
                      padding: "3px 10px", fontSize: 11.5, borderRadius: 6, fontWeight: 600, cursor: "pointer",
                      background: softAlloc ? C.orange : "rgba(255,255,255,0.06)",
                      color: softAlloc ? "#fff" : "#b0b8c8",
                      border: `1px solid ${softAlloc ? C.orange : C.border}`,
                    }}
                  >NC (Tentative)</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hours by phase header ── */}
      {phases.length > 0 && assignmentReady && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
              Hours by phase
            </div>
            <div style={{
              background: C.green, color: "#FFFFFF", borderRadius: 999,
              padding: "3px 10px", fontSize: 12, fontWeight: 700,
              boxShadow: "0 1px 2px rgba(107,165,57,0.25)",
            }}>
              Total {grandTotal}h
            </div>
          </div>
          <PhaseDistributionBar
            phases={phases.map(ph => ({
              name: ph.phaseName,
              hours: phaseTotal(ph),
              color: ph.color,
            }))}
            total={grandTotal}
          />
        </>
      )}

      {phases.length === 0 ? (
        <div style={{
          marginTop: 10, padding: "12px 14px", background: C.amberSoft,
          border: `1px solid ${C.amber}40`, borderRadius: 8,
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#7A5418", marginBottom: 10 }}>
            <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>No phase schedule found. Assign a lifecycle to this project to enable hours by phase.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => onSend?.(`Assign a lifecycle to ${projectId}`)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 13px", fontSize: 12.5, fontWeight: 700,
                color: "#fff", border: "none", borderRadius: 7,
                background: C.amber, cursor: "pointer",
              }}
            >
              Assign lifecycle
              <ArrowRight size={13} />
            </button>
            <button
              onClick={() => {
                const el = document.getElementById("schedule-section");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 13px", fontSize: 12.5, fontWeight: 700,
                color: "#7A5418", border: `1px solid ${C.amber}80`, borderRadius: 7,
                background: "transparent", cursor: "pointer",
              }}
            >
              Go to Schedule
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      ) : !assignmentReady ? (
        canSaveAssignment ? (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={handleAssignNewMember}
              disabled={assigning}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 7, padding: "10px 14px", fontSize: 13.5, fontWeight: 700,
                color: "#fff", border: "none", borderRadius: 9,
                background: !assigning ? C.green : "#C9D2DA",
                cursor: assigning ? "default" : "pointer",
                boxShadow: assigning ? "none" : "0 1px 2px rgba(107,165,57,0.25)",
              }}
            >
              {assigning ? <Loader2 size={14} className="rmone-spin" /> : <CheckCircle2 size={14} />}
              {assigning ? "Saving assignment…" : "Save assignment"}
            </button>
            <div style={{ marginTop: 6, fontSize: 11.5, color: C.textMuted, textAlign: "center" }}>
              Adds {personName} to the project, then opens hours by phase.
            </div>
          </div>
        ) : (
          <div style={{
            marginTop: 10, padding: "10px 12px", background: C.greenSoft + "55",
            border: `1px solid ${C.green}33`, borderRadius: 8,
            display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: C.greenInk,
          }}>
            <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>Confirm the {divTierOn ? <><strong>Division</strong>, <strong>Role</strong></> : <strong>Role</strong>} and <strong>Title</strong> above, then tap <strong>Save assignment</strong>.</div>
          </div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phases.map(ph => {
            const total = phaseTotal(ph);
            const isOpen = expanded.has(ph.stageStep);
            const locked = ph.stageStep < 0;
            return (
              <div key={ph.stageStep} style={{
                border: `1px solid ${C.borderSoft}`, borderRadius: 10, overflow: "hidden",
                background: C.bg, opacity: locked ? 0.6 : 1,
              }}>
                <button
                  onClick={() => !locked && togglePhase(ph.stageStep)}
                  disabled={locked}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", background: isOpen ? C.bgSoft : C.bg,
                    border: "none", cursor: locked ? "default" : "pointer", textAlign: "left",
                    borderLeft: `3px solid ${ph.color || C.green}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.25 }}>
                      {ph.phaseName}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
                      {locked ? "Read-only" : `${ph.weeks.length} week${ph.weeks.length === 1 ? "" : "s"} · tap to edit`}
                    </div>
                  </div>
                  <div style={{
                    background: total > 0 ? C.greenSoft : C.bgSoft,
                    color: total > 0 ? C.greenInk : C.textMuted,
                    fontWeight: 700, fontSize: 13, minWidth: 46, textAlign: "center",
                    padding: "4px 10px", borderRadius: 8,
                  }}>
                    {total}h
                  </div>
                  {!locked && (isOpen
                    ? <ChevronDown size={14} color={C.textMuted} />
                    : <ChevronRight size={14} color={C.textMuted} />
                  )}
                </button>
                {isOpen && !locked && (
                  <div style={{
                    padding: "4px 8px 8px",
                    borderTop: `1px solid ${C.borderSoft}`,
                    background: "var(--rm-panel-soft)",
                  }}>
                    {ph.weeks.map(w => {
                      const errKey = `${ph.stageStep}:${w.key}`;
                      const cellErr = weekErrors[errKey];
                      const cellOver = !!cellErr;
                      return (
                      <div key={w.key} style={{
                        display: "flex", flexDirection: "column",
                        padding: "6px 4px",
                        borderBottom: `1px solid ${C.borderSoft}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                            {wkLabel(w.key)}
                          </div>
                          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>
                            {w.key}
                          </div>
                        </div>
                        <button
                          onClick={() => updateWeek(ph.stageStep, w.key, Math.max(0, w.hours - 4))}
                          disabled={saving}
                          style={iconBtnStyle}
                          aria-label="Subtract 4 hours"
                        >
                          <Minus size={12} color={C.textMuted} />
                        </button>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={w.hours === 0 ? "" : w.hours}
                          placeholder="0"
                          onChange={e => updateWeek(ph.stageStep, w.key, e.target.value)}
                          disabled={saving}
                          style={{
                            width: 56, height: 30, textAlign: "center",
                            background: cellOver ? C.redSoft : C.bg,
                            border: `1px solid ${cellOver ? C.red : C.border}`,
                            borderRadius: 6, fontSize: 13, fontWeight: 700,
                            color: cellOver ? C.red : C.text, outline: "none",
                          }}
                          onFocus={e => { e.currentTarget.style.borderColor = cellOver ? C.red : C.green; e.currentTarget.select(); }}
                          onBlur={e => { e.currentTarget.style.borderColor = cellOver ? C.red : C.border; }}
                        />
                        <button
                          onClick={() => updateWeek(ph.stageStep, w.key, w.hours + 4)}
                          disabled={saving}
                          style={iconBtnStyle}
                          aria-label="Add 4 hours"
                        >
                          <Plus size={12} color={C.textMuted} />
                        </button>
                        </div>
                        {cellOver && (
                          <div style={{
                            display: "flex", alignItems: "center", gap: 4,
                            marginTop: 3, fontSize: 10.5, color: C.red,
                          }}>
                            <AlertTriangle size={10} />
                            {cellErr}
                          </div>
                        )}
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

      {/* ── Notices ── */}
      {error && (
        <div style={{
          marginTop: 10, padding: "8px 10px", background: C.redSoft,
          border: `1px solid ${C.red}33`, borderRadius: 8,
          display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#8A1F1F",
        }}>
          <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>{error}</div>
        </div>
      )}
      {notice && (
        <div style={{
          marginTop: 10, padding: "8px 10px", background: C.greenSoft,
          border: `1px solid ${C.green}40`, borderRadius: 8,
          display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: C.greenInk,
        }}>
          <CheckCircle2 size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>{notice}</div>
        </div>
      )}

      {/* ── Read-only notice ── */}
      {readOnly && phases.length > 0 && (
        <div style={{
          marginTop: 10, padding: "8px 10px", borderRadius: 8,
          background: "var(--rm-panel-soft)",
          border: "1px solid var(--rm-panel-border)",
          fontSize: 12, color: "var(--rm-text-muted)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <LockIcon size={13} style={{ flexShrink: 0 }} />
          Your access level (User) is view-only — saving is disabled.
        </div>
      )}

      {/* ── Save button ── */}
      {!readOnly && phases.length > 0 && assignmentReady && !notice.startsWith("Saved —") && (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSave}
            disabled={saving || hasWeekErrors}
            title={hasWeekErrors ? `Some weeks exceed ${MAX_WEEKLY_HOURS}h — correct highlighted cells first` : undefined}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 16px", borderRadius: 8,
              background: hasWeekErrors ? C.red : (!saving ? C.green : "#C9D2DA"),
              color: "#FFFFFF", fontSize: 13, fontWeight: 700,
              border: "none",
              cursor: (saving || hasWeekErrors) ? "not-allowed" : "pointer",
              boxShadow: (saving || hasWeekErrors) ? "none" : "0 1px 2px rgba(107,165,57,0.25)",
              transition: "background 0.15s ease",
              opacity: (saving || hasWeekErrors) ? 0.7 : 1,
            }}
          >
            {saving ? <Loader2 size={14} className="rmone-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : hasWeekErrors ? "Fix errors first" : "Save allocation"}
          </button>
        </div>
      )}

      {/* ── Picker dropdown overlay ── */}
      {picker && (
        <PickerModal
          title={picker === "businessUnit" ? "Select Business Unit" : picker === "bu" ? "Select Division" : picker === "role" ? "Select Role" : "Select Title"}
          options={
            picker === "businessUnit" ? buEntities
            : picker === "bu" ? filteredDivisions
            : picker === "role" ? roleOptions.map(r => ({ id: r, label: r }))
            : titleOptions.map(t => ({ id: t.id, label: t.label }))
          }
          search={pickerSearch}
          onSearch={setPickerSearch}
          onPick={(opt) => {
            if (picker === "businessUnit") {
              if (opt.id !== waBusinessUnit) {
                setWaBU("");
                setWaRole("");
                setWaTitle("");
                setWaTitleId("");
              }
              setWaBusinessUnit(opt.id);
            } else if (picker === "bu") {
              if (opt.id !== waBU) {
                setWaRole("");
                setWaTitle("");
                setWaTitleId("");
              }
              setWaBU(opt.id);
            } else if (picker === "role") { setWaRole(opt.label); setWaTitle(""); setWaTitleId(""); }
            else if (picker === "title") {
              const to = titleOptions.find(o => o.id === opt.id);
              setWaTitle(to?.name || opt.label);
              // Only carry a real catalogue ID; fallback options use name as id.
              setWaTitleId(apiTitles.some(t => t.id === opt.id) ? opt.id : "");
            }
            setPicker(null); setPickerSearch("");
          }}
          onClose={() => { setPicker(null); setPickerSearch(""); }}
        />
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 12,
  background: C.bg,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
  position: "relative",
};

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  background: C.bg, border: `1px solid ${C.border}`,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", padding: 0,
};

function SummaryTile({ label, value, accent, sub }: {
  label: string; value: string; accent: string; sub?: string;
}) {
  return (
    <div style={{
      background: C.bgSoft, borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: "9px 11px",
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 19, fontWeight: 800, color: accent, marginTop: 2, lineHeight: 1.05, letterSpacing: -0.4 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, lineHeight: 1.2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** Stacked horizontal bar — proportional distribution of hours across phases.
 *  Shows the team-lead at-a-glance where this person's hours are weighted. */
function PhaseDistributionBar({ phases, total }: {
  phases: Array<{ name: string; hours: number; color: string }>;
  total: number;
}) {
  if (total <= 0) return null;
  const segs = phases
    .filter(p => p.hours > 0)
    .map(p => ({ ...p, pct: Math.round((p.hours / total) * 100) }));
  if (segs.length === 0) return null;
  const ariaLabel = "Phase distribution: " + segs
    .map(s => `${s.name} ${s.hours} hours, ${s.pct} percent`)
    .join("; ");
  return (
    <div style={{ marginTop: 4, marginBottom: 8 }}>
      <div
        role="img"
        aria-label={ariaLabel}
        style={{
          display: "flex", height: 10, borderRadius: 999, overflow: "hidden",
          background: C.bgSoft, border: `1px solid ${C.borderSoft}`,
        }}
      >
        {segs.map((s, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{
              flex: s.hours,
              background: s.color || C.green,
              borderRight: i < segs.length - 1 ? "1px solid rgba(255,255,255,0.5)" : "none",
            }}
          />
        ))}
      </div>
      <ul
        aria-label="Phase legend"
        style={{
          display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 6,
          listStyle: "none", padding: 0,
        }}
      >
        {segs.map((s, i) => (
          <li key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden="true" style={{
              width: 8, height: 8, borderRadius: 2,
              background: s.color || C.green, flexShrink: 0,
            }} />
            <span style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 600 }}>
              {s.name} · <span style={{ color: C.text }}>{fmtHours(s.hours)}h</span>
              <span style={{ marginLeft: 4, color: C.textMuted, fontWeight: 500 }}>
                ({fmtPct(s.pct)})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PickerField({
  label, value, onClick, disabled,
}: { label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        background: disabled ? "var(--rm-panel-soft)" : C.bg,
        border: `1px solid ${C.border}`, borderRadius: 7,
        padding: "7px 10px", cursor: disabled ? "default" : "pointer",
        textAlign: "left", opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.textMuted,
        letterSpacing: 0.4, textTransform: "uppercase", minWidth: 88,
      }}>
        {label}
      </div>
      <div style={{
        flex: 1, fontSize: 12.5, color: value ? C.text : C.textMuted,
        fontWeight: value ? 600 : 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {value || "Tap to select"}
      </div>
      <ChevronDown size={13} color={C.textMuted} />
    </button>
  );
}

function PickerModal({
  title, options, search, onSearch, onPick, onClose,
}: {
  title: string;
  options: { id: string; label: string }[];
  search: string;
  onSearch: (s: string) => void;
  onPick: (opt: { id: string; label: string }) => void;
  onClose: () => void;
}) {
  const filtered = options.filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()));
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        zIndex: Z.POPUP, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, maxWidth: "100%", maxHeight: "70vh",
          background: C.bg, borderRadius: 12, overflow: "hidden",
          border: `1px solid ${C.border}`,
          boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "12px 14px", borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer", padding: 4,
            color: C.textMuted, display: "flex",
          }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {options.length > 6 && (
          <div style={{
            margin: "10px 12px 0", display: "flex", alignItems: "center", gap: 8,
            background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "6px 10px",
          }}>
            <Search size={13} color={C.textMuted} />
            <input
              autoFocus
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                fontSize: 13, color: C.text,
              }}
            />
          </div>
        )}
        <div style={{ flex: 1, overflow: "auto", padding: "6px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12 }}>
              No options
            </div>
          )}
          {filtered.map(opt => (
            <button
              key={opt.id}
              onClick={() => onPick(opt)}
              style={{
                width: "100%", textAlign: "left", padding: "10px 14px",
                background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: C.text, borderBottom: `1px solid ${C.borderSoft}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = C.bgSoft; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
