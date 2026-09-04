import { AppTextInput } from "@/components/AppTextInput";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, View, Text, Pressable, TextInput, FlatList, ActivityIndicator, ScrollView, Alert } from "react-native";
import { Feather } from "@/lib/icons";
import { Colors } from "@/constants/colors";
import { withSuggestedTitleNames } from "@/lib/standardTitles";
import { roleEquivalence } from "@workspace/role-match";
import { getDivisions, getProjectDivisionRoles, getUserList, assignResource, getJobTitles, type JobTitleRow,
  getRolesByBU, getJobTitlesByRole, getResourcesByJobTitle, getLiveTaskData, getEffectiveDisplayModeFor,
  type AssignRole, type AssignTitle, type AssignResource } from "@/lib/api";
import { globalAlert } from "@/lib/inAppAlert";
import {
  decideAssignDates, resolveAssignScheduleWindow,
  formatScheduleWindowLabel, scheduleWindowRejection, SCHED_WIN_LOADING, type ScheduleWindow,
} from "@/lib/scheduleWindow";
import { DisabledStaffControl } from "@/components/DisabledStaffControl";

type Picker = "bu" | "role" | "title" | "person" | null;

interface RoleRow { Name?: string; RoleName?: string; TypeName?: string; Title?: string; JobTitle?: string;
  DivisionShortName?: string; ShortName?: string; BU?: string; BusinessUnit?: string;
  DivisionId?: number; DivisionID?: number;
  [k: string]: unknown;
}

interface PersonRow {
  id: string; name: string; title: string;
  /** Raw role text from the staff profile — second matching signal for the
   *  "related people" filter (some tenants keep the real job title here). */
  role: string;
  division: string;
  /** Division ID from the staff profile — exact signal for the BU auto-fill
   *  on person pick; the division NAME is the fallback. */
  divisionId: string;
  availStart: string; availEnd: string;
  enabled?: boolean;
  tenantId?: string;
}

export interface ExistingAllocationRef {
  personId: string; bu: string; role: string; title: string;
  /** Total budgeted hours (EAC) for this allocation row — used by the person
   *  picker to show "On team · Nh" instead of a bare "Already on team". */
  hours?: number;
  /** Container allocation row ID (RWI) + window — lets the add flow merge a
   *  duplicate person+role add straight into the existing assignment (same
   *  edit-path save as the web app; no second row is ever created). Callers
   *  that can't supply these simply don't get the merge — the duplicate add
   *  stops with a pointer to editing the existing assignment instead. */
  allocationId?: number | null;
  startDate?: string;
  endDate?: string;
}

export function AddTeamMemberModal({
  visible, onClose, projectId, projectName, projectStartDate, projectEndDate, existingAllocations, onAssigned,
  prefillBuShort, prefillRole, prefillTitle, prefillStartDate, prefillEndDate, prefillPct, prefillAllocationId, prefillTypeGuid, prefillGroupId,
  canManageStaff = false, module,
}: {
  visible: boolean; onClose: () => void;
  projectId: string; projectName: string;
  /** Record module ("PMM" / "OPM" / "LEM") — picks which tenant display-mode
   *  setting governs the schedule window. Missing ⇒ project-side setting. */
  module?: string;
  projectStartDate: string; projectEndDate: string;
  existingAllocations: ExistingAllocationRef[];
  onAssigned: (personName: string, resourceId?: string) => void;
  prefillBuShort?: string;
  prefillRole?: string;
  prefillTitle?: string;
  prefillStartDate?: string;
  prefillEndDate?: string;
  prefillPct?: number;
  prefillAllocationId?: number;
  prefillTypeGuid?: string;
  prefillGroupId?: string;
  canManageStaff?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [schedWin, setSchedWin] = useState<ScheduleWindow>(SCHED_WIN_LOADING);
  const [bus, setBus] = useState<{ id: string; label: string }[]>([]);
  const [roleRows, setRoleRows] = useState<RoleRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [bu, setBU] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [personId, setPersonId] = useState<string>("");
  const [personName, setPersonName] = useState<string>("");
  const [picker, setPicker] = useState<Picker>(null);
  const [search, setSearch] = useState("");
  const [showAllPeople, setShowAllPeople] = useState(false);
  // Tenant-wide JobTitle catalogue (May 2026 GetJobTitle API). Populated
  // alongside divisions/roles/users in the modal-open effect below.
  const [jobTitleCatalog, setJobTitleCatalog] = useState<JobTitleRow[]>([]);
  // Official client cascade (BU → Role → Title → Person). Each falls back to
  // the heuristic derivation below when it comes back empty (e.g. RM ONE down).
  const [apiRoles, setApiRoles] = useState<AssignRole[]>([]);
  const [apiTitles, setApiTitles] = useState<AssignTitle[]>([]);
  const [apiResources, setApiResources] = useState<AssignResource[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [titlesLoading, setTitlesLoading] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWarning(null);
    setLoading(true);
    Promise.all([
      getDivisions().catch(() => []),
      getProjectDivisionRoles(projectId).catch(() => []),
      getUserList().catch((e) => { console.warn("[AddMember] user-list failed:", String(e)); return []; }),
      getJobTitles().catch((e) => { console.warn("[AddMember] job-titles failed:", String(e)); return [] as JobTitleRow[]; }),
    ]).then(([divs, projRoles, users, jobTitles]) => {
      setJobTitleCatalog(Array.isArray(jobTitles) ? jobTitles : []);
      const divArr: any[] = Array.isArray(divs) ? divs : [];
      const projArr: any[] = Array.isArray(projRoles) ? projRoles : [];
      // Authoritative division index so BU labels come from the division, not a
      // row's job title.
      const divsById = new Map<string, { short: string; title: string }>();
      for (const d of divArr) {
        const id = String(d.ID ?? d.Id ?? "");
        if (!id) continue;
        divsById.set(id, { short: String(d.ShortName ?? "").trim(), title: String(d.Title ?? "").trim() });
      }
      const buLabel = (short: string, title: string) =>
        short ? (title && title !== short ? `${short} - ${title}` : short) : title;
      // BU dropdown: the project's BUs first — ONE entry per division (deduped),
      // primary-first (proxy order). Only when the project has no BU assigned do
      // we fall back to listing every division.
      const projBUs: { id: string; label: string }[] = [];
      const seenBu = new Set<string>();
      for (const r of projArr) {
        const id = String(r.DivisionIDLookup ?? r.DivisionID ?? "");
        if (!id || seenBu.has(id)) continue;
        const meta = divsById.get(id);
        const short = (meta?.short || String(r.DivisionShortName ?? "")).trim();
        const title = (meta?.title || "").trim();
        const label = buLabel(short, title) || String(r.DivisionName ?? "").trim();
        if (!label) continue;
        seenBu.add(id);
        projBUs.push({ id, label });
      }
      const allBUs = divArr.map((d) => ({
        id: String(d.ID ?? d.Id ?? ""),
        label: buLabel(String(d.ShortName ?? "").trim(), String(d.Title ?? "").trim()),
      })).filter(b => b.id && b.label);
      const buList = projBUs.length ? projBUs : allBUs;
      setBus(buList);
      // Project role rows (used to enrich Title options if available)
      setRoleRows(Array.isArray(projRoles) ? (projRoles as RoleRow[]) : []);
      // People: use full user list (683 users) with proper JobProfile titles
      const userArr = Array.isArray(users) ? users : [];
      const ppl: PersonRow[] = [];
      const seen = new Set<string>();
      let droppedDeleted = 0, droppedGuid = 0, droppedNoName = 0;
      for (const u of userArr) {
        const id = String((u as any).Id ?? "").toLowerCase();
        const name = String((u as any).Name ?? "").trim();
        const deleted = (u as any).Deleted === true;
        if (!id || !name) { droppedNoName++; continue; }
        if (deleted) { droppedDeleted++; continue; }
        if (/^[0-9a-f]{8}-/.test(name)) { droppedGuid++; continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        ppl.push({ id, name, title: String((u as any).JobProfile ?? "").trim(), role: String((u as any).Role ?? "").trim(), division: String((u as any).DivisionName ?? (u as any).Division ?? (u as any).Department ?? (u as any).BusinessUnit ?? "").trim(), divisionId: String((u as any).DivisionId ?? "").trim(), availStart: String((u as any).UGITStartDate ?? "").trim(), availEnd: String((u as any).UGITEndDate ?? "").trim(), enabled: (u as any).enabled, tenantId: (u as any).tenantId });
      }
      ppl.sort((a, b) => a.name.localeCompare(b.name));
      const purc = ppl.filter(p => /purc/i.test(p.name)).map(p => p.name);
      console.log("[AddMember] BUs:", buList.length, "(project:", projBUs.length, "), users:", ppl.length, "raw:", userArr.length, "dropped(noname/deleted/guid):", droppedNoName, droppedDeleted, droppedGuid, "purc-matches:", purc);
      setPeople(ppl);
      // Apply prefill (open-slot Assign flow) if provided; otherwise
      // auto-pre-select the project's first BU for convenience.
      if (prefillBuShort) {
        const pre = String(prefillBuShort).trim().toLowerCase();
        const match = buList.find(b => {
          const parts = b.label.split(" - ");
          const short = parts[0].trim().toLowerCase();
          const full = parts.slice(1).join(" - ").trim().toLowerCase();
          return short === pre || full === pre || b.label.toLowerCase() === pre;
        });
        if (match) setBU(match.id);
        else if (projBUs[0] && !bu) setBU(projBUs[0].id);
      } else if (projBUs[0] && !bu) {
        setBU(projBUs[0].id);
      }
      if (prefillRole) setRole(prefillRole);
      if (prefillTitle) setTitle(prefillTitle);
    }).finally(() => setLoading(false));
  }, [visible, projectId]);

  useEffect(() => { if (!visible) { setBU(""); setRole(""); setTitle(""); setPersonId(""); setPersonName(""); setPicker(null); setSearch(""); setShowAllPeople(false); setSchedWin(SCHED_WIN_LOADING); } }, [visible]);

  // LIVE phase-schedule window (web AddTeamMemberModal parity). The uncached
  // /task-data fetch is authoritative — a schedule created or reshaped after
  // the caller's record payload loaded still wins over stale props. This form
  // shows no date inputs, so the window is applied by silently keeping the
  // hidden dates inside it at submit (web's hidden-date rule) — never by
  // blocking a save over dates the user can't see. Submit waits only while
  // the window is unknown ("loading"); on fetch failure ("error") a notice
  // appears and the submit-time re-resolve FAILS CLOSED (explicit error, no
  // write) — the server gate only backstops "full" mode, so an unknown mode
  // must never let dates pass through.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setSchedWin(SCHED_WIN_LOADING);
    (async () => {
      try {
        const win = await resolveAssignScheduleWindow({
          getMode: () => getEffectiveDisplayModeFor(module),
          fetchLive: () => getLiveTaskData(projectId),
        });
        if (!cancelled) setSchedWin(win);
      } catch {
        if (!cancelled) setSchedWin({ state: "error", start: "", end: "" });
      }
    })();
    return () => { cancelled = true; };
  }, [visible, projectId, module]);

  // Each new Role/Title selection starts back in "related" mode. When nothing
  // matches, the picker shows an explicit "not available — show all" notice
  // instead of silently listing everyone.
  useEffect(() => { setShowAllPeople(false); }, [role, title]);

  const buShort = useMemo(() => {
    const m = bus.find(b => b.id === bu); if (!m) return "";
    return m.label.split(" - ")[0];
  }, [bu, bus]);

  // OFFICIAL cascade #2 — Roles for the chosen BU.
  useEffect(() => {
    if (!visible || !bu) { setApiRoles([]); return; }
    let cancelled = false;
    setRolesLoading(true);
    getRolesByBU(bu)
      .then(rows => { if (!cancelled) setApiRoles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiRoles([]); })
      .finally(() => { if (!cancelled) setRolesLoading(false); });
    return () => { cancelled = true; };
  }, [visible, bu]);

  const selectedRoleId = useMemo(() => apiRoles.find(r => r.name === role)?.id || "", [apiRoles, role]);

  // OFFICIAL cascade #3 — Job Titles for the chosen BU + Role.
  useEffect(() => {
    if (!visible || !bu || !selectedRoleId) { setApiTitles([]); return; }
    let cancelled = false;
    setTitlesLoading(true);
    getJobTitlesByRole(bu, selectedRoleId)
      .then(rows => { if (!cancelled) setApiTitles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiTitles([]); })
      .finally(() => { if (!cancelled) setTitlesLoading(false); });
    return () => { cancelled = true; };
  }, [visible, bu, selectedRoleId]);

  const selectedTitleId = useMemo(() => apiTitles.find(t => t.name === title)?.id || "", [apiTitles, title]);

  // OFFICIAL cascade #4 — People for the chosen Job Title.
  useEffect(() => {
    if (!visible || !selectedTitleId) { setApiResources([]); return; }
    let cancelled = false;
    setResourcesLoading(true);
    getResourcesByJobTitle(selectedTitleId)
      .then(rows => { if (!cancelled) setApiResources(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiResources([]); })
      .finally(() => { if (!cancelled) setResourcesLoading(false); });
    return () => { cancelled = true; };
  }, [visible, selectedTitleId]);

  const filteredRoles = useMemo(() => {
    if (!buShort) return roleRows;
    const bn = buShort.toLowerCase();
    return roleRows.filter(r => {
      const rb = String(r.DivisionShortName ?? r.ShortName ?? r.BU ?? r.BusinessUnit ?? "").toLowerCase();
      return !rb || rb === bn;
    });
  }, [roleRows, buShort]);

  const roleOptions = useMemo(() => {
    // Prefer the client's official Roles-by-BU API; fall back to heuristic.
    if (apiRoles.length > 0) {
      return Array.from(new Set(apiRoles.map(r => r.name).filter(Boolean))).sort();
    }
    const set = new Set<string>();
    for (const r of filteredRoles) {
      const v = String(r.Name ?? r.RoleName ?? r.TypeName ?? "").trim();
      if (v) set.add(v);
    }
    if (set.size === 0) {
      // Fallback: derive roles from the workforce roster (job titles of all people)
      for (const p of people) { if (p.title) set.add(p.title); }
    }
    return Array.from(set).sort();
  }, [apiRoles, filteredRoles, people]);

  // Title catalogue from /api/common/GetJobTitle (May 2026). Filtered by
  // the selected role when possible, with a graceful fallback to the
  // legacy derivation from filteredRoles/roleRows/people if the catalogue
  // is empty (e.g. tenant without GetJobTitle access).
  const baseTitleOptions = useMemo(() => {
    // Prefer the client's official Job-Titles-by-Role API; fall back below.
    if (apiTitles.length > 0) {
      return Array.from(new Set(apiTitles.map(t => t.name).filter(Boolean))).sort();
    }
    const rn = role.trim().toLowerCase();
    const set = new Set<string>();
    if (jobTitleCatalog.length > 0) {
      for (const jt of jobTitleCatalog) {
        if (rn) {
          const jtRole = String(jt.RoleName ?? "").trim().toLowerCase();
          if (jtRole && jtRole !== rn) continue;
        }
        const v = String(jt.JobTitleName ?? jt.Title ?? "").trim();
        if (v) set.add(v);
      }
      if (set.size > 0) return Array.from(set).sort();
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
    return Array.from(set).sort();
  }, [jobTitleCatalog, filteredRoles, roleRows, people, role]);

  // Always offer the curated standard titles too — the save carries the
  // title by NAME (JobTitleName), so no catalogue id is needed.
  const titleOptions = useMemo(() => withSuggestedTitleNames(baseTitleOptions), [baseTitleOptions]);

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
      if (!r && !t) return true;
      const hit = (text: string) => !!text && (roleEq(text) || titleEq(text));
      return hit(p.title) || hit(p.role);
    };
    const searchFiltered = people.filter(searchOk);
    const related = searchFiltered.filter(relatedOk);
    return {
      list: showAllPeople ? searchFiltered : related,
      related,
      // Count related people BEFORE the search filter: the "not available"
      // notice is about the Role/Title having no matching staff, not about
      // the current search text. A search that happens to exclude every
      // related person must NOT flip the picker into the notice state.
      relatedCount: people.filter(relatedOk).length,
    };
  }, [people, search, role, title, showAllPeople]);
  const filteredPeople = filteredPeopleInfo.list;
  const relatedPeopleCount = filteredPeopleInfo.relatedCount;

  // OFFICIAL people for the chosen Job Title, enriched with availability dates
  // from the roster (the resources API doesn't return those). When present we
  // show exactly these people; otherwise we fall back to the heuristic list.
  const officialPeople = useMemo<PersonRow[]>(() => {
    if (apiResources.length === 0) return [];
    const byId = new Map(people.map(p => [p.id, p]));
    return apiResources.map(r => {
      const m = byId.get(r.id);
      return {
        id: r.id,
        name: r.name || m?.name || r.id,
        title: r.title || m?.title || title,
        role: m?.role || "",
        division: m?.division || buShort,
        divisionId: m?.divisionId || "",
        availStart: m?.availStart || "",
        availEnd: m?.availEnd || "",
        enabled: r.enabled ?? m?.enabled,
        tenantId: r.tenantId ?? m?.tenantId,
      };
    });
  }, [apiResources, people, title, buShort]);

  const usingOfficialPeople = officialPeople.length > 0;
  // Official title-ID people first, then any SAME-role people the catalog
  // lookup missed — both paths honor the same strict equivalence contract.
  const displayPeople = useMemo(() => {
    if (!usingOfficialPeople) return filteredPeopleInfo.list;
    const seen = new Set(officialPeople.map(p => p.id.toLowerCase()));
    const extras = filteredPeopleInfo.related.filter(p => !seen.has(p.id.toLowerCase()));
    return extras.length ? [...officialPeople, ...extras] : officialPeople;
  }, [usingOfficialPeople, officialPeople, filteredPeopleInfo]);

  const norm = (s: string) => (s || "").trim().toLowerCase();
  const isExactDupe = (pid: string) => {
    if (!buShort || !role) return false;
    return existingAllocations.some(a =>
      norm(a.personId) === norm(pid) &&
      norm(a.bu) === norm(buShort) &&
      norm(a.role) === norm(role) &&
      norm(a.title) === norm(title)
    );
  };
  const dupeOnSubmit = !!personId && isExactDupe(personId);
  // schedWin "loading" gate: the assign payload carries hidden dates, so the
  // save waits until the schedule window is known (ready/none/off/error) —
  // otherwise a fast submit could race the fetch and write unclamped dates.
  const canSubmit = canManageStaff && !!bu && !!role && !!personId && !submitting && !dupeOnSubmit && schedWin.state !== "loading";

  async function submit() {
    if (!canManageStaff) {
      globalAlert("View only", "You do not have permission to manage project staff.");
      return;
    }
    if (!canSubmit) return;
    // ── ADD-mode duplicate → DIRECT merge (same product rule as web, Aug 2026) ──
    // isExactDupe hard-blocks only a full person+BU+role+title match — a same
    // person + same role add with a different title would sail through and
    // create a visually identical second row. A person+role match NEVER
    // creates a second row: the entered hours (open-slot pct prefill —
    // PctAllocation stores raw hours) are added straight into the existing
    // assignment via the same edit-path save (ID = existing allocation, union
    // window, existing + entered hours, keep the row's title). When there's
    // nothing addable (no hours, or the match carries no editable allocation
    // id), submit stops with a pointer to editing the existing assignment.
    // Open-slot fills that already target an allocation (prefillAllocationId)
    // skip this — the row identity is explicit there.
    const enteredHours = typeof prefillPct === "number" && prefillPct > 0 ? prefillPct : 0;
    let mergeTarget: ExistingAllocationRef | null = null;
    if (!prefillAllocationId) {
      const matches = existingAllocations.filter(a =>
        norm(a.personId) === norm(personId) && norm(a.role) === norm(role));
      if (matches.length > 0) {
        const es = (prefillStartDate || projectStartDate || "").slice(0, 10);
        const ee = (prefillEndDate || projectEndDate || "").slice(0, 10);
        // Merge target = the match whose window overlaps the entered dates
        // most (no overlap still merges: the union window covers both periods).
        const overlapDays = (a: ExistingAllocationRef) => {
          const s = (a.startDate || "").slice(0, 10), e = (a.endDate || "").slice(0, 10);
          if (!s || !e || !es || !ee) return -1;
          const lo = es > s ? es : s, hi = ee < e ? ee : e;
          return lo <= hi ? (new Date(hi).getTime() - new Date(lo).getTime()) / 86400000 : -1;
        };
        const mergeable = matches.filter(a => a.allocationId != null && a.startDate && a.endDate);
        const best = mergeable.length
          ? mergeable.reduce((x, y) => (overlapDays(y) > overlapDays(x) ? y : x))
          : null;
        if (best && enteredHours > 0) {
          mergeTarget = best;
        } else {
          // Nothing addable — never create a lookalike second row.
          setWarning(`${personName || "This person"} is already on this team as ${role} — edit that assignment from the team list to change their hours or dates.`);
          return;
        }
      }
    }
    setSubmitting(true);
    setWarning(null);
    const mergedHours = mergeTarget ? Math.max(0, mergeTarget.hours ?? 0) + enteredHours : 0;
    try {
      // Hidden-date rule (web parity), applied at the WRITE decision: the
      // display mode + window are re-resolved LIVE here — the open-time
      // fetch behind the schedule note is informational only, and a
      // schedule created or reshaped while this form sat open must still
      // govern the saved dates (the desired fallbacks — open-slot demand
      // dates, record Target dates — can sit years outside the window).
      // The merge path clamps the EXISTING row's dates too before the
      // union, so duplicate-person merges keep succeeding.
      let decision: Awaited<ReturnType<typeof decideAssignDates>>;
      try {
        decision = await decideAssignDates({
          getMode: () => getEffectiveDisplayModeFor(module),
          fetchLive: () => getLiveTaskData(projectId),
          desiredStart: (prefillStartDate || projectStartDate || "").slice(0, 10),
          desiredEnd: (prefillEndDate || projectEndDate || "").slice(0, 10),
          mergeStart: mergeTarget ? (mergeTarget.startDate || "").slice(0, 10) : undefined,
          mergeEnd: mergeTarget ? (mergeTarget.endDate || "").slice(0, 10) : undefined,
        });
      } catch (winErr) {
        // Window unknown (mode or live schedule read failed) ⇒ FAIL CLOSED:
        // the server gate only backstops "full" mode, so proceeding could
        // save out-of-window dates on schedule-no-grid records. Explicit
        // error, nothing written — pressing Add again retries the resolve.
        setSchedWin({ state: "error", start: "", end: "" });
        setWarning(winErr instanceof Error ? winErr.message : String(winErr));
        setSubmitting(false);
        return;
      }
      // Keep the schedule note honest if the save is rejected and the form stays open.
      setSchedWin(decision.window);
      const result = await assignResource({
        ProjectID: projectId,
        Allocations: [{
          AllocationStartDate: decision.startDate,
          AllocationEndDate: decision.endDate,
          AssignedTo: personId,
          AssignedToName: personName,
          ID: mergeTarget ? (mergeTarget.allocationId ?? 0) : (prefillAllocationId ?? 0),
          PctAllocation: mergeTarget ? mergedHours : enteredHours,
          // Explicit hours signal on merge — the backend edit path persists it
          // onto the container row (AllocationHour + PctAllocation), same as
          // the web merge submit.
          ...(mergeTarget ? { AllocationHour: mergedHours } : {}),
          ProjectID: projectId,
          TemplateID: 0,
          // Merge keeps the existing row's title — the form's title pick
          // described a would-be NEW row, not a rename of the merged one.
          Title: mergeTarget ? (mergeTarget.title || null) : (title || null),
          JobTitleName: mergeTarget ? (mergeTarget.title || null) : (title || null),
          // Merge: send NO division — the server's edit path COALESCEs a null
          // division to the row's stored lookup, so the existing assignment
          // keeps its division instead of adopting the form's pick.
          DivisionName: mergeTarget ? null : (buShort || null),
          Type: prefillTypeGuid || "",
          GroupId: prefillGroupId || undefined,
          TypeName: role,
          SoftAllocation: "false",
          NonChargeable: false,
          IsResourceDisabled: false,
          IsResourceOverAllocated: false,
          IsPreconStage: false,
        }],
      });
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      const schedRejection = scheduleWindowRejection(result);
      if (schedRejection) {
        // Server schedule-window gate. Rare here — dates are pre-clamped — but
        // a schedule change racing the save (or an "error"-state fetch) can
        // still trip it, and without this branch the 200 + {ok:false} body
        // would read as SUCCESS and the modal would close over a failed save.
        setWarning(`${schedRejection} Change the project schedule first, then try again.`);
      } else if (resultStr.toLowerCase().includes("allocationoutofbounds")) {
        const oobMatch = resultStr.match(/AllocationOutofbounds~\d+~([^~]+)~([^~]+)~([^~"]+)/i);
        const availS = oobMatch?.[1] ?? "?";
        const availE = oobMatch?.[2] ?? "?";
        const who = oobMatch?.[3]?.trim() || personName;
        setWarning(`RM ONE rejected: ${who}'s availability (${availS} – ${availE}) doesn't cover the project dates. This person cannot be assigned. Please pick someone else or update their availability in the RM ONE portal.`);
      } else if (resultStr.toLowerCase().includes("overlappingallocation")) {
        setWarning(`RM ONE rejected: ${personName} already has an overlapping allocation on this project. Remove the existing allocation in the RM ONE portal first, then try again.`);
      } else {
        console.log("[AddTeamMember] SUCCESS — closing modal, calling onAssigned for", personName, "id:", personId, mergeTarget ? `(merged into allocation ${mergeTarget.allocationId})` : "");
        setSubmitting(false);
        onClose();
        if (mergeTarget) {
          globalAlert("Hours Added", `Added ${enteredHours}h to ${personName}'s existing ${role} assignment — new total ${Math.round(mergedHours)}h.`);
        }
        try { onAssigned(personName, personId || undefined); } catch (assignErr) { console.log("[AddTeamMember] onAssigned error:", assignErr); }
        return;
      }
    } catch (e) {
      globalAlert("Add Failed", String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  }

  function pickerData(): { id: string; label: string; sub?: string; disabled?: boolean; alreadyOnTeam?: boolean; teamHours?: number; enabled?: boolean; tenantId?: string }[] {
    if (picker === "bu") return bus.map(b => ({ id: b.id, label: b.label }));
    if (picker === "role") return roleOptions.map(r => ({ id: r, label: r }));
    if (picker === "title") return titleOptions.map(t => ({ id: t, label: t }));
    if (picker === "person") return displayPeople.map(p => {
      let sub = p.title;
      if (p.availStart && p.availEnd) {
        const fmtShort = (d: string) => { const dt = new Date(d); return isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }); };
        const s = fmtShort(p.availStart); const e = fmtShort(p.availEnd);
        if (s && e) sub = sub ? `${sub}  ·  ${s} – ${e}` : `${s} – ${e}`;
      }
      // alreadyOnTeam = this person has ANY allocation on the project (used
      // for the red visual flag in the picker so the user immediately spots
      // someone already assigned). disabled keeps the stricter "same BU +
      // Role + Title" check that blocks submit — adding the same person
      // again with a different role/title is still allowed.
      const mine = existingAllocations.filter(a => norm(a.personId) === norm(p.id));
      const alreadyOnTeam = mine.length > 0;
      // Sum of budgeted hours across ALL of this person's allocation rows on
      // the project — shown in the badge so the user sees how much work the
      // person already carries here (0/absent hours → plain badge).
      const teamHours = mine.reduce((s, a) => s + (Number(a.hours) || 0), 0);
      return { id: p.id, label: p.name, sub, disabled: isExactDupe(p.id) || alreadyOnTeam, alreadyOnTeam, teamHours, enabled: p.enabled, tenantId: p.tenantId };
    });
    return [];
  }

  function pickerTitle() {
    if (picker === "bu") return "Select Business Unit";
    if (picker === "role") return "Select Role";
    if (picker === "title") return "Select Title";
    if (picker === "person") return "Assign To";
    return "";
  }

  function applyPick(id: string, label: string) {
    // Changing any parent in the cascade must clear everything downstream,
    // including a previously-picked person, so we never submit a stale resource.
    if (picker === "bu") { setBU(id); setRole(""); setTitle(""); setPersonId(""); setPersonName(""); }
    else if (picker === "role") { setRole(label); setTitle(""); setPersonId(""); setPersonName(""); }
    else if (picker === "title") { setTitle(label); setPersonId(""); setPersonName(""); }
    else if (picker === "person") {
      const p = displayPeople.find(p => p.id === id) || people.find(p => p.id === id);
      if (p) {
        setPersonId(p.id); setPersonName(p.name);
        if (!title && p.title) setTitle(p.title);
        // Auto-fill the Business Unit from the person's staff profile:
        // exact division ID first, then division NAME matched against the
        // dropdown labels ("SHORT - Title"). Never fabricate an entry — on a
        // miss the current selection stays.
        const dn = p.division.trim().toLowerCase();
        const m =
          (p.divisionId ? bus.find(b => b.id === p.divisionId) : undefined) ??
          (dn ? bus.find(b => {
            const parts = b.label.split(" - ");
            return parts[0].trim().toLowerCase() === dn
              || parts.slice(1).join(" - ").trim().toLowerCase() === dn
              || b.label.trim().toLowerCase() === dn;
          }) : undefined);
        if (m && m.id !== bu) setBU(m.id);
      }
    }
    setPicker(null); setSearch("");
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: Colors.darkDeep, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border + "40" }}>
            <Feather name="user-plus" size={18} color={Colors.green} />
            <Text style={{ flex: 1, marginLeft: 10, fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.textPrimary }}>Add Team Member</Text>
            <Pressable onPress={onClose} hitSlop={12}><Feather name="x" size={20} color={Colors.textMuted} /></Pressable>
          </View>

          {loading ? (
            <View style={{ padding: 40, alignItems: "center" }}>
              <ActivityIndicator color={Colors.green} />
              <Text style={{ marginTop: 10, color: Colors.textMuted, fontSize: 12 }}>Loading roles & roster…</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
              <Text style={{ color: Colors.textMuted, fontSize: 11, marginBottom: 14 }}>Project: {projectName}</Text>
              <Field label="Business Unit *" value={bus.find(b => b.id === bu)?.label || ""} onPress={() => setPicker("bu")} />
              <Field label="Role *" value={role} onPress={() => bu ? setPicker("role") : globalAlert("Select BU first", "Pick a Business Unit before choosing the Role.")} disabled={!bu} />
              <Field label="Title" value={title} onPress={() => bu ? setPicker("title") : globalAlert("Select BU first", "Pick a Business Unit first.")} disabled={!bu} />
              <Field label="Assigned To *" value={personName} onPress={() => setPicker("person")} />

              {schedWin.state === "ready" ? (
                <Text style={{ marginTop: 6, fontSize: 10, color: Colors.textMuted }}>
                  Member dates follow the project's phase schedule ({formatScheduleWindowLabel(schedWin)}).
                </Text>
              ) : schedWin.state === "loading" ? (
                <Text style={{ marginTop: 6, fontSize: 10, color: Colors.textMuted }}>Checking the project schedule…</Text>
              ) : schedWin.state === "error" ? (
                <Text style={{ marginTop: 6, fontSize: 10, color: Colors.orange }}>
                  Couldn't load the project's schedule window — it will be re-checked before saving.
                </Text>
              ) : null}
              {warning ? (
                <View style={{ marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: "#D32F2F20", borderWidth: 1, borderColor: "#D32F2F60" }}>
                  <Text style={{ color: "#D32F2F", fontSize: 11, fontFamily: "Inter_600SemiBold" }}>{warning}</Text>
                </View>
              ) : null}
              {dupeOnSubmit ? (
                <View style={{ marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: Colors.orange + "20", borderWidth: 1, borderColor: Colors.orange + "60" }}>
                  <Text style={{ color: Colors.orange, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>This person is already on the team with the same Business Unit, Role, and Title. Pick a different role or title to add another assignment.</Text>
                </View>
              ) : null}
              <Pressable
                disabled={!canSubmit}
                onPress={submit}
                style={{ marginTop: 20, backgroundColor: canSubmit ? Colors.green : Colors.border, paddingVertical: 14, borderRadius: 10, alignItems: "center", flexDirection: "row", justifyContent: "center" }}
              >
                {submitting ? <ActivityIndicator color="#FFF" /> : <Feather name="check" size={16} color="#FFF" />}
                <Text style={{ marginLeft: 8, color: "#FFF", fontFamily: "Inter_700Bold", fontSize: 14 }}>{submitting ? "Adding…" : "Add to Team"}</Text>
              </Pressable>
              <Text style={{ marginTop: 10, fontSize: 10, color: Colors.textMuted, textAlign: "center" }}>
                After adding, you'll be prompted to enter weekly hours per phase.
              </Text>
            </ScrollView>
          )}
        </View>
      </View>

      <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: Colors.darkDeep, borderRadius: 14, maxHeight: "75%", borderWidth: 1, borderColor: Colors.border + "60" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border + "40" }}>
              <Text style={{ flex: 1, fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.textPrimary }}>{pickerTitle()}</Text>
              <Pressable onPress={() => { setPicker(null); setSearch(""); }} hitSlop={12}><Feather name="x" size={18} color={Colors.textMuted} /></Pressable>
            </View>
            {(picker === "person" || pickerData().length > 8) && (
              <View style={{ flexDirection: "row", alignItems: "center", margin: 12, marginBottom: 0, paddingHorizontal: 10, backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border + "40" }}>
                <Feather name="search" size={14} color={Colors.textMuted} />
                <AppTextInput
                  value={search} onChangeText={setSearch} placeholder="Search…" placeholderTextColor={Colors.textMuted}
                  style={{ flex: 1, padding: 10, fontSize: 12, color: Colors.textPrimary, fontFamily: "Inter_500Medium" }}
                />
              </View>
            )}
            {picker === "person" && usingOfficialPeople && (
              <View style={{ marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Colors.green + "15", borderRadius: 6 }}>
                <Text style={{ fontSize: 11, color: Colors.textMuted, fontFamily: "Inter_500Medium" }}>
                  {`${displayPeople.length} ${title ? `for "${title}"` : "available"}`}
                </Text>
              </View>
            )}
            {picker === "person" && !usingOfficialPeople && (role || title) && (
              relatedPeopleCount === 0 && !showAllPeople ? (
                /* Nothing matches the chosen Role/Title: say so explicitly
                   instead of silently listing the whole staff. */
                <View style={{ marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.orange + "18", borderWidth: 1, borderColor: Colors.orange + "50", borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, color: Colors.textPrimary, fontFamily: "Inter_600SemiBold", marginBottom: 6 }}>
                    No one in your staff list matches "{role || title}".
                  </Text>
                  <Pressable onPress={() => setShowAllPeople(true)} style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: Colors.border + "40", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.green }}>Show all {people.length} people</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: showAllPeople ? "transparent" : Colors.green + "15", borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, color: Colors.textMuted, fontFamily: "Inter_500Medium" }}>
                    {showAllPeople ? `All ${filteredPeople.length} people` : `${filteredPeople.length} matching "${role || title}"`}
                  </Text>
                  <Pressable onPress={() => setShowAllPeople(!showAllPeople)} style={{ borderWidth: 1, borderColor: Colors.border + "40", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.green }}>{showAllPeople ? "Show Related" : "Show All"}</Text>
                  </Pressable>
                </View>
              )
            )}
            <FlatList
              data={pickerData().filter(d => { if (!search) return true; const q = search.toLowerCase(); return d.label.toLowerCase().includes(q) || (d.sub && d.sub.toLowerCase().includes(q)); })}
              keyExtractor={d => d.id}
              ListEmptyComponent={<Text style={{ padding: 24, textAlign: "center", color: Colors.textMuted, fontSize: 12 }}>No options</Text>}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => applyPick(item.id, item.label)}
                  style={({ pressed }) => ({ padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border + "20", backgroundColor: pressed ? Colors.green + "20" : "transparent" })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ flex: 1, color: Colors.textPrimary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>{item.label}</Text>
                    {item.alreadyOnTeam ? (
                      <Text style={{ color: "#E85D4A", fontSize: 10, fontFamily: "Inter_600SemiBold", backgroundColor: "#E85D4A22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                        {item.teamHours ? `On team · ${Math.round(item.teamHours)}h` : "Already on team"}
                      </Text>
                    ) : null}
                  </View>
                   <DisabledStaffControl
                     enabled={item.enabled}
                     userGuid={item.id}
                     tenantId={item.tenantId}
                     onReactivated={(userGuid) => {
                       setPeople(prev => prev.map(person => person.id.toLowerCase() === userGuid.toLowerCase() ? { ...person, enabled: true } : person));
                       setApiResources(prev => prev.map(person => person.id.toLowerCase() === userGuid.toLowerCase() ? { ...person, enabled: true } : person));
                     }}
                   />
                  {item.sub ? <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 2 }}>{item.sub}</Text> : null}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function Field({ label, value, onPress, disabled }: { label: string; value: string; onPress: () => void; disabled?: boolean }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 11, color: Colors.textMuted, marginBottom: 6, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={{ flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border + (disabled ? "20" : "60"), opacity: disabled ? 0.5 : 1 }}
      >
        <Text style={{ flex: 1, fontSize: 13, color: value ? Colors.textPrimary : Colors.textMuted, fontFamily: "Inter_500Medium" }}>{value || "Tap to select"}</Text>
        <Feather name="chevron-down" size={16} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}
