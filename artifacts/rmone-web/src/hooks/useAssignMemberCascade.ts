// ── useAssignMemberCascade ───────────────────────────────────────────────────
// The full Add/Edit Team Member cascade (BU → Division → Department → Title →
// Role → Person), extracted verbatim from AddTeamMemberModal so BOTH the modal
// and the inline Excel-style add row under the weekly grid share one engine:
// roster loading + memSeed caching, official-API cascades with heuristic
// fallbacks, duplicate guards, schedule-window validation, and the submit path
// (assignResource + post-save hours bookkeeping).
//
// Invariants preserved from the modal (do not change here without checking both
// consumers):
//  - PctAllocation stores raw HOURS, not a percentage.
//  - JobTitleId is sent only for explicit catalogue picks (titleId), never the
//    name→first-match fallback.
//  - DivisionId comes from the `bu` state (division id); memSeed roster keys
//    must stay byte-identical to the prewarm writer in projects.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDivisions, getProjectDivisionRoles, getUserList, assignResource, bustCache,
  getJobTitles, type JobTitleRow, getBusinessUnits, getDepartments,
  getRolesByBU, getResourcesByJobTitle, buildTitleOptions, updateFields,
  type AssignRole, type AssignTitle, type AssignResource, type OpenRole,
  getFullProjectAllocations, getTaskData,
  changeTeamResource, removeOpenPosition,
} from "@/lib/api";
import { saveMemberWeeklyHours } from "@/lib/saveMemberWeeklyHours";
import { runFastWeeklyHoursSave } from "@/lib/fastWeeklyHoursSave";
import { addMemberRosterKeys, ADD_MEMBER_ROSTER_TTL } from "@/lib/addMemberRoster";
import { maxAssignmentHours } from "@/lib/utilGrid";
import {
  getWindowAvailability, availabilityBadge, WEEK_CAPACITY_HRS,
  type AvailabilityIndex,
} from "@/lib/availability";
import { withSuggestedTitleOptions } from "@/lib/standardTitles";
import { roleEquivalence } from "@workspace/role-match";
import { getBusinessRules } from "@/lib/businessRules";
import {
  getCrossBuPromptMode,
  shouldAutoContinueAfterBuAdd,
  shouldFilterPeopleByOrganization,
} from "@/lib/crossBuConfirmation";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import { memSeed } from "@/lib/memSeed";
import {
  derivePhaseHours,
  matchMemberAlloc,
  buildEvenSpreadAllocations,
  type AllocationsResponse,
} from "@/lib/phaseHours";
import {
  findWeeklyHoursViolation,
  weeklyHoursViolationMessage,
} from "@/lib/weeklyHoursValidation";
import { assignmentDateRangeError } from "@/lib/assignmentDateRange";
import { Z } from "@/lib/zLayers";

export type Picker = "businessUnit" | "bu" | "department" | "role" | "title" | "person" | null;

// ── Post-close save toasts ───────────────────────────────────────────────────
// The instant-save path finishes (or fails) AFTER the editor has closed, so
// feedback must be a DOM-level toast rather than modal state. One toast at a
// time: a newer message replaces the previous one (progress → result).
let activeSaveToast: HTMLDivElement | null = null;
function showAllocationSaveToast(text: string, kind: "progress" | "success" | "warning" | "error") {
  if (typeof window === "undefined") return;
  activeSaveToast?.remove();
  const palette = {
    progress: { background: "#1B2B38", color: "#E8EDF2", border: "1px solid rgba(232,237,242,0.25)" },
    success: { background: "#1B2B38", color: "#6BA539", border: "1px solid rgba(107,165,57,0.3)" },
    warning: { background: "#38221B", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.35)" },
    error: { background: "#3A1D1D", color: "#F87171", border: "1px solid rgba(248,113,113,0.4)" },
  }[kind];
  const toast = document.createElement("div");
  toast.textContent = text;
  Object.assign(toast.style, {
    position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
    padding: "12px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: "600",
    zIndex: String(Z.DOM_TOAST), boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    transition: "opacity 0.3s", maxWidth: "560px", ...palette,
  });
  document.body.appendChild(toast);
  activeSaveToast = toast;
  // Errors/warnings linger so the user cannot miss a failed save; progress is
  // generous in case the queued write waits behind another in-flight edit.
  const ttlMs = kind === "success" ? 3000 : kind === "progress" ? 30000 : 10000;
  setTimeout(() => {
    if (activeSaveToast === toast) activeSaveToast = null;
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, ttlMs);
}

// One edit at a time per (project, person): the instant-save path closes the
// editor before its writes land, so a rapid reopen-and-save must queue behind
// the still-in-flight edit. The weekly write queue only covers the hours POST;
// the assignment-dates UPDATE is not in it, and two concurrent date UPDATEs
// could land out of order. Module-level so it survives modal remounts
// (Quick Actions remounts the editor via key).
const existingEditChains = new Map<string, Promise<void>>();

interface RoleRow {
  Name?: string; RoleName?: string; TypeName?: string; Title?: string; JobTitle?: string;
  DivisionShortName?: string; ShortName?: string; BU?: string; BusinessUnit?: string;
  DivisionId?: number; DivisionID?: number;
  [k: string]: unknown;
}
export interface PersonRow {
  id: string; name: string; title: string;
  /** Raw role text from the staff profile — second matching signal for the
   *  "related people" filter (some tenants keep the real job title here). */
  role: string;
  division: string; department: string;
  /** Org IDs from the staff profile — preferred (exact) signals for the
   *  person-pick org auto-fill; the name fields above are the fallback. */
  divisionId: string; departmentId: string;
  availStart: string; availEnd: string;
  /** Display username (often same as email for RDS tenants). */
  username: string;
  /** Email address — preferred over username for name-collision disambiguation
   *  (username is a separate account field and may not be an email). */
  email: string;
}
export interface ExistingAllocationRef {
  personId: string; bu: string; role: string; title: string;
  /** Total budgeted hours (EAC) for this allocation row — used by the person
   *  picker to show "On team · Nh" instead of a bare "Already on team". */
  hours?: number;
  /** Container allocation row ID (RWI) + window — lets the add flow's
   *  duplicate prompt offer "add these hours to the existing assignment"
   *  (merge submits through the same edit path as the pencil). Callers that
   *  can't supply these simply don't get the merge option. */
  allocationId?: number;
  startDate?: string;
  endDate?: string;
}

export interface OptimisticAssignedMember {
  id: string;
  role: string;
  bu: string;
  title: string;
  startDate: string;
  endDate: string;
  pct: number;
  hours?: number;
  weeklyHours?: { week: string; hours: number }[];
  period?: { startDate: string; endDate: string; hours: number };
  /** True when the allocation workspace updated a person who was already on
   *  this project instead of creating a new team membership. */
  isExisting?: boolean;
}

export interface AssignCascadeParams {
  /** Load rosters + keep state while true; reset everything when it flips false. */
  active: boolean;
  projectId: string;
  projectName: string;
  projectStartDate: string;
  projectEndDate: string;
  /** Phase-schedule window — pass ONLY when the project has a phase schedule.
   *  When set, member dates are clamped to [scheduleStart, scheduleEnd]
   *  (client rule; the backend enforces the same bound). Blank = no schedule,
   *  dates are free and the record's Target End auto-extends to cover them. */
  scheduleStart?: string;
  scheduleEnd?: string;
  /** Whether the record's RESOLVED display mode follows a phase schedule
   *  ("full" or "schedule-no-grid", per-record overrides included). When
   *  provided this decides window enforcement; when undefined a legacy
   *  tenant-global "full"-only check applies (misses schedule-no-grid and
   *  per-record overrides — record-aware callers should always pass it). */
  scheduleWindowEnabled?: boolean;
  existingAllocations: ExistingAllocationRef[];
  onAssigned: (personName: string, optimistic?: OptimisticAssignedMember) => void;
  onClose: () => void;
  prefillBuShort?: string;
  prefillDivisionId?: string;
  prefillMemberBu?: string;
  prefillRole?: string;
  prefillTitle?: string;
  prefillDept?: string;
  prefillStartDate?: string;
  prefillEndDate?: string;
  prefillPct?: number;
  prefillAllocationId?: number;
  prefillTypeGuid?: string;
  prefillGroupId?: string;
  /** Open-position fill: the RA demand-row IDs this assignment consumes. */
  consumeRaIds?: number[];
  /** Quick Actions inferred these IDs from the initially seeded staff member;
   * they are not an operator's durable slot selection. */
  inferredConsumeRaIds?: boolean;
  prefillPersonId?: string;
  prefillPersonName?: string;
  /** ADD-mode person seed (e.g. the grid toolbar search pick): pre-selects
   *  this person exactly as if they were picked from the Assigned To picker —
   *  title from their staff profile, org (BU/Division/Dept) auto-filled and
   *  locked. Unlike prefillPersonId this does NOT switch the flow into
   *  edit-assignment mode. Ignored when prefillPersonId is set. */
  seedPersonId?: string;
  /** Show a direct "Total Hours" input (no phase schedule grid available). */
  showHoursField?: boolean;
  /** Create only a person↔record team relationship. No role, dates, hours, or
   * allocation plan are required or written. */
  personOnly?: boolean;
  /** Current total hours for the member being edited — seeds the Total Hours input. */
  prefillHours?: number;
  /** ADD-mode horizontal planner: exact Monday ISO date → raw hours. When
   *  present, submit does not report success or close until these exact weekly
   *  rows have been saved through the canonical /hours-allocation contract. */
  plannedWeeklyHours?: Record<string, number>;
  /** Open positions on this project — surfaced as one-click "this project
   *  needs" suggestions at the top of the role-first add flow (add mode only). */
  openRoles?: OpenRole[];
  /** When Quick Actions detects duplicate open role/title choices, require the
   * operator to select the intended slot before this save may retire demand. */
  requireOpenRoleSelection?: boolean;
  /** CHANGE-RESOURCE mode: the outgoing member being replaced. The flow stays
   *  role-first (role/title prefilled from their assignment), but submit calls
   *  POST /change-team-resource instead of /assign-resource — the server adds
   *  the new person and hands over every allocation week from next Monday
   *  onward, leaving the outgoing member's history untouched. */
  changeFrom?: { personId: string; name: string };
  /** PERIOD-SCOPED edit: the pencil was clicked on ONE period row of a
   *  multi-period assignment. The date/hours inputs are seeded with THAT
   *  period, and Save reshapes only the weeks inside it — the member's other
   *  periods keep their dates and hours. Without this scope, saving a single
   *  period's window through the whole-assignment path would rewrite the RWI
   *  window and zero every week outside the period (data loss). All dates YMD. */
  periodScope?: {
    periodStart: string;
    periodEnd: string;
    /** Original hours inside this period. */
    periodHours: number;
    /** Whole-assignment window + total — the RWI/container write targets. */
    assignStart?: string;
    assignEnd?: string;
    assignHours?: number;
    /** The edited period's OWN assignment row (RWI). When known and the
     *  Total Hours field is filled, the save becomes a REPLACE of that
     *  assignment's hours rows (server-side ReplaceAllHours): entered
     *  dates/hours are the whole truth for that RWI, so phantom same-RWI
     *  sibling periods (stacked lump + weekly rows — the Aug 2026 duplicate
     *  bug) are merged away instead of blocking the save as an overlap. */
    rwiId?: number | null;
    /** The member's OTHER period windows (all their allocation entries).
     *  Weekly rows carry no per-period identity — ownership is inferred by
     *  date range — so a new window that overlaps another period would let
     *  the re-spread overwrite that period's weeks. Overlaps are REJECTED
     *  at submit instead — except same-RWI periods a replace-all save is
     *  about to merge away. YMD. */
    otherPeriods?: { start: string; end: string; rwiId?: number | null }[];
  };
}

export function useAssignMemberCascade({
  active, onClose, projectId, projectStartDate, projectEndDate,
  scheduleStart, scheduleEnd, scheduleWindowEnabled,
  existingAllocations, onAssigned,
  prefillBuShort, prefillDivisionId, prefillMemberBu, prefillRole, prefillTitle, prefillDept, prefillStartDate, prefillEndDate, prefillPct, prefillAllocationId, prefillTypeGuid, prefillGroupId,
  prefillPersonId, prefillPersonName, seedPersonId, showHoursField, personOnly, prefillHours, plannedWeeklyHours, consumeRaIds, inferredConsumeRaIds,
  openRoles, requireOpenRoleSelection, changeFrom, periodScope,
}: AssignCascadeParams) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bus, setBus] = useState<{ id: string; label: string; buId?: string }[]>([]);
  const [buEntities, setBuEntities] = useState<{ id: string; label: string }[]>([]);
  const [roleRows, setRoleRows] = useState<RoleRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [businessUnit, setBusinessUnit] = useState<string>("");
  const [bu, setBU] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  // Specific JobTitle.ID for the chosen title. Distinguishes two titles that
  // share a name across departments so the right record is saved. Empty for
  // heuristic (non-catalogue) fallback options.
  const [titleId, setTitleId] = useState<string>("");
  const [personId, setPersonId] = useState<string>("");
  const [personName, setPersonName] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  // Direct hours entry — used when there is no phase schedule (showHoursField).
  // Stored as a raw string so the input stays editable mid-type (e.g. "40.").
  // Treated as 0 when blank on submit.
  const [lumpHours, setLumpHours] = useState<string>("");
  const [picker, setPicker] = useState<Picker>(null);
  const [search, setSearch] = useState("");
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The core assignment and the exact weekly rows are two existing API writes.
  // If the first succeeds and the second fails, keep the workspace open and
  // retry ONLY the weekly write — re-running assignResource would create an
  // overlap/duplicate error even though the user's assignment already exists.
  const [assignmentSaved, setAssignmentSaved] = useState(false);
  const assignmentSavedRef = useRef(false);
  // Tenant-wide JobTitle catalogue (May 2026 GetJobTitle API). Preferred
  // source for the Title dropdown; falls back to legacy derivation when
  // empty (e.g. tenant without GetJobTitle access).
  const [jobTitleCatalog, setJobTitleCatalog] = useState<JobTitleRow[]>([]);
  // Official client cascade (BU → Role → Title → Person). Each falls back to
  // the heuristic derivation below when it comes back empty (e.g. RM ONE down).
  const [apiRoles, setApiRoles] = useState<AssignRole[]>([]);
  const [apiTitles, setApiTitles] = useState<AssignTitle[]>([]);
  const [apiResources, setApiResources] = useState<AssignResource[]>([]);
  const [dept, setDept] = useState<string>("");
  const [deptName, setDeptName] = useState<string>("");
  const [allDepartments, setAllDepartments] = useState<{ id: string; name: string; divisionId: string }[]>([]);
  // ── Role/person flow state ──────────────────────────────────────────────
  // RA demand-row IDs the save will consume. STATE (not the raw prop) because
  // clicking an open-position suggestion chip retargets which slot the save
  // fills; seeded from the consumeRaIds prop on open so the existing
  // assignSlot prefill flow behaves exactly as before.
  const [consumeIds, setConsumeIds] = useState<number[] | null>(null);
  const [pickedSuggestion, setPickedSuggestion] = useState(-1);
  // True after a person pick auto-filled BU/Division/Dept from their staff
  // profile — org fields render locked until the user explicitly unlocks.
  const [orgLocked, setOrgLocked] = useState(false);
  // True once the user EXPLICITLY picks a Title — profile/suggestion
  // auto-fills must not overwrite an explicit catalogue pick.
  const [titleManual, setTitleManual] = useState(false);
  // ── BU-mismatch guard (add mode) ───────────────────────────────────────
  // Full division catalogue (every tenant division, not just the project's) —
  // needed to resolve a picked person's HOME division when it is not one of
  // the project's BUs (`bus` only lists project divisions in that case).
  const [divCatalog, setDivCatalog] = useState<{ id: string; label: string; buId?: string }[]>([]);
  // The project's record-level division ids (DivisionLookup + DivisionMultiLookup,
  // primary first) — the authority for "is this person's BU on the project?".
  const [projDivIds, setProjDivIds] = useState<string[]>([]);
  // Set when the picked person's home division is NOT one of the project's
  // BUs. This stays pending while the user selects; the popup opens only
  // after the user explicitly clicks Add to Team.
  const [buMismatch, setBuMismatch] = useState<{ divisionId: string; divisionLabel: string; buId: string; personName: string } | null>(null);
  const [buMismatchPromptOpen, setBuMismatchPromptOpen] = useState(false);
  const [addingBu, setAddingBu] = useState(false);
  const [buMismatchError, setBuMismatchError] = useState("");
  // One-shot: armed only when the popup's "Add" write succeeds, so the add
  // flow resumes automatically instead of needing a second "Add to team"
  // click. Never armed by Cancel or a failed BU write.
  const autoSubmitAfterBuAddRef = useRef(false);
  // Availability index for the current window (null = not loaded / failed —
  // callers show NO badges rather than wrong ones).
  const [availIdx, setAvailIdx] = useState<AvailabilityIndex | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  // The compact weekly planner deliberately exposes Role + Person, not the
  // legacy independent Title control. Keep its hidden title in sync with Role
  // so an earlier title cannot drive the person lookup or save path.
  const isWeeklyPlanner = plannedWeeklyHours !== undefined;

  // ── in-memory roster cache (memSeed — nothing persisted to browser storage) ─
  // Key for the 5 tenant-wide static lists (divisions/users/jobTitles/BUs/depts).
  // TTL 30 min. projectId-scoped key for the project-roles list.
  // Keys come from lib/addMemberRoster so this reader and the prewarm writer
  // (warmAddMemberRoster — called by projects.tsx and project-detail.tsx)
  // can never drift apart. Tenant-scoped BY CONSTRUCTION.
  const { rosterKey: ROSTER_LS_KEY, projRolesKey: projRolesLsKey } = addMemberRosterKeys(projectId);
  const ROSTER_TTL = ADD_MEMBER_ROSTER_TTL;

  const readRosterCache = () => {
    try {
      const raw = memSeed.getItem(ROSTER_LS_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw) as { data: unknown[]; ts: number };
      if (Date.now() - ts > ROSTER_TTL) return null;
      return data as [unknown[], Record<string, unknown>[], JobTitleRow[], unknown[], unknown[]];
    } catch { return null; }
  };
  const readProjRolesCache = () => {
    try {
      const raw = memSeed.getItem(projRolesLsKey);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw) as { data: unknown; ts: number };
      if (Date.now() - ts > ROSTER_TTL) return null;
      return data as unknown[];
    } catch { return null; }
  };
  const writeRosterCache = (divsRaw: unknown[], usersRaw: Record<string, unknown>[], jobTitles: JobTitleRow[], buRaw: unknown[], deptsRaw: unknown[]) => {
    try { memSeed.setItem(ROSTER_LS_KEY, JSON.stringify({ data: [divsRaw, usersRaw, jobTitles, buRaw, deptsRaw], ts: Date.now() })); } catch { /* non-serializable */ }
  };
  const writeProjRolesCache = (projRolesRaw: unknown[]) => {
    try { memSeed.setItem(projRolesLsKey, JSON.stringify({ data: projRolesRaw, ts: Date.now() })); } catch { /* non-serializable */ }
  };

  // Load BU + roles + users when the cascade activates
  useEffect(() => {
    if (!active) return;
    setError(null);
    // Seed the consumable slot IDs from the caller (open-position "Assign"
    // buttons); suggestion chips may retarget this later.
    setConsumeIds(consumeRaIds && consumeRaIds.length > 0 ? consumeRaIds : null);

    // ── Phase 1: seed from cache (instant, no spinner) ─────────────────────
    const cachedRoster = readRosterCache();
    const cachedProjRoles = readProjRolesCache();
    const hasCache = !!(cachedRoster && cachedProjRoles);

    if (!hasCache) setLoading(true);

    const applyData = (divsRaw: unknown[], projRolesRaw: unknown[], usersRaw: Record<string, unknown>[], jobTitles: JobTitleRow[], buRaw: unknown[], deptsRaw: unknown[]) => {
      setJobTitleCatalog(Array.isArray(jobTitles) ? jobTitles : []);
      const divs = Array.isArray(divsRaw) ? divsRaw as Record<string, unknown>[] : [];
      const projRoles = Array.isArray(projRolesRaw) ? projRolesRaw as Record<string, unknown>[] : [];
      // Real Business Unit entities — the optional top tier that groups
      // divisions. Picking one simply narrows the Division list below; the
      // member is still persisted against the Division (BU is derivable from it).
      const buEnts = (Array.isArray(buRaw) ? buRaw as Record<string, unknown>[] : [])
        .map((b) => ({
          id: String(b.ID ?? b.Id ?? ""),
          label: String(b.ShortName ?? b.Title ?? b.Name ?? "").trim(),
        }))
        .filter((b) => b.id && b.label);
      setBuEntities(buEnts);
      // Authoritative division index (id → ShortName/Title/parent BU) so BU
      // labels always come from the division — never from a row's job title.
      const divsById = new Map<string, { short: string; title: string; buId: string }>();
      for (const d of divs) {
        const id = String(d.ID ?? d.Id ?? "");
        if (!id) continue;
        divsById.set(id, {
          short: String(d.ShortName ?? "").trim(),
          title: String(d.Title ?? "").trim(),
          buId: String(d.BusinessUnitIdLookup ?? "").trim(),
        });
      }
      const buLabel = (short: string, title: string) =>
        short ? (title && title !== short ? `${short} - ${title}` : short) : title;
      // BU dropdown: the project's BUs first — ONE entry per division (deduped),
      // primary-first (proxy order). Only when the project has no BU assigned do
      // we fall back to listing every division.
      const projBUs: { id: string; label: string; buId?: string }[] = [];
      const seenBu = new Set<string>();
      for (const r of projRoles) {
        const id = String(r.DivisionIDLookup ?? r.DivisionID ?? "");
        if (!id || seenBu.has(id)) continue;
        const meta = divsById.get(id);
        const short = (meta?.short || String(r.DivisionShortName ?? "")).trim();
        const title = (meta?.title || "").trim();
        const label = buLabel(short, title) || String(r.DivisionName ?? "").trim();
        if (!label) continue;
        seenBu.add(id);
        projBUs.push({ id, label, buId: meta?.buId || "" });
      }
      const allBUsSeen = new Set<string>();
      const allBUs = divs.map((d) => ({
        id: String(d.ID ?? d.Id ?? ""),
        label: buLabel(String(d.ShortName ?? "").trim(), String(d.Title ?? "").trim()),
        buId: String(d.BusinessUnitIdLookup ?? "").trim(),
      })).filter((b) => { if (!b.id || !b.label || allBUsSeen.has(b.id)) return false; allBUsSeen.add(b.id); return true; });
      const buList = projBUs.length ? projBUs : allBUs;
      setBus(buList);
      setDivCatalog(allBUs);
      setProjDivIds(projBUs.map((b) => b.id));
      setRoleRows(projRoles as RoleRow[]);
      // People list — drop deleted, GUID names, empties
      const userArr = Array.isArray(usersRaw) ? usersRaw : [];
      const ppl: PersonRow[] = [];
      const seen = new Set<string>();
      for (const u of userArr) {
        const id = String(u.Id ?? "").toLowerCase();
        const name = String(u.Name ?? "").trim();
        const deleted = u.Deleted === true;
        if (!id || !name) continue;
        if (deleted) continue;
        if (/^[0-9a-f]{8}-/.test(name)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        ppl.push({ id, name, title: String(u.JobProfile ?? "").trim(), role: String(u.Role ?? "").trim(), division: String(u.DivisionName ?? u.Division ?? u.Department ?? u.BusinessUnit ?? "").trim(), department: String(u.Department ?? "").trim(), divisionId: String(u.DivisionId ?? "").trim(), departmentId: String(u.DepartmentId ?? "").trim(), availStart: String(u.UGITStartDate ?? "").trim(), availEnd: String(u.UGITEndDate ?? "").trim(), username: String(u.UserName ?? u.Email ?? "").trim(), email: String(u.Email ?? "").trim() });
      }
      ppl.sort((a, b) => a.name.localeCompare(b.name));
      setPeople(ppl);
      const deptArr = Array.isArray(deptsRaw) ? deptsRaw as Record<string, unknown>[] : [];
      setAllDepartments(deptArr
        .map(d => ({
          id: String(d.ID ?? d.Id ?? ""),
          name: String(d.Title ?? d.Name ?? "").trim(),
          divisionId: String(d.DivisionIdLookup ?? "").trim(),
        }))
        .filter(d => d.id && d.name));
      // Pre-fill BU from caller (e.g. "MEP" from an open demand row), else
      // auto-pick the first project BU. Match by short-name prefix on label.
      // Always apply unconditionally — the reset clears all state on close so
      // there are no in-progress user edits to protect here.
      // Track the prefilled division's own BU id so the member-BU fallback
      // below can't override the Business Unit to one that doesn't contain
      // the selected division (that would filter the Division list down to
      // empty / exclude the selection and leave Save Changes disabled).
      let chosenDivBuId = "";
      if (prefillDivisionId) {
        // Direct ID match — most reliable, no name-normalization needed.
        let m = buList.find(b => b.id === prefillDivisionId);
        if (!m) {
          // Division not in the active list (e.g. soft-deleted after import).
          // Inject a ghost entry so the dropdown shows the correct label and
          // Save Changes can still write the correct division ID.
          const ghostLabel = prefillBuShort?.trim() || prefillDivisionId;
          const ghost = { id: prefillDivisionId, label: ghostLabel, buId: "" };
          setBus([...buList, ghost]);
          m = ghost;
        }
        setBU(m.id);
        if (m.buId) { setBusinessUnit(m.buId); chosenDivBuId = m.buId; }
      } else if (prefillBuShort) {
        // Name-based fallback (for callers that only supply the display name).
        const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
        const want = norm(prefillBuShort);
        const m = buList.find((b) => {
          const rawTitle = norm(divsById.get(b.id)?.title ?? "");
          const parts = b.label.split(" - ");
          const short = norm(parts[0]);
          const full = norm(parts.slice(1).join(" - "));
          return short === want || full === want || norm(b.label) === want || rawTitle === want;
        });
        if (m) { setBU(m.id); if (m.buId) { setBusinessUnit(m.buId); chosenDivBuId = m.buId; } }
        else if (projBUs[0]) { setBU(projBUs[0].id); if (projBUs[0].buId) { setBusinessUnit(projBUs[0].buId); chosenDivBuId = projBUs[0].buId; } }
      } else if (projBUs[0]) {
        setBU(projBUs[0].id);
        if (projBUs[0].buId) { setBusinessUnit(projBUs[0].buId); chosenDivBuId = projBUs[0].buId; }
      }
      // If the division-derived buId didn't resolve a BU entity (e.g. ghost entry
      // for a soft-deleted division has buId=""), try matching against the member's
      // stored CRMBusinessUnitChoice (prefillMemberBu) in the BU entity list.
      // NEVER override when the prefilled division already resolved its own BU —
      // the member's home BU may contain no divisions at all, which would strand
      // the modal with an empty Division list and a permanently disabled Save.
      if (prefillMemberBu && !chosenDivBuId) {
        const normBu = (s: string) => s.toLowerCase().trim();
        const wantBu = normBu(prefillMemberBu);
        const buEnt = buEnts.find(b => normBu(b.label) === wantBu);
        if (buEnt) setBusinessUnit(buEnt.id);
      }
      if (prefillRole) setRole(prefillRole);
      if (prefillTitle) setTitle(prefillTitle);
      if (prefillDept) {
        const want = prefillDept.trim().toLowerCase();
        const dMatch = deptArr
          .map(d => ({ id: String(d.ID ?? d.Id ?? ""), name: String(d.Title ?? d.Name ?? "").trim() }))
          .filter(d => d.id && d.name)
          .find(d => d.name.toLowerCase() === want);
        if (dMatch) { setDept(dMatch.id); setDeptName(dMatch.name); }
      }
      if (prefillPersonId) { setPersonId(prefillPersonId); setPersonName(prefillPersonName || ""); }
      // ADD-mode person seed: behave exactly like picking this person from
      // the Assigned To picker — person set, title from their staff profile
      // (unless the caller prefills one), org auto-filled + LOCKED. Uses the
      // LOCAL lists (buList/deptArr) because the state setters above haven't
      // landed yet. Mirrors the applyPick("person") branch — keep in lockstep.
      if (!prefillPersonId && seedPersonId && !didSeedRef.current) {
        const sp = ppl.find((p) => p.id === seedPersonId.toLowerCase());
        if (sp) {
          setPersonId(sp.id); setPersonName(sp.name);
          if (sp.title && !prefillTitle) { setTitle(sp.title); setTitleId(""); }
          // Seed the role from the staff member's profile so the role picker is
          // pre-populated when opening from Staff Quick Actions.
          if (sp.role) { setRole(sp.role); }
          const normL = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
          const wantDiv = normL(sp.division || "");
          const m =
            (sp.divisionId ? buList.find((b) => b.id === sp.divisionId) : undefined) ??
            (wantDiv
              ? buList.find((b) => {
                  const parts = b.label.split(" - ");
                  return normL(parts[0]) === wantDiv || normL(parts.slice(1).join(" - ")) === wantDiv || normL(b.label) === wantDiv;
                })
              : undefined);
          if (m) {
            setBU(m.id);
            setBusinessUnit(m.buId || "");
            const depts = deptArr
              .map((d) => ({
                id: String(d.ID ?? d.Id ?? ""),
                name: String(d.Title ?? d.Name ?? "").trim(),
                divisionId: String(d.DivisionIdLookup ?? "").trim(),
              }))
              .filter((d) => d.id && d.name);
            const dn = (sp.department || "").trim().toLowerCase();
            const dm =
              (sp.departmentId ? depts.find((d) => d.id === sp.departmentId) : undefined) ??
              (dn ? depts.find((d) => d.name.toLowerCase() === dn && (!d.divisionId || d.divisionId === m.id)) : undefined);
            if (dm) { setDept(dm.id); setDeptName(dm.name); }
            setOrgLocked(true);
          } else {
            // BU-mismatch guard (mirror of applyPick("person") — keep in
            // lockstep): the seeded person's home division is not one of the
            // project's BUs. Resolve it against the FULL catalogue; a hit
            // raises the blocking "add this BU to the project first" popup.
            const home =
              (sp.divisionId ? allBUs.find((b) => b.id === sp.divisionId) : undefined) ??
              (wantDiv
                ? allBUs.find((b) => {
                    const parts = b.label.split(" - ");
                    return normL(parts[0]) === wantDiv || normL(parts.slice(1).join(" - ")) === wantDiv || normL(b.label) === wantDiv;
                  })
                : undefined);
            if (home && projBUs.length > 0 && !projBUs.some((b) => b.id === home.id)) {
              setBuMismatch({ divisionId: home.id, divisionLabel: home.label, buId: home.buId || "", personName: sp.name });
              setBuMismatchPromptOpen(false);
              setBuMismatchError("");
            }
          }
          // One-shot: the phase-2 background roster refresh re-runs applyData;
          // without this guard it would re-lock the org / revert person &
          // title edits the user made in the first seconds after opening.
          didSeedRef.current = true;
        }
      }
      setStartDate(prefillStartDate || projectStartDate || "");
      setEndDate(prefillEndDate || projectEndDate || "");
      // Seed the direct hours field from the existing TOTAL HOURS so the user
      // sees the current total rather than a blank box on first open. NOTE:
      // prefillHours is real hours (eacHrs); prefillPct is a percentage and
      // must never seed this field.
      setLumpHours(typeof prefillHours === "number" && prefillHours > 0 ? String(Math.round(prefillHours)) : "");
      setLoading(false);
    };

    // Tracks whether the UI already rendered real data (phase 1 or 1.5) so a
    // FAILED phase-2 refresh never wipes a good render back to empty lists,
    // and whether phase 2 already painted fresher data (phase 1.5 must not
    // overwrite it with the older cached roster afterwards).
    let appliedFromCache = hasCache;
    let appliedFresh = false;

    // ── Phase 1: render from cache immediately (no spinner) ────────────────
    if (hasCache) {
      const [divsRaw, usersRaw, jobTitles, buRaw, deptsRaw] = cachedRoster!;
      applyData(divsRaw as unknown[], cachedProjRoles! as unknown[], usersRaw as Record<string, unknown>[], jobTitles, buRaw as unknown[], deptsRaw as unknown[]);
    } else if (cachedRoster) {
      // ── Phase 1.5: the five tenant-wide lists are cached; only THIS
      // project's roles list is missing (first add-member open on this
      // project). Gate the spinner on that ONE call instead of all six —
      // the full phase-2 refresh below still runs in the background.
      getProjectDivisionRoles(projectId).then((projRolesRaw) => {
        if (appliedFresh) return;
        const rows = Array.isArray(projRolesRaw) ? projRolesRaw as unknown[] : [];
        writeProjRolesCache(rows);
        const [divsRaw, usersRaw, jobTitles, buRaw, deptsRaw] = cachedRoster;
        applyData(divsRaw as unknown[], rows, usersRaw as Record<string, unknown>[], jobTitles, buRaw as unknown[], deptsRaw as unknown[]);
        appliedFromCache = true;
      }).catch(() => { /* phase 2 below settles the spinner */ });
    }

    // ── Phase 2: background refresh (always fires, updates cache) ──────────
    let allOk = true;
    // A stalled roster endpoint used to keep the Add Team Member workspace in
    // its loading state forever. Let the remaining live/cached data render and
    // make unavailable lists honest rather than trapping the user in a spinner.
    const safe = async <T,>(p: Promise<T>, fb: T): Promise<T> => {
      const result = await Promise.race([
        p.then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: fb })),
        // Bare setTimeout (not window.setTimeout): identical in the browser and
        // keeps the hook renderable under the node test harness (no window).
        new Promise<{ ok: false; value: T }>((resolve) => setTimeout(() => resolve({ ok: false, value: fb }), 15_000)),
      ]);
      if (!result.ok) allOk = false;
      return result.value;
    };
    Promise.all([
      safe(getDivisions() as Promise<unknown[]>, [] as unknown[]),
      safe(getProjectDivisionRoles(projectId) as Promise<unknown>, [] as unknown),
      safe(getUserList(), [] as Record<string, unknown>[]),
      safe(getJobTitles(), [] as JobTitleRow[]),
      safe(getBusinessUnits(), [] as unknown[]),
      safe(getDepartments(), [] as unknown[]),
    ]).then(([divsRaw, projRolesRaw, usersRaw, jobTitles, buRaw, deptsRaw]) => {
      // Hollow-cache rule: never cache failure-empty lists — a transient
      // outage must not pin an empty roster/people list for the 30-min TTL.
      if (allOk) {
        writeRosterCache(
          Array.isArray(divsRaw) ? divsRaw : [],
          Array.isArray(usersRaw) ? usersRaw as Record<string, unknown>[] : [],
          Array.isArray(jobTitles) ? jobTitles : [],
          Array.isArray(buRaw) ? buRaw : [],
          Array.isArray(deptsRaw) ? deptsRaw : [],
        );
        writeProjRolesCache(Array.isArray(projRolesRaw) ? projRolesRaw as unknown[] : []);
      } else if (appliedFromCache) {
        // Partial failure with a good cached render already on screen —
        // keep it; re-applying would replace real lists with empties.
        return;
      }
      appliedFresh = true;
      applyData(
        Array.isArray(divsRaw) ? divsRaw : [],
        Array.isArray(projRolesRaw) ? projRolesRaw as unknown[] : [],
        Array.isArray(usersRaw) ? usersRaw as Record<string, unknown>[] : [],
        Array.isArray(jobTitles) ? jobTitles : [],
        Array.isArray(buRaw) ? buRaw : [],
        Array.isArray(deptsRaw) ? deptsRaw : [],
      );
    }).catch(() => { if (!hasCache) setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId]);

  // One-shot flag for the ADD-mode person seed (see applyData) — reset on
  // close so a re-opened modal seeds again.
  const didSeedRef = useRef(false);

  // Reset on close/deactivate
  useEffect(() => {
    if (active) return;
    didSeedRef.current = false;
    assignmentSavedRef.current = false;
    setAssignmentSaved(false);
    setBusinessUnit(""); setBU(""); setDept(""); setDeptName(""); setRole(""); setTitle(""); setTitleId(""); setPersonId(""); setPersonName("");
    setStartDate(""); setEndDate(""); setLumpHours("");
    setPicker(null); setSearch(""); setShowAllPeople(false); setError(null);
    setConsumeIds(null); setPickedSuggestion(-1); setOrgLocked(false); setTitleManual(false);
    setAvailIdx(null); setAvailLoading(false);
    setBuMismatch(null); setBuMismatchPromptOpen(false); setBuMismatchError(""); setAddingBu(false);
  }, [active]);

  const buShort = useMemo(() => {
    const m = bus.find((b) => b.id === bu);
    if (!m) return "";
    return m.label.split(" - ")[0];
  }, [bu, bus]);

  // Resolve a division NAME (staff-profile division or an open slot's BU
  // label) to a real division entry — same normalization as the
  // prefillBuShort path in applyData. Returns undefined when nothing
  // matches: callers must NEVER fabricate an id from a name.
  const matchDivisionIn = (list: { id: string; label: string; buId?: string }[], want0: string) => {
    const normL = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    const want = normL(want0);
    if (!want) return undefined;
    return list.find((b) => {
      const parts = b.label.split(" - ");
      const short = normL(parts[0]);
      const full = normL(parts.slice(1).join(" - "));
      return short === want || full === want || normL(b.label) === want;
    });
  };
  const matchDivisionByLabel = (want0: string) => matchDivisionIn(bus, want0);

  // ── Open-position suggestions (role-first flow, add mode only) ────────────
  const suggestions = useMemo<OpenRole[]>(
    () => (prefillPersonId ? [] : (openRoles ?? []).filter((o) => !!(o.role || o.title))),
    [openRoles, prefillPersonId],
  );
  const normalizeOpenRoleLabel = (value: string) => value.trim().toLowerCase()
    .replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ");
  const openRoleSelectionRequired = useMemo(() => {
    if (!requireOpenRoleSelection || pickedSuggestion >= 0) return false;
    const selectedRole = normalizeOpenRoleLabel(role);
    const selectedTitle = normalizeOpenRoleLabel(title);
    if (!selectedRole && !selectedTitle) return false;
    const matching = suggestions.filter((slot) =>
      (selectedRole && normalizeOpenRoleLabel(slot.role) === selectedRole) ||
      (selectedTitle && normalizeOpenRoleLabel(slot.title) === selectedTitle),
    );
    // This intentionally mirrors quick-fill's OR matching semantics. Same
    // role with different titles is still unsafe to auto-retire: the person
    // assignment may match either row, so the operator must choose one.
    return matching.length > 1;
  }, [requireOpenRoleSelection, pickedSuggestion, role, title, suggestions]);

  // A detailed slot selection is valid only while the rest of the assignment
  // still describes that slot. Picking another person may infer a new role or
  // title; retaining the old RA IDs would then retire a demand row unrelated
  // to the final assignment. Quick Actions shortcut IDs are only inferred, so
  // they must clear instead of being restored after an assignment change.
  useEffect(() => {
    if (pickedSuggestion < 0) return;
    const picked = suggestions[pickedSuggestion];
    if (!picked) {
      setPickedSuggestion(-1);
      setConsumeIds(inferredConsumeRaIds ? null : (consumeRaIds && consumeRaIds.length > 0 ? consumeRaIds : null));
      return;
    }
    const roleStillMatches = !picked.role ||
      normalizeOpenRoleLabel(picked.role) === normalizeOpenRoleLabel(role);
    const titleStillMatches = !picked.title ||
      normalizeOpenRoleLabel(picked.title) === normalizeOpenRoleLabel(title);
    if (!roleStillMatches || !titleStillMatches) {
      setPickedSuggestion(-1);
      setConsumeIds(inferredConsumeRaIds ? null : (consumeRaIds && consumeRaIds.length > 0 ? consumeRaIds : null));
    }
  }, [pickedSuggestion, suggestions, role, title, consumeRaIds, inferredConsumeRaIds]);

  // The caller's slot selection may arrive AFTER the modal opened: quick
  // actions on Home/Alerts fetch a fresh team read to recover the slot's RA
  // ids, so the consumeRaIds prop starts undefined and fills in a moment
  // later. The mount-time seed above has [active, projectId] deps and never
  // re-runs, which silently disarmed the consume — the save then added the
  // person WITHOUT retiring the chosen open position (project detail's
  // Assign button never hit this because it passes the ids up front). Track
  // the prop until the user explicitly retargets via a suggestion chip;
  // shortcut-inferred ids stay cleared once an assignment change drops them.
  const priorConsumePropRef = useRef<number[] | undefined>(undefined);
  useEffect(() => {
    if (!active) { priorConsumePropRef.current = undefined; return; }
    const prior = priorConsumePropRef.current;
    priorConsumePropRef.current = consumeRaIds;
    const changed = (prior?.join(",") ?? "") !== (consumeRaIds?.join(",") ?? "");
    if (!changed || pickedSuggestion >= 0) return;
    if (consumeRaIds && consumeRaIds.length > 0) setConsumeIds(consumeRaIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, consumeRaIds, pickedSuggestion]);

  /** One-click "this project needs" chip: seeds Role/Title/dates/hours from
   *  the open slot and retargets the save to consume that slot's demand rows. */
  function applySuggestion(i: number) {
    const s = suggestions[i];
    if (!s) return;
    setPickedSuggestion(i);
    setError(null);
    const roleName = (s.role || s.title || "").trim();
    const titleName = (s.title || s.role || "").trim();
    setRole(roleName);
    // Respect an explicit catalogue Title pick; otherwise the slot's title
    // flows by NAME (titleId stays empty — catalogue-picks-only invariant).
    if (!titleManual) { setTitle(titleName); setTitleId(""); }
    if (s.startDate) setStartDate(s.startDate.slice(0, 10));
    if (s.endDate) setEndDate(s.endDate.slice(0, 10));
    setConsumeIds(s.raIds && s.raIds.length > 0 ? s.raIds : null);
    if (showHoursField && s.eacHrs > 0) setLumpHours(String(Math.round(s.eacHrs)));
    // Seed the slot's division by NAME — skipped once a person's profile has
    // locked the org section (profile wins per product rule).
    if (s.bu && !orgLocked) {
      const m = matchDivisionByLabel(s.bu);
      if (m) {
        setBU(m.id);
        if (m.buId) setBusinessUnit(m.buId);
        setDept(""); setDeptName("");
      }
    }
  }

  const unlockOrg = () => setOrgLocked(false);

  // ── BU-mismatch actions (add mode) ─────────────────────────────────────
  /** Popup "Add" — append the person's home division to the project record,
   *  then continue the add flow with the org filled + locked from their
   *  profile. Same write shape as the project page's Business Units section:
   *  DivisionLookup = primary (unchanged), DivisionMultiLookup = supporting
   *  csv with the new division appended. */
  const addBuToProject = async () => {
    if (!buMismatch || addingBu) return;
    setAddingBu(true); setBuMismatchError("");
    try {
      const div = { id: buMismatch.divisionId, label: buMismatch.divisionLabel, buId: buMismatch.buId };
      const keep = projDivIds.filter((id) => id !== div.id);
      const primary = keep[0] || div.id;
      const supporting = keep.length > 0 ? [...keep.slice(1), div.id] : [];
      const r = await updateFields(projectId, [
        { FieldName: "DivisionLookup", Value: primary },
        { FieldName: "DivisionMultiLookup", Value: supporting.join(",") },
      ]);
      if (!r.ok) { setBuMismatchError(r.error || "Could not add the Business Unit to the project."); return; }
      // Background refresh of this project's division-roles list so the BU
      // section and future add-member opens see the new BU. updateFields
      // already busted the project: caches; this re-primes the memSeed copy.
      // The fresh rows are also broadcast so the project page's Business
      // Units card updates live — no manual page reload needed. On fetch
      // failure the event still fires (without rows) so listeners can
      // force-reload themselves.
      getProjectDivisionRoles(projectId, { fresh: true })
        .then((rows) => {
          if (Array.isArray(rows)) writeProjRolesCache(rows as unknown[]);
          try {
            window.dispatchEvent(new CustomEvent("rmone:projectBuChanged", {
              detail: { ticketId: projectId, rows: Array.isArray(rows) ? rows : undefined },
            }));
          } catch { /* ignore */ }
        })
        .catch(() => {
          try {
            window.dispatchEvent(new CustomEvent("rmone:projectBuChanged", { detail: { ticketId: projectId } }));
          } catch { /* ignore */ }
        });
      setProjDivIds((prev) => (prev.includes(div.id) ? prev : [...prev, div.id]));
      setBus((prev) => (prev.some((b) => b.id === div.id) ? prev : [...prev, div]));
      // Continue exactly like a successful profile auto-fill: org locked.
      setBU(div.id);
      setBusinessUnit(div.buId || "");
      const p = people.find((pp) => pp.id === personId);
      const dn = (p?.department || "").trim().toLowerCase();
      const dm =
        (p?.departmentId ? allDepartments.find((d) => d.id === p.departmentId) : undefined) ??
        (dn ? allDepartments.find((d) => d.name.toLowerCase() === dn && (!d.divisionId || d.divisionId === div.id)) : undefined);
      if (dm) { setDept(dm.id); setDeptName(dm.name); } else { setDept(""); setDeptName(""); }
      setOrgLocked(true);
      // The BU is on the project now — resume the add the user already
      // started (the popup only ever opens from an "Add to team" click).
      autoSubmitAfterBuAddRef.current = true;
      setBuMismatch(null);
      setBuMismatchPromptOpen(false);
    } catch (e) {
      setBuMismatchError(e instanceof Error ? e.message : "Could not add the Business Unit to the project.");
    } finally {
      setAddingBu(false);
    }
  };

  /** Popup "Cancel" — abandon this person pick: the assignment cannot proceed
   *  while the person's BU is not on the project. */
  const dismissBuMismatch = () => {
    autoSubmitAfterBuAddRef.current = false;
    setBuMismatch(null); setBuMismatchPromptOpen(false); setBuMismatchError("");
    setPersonId(""); setPersonName("");
  };

  // Auto-continue after a successful cross-BU add: waits for the re-render
  // that commits the popup's org updates (BU/division/department state), so
  // submit() sees the fresh values rather than the pre-confirmation closure.
  useEffect(() => {
    if (!shouldAutoContinueAfterBuAdd(
      autoSubmitAfterBuAddRef.current,
      !!buMismatch,
      buMismatchPromptOpen,
      addingBu || submitting,
    )) return;
    autoSubmitAfterBuAddRef.current = false;
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buMismatch, buMismatchPromptOpen, addingBu, submitting]);

  // Labels of the project's current BUs — popup copy ("this project's
  // business units are …"). Falls back to the full catalogue for ids the
  // (possibly extended) `bus` list doesn't carry.
  const projectBuLabels = useMemo(
    () => projDivIds
      .map((id) => bus.find((b) => b.id === id)?.label || divCatalog.find((b) => b.id === id)?.label || "")
      .filter(Boolean),
    [projDivIds, bus, divCatalog],
  );

  // ── Availability (free capacity) for the member window ────────────────────
  // Same date fallback chain as submit(). Loaded lazily — once the flow is far
  // enough along that the person list matters — and NEVER blocks the cascade.
  const availStartYmd = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
  const availEndYmd = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
  const availWanted = active && (picker === "person" || !!role || !!personId);
  useEffect(() => {
    if (!availWanted) return;
    if (!availStartYmd || !availEndYmd || availStartYmd > availEndYmd) { setAvailIdx(null); return; }
    let cancelled = false;
    setAvailLoading(true);
    getWindowAvailability(availStartYmd, availEndYmd)
      .then((idx) => { if (!cancelled) setAvailIdx(idx); })
      .catch(() => { if (!cancelled) setAvailIdx(null); })
      .finally(() => { if (!cancelled) setAvailLoading(false); });
    return () => { cancelled = true; };
  }, [availWanted, availStartYmd, availEndYmd]);

  const availEntryFor = (p: PersonRow) =>
    availIdx
      ? (availIdx.byId.get(p.id.toLowerCase()) ?? availIdx.byName.get(p.name.trim().toLowerCase()))
      : undefined;

  // Divisions shown in the Division picker, narrowed to the chosen Business
  // Unit when one is selected (BU is an optional top tier). With no BU picked
  // we show every candidate division so nothing becomes unreachable.
  const filteredDivisions = useMemo(() => {
    if (!businessUnit) return bus;
    const inBu = bus.filter((d) => d.buId === businessUnit);
    // Dead-end guard: if the chosen BU contains no divisions (e.g. a member's
    // home BU that was never linked to any division), fall back to the full
    // list so the user can always pick something and Save stays reachable.
    return inBu.length > 0 ? inBu : bus;
  }, [bus, businessUnit]);

  // Departments filtered to the selected Division (BU → Division → Department).
  // Division tier hidden → no division is ever picked; offer the full
  // department catalogue instead of an empty list.
  const filteredDepartments = useMemo(() => {
    if (!bu) return getBusinessRules().showDivision ? [] : allDepartments;
    const inDiv = allDepartments.filter(d => !d.divisionId || d.divisionId === bu);
    return inDiv;
  }, [allDepartments, bu]);

  // OFFICIAL cascade #2 — Roles for the chosen BU.
  useEffect(() => {
    // Division tier hidden → no division is ever picked, but the roles list
    // is tenant-wide server-side; use a sentinel key so it still loads.
    const divKey = bu || (!getBusinessRules().showDivision ? "all" : "");
    if (!active || !divKey) { setApiRoles([]); return; }
    let cancelled = false;
    getRolesByBU(divKey)
      .then((rows) => {
        if (cancelled) return;
        const raw = Array.isArray(rows) ? rows : [];
        const seen = new Set<string>();
        setApiRoles(raw.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; }));
      })
      .catch(() => { if (!cancelled) setApiRoles([]); });
    return () => { cancelled = true; };
  }, [active, bu]);

  // OFFICIAL cascade #2b — Job Titles: show the full tenant catalogue so the user
  // is never limited to the titles that happen to be linked to the chosen division.
  // We derive from the already-loaded jobTitleCatalog (no extra network call) and
  // sort alphabetically; the role picker is independent.
  useEffect(() => {
    if (!active) { setApiTitles([]); return; }
    setApiTitles(
      jobTitleCatalog
        .map(t => ({
          id: String(t.ID),
          name: (t.Title || t.JobTitleName || "").trim(),
          department: "",
          departmentId: t.DepartmentId ? String(t.DepartmentId) : "",
        }))
        .filter(t => t.name),
    );
  }, [active, jobTitleCatalog]);

  const selectedTitleId = useMemo(
    () => titleId || apiTitles.find((t) => t.name === title)?.id || "",
    [titleId, apiTitles, title],
  );

  // OFFICIAL cascade #4 — People for the chosen Job Title.
  useEffect(() => {
    if (!active || !selectedTitleId) { setApiResources([]); return; }
    let cancelled = false;
    getResourcesByJobTitle(selectedTitleId)
      .then((rows) => { if (!cancelled) setApiResources(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiResources([]); });
    return () => { cancelled = true; };
  }, [active, selectedTitleId]);

  const filteredRoles = useMemo(() => {
    if (!buShort) return roleRows;
    const bn = buShort.toLowerCase();
    return roleRows.filter((r) => {
      const rb = String(r.DivisionShortName ?? r.ShortName ?? r.BU ?? r.BusinessUnit ?? "").toLowerCase();
      return !rb || rb === bn;
    });
  }, [roleRows, buShort]);

  const roleOptions = useMemo(() => {
    // Prefer the client's official Roles-by-BU API; fall back to heuristic.
    if (apiRoles.length > 0) {
      return Array.from(new Set(apiRoles.map((r) => r.name).filter(Boolean))).sort();
    }
    const set = new Set<string>();
    for (const r of filteredRoles) {
      const v = String(r.Name ?? r.RoleName ?? r.TypeName ?? "").trim();
      if (v) set.add(v);
    }
    if (set.size === 0) {
      // Fallback: derive from people job titles when project has no role rows for this BU
      for (const p of people) { if (p.title) set.add(p.title); }
    }
    return Array.from(set).sort();
  }, [apiRoles, filteredRoles, people]);

  const baseTitleOptions = useMemo<{ id: string; name: string; label: string }[]>(() => {
    // Prefer the client's official Job-Titles-by-Role API; fall back below.
    if (apiTitles.length > 0) {
      return buildTitleOptions(apiTitles);
    }
    const rn = role.trim().toLowerCase();
    const set = new Set<string>();
    // Catalogue-first: prefer the tenant-wide GetJobTitle catalogue,
    // optionally narrowed by the selected role (via RoleName).
    if (jobTitleCatalog.length > 0) {
      for (const jt of jobTitleCatalog) {
        if (rn) {
          const jtRole = String(jt.RoleName ?? "").trim().toLowerCase();
          if (jtRole && jtRole !== rn) continue;
        }
        const v = String(jt.JobTitleName ?? jt.Title ?? "").trim();
        if (v) set.add(v);
      }
      if (set.size > 0) return Array.from(set).sort().map((n) => ({ id: n, name: n, label: n }));
    }
    if (rn) {
      for (const r of filteredRoles) {
        const rrole = String(r.Name ?? r.RoleName ?? r.TypeName ?? "").trim().toLowerCase();
        if (rrole !== rn) continue;
        const v = String(r.Title ?? r.JobTitle ?? "").trim();
        if (v) set.add(v);
      }
    }
    if (set.size === 0) {
      for (const p of people) { if (p.title) set.add(p.title); }
      for (const r of roleRows) {
        const v = String(r.Title ?? r.JobTitle ?? r.Name ?? r.RoleName ?? r.TypeName ?? "").trim();
        if (v) set.add(v);
      }
    }
    return Array.from(set).sort().map((n) => ({ id: n, name: n, label: n }));
  }, [jobTitleCatalog, filteredRoles, roleRows, people, role]);

  // Always offer the curated standard titles too (name-only options). The
  // applyPick guard (apiTitles.some) keeps JobTitleId empty for these picks,
  // so the title flows upstream by name — same as the heuristic fallbacks.
  const titleOptions = useMemo(() => withSuggestedTitleOptions(baseTitleOptions), [baseTitleOptions]);

  // Person selection may happen before or after Role. When Role is selected,
  // it narrows the roster; when it is blank, the picker shows the available
  // roster so a person can establish the initial role. An explicitly chosen
  // BU, Division, or Department must still narrow the roster in the legacy
  // form. Match stable IDs first and only use normalized labels for legacy
  // rows that do not carry those IDs.
  const selectedOrgMatches = useMemo(() => {
    // The compact weekly planner has no editable organization controls. Its
    // initial Division comes from the project, not an explicit roster filter,
    // so applying it here would hide every cross-BU candidate before the
    // deferred Add-to-Team confirmation can protect the project.
    if (!shouldFilterPeopleByOrganization(isWeeklyPlanner)) return () => true;
    const normalize = (value: string) => value.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    const selectedDivision = bus.find((entry) => entry.id === bu);
    const selectedDepartment = filteredDepartments.find((entry) => entry.id === dept);
    const selectedDivisionNames = new Set(
      [selectedDivision?.label || "", selectedDivision?.label?.split(" - ")[0] || ""]
        .map(normalize)
        .filter(Boolean),
    );
    const selectedDepartmentNames = new Set(
      [selectedDepartment?.name || deptName]
        .map(normalize)
        .filter(Boolean),
    );
    return (person: PersonRow) => {
      if (bu) {
        const profileDivision = person.divisionId
          ? divCatalog.find((entry) => entry.id === person.divisionId)
          : undefined;
        const names = [person.division, profileDivision?.label || ""].map(normalize).filter(Boolean);
        if (person.divisionId !== bu && !names.some((name) => selectedDivisionNames.has(name))) return false;
      } else if (businessUnit) {
        const profileDivision = person.divisionId
          ? divCatalog.find((entry) => entry.id === person.divisionId)
          : (person.division ? matchDivisionIn(divCatalog, person.division) : undefined);
        if (!profileDivision || profileDivision.buId !== businessUnit) return false;
      }
      if (dept) {
        const personDepartment = normalize(person.department);
        if (person.departmentId !== dept && (!personDepartment || !selectedDepartmentNames.has(personDepartment))) return false;
      } else if (deptName && normalize(person.department) !== normalize(deptName)) {
        return false;
      }
      return true;
    };
  }, [isWeeklyPlanner, bu, businessUnit, bus, dept, deptName, divCatalog, filteredDepartments]);

  const filteredPeopleInfo = useMemo(() => {
    const q = search.trim().toLowerCase();
    const r = role.trim();
    const t = title.trim();
    // STRICT same-role check from @workspace/role-match: "PM" ≡ "Project
    // Manager" ≡ "Proj Mgr", but seniority/level variants are DIFFERENT
    // roles — selecting "Project Manager" must NOT offer "Senior Project
    // Manager" / "Sr PM" / "Assistant PM" / "PM II" people (owner mandate).
    // The "show all people" notice remains the escape hatch.
    const roleEq = roleEquivalence(r);
    const titleEq = roleEquivalence(t);
    const searchOk = (p: PersonRow) =>
      !q || p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
    // "Related" = the person's job title OR raw role IS the selected
    // Role/Title. Both signals matter: some tenants keep the real job title
    // in the role field while title holds a filler value.
    const relatedOk = (p: PersonRow) => {
      if (!selectedOrgMatches(p)) return false;
      if (!r && !t) return true;
      const hit = (text: string) => !!text && (roleEq(text) || titleEq(text));
      return hit(p.title) || hit(p.role);
    };
    const searchFiltered = people.filter(searchOk);
    const related = searchFiltered.filter(relatedOk);
    return {
      // "Show all" expands beyond the role match, but never escapes an
      // explicitly selected BU, Division, or Department.
      list: showAllPeople ? searchFiltered.filter(selectedOrgMatches) : related,
      related,
      // Count related people BEFORE the search filter: the "not available"
      // notice is about the Role/Title having no matching staff, not about
      // the current search text. A search that happens to exclude every
      // related person must NOT flip the picker into the notice state.
      relatedCount: people.filter(relatedOk).length,
    };
  }, [people, search, role, title, showAllPeople, selectedOrgMatches]);
  const filteredPeople = filteredPeopleInfo.list;
  const relatedPeopleCount = filteredPeopleInfo.relatedCount;

  // OFFICIAL people for the chosen Job Title, enriched with availability dates
  // from the roster (the resources API doesn't return those). When present we
  // show exactly these people; otherwise we fall back to the heuristic list.
  const officialPeople = useMemo<PersonRow[]>(() => {
    if (apiResources.length === 0) return [];
    const byId = new Map(people.map((p) => [p.id, p]));
      return apiResources.map((r) => {
      const m = byId.get(r.id);
      return {
        id: r.id,
        name: r.name || m?.name || r.id,
        title: r.title || m?.title || title,
        role: m?.role || "",
        division: m?.division || buShort,
        divisionId: m?.divisionId || "",
        department: m?.department || "",
        departmentId: m?.departmentId || "",
        availStart: m?.availStart || "",
        availEnd: m?.availEnd || "",
        username: m?.username || "",
        email: m?.email || "",
      };
      }).filter(selectedOrgMatches);
  }, [apiResources, people, title, buShort, selectedOrgMatches]);

  const usingOfficialPeople = officialPeople.length > 0;
  // Official title-ID people come first, then any SAME-role people the
  // catalog lookup missed (free-text "PM" titles under a separately
  // catalogued "Project Manager", etc.) — both data paths honor the same
  // strict equivalence contract, so the picker never depends on which one
  // answered.
  const baseDisplayPeople = useMemo(() => {
    if (!usingOfficialPeople) return filteredPeopleInfo.list;
    const seen = new Set(officialPeople.map((p) => p.id.toLowerCase()));
    const extras = filteredPeopleInfo.related.filter((p) => !seen.has(p.id.toLowerCase()));
    return extras.length ? [...officialPeople, ...extras] : officialPeople;
  }, [usingOfficialPeople, officialPeople, filteredPeopleInfo]);
  // Rank by free capacity (most free first) once the availability index is
  // loaded; a person absent from a SUCCESSFUL index has no allocations in the
  // window and sorts as fully free. Without an index, keep the original order.
  const displayPeople = useMemo(() => {
    if (!availIdx) return baseDisplayPeople;
    const free = (p: PersonRow) => {
      const a = availIdx.byId.get(p.id.toLowerCase()) ?? availIdx.byName.get(p.name.trim().toLowerCase());
      return a ? a.freeHrsPerWk : WEEK_CAPACITY_HRS;
    };
    const availabilityRank = (p: PersonRow) => {
      const tone = availabilityBadge(availEntryFor(p)).tone;
      return tone === "free" ? 2 : tone === "tight" ? 1 : 0;
    };
    return [...baseDisplayPeople].sort((a, b) =>
      availabilityRank(b) - availabilityRank(a) || free(b) - free(a) || a.name.localeCompare(b.name)
    );
  }, [baseDisplayPeople, availIdx]);

  // Each new Role/Title selection starts back in "related" mode. When nothing
  // matches, we NO LONGER silently flip to the full staff list — the picker
  // instead shows an explicit "<Role> not available — show all people" notice
  // (rendered by the consumers using relatedPeopleCount), so the user always
  // understands why they're seeing everyone.
  useEffect(() => {
    setShowAllPeople(false);
  }, [role, title]);

  const norm = (s: string) => (s || "").trim().toLowerCase();
  const isExactDupe = (pid: string) => {
    if (!buShort || !role) return false;
    return existingAllocations.some((a) =>
      norm(a.personId) === norm(pid) &&
      norm(a.bu) === norm(buShort) &&
      norm(a.role) === norm(role) &&
      norm(a.title) === norm(title)
    );
  };
  // The horizontal allocation workspace is both the add route and the direct
  // edit route. Once the selected GUID already belongs to this project, retain
  // that persisted assignment as the save target instead of attempting a new
  // ID=0 insert. The weekly save below also force-refreshes membership before
  // writing, so a stale client cannot resurrect a removed member.
  const existingDirectAllocation = plannedWeeklyHours !== undefined
    ? existingAllocations.find((allocation) => norm(allocation.personId) === norm(personId))
    : undefined;
  const alreadyOnProjectForDirectPlan = !!existingDirectAllocation;
  const dupeOnSubmit = !changeFrom && !prefillPersonName && !!personId &&
    !alreadyOnProjectForDirectPlan &&
    (personOnly
      ? existingAllocations.some((allocation) => norm(allocation.personId) === norm(personId))
      : isExactDupe(personId));
  // Division tier hidden → a division pick can't be required (the picker is
  // not rendered); the hidden bridge division is resolved at submit time.
  const canSubmit = assignmentSaved || (
    personOnly
      ? !!personId && !submitting && !dupeOnSubmit
      : (!!bu || !getBusinessRules().showDivision) &&
        !!role &&
        !!personId &&
        !submitting &&
        !dupeOnSubmit &&
        !openRoleSelectionRequired &&
        !buMismatchPromptOpen
  );

  // Selecting an existing member turns the planner into Edit Assignment in
  // place. Seed its saved role/title/window so the screen never presents
  // project-level defaults as though they were the member's stored values.
  // This effect intentionally keys on assignment identity/person selection,
  // not on the editable state it seeds.
  useEffect(() => {
    if (!active || plannedWeeklyHours === undefined || !existingDirectAllocation) return;
    if (existingDirectAllocation.role) setRole(existingDirectAllocation.role);
    if (existingDirectAllocation.title) setTitle(existingDirectAllocation.title);
    if (existingDirectAllocation.startDate) setStartDate(existingDirectAllocation.startDate.slice(0, 10));
    if (existingDirectAllocation.endDate) setEndDate(existingDirectAllocation.endDate.slice(0, 10));
  }, [
    active,
    isWeeklyPlanner,
    personId,
    people,
    existingDirectAllocation?.allocationId,
    existingDirectAllocation?.personId,
  ]);

  // ── ADD-mode duplicate handling: DIRECT merge (user mandate Aug 2026) ──
  // isExactDupe hard-blocks only a full person+BU+role+title match — a same
  // person + same role add with a different title sailed through silently
  // and created a visually identical second row (live report Aug 2026).
  // A person+role match now NEVER asks and NEVER creates a second row: the
  // entered hours are added straight into the existing assignment (the same
  // edit-path submit as the pencil — union window, existing + entered
  // hours). The earlier choice prompt ("add to existing / separate / never
  // mind") was retired on user request — no separate-assignment option.
  // When there's nothing addable (no hours entered, or the match carries no
  // editable allocation id), submit stops with a pointer to the pencil.
  const mergeTargetRef = useRef<ExistingAllocationRef | null>(null);

  // Phase-schedule window (only passed by callers when the project HAS a
  // schedule). Member dates must stay inside it — validated here for a fast,
  // friendly error and enforced again server-side.
  //
  // The window applies ONLY in "full" display mode. In the no-schedule display
  // modes the schedule data may still exist behind the scenes, but it's hidden
  // from users — clamping dates to an invisible window would block picks the
  // user can't understand. Zeroing the window here turns off EVERY downstream
  // restriction in one place: submit validation, the modal/inline-row date
  // input min/max, the clamp effect, and the explanatory notes.
  // Record-aware callers (AddTeamMemberModal) pass scheduleWindowEnabled from
  // the RESOLVED display mode — "full" AND "schedule-no-grid" follow a phase
  // schedule, and per-record overrides are honored. The tenant-global re-read
  // below is only a legacy fallback for callers that don't pass it; it misses
  // schedule-no-grid and per-record overrides, which used to let member dates
  // land outside a real phase schedule. The server enforces independently:
  // the forwarded flag can only TIGHTEN the server gate (true), never disable
  // it — so a record overridden to a no-schedule LAYOUT on this device still
  // gets the server rejection when tenant settings follow a schedule.
  const windowApplies = scheduleWindowEnabled ?? (getBusinessRules().projectDisplayMode === "full");
  const schedStartYmd = windowApplies ? (scheduleStart || "").slice(0, 10) : "";
  const schedEndYmd = windowApplies ? (scheduleEnd || "").slice(0, 10) : "";
  const hasScheduleWindow = !!(schedStartYmd || schedEndYmd);
  const fmtNice = (ymd: string) => {
    const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
    return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const schedWindowLabel = `${schedStartYmd ? fmtNice(schedStartYmd) : "…"} – ${schedEndYmd ? fmtNice(schedEndYmd) : "…"}`;

  const directWeeklyEntries = Object.entries(plannedWeeklyHours ?? {})
    .filter(([week]) => /^\d{4}-\d{2}-\d{2}$/.test(week))
    .map(([week, rawHours]) => ({
      week,
      hours: rawHours,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
  const directWeeklyViolation = findWeeklyHoursViolation(
    directWeeklyEntries.map((entry) => [entry.week, entry.hours] as const),
  );
  const directWeeklyTotal = directWeeklyEntries.reduce((sum, row) => sum + row.hours, 0);
  const hasDirectWeeklyPlan = plannedWeeklyHours !== undefined;
  const directWeeklyOptimistic = (): OptimisticAssignedMember => ({
    id: personId,
    role,
    bu: businessUnit,
    title,
    startDate: startDate || prefillStartDate || scheduleStart || projectStartDate,
    endDate: endDate || prefillEndDate || scheduleEnd || projectEndDate,
    pct: directWeeklyTotal,
    hours: directWeeklyTotal,
    weeklyHours: directWeeklyEntries.map(({ week, hours }) => ({ week, hours })),
    isExisting: alreadyOnProjectForDirectPlan,
  });

  const friendlySaveError = (error: unknown) => {
    const maybeFriendly = error as { friendlyMessage?: unknown };
    if (typeof maybeFriendly?.friendlyMessage === "string" && maybeFriendly.friendlyMessage.trim()) {
      return maybeFriendly.friendlyMessage;
    }
    return error instanceof Error ? error.message : String(error);
  };

  async function persistDirectWeeklyHours() {
    // A zero-hour assignment is valid. With no positive rows there is nothing
    // for /hours-allocation to insert after assignResource's zero-hour
    // container, so avoid a needless full-replace write.
    if (!hasDirectWeeklyPlan || (directWeeklyEntries.every((row) => row.hours === 0) && !alreadyOnProjectForDirectPlan)) return;

    // The server saves one person's complete weekly plan atomically. Route
    // the write through saveMemberWeeklyHours so it serializes behind any
    // in-flight grid/sidebar write for this same person (project+GUID key)
    // and merges onto FRESH server truth at queue turn instead of a stale
    // local snapshot. The visible planner weeks are sent as patches so any
    // authoritative weeks outside the planner range survive a concurrent edit;
    // explicit zero-hour weeks still clear the values the user can see. For a
    // just-created assignment the helper's
    // queue-turn fresh team read happens AFTER assignResource has landed the
    // membership; if the new member still isn't visible it throws
    // NotOnTeamError rather than silently writing nothing.
    const weekPatches: Record<string, number> = {};
    for (const { week, hours } of directWeeklyEntries) weekPatches[week] = hours;
    // GUID-first identity: personId is the selected person's stable GUID.
    // Perceived-speed fast path (runFastWeeklyHoursSave): resolve as soon as
    // the server ACCEPTS the exact week map (the /hours-allocation POST
    // succeeded). The helper's forced-fresh verification read still runs to
    // completion in the background; every pre-acceptance failure (validation,
    // past-week lock, NotOnTeam, server "Error") still rejects and keeps the
    // modal open for retry exactly as before. Only a post-acceptance
    // verification mismatch — the server confirmed the write but a fresh read
    // disagreed — is surfaced as a loud toast after close instead of blocking
    // the save on one more RDS round trip.
    await runFastWeeklyHoursSave(
      {
        projectId,
        memberId: personId,
        memberName: personName,
        memberRole: role,
        weekPatches,
      },
      {
        bustCache,
        warnVerificationFailed: (err) => {
          // The modal is already closed — tell the user loudly; never silently.
          showAllocationSaveToast(
            `⚠ ${personName}'s hours were saved, but the follow-up check could not confirm them. Open the project team card to verify. ${friendlySaveError(err)}`,
            "warning",
          );
        },
      },
    );
  }

  // Returns true only when an UPDATE was actually issued and accepted, so the
  // caller can report a partial save (dates landed, hours failed) precisely.
  async function persistExistingDirectAssignmentWindow(): Promise<boolean> {
    if (!existingDirectAllocation) return false;
    const savedStart = (existingDirectAllocation.startDate || "").slice(0, 10);
    const savedEnd = (existingDirectAllocation.endDate || "").slice(0, 10);
    const nextStart = (startDate || savedStart || projectStartDate || "").slice(0, 10);
    const nextEnd = (endDate || savedEnd || projectEndDate || "").slice(0, 10);
    if (savedStart === nextStart && savedEnd === nextEnd) return false;

    const existingId = Number(existingDirectAllocation.allocationId);
    if (!Number.isFinite(existingId) || existingId <= 0) {
      throw new Error(
        `The saved assignment row for ${personName} could not be identified. Refresh the team and try again before changing its dates.`,
      );
    }

    const result = await assignResource({
      ProjectID: projectId,
      // Record-resolved schedule-window flag (per-record overrides live
      // client-side). Only sent when a record-aware caller provided it —
      // otherwise the server resolves from the tenant's module-level mode.
      ...(scheduleWindowEnabled !== undefined ? { ScheduleWindowEnabled: scheduleWindowEnabled } : {}),
      Allocations: [{
        AllocationStartDate: nextStart,
        AllocationEndDate: nextEnd,
        AssignedTo: personId,
        AssignedToName: personName,
        // Positive persisted ID is the key invariant: this can only UPDATE the
        // existing assignment and can never enter the server's insert path.
        ID: existingId,
        PctAllocation: 0,
        ProjectID: projectId,
        TemplateID: 0,
        Title: existingDirectAllocation.title || title || null,
        JobTitleName: existingDirectAllocation.title || title || null,
        DivisionName: null,
        Type: prefillTypeGuid || "",
        GroupId: prefillGroupId || undefined,
        TypeName: existingDirectAllocation.role || role,
        SoftAllocation: "false",
        NonChargeable: false,
        IsResourceDisabled: false,
        IsResourceOverAllocated: false,
        IsPreconStage: false,
      }],
    });
    const resultText = typeof result === "string" ? result : JSON.stringify(result ?? {});
    const parsed = (() => {
      try { return JSON.parse(resultText) as { Status?: boolean; ok?: boolean; error?: string; Message?: string }; }
      catch { return null; }
    })();
    if (parsed?.Status === false || parsed?.ok === false || parsed?.error) {
      throw new Error(parsed.Message || parsed.error || `Could not update ${personName}'s assignment dates.`);
    }
    return true;
  }

  async function submit() {
    if (!canSubmit && !assignmentSavedRef.current) return;
    if (openRoleSelectionRequired) {
      setError("Choose the specific open position to fill before saving. This keeps the other identical open role available.");
      return;
    }
    // Date order is a save-boundary invariant, not just an availability-query
    // concern. It must run before the partial-save retry, instant weekly-save
    // path, or any assignment/date write can begin.
    if (!personOnly) {
      const effectiveStart = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
      const effectiveEnd = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
      const dateRangeError = assignmentDateRangeError(effectiveStart, effectiveEnd);
      if (dateRangeError) {
        setError(dateRangeError);
        return;
      }
    }
    // This must happen before assignResource as well as before the direct
    // weekly save. An invalid planner value must never create a member shell
    // that then fails its hours replacement.
    if (hasDirectWeeklyPlan && directWeeklyViolation) {
      setError(weeklyHoursViolationMessage(directWeeklyViolation));
      return;
    }
    // Partial-save retry: the person is already on the team, so retry only the
    // exact weekly rows. Keep every selector locked until this succeeds.
    if (assignmentSavedRef.current) {
      setSubmitting(true);
      setError(null);
      try {
        await persistDirectWeeklyHours();
        bustCache();
        assignmentSavedRef.current = false;
        setAssignmentSaved(false);
        onAssigned(personName, directWeeklyOptimistic());
        onClose();
      } catch (e) {
        setError(`The person is on the team, but the weekly hours still weren't saved. Retry the hours save. ${friendlySaveError(e)}`);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    // The weekly allocation workspace doubles as the safe edit route for a
    // person who is already on this project. Update only their existing
    // project-week rows; calling assignResource here would create (or be
    // rejected as) a duplicate assignment.
    if (hasDirectWeeklyPlan && alreadyOnProjectForDirectPlan) {
      // INSTANT-SAVE contract (parity with the grid's inline week cells):
      // close now, run the canonical queued write in the background, be LOUD
      // on failure. Nothing is patched optimistically pre-acceptance, so a
      // failure leaves views on server truth. onAssigned (parent patch +
      // forced-fresh reconcile) fires only AFTER the write lands, or the
      // parent's fresh read races the in-flight write and shows stale hours.
      setError(null);
      onClose();
      showAllocationSaveToast(`Saving ${personName}'s weekly hours…`, "progress");
      const chainKey = `${projectId}::${norm(personId)}`;
      const prior = existingEditChains.get(chainKey) ?? Promise.resolve();
      const run = prior.then(async () => {
        let datesCommitted = false;
        try {
          datesCommitted = await persistExistingDirectAssignmentWindow();
          await persistDirectWeeklyHours();
          // The operator picked an EXACT open position for this person to
          // fill (alert / quick-action hand-off carries the slot's RA ids).
          // A person already on the team takes this edit path, which never
          // reaches assignResource's ConsumeOpenSlotRaIds — so retire the
          // selected slot explicitly here, or it lingers as a phantom open
          // role next to the member whose hours were just updated. The
          // server only ever touches rows that are STILL open, so a stale
          // id can never delete a real assignment.
          let slotWarning = "";
          if (consumeIds && consumeIds.length > 0) {
            try {
              await removeOpenPosition(projectId, consumeIds);
            } catch (slotErr) {
              slotWarning = ` The selected open position could NOT be retired and may still show as unfilled — remove it from the team grid, or refresh and try again. ${friendlySaveError(slotErr)}`;
            }
          }
          bustCache();
          onAssigned(personName, directWeeklyOptimistic());
          showAllocationSaveToast(
            slotWarning
              ? `✓ Updated ${personName}'s weekly project hours.${slotWarning}`
              : `✓ Updated ${personName}'s weekly project hours.`,
            slotWarning ? "warning" : "success",
          );
        } catch (e) {
          // Never fail silently after the editor has closed: force fresh
          // reads so open views show true server state, and say exactly what
          // landed — the dates UPDATE may have succeeded before the hours
          // write failed.
          bustCache();
          showAllocationSaveToast(
            datesCommitted
              ? `✕ ${personName}'s assignment dates were updated, but the weekly hours were NOT saved — reopen the allocation editor to re-enter the hours. ${friendlySaveError(e)}`
              : `✕ ${personName}'s allocation edit was NOT saved — reopen the allocation editor and try again. ${friendlySaveError(e)}`,
            "error",
          );
        }
      });
      existingEditChains.set(chainKey, run);
      void run.finally(() => {
        if (existingEditChains.get(chainKey) === run) existingEditChains.delete(chainKey);
      });
      return;
    }
    // Selecting a person must never add their Business Unit to the project.
    // The mismatch is held until the user explicitly starts the add action.
    if (!personOnly && getCrossBuPromptMode(!!buMismatch, buMismatchPromptOpen) === "pending") {
      setBuMismatchPromptOpen(true);
      return;
    }
    // ── CHANGE-RESOURCE mode ────────────────────────────────────────────────
    // The server owns all dates here (cutover = next Monday; the incoming
    // person's container mirrors the outgoing member's span), so the client
    // schedule-window check and the post-save hours bookkeeping below are
    // both skipped — the hand-over transaction does that work in one place.
    if (changeFrom) {
      if (norm(personId) === norm(changeFrom.personId)) {
        setError(`${changeFrom.name} already holds this assignment — pick a different person to take it over.`);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const resolvedDivisionId = await resolveDivisionForSave(bu, businessUnit);
        const data = await changeTeamResource({
          ProjectID: projectId,
          FromResourceUser: changeFrom.personId,
          // The server derives the incoming container's dates from the
          // outgoing member's span, then runs the same schedule-window gate
          // as a normal add — pass the record-resolved flag so per-record
          // display-mode overrides govern the hand-over too.
          ...(scheduleWindowEnabled !== undefined ? { ScheduleWindowEnabled: scheduleWindowEnabled } : {}),
          Allocations: [{
            AllocationStartDate: startDate || prefillStartDate || projectStartDate,
            AllocationEndDate: endDate || prefillEndDate || projectEndDate,
            AssignedTo: personId,
            AssignedToName: personName,
            ID: 0,
            PctAllocation: 0,
            ProjectID: projectId,
            TemplateID: 0,
            Title: title || null,
            JobTitleName: title || null,
            JobTitleId: titleId || undefined,
            DivisionId: resolvedDivisionId || undefined,
            DivisionName: buShort || null,
            Type: prefillTypeGuid || "",
            TypeName: role,
            SoftAllocation: "false",
            NonChargeable: false,
            IsResourceDisabled: false,
            IsResourceOverAllocated: false,
            IsPreconStage: false,
          }],
        });
        bustCache();
        const resultStr = JSON.stringify(data ?? {});
        const low = resultStr.toLowerCase();
        if (data?.Status === false || data?.ok === false || data?.error || low.includes("schedulewindow")) {
          // Same error mapping as a normal Add Member save — the server runs
          // the identical assignResourceRds gates before the hand-over.
          if (low.includes("schedulewindow")) {
            setError(data?.Message || `Member dates must stay within the project schedule (${schedWindowLabel}).`);
          } else if (low.includes("allocationoutofbounds")) {
            const oobMatch = resultStr.match(/AllocationOutofbounds~\d+~([^~]+)~([^~]+)~([^~"]+)/i);
            setError(`RM ONE rejected: ${oobMatch?.[3]?.trim() || personName}'s availability (${oobMatch?.[1] ?? "?"} – ${oobMatch?.[2] ?? "?"}) doesn't cover the assignment dates. Please pick someone else or update their availability in the RM ONE portal.`);
          } else if (low.includes("overlappingallocation")) {
            setError(`RM ONE rejected: ${personName} already has an overlapping allocation on this project. Remove the existing allocation in the RM ONE portal first, then try again.`);
          } else {
            setError(data?.Message || "Couldn't change the resource. Please try again.");
          }
          return;
        }
        const handedOver = (data?.moved ?? 0) + (data?.split ?? 0) + (data?.synthesized ?? 0);
        const cutNice = data?.cutover ? fmtNice(data.cutover) : "next week";
        const extendedTo = data?.targetEndExtended;
        const msg = handedOver > 0
          ? `${personName} takes over from ${changeFrom.name} starting ${cutNice} — ${handedOver} upcoming allocation${handedOver === 1 ? "" : "s"} moved over.${extendedTo ? ` Target End moved to ${fmtNice(extendedTo)}.` : ""}`
          : `${personName} takes over from ${changeFrom.name} starting ${cutNice}. ${changeFrom.name.split(" ")[0]} had no upcoming hours scheduled, so ${personName.split(" ")[0]} starts at 0 hours.`;
        onAssigned(personName, {
          id: personId, role, bu: businessUnit, title,
          startDate: data?.cutover || (startDate || prefillStartDate || projectStartDate),
          endDate: endDate || prefillEndDate || projectEndDate,
          pct: 0,
        });
        onClose();
        if (typeof window !== "undefined") {
          const toast = document.createElement("div");
          toast.textContent = `✓ ${msg}`;
          Object.assign(toast.style, {
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            background: "#1B2B38", color: "#6BA539", padding: "12px 24px", borderRadius: "10px",
            fontSize: "14px", fontWeight: "600", zIndex: String(Z.DOM_TOAST), boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            border: "1px solid rgba(107,165,57,0.3)", transition: "opacity 0.3s",
          });
          document.body.appendChild(toast);
          setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 5000);
        }
      } catch (e) {
        console.warn("[change-resource] failed:", e);
        setError(
          "Couldn't finish the change — the connection dropped mid-save. Refresh the page to see where things stand: if the new person already appears on the team, retry Change Resource on the original member; otherwise just try again.",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
    // Total-hours physical ceiling: an assignment can never carry more than
    // 24h × span days (min 168h). Mirrors the server's assignResourceRds gate
    // so the user hears it BEFORE submitting instead of via an error toast.
    if (!personOnly && showHoursField && lumpHours !== "") {
      const hrs = Math.max(0, Number(lumpHours) || 0);
      const capStart = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
      const capEnd = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
      const { cap, days } = maxAssignmentHours(capStart, capEnd);
      if (hrs > cap) {
        setError(`Total hours can't exceed ${cap}h for these dates — that's 24 hours × ${days} day${days === 1 ? "" : "s"}. Lower the hours or widen the date range.`);
        return;
      }
    }
    // Schedule-window clamp: block out-of-bounds dates before any request.
    if (!personOnly && hasScheduleWindow) {
      const effStart = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
      const effEnd = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
      if (schedStartYmd && effStart && effStart < schedStartYmd) {
        setError(`Start date can't be before the project schedule starts. This project has a phase schedule, so member dates must stay within ${schedWindowLabel}.`);
        return;
      }
      if (schedEndYmd && effEnd && effEnd > schedEndYmd) {
        setError(`End date can't be after the project schedule ends. This project has a phase schedule, so member dates must stay within ${schedWindowLabel}.`);
        return;
      }
    }
    // REPLACE-ALL save (Aug 2026): the user edited the direct Total Hours
    // field, so the entered dates + total are the WHOLE truth for the target
    // assignment row — the server zeroes every other hours row under that RWI
    // (weekly import rows included) instead of stacking a second lump next to
    // them (the duplicate-period bug). Whole-assignment edits always qualify;
    // period edits only when the period's own RWI is known (legacy cached
    // slices without rwiId keep the conservative merge-total path).
    const hoursEdited = !personOnly && !hasDirectWeeklyPlan && showHoursField && lumpHours !== "";
    const replaceScope = hoursEdited && (!periodScope || periodScope.rwiId != null);
    // Period mode: the new window must not overlap any of the member's OTHER
    // periods — weekly rows have no per-period identity, so an overlapping
    // window would let the re-spread silently overwrite the other period's
    // hours. Fail loud instead. Same-RWI siblings are exempt under a
    // replace-all save: they're phantom duplicates the server is about to
    // merge into this one row, not real separate periods (legit multi-period
    // members always live on separate RWIs).
    if (periodScope?.otherPeriods?.length) {
      const ns = (startDate || prefillStartDate || "").slice(0, 10);
      const ne = (endDate || prefillEndDate || "").slice(0, 10);
      const guarded = replaceScope && periodScope.rwiId != null
        ? periodScope.otherPeriods.filter((p) => !(p.rwiId != null && p.rwiId === periodScope.rwiId))
        : periodScope.otherPeriods;
      const clash = ns && ne
        ? guarded.find((p) => !(ne < p.start || ns > p.end))
        : undefined;
      if (clash) {
        const fmt = (ymd: string) => {
          const d = new Date(`${ymd}T00:00:00`);
          return isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        };
        setError(`These dates overlap the member's other assignment period (${fmt(clash.start)} – ${fmt(clash.end)}). Adjust that period first, or pick dates that don't overlap it.`);
        return;
      }
    }
    // ── ADD-mode duplicate → DIRECT merge ─────────────────────────────────
    // Runs after all date validations. Edit/change/period modes never enter
    // here (the row identity is already explicit there). A person+role match
    // merges into the existing assignment immediately — no prompt, never a
    // second row (user mandate Aug 2026). Merge target = the match whose
    // window overlaps the entered dates most (no overlap still merges: the
    // union window covers both periods).
    if (!changeFrom && !periodScope && !prefillAllocationId && !prefillPersonName
        && !mergeTargetRef.current) {
      const matches = existingAllocations.filter((a) =>
        norm(a.personId) === norm(personId) && norm(a.role) === norm(role));
      if (matches.length > 0) {
        const es = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
        const ee = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
        const overlapDays = (a: ExistingAllocationRef) => {
          const s = (a.startDate || "").slice(0, 10), e = (a.endDate || "").slice(0, 10);
          if (!s || !e || !es || !ee) return -1;
          const lo = es > s ? es : s, hi = ee < e ? ee : e;
          return lo <= hi ? (new Date(hi).getTime() - new Date(lo).getTime()) / 86400000 : -1;
        };
        const mergeable = matches.filter((a) => a.allocationId != null && a.startDate && a.endDate);
        const best = mergeable.length
          ? mergeable.reduce((x, y) => (overlapDays(y) > overlapDays(x) ? y : x))
          : null;
        const entered = hasDirectWeeklyPlan
          ? directWeeklyTotal
          : (showHoursField && lumpHours !== "" ? Math.max(0, Number(lumpHours) || 0) : 0);
        if (best && entered > 0) {
          // Fall through into the save below as an EDIT of the existing row —
          // cleared in this submit's finally.
          mergeTargetRef.current = best;
        } else {
          // Nothing addable (no hours entered, or the existing row can't be
          // edited from this list). Never create a lookalike second row.
          setError(`${personName || "This person"} is already on this team as ${role}. Refresh the team, select them again here, and edit their saved hours in this workspace.`);
          return;
        }
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      // Division tier hidden → resolve the hidden bridge division so the
      // assignment still lands with a connected Division→BU chain.
      const resolvedDivisionId = personOnly ? null : await resolveDivisionForSave(bu, businessUnit);
      // PERIOD-SCOPED edit: the form's dates/hours describe ONE period, but the
      // RWI/container write must stay whole-assignment — window widened only if
      // the period now pokes outside it, total = old total − old period hours
      // + new period hours. The per-week reshaping happens post-save below.
      const effStartYmd = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
      const effEndYmd = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
      const minYmd = (a: string, b: string) => (a && b ? (a < b ? a : b) : a || b);
      const maxYmd = (a: string, b: string) => (a && b ? (a > b ? a : b) : a || b);
      // Replace-all period edit targets the period's OWN RWI, so the entered
      // dates/hours ARE that assignment's whole truth — no widening to the
      // member-wide window and no merged-total math (those exist only for the
      // legacy path where the write lands on the shared primary RWI).
      const perRwiReplace = replaceScope && !!periodScope;
      const saveStart = periodScope && !perRwiReplace
        ? minYmd((periodScope.assignStart || "").slice(0, 10), effStartYmd)
        : (startDate || prefillStartDate || projectStartDate);
      const saveEnd = periodScope && !perRwiReplace
        ? maxYmd((periodScope.assignEnd || "").slice(0, 10), effEndYmd)
        : (endDate || prefillEndDate || projectEndDate);
      const newPeriodHours = Math.max(0, Number(lumpHours) || 0);
      // PctAllocation stores raw hours (not a percentage — see memory/pctallocation-is-hours-not-percent.md).
      // When the hours field is visible the user edits this directly; otherwise
      // the pre-fill value is preserved so an existing allocation isn't zeroed.
      const resolvedHours =
        hasDirectWeeklyPlan
          ? directWeeklyTotal
          : showHoursField && lumpHours !== ""
          ? (periodScope && !perRwiReplace
              ? Math.max(0, (periodScope.assignHours ?? 0) - periodScope.periodHours + newPeriodHours)
              : newPeriodHours)
          : (typeof prefillPct === "number" ? prefillPct : 0);
      // Duplicate-prompt merge: submit as an EDIT of the chosen existing row —
      // union window, entered hours ADDED to the row's current total. Same
      // server path as the pencil edit (ID > 0 + AllocationHour + PctAllocation).
      const mergeTarget = mergeTargetRef.current;
      const mergeStart = mergeTarget ? minYmd((mergeTarget.startDate || "").slice(0, 10), effStartYmd) : "";
      const mergeEnd = mergeTarget ? maxYmd((mergeTarget.endDate || "").slice(0, 10), effEndYmd) : "";
      const mergedHours = mergeTarget ? Math.max(0, mergeTarget.hours ?? 0) + newPeriodHours : 0;
      const result = await assignResource({
        ProjectID: projectId,
        // Record-resolved schedule-window flag (per-record overrides live
        // client-side). Only sent when a record-aware caller provided it —
        // otherwise the server resolves from the tenant's module-level mode.
        ...(scheduleWindowEnabled !== undefined ? { ScheduleWindowEnabled: scheduleWindowEnabled } : {}),
        Allocations: [{
          ...(!personOnly ? {
            AllocationStartDate: mergeTarget ? mergeStart : saveStart,
            AllocationEndDate: mergeTarget ? mergeEnd : saveEnd,
          } : {}),
          AssignedTo: personId,
          AssignedToName: personName,
          ID: mergeTarget ? (mergeTarget.allocationId ?? 0) : (prefillAllocationId ?? 0),
          // The direct weekly workspace writes exact short rows immediately
          // after this core save. Keep its long-span membership container at
          // zero so it can never be spread back over deliberately zero weeks
          // and double-count the exact weekly plan on workload reads.
          PctAllocation: personOnly ? 0 : (mergeTarget ? mergedHours : (hasDirectWeeklyPlan ? 0 : resolvedHours)),
          // Explicit hours signal — only sent when the user edited the direct
          // Total Hours field. The backend edit path persists this onto the
          // member's container allocation row (AllocationHour + PctAllocation)
          // so the card can show the total and its implied allocation %.
          ...(mergeTarget
            ? { AllocationHour: mergedHours }
            : (showHoursField && lumpHours !== "" ? { AllocationHour: resolvedHours } : {})),
          // Replace semantics: the sent AllocationHour is the assignment's
          // WHOLE truth — the server zeroes every other hours row under the
          // target RWI (weekly rows included) so edits never stack a second
          // visible period. Merges qualify too: mergedHours already contains
          // the row's old total, so collapsing weekly detail keeps the sum.
          ...(mergeTarget || replaceScope ? { ReplaceAllHours: true } : {}),
          ProjectID: projectId,
          TemplateID: 0,
          // Merge keeps the existing row's title — the form's title pick
          // described a would-be NEW row, not a rename of the merged one.
          Title: personOnly ? null : (mergeTarget ? (mergeTarget.title || null) : (title || null)),
          JobTitleName: personOnly ? null : (mergeTarget ? (mergeTarget.title || null) : (title || null)),
          // Only persist a title id the user EXPLICITLY picked from the
          // catalogue. selectedTitleId has a name→first-match fallback (used
          // for the people list) that could resolve the wrong duplicate, so it
          // must never become the saved JobTitleLookup.
          JobTitleId: personOnly || mergeTarget ? undefined : (titleId || undefined),
          // Exact division ID the user picked — the backend prefers this over
          // name resolution (short labels like "CIV" don't reliably match
          // CompanyDivisions Title/ShortName, which used to null the lookup).
          // Merge: send NO division — the server's edit path COALESCEs a null
          // division to the row's stored lookup, so the existing assignment
          // keeps its division instead of adopting the form's autofill.
          DivisionId: personOnly || mergeTarget ? undefined : (resolvedDivisionId || undefined),
          DivisionName: personOnly || mergeTarget ? null : (buShort || null),
          Type: prefillTypeGuid || "",
          GroupId: prefillGroupId || undefined,
          TypeName: personOnly ? "" : role,
          SoftAllocation: "false",
          NonChargeable: false,
          IsResourceDisabled: false,
          IsResourceOverAllocated: false,
          IsPreconStage: false,
        }],
        // Filling an open slot: tell the server which open demand rows this
        // assignment satisfies so they're consumed (soft-deleted) — otherwise
        // the position lingers as a phantom open role next to the new member.
        // consumeIds is STATE seeded from the consumeRaIds prop and retargeted
        // when the user clicks an open-position suggestion chip.
        ...(consumeIds && consumeIds.length > 0 ? { ConsumeOpenSlotRaIds: consumeIds } : {}),
        // Quick Actions marks duplicate role/title choices explicitly. If this
        // client-side guard is somehow bypassed without a selected slot, the
        // server must not fall back to its best-effort role/date matcher.
        ...(requireOpenRoleSelection ? { RequireOpenSlotSelection: true } : {}),
      });
      bustCache();
      const structured = result as { error?: string; Message?: string; targetEndExtended?: string } | string;
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      // assignResource returns raw response TEXT, so the typeof-object branch
      // never fires on its own — also detect ScheduleWindow by string and pull
      // the server's Message out of the JSON body.
      const parsedResult = (() => {
        try { return JSON.parse(resultStr) as { error?: string; Message?: string; targetEndExtended?: string }; }
        catch { return undefined; }
      })();
      if ((typeof structured === "object" && structured?.error === "ScheduleWindow") || resultStr.toLowerCase().includes("schedulewindow")) {
        setError((typeof structured === "object" ? structured.Message : undefined) || parsedResult?.Message || `Member dates must stay within the project schedule (${schedWindowLabel}).`);
      } else if (resultStr.toLowerCase().includes("allocationoutofbounds")) {
        const oobMatch = resultStr.match(/AllocationOutofbounds~\d+~([^~]+)~([^~]+)~([^~"]+)/i);
        const availS = oobMatch?.[1] ?? "?";
        const availE = oobMatch?.[2] ?? "?";
        const who = oobMatch?.[3]?.trim() || personName;
        setError(`RM ONE rejected: ${who}'s availability (${availS} – ${availE}) doesn't cover the project dates. This person cannot be assigned. Please pick someone else or update their availability in the RM ONE portal.`);
      } else if (resultStr.toLowerCase().includes("duplicateassignment")) {
        setError(`${personName || "This person"} is already assigned to this project. Refresh the team, select them again here, and edit their saved weekly hours in this workspace.`);
      } else if (resultStr.toLowerCase().includes("overlappingallocation")) {
        setError(`RM ONE rejected: ${personName} already has an overlapping allocation on this project. Remove the existing allocation in the RM ONE portal first, then try again.`);
      } else {
        // The horizontal add workspace promises exact weekly hours as part of
        // this action. Do not close or report success until that canonical save
        // succeeds. If it fails, remember that the core assignment already
        // exists and turn the next click into an hours-only retry.
        if (hasDirectWeeklyPlan) {
          assignmentSavedRef.current = true;
          setAssignmentSaved(true);
          try {
            await persistDirectWeeklyHours();
          } catch (weeklyError) {
            bustCache();
            setError(`The person was added to the team, but the weekly hours weren't saved. Retry the hours save before closing. ${friendlySaveError(weeklyError)}`);
            return;
          }
          assignmentSavedRef.current = false;
          setAssignmentSaved(false);
        }

        const extendedTo = (typeof structured === "object" ? structured?.targetEndExtended : undefined) ?? parsedResult?.targetEndExtended;
        const msg = mergeTarget
          ? `Added ${newPeriodHours}h to ${personName}'s existing ${role} assignment — new total ${Math.round(mergedHours)}h.${extendedTo ? ` Target End moved to ${fmtNice(extendedTo)} to cover it.` : ""}`
          : personOnly
            ? `${personName} has been added to the lead team.`
            : `${personName} has been assigned to the project as ${role}.${hasDirectWeeklyPlan ? ` ${Math.round(directWeeklyTotal)}h were saved across the selected weeks.` : ""}${extendedTo ? ` Target End moved to ${fmtNice(extendedTo)} to cover this assignment.` : ""}`;
        if (mergeTarget) onAssigned(personName); // no optimistic row — the row already exists; the busted cache refetch shows the new total
        else onAssigned(personName, {
          id: personId,
          role,
          bu: businessUnit,
          title,
          // Period mode: report the (possibly widened) WHOLE-assignment window
          // so the optimistic card patch never shrinks the member's span to
          // one period. saveStart/saveEnd equal the form dates otherwise.
          startDate: personOnly ? "" : saveStart,
          endDate: personOnly ? "" : saveEnd,
          pct: resolvedHours,
          // Period mode: also report the edited period's NEW window/hours so
          // the caller can patch that period row in place (slices otherwise
          // stay stale until the post-save refresh lands).
          ...(periodScope ? {
            period: {
              startDate: effStartYmd,
              endDate: effEndYmd,
              hours: showHoursField && lumpHours !== "" ? newPeriodHours : periodScope.periodHours,
            },
          } : {}),
          ...(hasDirectWeeklyPlan ? {
            weeklyHours: directWeeklyEntries.map(({ week, hours }) => ({ week, hours })),
          } : {}),
          // Explicit hours signal, gated EXACTLY like the AllocationHour write
          // above: present only when the Total Hours field was shown AND filled.
          // Without this gate, resolvedHours falls back to prefillPct (a
          // PERCENTAGE) and consumers would misread it as raw hours.
          ...((showHoursField && lumpHours !== "") || hasDirectWeeklyPlan ? { hours: resolvedHours } : {}),
        });
        onClose();
        if (typeof window !== "undefined") {
          const toast = document.createElement("div");
          toast.textContent = `✓ ${msg}`;
          Object.assign(toast.style, {
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            background: "#1B2B38", color: "#6BA539", padding: "12px 24px", borderRadius: "10px",
            fontSize: "14px", fontWeight: "600", zIndex: String(Z.DOM_TOAST), boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            border: "1px solid rgba(107,165,57,0.3)", transition: "opacity 0.3s",
          });
          document.body.appendChild(toast);
          setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 3000);
        }

        // Edit mode: zero out hours for weeks now outside the new [start, end] range,
        // and if the start date moved earlier, auto-redistribute the member's total
        // evenly across the new full range (same math as "Distribute evenly").
        // Guard: run whenever we're editing an existing person (prefillPersonId set),
        // NOT only when prefillAllocationId > 0.  rwiId may be null for OPM members
        // whose RA rows have no RWI linkage, but the inner loop already matches by
        // person GUID so zeroing is safe without a valid rwiId.
        // Fire-and-forget: the form has already closed, so this must not block
        // submit()/setSubmitting — it calls onAssigned again on completion to
        // pull in whatever it wrote, without holding up the initial close.
        // Period mode: when the clicked period's dates AND hours are untouched
        // (org-only edit), skip the hours bookkeeping entirely — a blind
        // even-spread would flatten the period's weekly pace for no reason.
        const periodUntouched = !!periodScope &&
          effStartYmd === periodScope.periodStart.slice(0, 10) &&
          effEndYmd === periodScope.periodEnd.slice(0, 10) &&
          (lumpHours === "" || newPeriodHours === periodScope.periodHours);
        // Replace-all saves need NO client bookkeeping: the server already
        // zeroed every other hours row under the RWI, and a blind re-spread /
        // widen here would just recreate rows the replace removed.
        if (!!prefillPersonId && !periodUntouched && !replaceScope) {
          const newStart = startDate || prefillStartDate || projectStartDate;
          const newEnd   = endDate   || prefillEndDate   || projectEndDate;
          if (newStart && newEnd) {
            (async () => {
              let wroteHours = false;
              try {
                const startMs = new Date(newStart).getTime();
                const endMs   = new Date(newEnd).getTime();
                const rawData = await getFullProjectAllocations(projectId) as {
                  ExistingAllocations?: Record<string, unknown>[];
                  NewAllocations?: Record<string, unknown>[];
                };
                const allRows = [
                  ...(rawData.ExistingAllocations ?? []),
                  ...(rawData.NewAllocations ?? []),
                ];
                const normName = personName.trim().toLowerCase();
                // Weekly rows (ISO Monday key) whose hours we intend to zero.
                // Collected as a week→0 patch map that saveMemberWeeklyHours
                // merges onto FRESH server truth at queue turn, so untouched
                // weeks (and OTHER assignment periods) keep their stored value.
                const toZeroWeeks: string[] = [];
                // Period mode: weekly rows inside the NEW period window —
                // they receive the even re-spread of the period's hours.
                const spreadRows: Record<string, unknown>[] = [];
                const weekKeyOf = (row: Record<string, unknown>) =>
                  String(row.AllocationStartDate ?? "").slice(0, 10);
                const GUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const pidLow = personId.trim().toLowerCase();
                for (const row of allRows) {
                  // Match this person by GUID (case-insensitive) or name — but
                  // a row carrying a DIFFERENT person GUID is a different
                  // person no matter how well the name matches: tenants can
                  // hold duplicate same-name accounts, and pulling the other
                  // account's rows into this save silently re-adds them to the
                  // team (see matchMemberAlloc in lib/phaseHours.ts).
                  const rid = String(row.ResourceId ?? row.ResourceID ?? row.AssignedTo ?? "").trim().toLowerCase();
                  const rname = String(row.AssignedToName ?? "").trim().toLowerCase();
                  if (GUID_SHAPE.test(rid) && GUID_SHAPE.test(pidLow)) {
                    if (rid !== pidLow) continue;
                  } else if (rid !== pidLow && rname !== normName) continue;
                  const rowStartStr = String(row.AllocationStartDate ?? "").slice(0, 10);
                  if (!rowStartStr) continue;
                  const rowStartMs = new Date(rowStartStr).getTime();
                  // When AllocationEndDate is missing, treat the week as start → start+6d
                  const rowEndStr = String(row.AllocationEndDate ?? "").slice(0, 10);
                  const rowEndMs = rowEndStr
                    ? new Date(rowEndStr).getTime()
                    : rowStartMs + 6 * 86_400_000;
                  const outsideNew = rowEndMs < startMs || rowStartMs > endMs;
                  if (periodScope) {
                    // Container rows (span > 1 week, AllocationHour NULL) are
                    // whole-assignment bookkeeping — never touched per-period.
                    if (rowEndMs - rowStartMs > 7 * 86_400_000) continue;
                    // Weeks inside the NEW window collect for the even
                    // re-spread (including current 0h weeks); weeks that held
                    // hours in the OLD window but fell out of the new one get
                    // zeroed. Weeks belonging to OTHER periods stay untouched.
                    if (!outsideNew) { spreadRows.push(row); continue; }
                    const hrs = Number(row.AllocationHour ?? 0);
                    if (hrs <= 0) continue;
                    const oldS = new Date(periodScope.periodStart.slice(0, 10)).getTime();
                    const oldE = new Date(periodScope.periodEnd.slice(0, 10)).getTime();
                    if (!(rowEndMs < oldS || rowStartMs > oldE)) {
                      const wk = weekKeyOf(row);
                      if (wk) toZeroWeeks.push(wk);
                    }
                    continue;
                  }
                  const hrs = Number(row.AllocationHour ?? 0);
                  if (hrs <= 0) continue;
                  if (outsideNew) {
                    const wk = weekKeyOf(row);
                    if (wk) toZeroWeeks.push(wk);
                  }
                }

                // Build ONE partial patch map (zeroed weeks + period re-spread
                // weeks) and merge it onto fresh server truth via
                // saveMemberWeeklyHours (weekPatches). Untouched weeks and the
                // member's OTHER periods keep their stored values because the
                // merge reads authoritative server hours at queue turn. The
                // whole write is serialized under this person's project+GUID
                // key so it can't race a grid/sidebar write for the same
                // member. Intended zeroing history is preserved: a week set to
                // 0 is posted as 0 (never dropped from the map).
                const editPatches: Record<string, number> = {};
                for (const wk of toZeroWeeks) editPatches[wk] = 0;

                // Period mode: even-spread the period's hours across the weeks
                // now inside its (possibly moved) window. Exact total — the
                // last week absorbs the rounding remainder.
                if (periodScope && spreadRows.length > 0) {
                  const total = showHoursField && lumpHours !== "" ? newPeriodHours : periodScope.periodHours;
                  const n = spreadRows.length;
                  const per = Math.floor((total / n) * 100) / 100;
                  const last = Math.round((total - per * (n - 1)) * 100) / 100;
                  spreadRows.forEach((row, ix) => {
                    const wk = weekKeyOf(row);
                    if (wk) editPatches[wk] = ix === n - 1 ? last : per;
                  });
                }

                if (Object.keys(editPatches).length > 0) {
                  await saveMemberWeeklyHours({
                    projectId,
                    memberId: personId,
                    memberName: personName,
                    memberRole: role,
                    weekPatches: editPatches,
                  });
                  wroteHours = true;
                }

                // Backward extension: the new start date is EARLIER than before,
                // so brand-new leading weeks now exist in the grid (shown at 0h,
                // since nothing ever set them). Rather than leaving them stuck
                // at 0 until the user remembers to click "Distribute evenly" or
                // reapply Settings, automatically rebalance the member's
                // existing total evenly across the FULL new date range —
                // identical math to PhaseBreakdown's "Distribute evenly" button,
                // via the shared buildEvenSpreadAllocations helper. Total hours
                // never change, only the weekly pace. Forward-only extensions
                // (start unchanged/later) are left alone — their trailing weeks
                // already zero-fill correctly via the reapply/cap logic.
                // Skipped in period mode — the whole-range even spread would
                // wreck the member's OTHER periods; the scoped spread above
                // already handled this period's weeks.
                const oldStartMs = prefillStartDate ? new Date(prefillStartDate).getTime() : null;
                if (!periodScope && oldStartMs != null && startMs < oldStartMs) {
                  try {
                    const freshData = await getFullProjectAllocations(projectId) as AllocationsResponse;
                    const spreadPerson = { name: personName, resourceId: personId };
                    const memberForSpread = matchMemberAlloc(freshData, { ...spreadPerson, pct: typeof prefillPct === "number" ? prefillPct : 0 }, projectId);
                    if (memberForSpread) {
                      const schedRes = await getTaskData(projectId);
                      const schedulePhasesRaw = Array.isArray(schedRes) ? schedRes : [];
                      const phaseHours = derivePhaseHours(freshData, schedulePhasesRaw, spreadPerson);
                      const evenAllocations = buildEvenSpreadAllocations(phaseHours, memberForSpread);
                      if (evenAllocations) {
                        // Even-spread covers the visible new range. Apply those
                        // weeks as patches so authoritative weeks outside that
                        // range cannot be deleted by a concurrent editor.
                        const evenWeekMap: Record<string, number> = {};
                        for (const alloc of evenAllocations) {
                          const wk = String((alloc as Record<string, unknown>).AllocationStartDate ?? "").slice(0, 10);
                          if (wk) evenWeekMap[wk] = Number((alloc as Record<string, unknown>).AllocationHour ?? 0);
                        }
                        if (Object.keys(evenWeekMap).length > 0) {
                          await saveMemberWeeklyHours({
                            projectId,
                            memberId: personId,
                            memberName: personName,
                            memberRole: role,
                            weekPatches: evenWeekMap,
                          });
                          wroteHours = true;
                        }
                      }
                    }
                  } catch (spreadErr) {
                    console.warn("[EditAssignment] backward-extension auto-redistribute failed (non-fatal):", spreadErr);
                  }
                }
              } catch (zeroErr) {
                console.warn("[EditAssignment] hours zeroing failed (non-fatal):", zeroErr);
              } finally {
                if (wroteHours) {
                  bustCache();
                  onAssigned(personName);
                }
              }
            })();
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Direct-merge marker must never leak into the next submit.
      mergeTargetRef.current = null;
      setSubmitting(false);
    }
  }

  function pickerData(): { id: string; label: string; sub?: string; workloadLabel?: string; disabled?: boolean; alreadyOnTeam?: boolean; teamHours?: number; availLabel?: string; availTone?: "free" | "tight" | "busy" }[] {
    if (picker === "businessUnit") return buEntities.map((b) => ({ id: b.id, label: b.label }));
    if (picker === "bu") return filteredDivisions.map((b) => ({ id: b.id, label: b.label }));
    if (picker === "department") return filteredDepartments.map((d) => ({ id: d.id, label: d.name }));
    if (picker === "role") return roleOptions.map((r) => ({ id: r, label: r }));
    if (picker === "title") return titleOptions.map((t) => ({ id: t.id, label: t.label }));
    if (picker === "person") {
      // Find names that appear more than once in the visible list so we can
      // append an email/username disambiguator for those people. This mirrors
      // the same "duplicate same-name accounts" check the Resources admin
      // banner surfaces, but scoped to exactly the people currently visible in
      // this picker so there are no false positives from filtered-out rows.
      const nameCounts = new Map<string, number>();
      for (const p of displayPeople) {
        const n = p.name.toLowerCase().trim();
        if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
      }
      const dupNameSet = new Set<string>(
        [...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n)
      );
      return displayPeople.map((p) => {
        // For duplicate-name people, the disambiguator (email or username) comes
        // FIRST so the picker row immediately tells accounts apart. Non-duplicate
        // people keep the original order: title · username · date-window.
        const isDup = dupNameSet.has(p.name.toLowerCase().trim());
        // Prefer the explicit email field; fall back to username only when
        // email is absent (username is a separate DB column and may not be
        // an email address on all tenants).
        const disambig = p.email || p.username || "";
        // In the weekly planner, Role is the explicit selection and must be
        // reflected in each result. Staff profiles may carry an old/general
        // JobProfile (e.g. "Assistant Project Manager") while their actual
        // role is Architectural Designer; showing that stale title makes the
        // picker look out of sync even when matching correctly.
        const selectedRoleMatches = role.trim() ? roleEquivalence(role.trim()) : null;
        let sub = isWeeklyPlanner && selectedRoleMatches?.(p.role) ? p.role : p.title;
        if (isDup && disambig) {
          // Lead with the disambiguating email; append title after if present.
          sub = disambig + (sub ? `  ·  ${sub}` : "");
        } else if (!isDup && p.username) {
          sub = sub ? `${sub}  ·  ${p.username}` : p.username;
        }
        if (p.availStart && p.availEnd) {
          const fmtShort = (d: string) => { const dt = new Date(d); return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }); };
          const s = fmtShort(p.availStart); const e = fmtShort(p.availEnd);
          if (s && e) sub = sub ? `${sub}  ·  ${s} – ${e}` : `${s} – ${e}`;
        }
        // The direct weekly planner deliberately keeps cross-BU people
        // selectable. Surface their organization here so the user can make an
        // informed pick before the explicit Add-to-Team confirmation.
        if (isWeeklyPlanner) {
          const org = [p.division, p.department].map((value) => value.trim()).filter(Boolean).join(" · ");
          if (org) sub = sub ? `${sub}  ·  ${org}` : org;
        }
        // alreadyOnTeam = ANY existing allocation for this person on the
        // project (used for the red visual flag). disabled keeps the stricter
        // exact-dupe check (same person + BU + Role + Title) that blocks
        // submit — the user can still add the same person with a different
        // role/title combination.
        const mine = existingAllocations.filter((a) => norm(a.personId) === norm(p.id));
        const alreadyOnTeam = mine.length > 0;
        // Sum of budgeted hours across ALL of this person's allocation rows on
        // the project — shown in the badge so the user sees how much work the
        // person already carries here (0/absent hours → plain badge).
        const teamHours = mine.reduce((s, a) => s + (Number(a.hours) || 0), 0);
        // Free-capacity badge — ONLY when the availability feed loaded. A person
        // absent from a loaded index has no allocation rows in the window.
        let availLabel: string | undefined;
        let availTone: "free" | "tight" | "busy" | undefined;
        let workloadLabel: string | undefined;
        if (availIdx) {
          const availability = availEntryFor(p);
          const b = availabilityBadge(availability);
          availLabel = b.label; availTone = b.tone;
          const projects = availability?.projectCount ?? 0;
          const avgHours = Math.round(availability?.bookedHrsPerWk ?? 0);
          workloadLabel = `${projects} ${projects === 1 ? "project" : "projects"} · Avg ${avgHours}h/wk assigned`;
        }
        return { id: p.id, label: p.name, sub, workloadLabel, disabled: isExactDupe(p.id) || alreadyOnTeam, alreadyOnTeam, teamHours, availLabel, availTone };
      });
    }
    return [];
  }
  function pickerTitle() {
    if (picker === "businessUnit") return "Select Business Unit";
    if (picker === "bu") return "Select Division";
    if (picker === "department") return "Select Department";
    if (picker === "role") return "Select Role";
    if (picker === "title") return "Select Title";
    if (picker === "person") return "Assign To";
    return "";
  }
  function applyPick(id: string, label: string) {
    // Parent organization changes still clear stale downstream values when no
    // person has been chosen. Once a person is selected, Role and Person are
    // independent user choices: changing Role must not clear that person.
    // This supports both Role → Person and Person → Role, including an
    // intentional role override for the same person.
    const keepPicks = !prefillPersonId && !!personId;
    if (picker === "businessUnit") {
      setBusinessUnit(id); setBU(""); setDept(""); setDeptName("");
      if (!keepPicks) { setRole(""); setTitle(""); setTitleId(""); setPersonId(""); setPersonName(""); }
    }
    else if (picker === "bu") {
      setBU(id); setDept(""); setDeptName("");
      if (!keepPicks) { setRole(""); setTitle(""); setTitleId(""); setPersonId(""); setPersonName(""); }
    }
    else if (picker === "department") { setDept(id); setDeptName(label); setTitle(""); setTitleId(""); setRole(""); setPersonId(""); setPersonName(""); }
    else if (picker === "title") {
      const opt = titleOptions.find((o) => o.id === id);
      setTitle(opt?.name || label);
      // Only carry a real catalogue ID through to the write; heuristic
      // fallback options use the name as their id and must not be sent.
      setTitleId(apiTitles.some((t) => t.id === id) ? id : "");
      // Explicit pick — profile/suggestion auto-fills must not overwrite it.
      setTitleManual(true);
      // A title change breaks the association with either a detailed slot
      // selection or a shortcut-inferred slot. Inferred IDs must never revive.
      if (pickedSuggestion >= 0 || inferredConsumeRaIds) {
        setPickedSuggestion(-1);
        setConsumeIds(inferredConsumeRaIds ? null : (consumeRaIds && consumeRaIds.length > 0 ? consumeRaIds : null));
      }
      // Role options come from the Division (Roles-by-BU), NOT the title, so
      // an already-picked Role stays valid — do not clear it here. The grid
      // add-row shows ROLE before TITLE, so wiping it silently lost picks.
      setPersonId(""); setPersonName("");
    }
    else if (picker === "role") {
      // Keep the selected person when the user intentionally overrides their
      // inferred role. With no person selected this is the normal first step
      // and the person picker will remain role-filtered.
      const keepSelectedPerson = !!personId;
      setRole(label);
      if (!keepSelectedPerson) { setPersonId(""); setPersonName(""); }
      if (isWeeklyPlanner) {
        const matchesRole = roleEquivalence(label);
        const matchingTitle = titleOptions.find((option) => matchesRole(option.name));
        const syncedTitle = matchingTitle?.name || label;
        setTitle(syncedTitle);
        setTitleId(matchingTitle && apiTitles.some((candidate) => candidate.id === matchingTitle.id) ? matchingTitle.id : "");
        setTitleManual(false);
      }
      // Manually changing the Role abandons a previously-clicked suggestion.
      // Shortcut-inferred IDs are not a selected slot, so clear them too.
      if (pickedSuggestion >= 0 || inferredConsumeRaIds) {
        setPickedSuggestion(-1);
        setConsumeIds(inferredConsumeRaIds ? null : (consumeRaIds && consumeRaIds.length > 0 ? consumeRaIds : null));
      }
    }
    else if (picker === "person") {
      const p = displayPeople.find((pp) => pp.id === id) || people.find((pp) => pp.id === id);
      if (p) {
        // A person change can infer a new role/title. Never carry a
        // shortcut-derived open-slot ID list into that new assignment.
        if (pickedSuggestion >= 0 || inferredConsumeRaIds) {
          setPickedSuggestion(-1);
          setConsumeIds(inferredConsumeRaIds ? null : (consumeRaIds && consumeRaIds.length > 0 ? consumeRaIds : null));
        }
        setPersonId(p.id); setPersonName(p.name);
        // Person-first is valid. Use the person's authoritative role field
        // when present and fall back to the job title only for older staff
        // rows that do not carry a separate role. The user can immediately
        // open Role and override this value without losing the person.
        const inferredRole = (p.role || p.title || "").trim();
        if (inferredRole) {
          setRole(inferredRole);
          if (isWeeklyPlanner) {
            setTitle(inferredRole);
            setTitleId("");
            setTitleManual(false);
          }
        }
        // Title from the person's staff profile — unless the user explicitly
        // picked a catalogue title. Profile titles flow by NAME only (titleId
        // cleared — catalogue-picks-only invariant).
        if (!isWeeklyPlanner && p.title && !titleManual) { setTitle(p.title); setTitleId(""); }
        // Add mode: auto-fill + LOCK the org section (BU/Division/Dept) from
        // the person's staff profile. Only when the profile's division name
        // resolves to a REAL division id — never fabricate one; on a miss the
        // org stays unlocked and the user picks the Division manually.
        if (!prefillPersonId) {
          // Division: exact ID from the staff profile wins; the profile's
          // division NAME is the fallback. Never fabricate an id from a name.
          const m =
            (p.divisionId ? bus.find((b) => b.id === p.divisionId) : undefined) ??
            (p.division ? matchDivisionByLabel(p.division) : undefined);
          if (m) {
            setBU(m.id);
            setBusinessUnit(m.buId || "");
            // Department: exact ID first, then name (scoped to the matched
            // division so a same-named dept under another division can't win).
            const dn = (p.department || "").trim().toLowerCase();
            const dm =
              (p.departmentId ? allDepartments.find((d) => d.id === p.departmentId) : undefined) ??
              (dn ? allDepartments.find((d) => d.name.toLowerCase() === dn && (!d.divisionId || d.divisionId === m.id)) : undefined);
            if (dm) { setDept(dm.id); setDeptName(dm.name); }
            else { setDept(""); setDeptName(""); }
            setOrgLocked(true);
            setBuMismatch(null); setBuMismatchPromptOpen(false); setBuMismatchError("");
          } else {
            // BU-mismatch guard: `bus` only lists the PROJECT's divisions when
            // the project has BUs, so a miss here may just mean the person
            // belongs to a different BU. Resolve their home division against
            // the FULL catalogue — a hit that is not one of the project's
            // divisions raises the blocking "add BU to the project first"
            // popup instead of failing silently.
            const home =
              (p.divisionId ? divCatalog.find((b) => b.id === p.divisionId) : undefined) ??
              (p.division ? matchDivisionIn(divCatalog, p.division) : undefined);
            if (home && projDivIds.length > 0 && !projDivIds.includes(home.id)) {
              setBuMismatch({ divisionId: home.id, divisionLabel: home.label, buId: home.buId || "", personName: p.name });
              setBuMismatchPromptOpen(false);
              setBuMismatchError("");
            } else {
              setBuMismatch(null); setBuMismatchPromptOpen(false); setBuMismatchError("");
            }
            // Division-name miss: never let a PREVIOUS person's auto-filled
            // org ride along under the new pick. Clear when the org was
            // auto-locked, OR when in Change Resource mode where the org was
            // pre-seeded from the OUTGOING member — it must not inherit to
            // the newly-selected person if their division isn't in the list.
            if (orgLocked || changeFrom) { setBU(""); setBusinessUnit(""); setDept(""); setDeptName(""); }
            setOrgLocked(false);
          }
        }
      }
    }
    setPicker(null); setSearch("");
  }

  return {
    // status
    loading, submitting, error, setError, assignmentSaved,
    // cascade state + setters used by consumers
    buEntities, businessUnit, bus, bu, dept, deptName, filteredDepartments,
    role, title, personId, personName,
    startDate, setStartDate, endDate, setEndDate,
    lumpHours, setLumpHours,
    picker, setPicker, search, setSearch,
    showAllPeople, setShowAllPeople,
    // derived
    displayPeople, filteredPeople, usingOfficialPeople,
    selectedPerson: people.find((person) => norm(person.id) === norm(personId)),
    // "Related" match count + total roster size — consumers render the
    // "<Role> not available — show all N people" notice from these.
    relatedPeopleCount, peopleCount: people.length,
    dupeOnSubmit, canSubmit,
    hasScheduleWindow, schedStartYmd, schedEndYmd, schedWindowLabel, fmtNice,
    // role-first flow
    suggestions, pickedSuggestion, applySuggestion, openRoleSelectionRequired,
    orgLocked, unlockOrg,
    // BU-mismatch popup opens only after Add to Team confirms the pending
    // cross-BU selection.
    buMismatch: getCrossBuPromptMode(!!buMismatch, buMismatchPromptOpen) === "open" ? buMismatch : null,
    addingBu, buMismatchError, addBuToProject, dismissBuMismatch, projectBuLabels,
    availLoading, availReady: !!availIdx,
    // actions
    submit, pickerData, pickerTitle, applyPick,
  };
}
