import { useEffect, useRef, useState } from "react";
import { Layers, Trash2, Plus, Check, ChevronRight, Loader2, X, ArrowLeft, PencilLine, FolderInput } from "lucide-react";
import {
  getAllocTemplates, createAllocTemplate, updateAllocTemplate, deleteAllocTemplate,
  assignResource, getUserList, getProjectTeam,
  getDivisions, getBusinessUnits, getDepartments, getRolesByBU, getJobTitles,
  peekCache, ALLOC_TEMPLATES_CACHE_KEY,
  type AllocTemplate, type AllocTemplateSlot,
  type AssignRole, type JobTitleRow, type ProjectTeamMember,
} from "@/lib/api";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { getBusinessRules } from "@/lib/businessRules";
import { ScheduleWindowTip } from "@/components/ScheduleWindowTip";
import DateField from "@/components/DateField";
import { Z } from "@/lib/zLayers";

interface TeamMemberRef {
  bu?: string;
  role?: string;
  title?: string;
  pct?: number;
}

const ACCENT = "#6BA539";
const ORANGE = "#E87722";
const OVERLAY_BG = "rgba(0,0,0,0.65)";
const MODAL_BG = "var(--rm-panel, #1a2133)";
const BORDER = "var(--rm-panel-border, rgba(255,255,255,0.08))";
const TEXT = "var(--rm-text, #e8eaf0)";
const MUTED = "var(--rm-text-muted, #7a8299)";

type SlotDraft = Omit<AllocTemplateSlot, "id">;

interface BUOption   { id: string; name: string }
interface DivOption  { id: string; name: string; buId: string | null }
interface DeptOption { id: string; name: string; divId: string }

interface NewSlotRow {
  buId: string;       buName: string;
  divId: string;      divisionName: string;
  deptId: string;     deptName: string;
  /* role — can be dropdown or manual */
  roleMode: "dropdown" | "manual";
  roleId: string;     roleName: string;
  roles: AssignRole[]; loadingRoles: boolean;
  /* job title — can be dropdown or manual */
  titleMode: "dropdown" | "manual";
  jobTitleId: string; jobTitleName: string;
  defaultPct: number;
}

function blankSlot(): NewSlotRow {
  return {
    buId: "", buName: "", divId: "", divisionName: "",
    deptId: "", deptName: "",
    roleMode: "dropdown", roleId: "", roleName: "",
    roles: [], loadingRoles: false,
    titleMode: "dropdown", jobTitleId: "", jobTitleName: "",
    defaultPct: 40,
  };
}

interface Person {
  id: string; name: string; role: string; bu: string; title: string;
  divisionName: string; buName: string; deptId: string;
}

function extractPeople(raw: Record<string, unknown>[]): Person[] {
  return raw.map(u => ({
    id:    String(u.Id ?? u.id ?? u.GUID ?? u.Guid ?? ""),
    name:  String(u.Name ?? u.name ?? u.UserName ?? u.username ?? ""),
    role:  String(u.JobProfile ?? u.JobTitle ?? u.Title ?? ""),
    bu:    String(u.DivisionName ?? u.Division ?? u.Department ?? u.BusinessUnit ?? ""),
    title: String(u.title ?? u.Title ?? u.JobTitle ?? u.JobProfile ?? ""),
    divisionName: String(u.DivisionName ?? u.Division ?? ""),
    buName:       String(u.BusinessUnit ?? ""),
    deptId:       String(u.DepartmentId ?? ""),
  })).filter(p => p.id && p.name);
}

function chipStyle(color: string): React.CSSProperties {
  return { display: "inline-block", padding: "2px 8px", borderRadius: 20, background: color + "22", color, fontSize: 11, fontWeight: 600 };
}

function selStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "rgba(255,255,255,0.05)", color: TEXT, fontSize: 13, outline: "none", cursor: "pointer", boxSizing: "border-box", ...extra };
}

function fieldLabel(text: string) {
  return <div style={{ fontSize: 11, color: MUTED, marginBottom: 4, fontWeight: 500 }}>{text}</div>;
}

function SlotRow({ slot, index }: { slot: SlotDraft; index: number }) {
  const label = [slot.roleName, slot.jobTitleName].filter(Boolean).join(" · ") || "Unnamed slot";
  const bu = slot.buName || slot.divisionName;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", marginBottom: 4 }}>
      <div style={{ fontSize: 11, color: MUTED, minWidth: 18, textAlign: "right" }}>{index + 1}.</div>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>{label}</span>
        {bu && <span style={{ ...chipStyle("#5b8cf7"), marginLeft: 6 }}>{bu}</span>}
      </div>
      <span style={chipStyle(ACCENT)}>{slot.defaultPct}h</span>
    </div>
  );
}

interface Props {
  open: boolean;
  mode: "save" | "apply";
  projectId: string;
  projectTitle?: string;
  projectStartDate: string;
  projectEndDate: string;
  /** Phase-schedule window (when the project has one) — member dates must
      stay inside it, same contract as AddTeamMemberModal. */
  scheduleStart?: string;
  scheduleEnd?: string;
  currentTeam?: TeamMemberRef[];
  assignedPersonIds?: string[];
  onClose: () => void;
  onApplied?: () => void;
}

export function AllocationTemplateModal({
  open, mode, projectId, projectTitle = "",
  projectStartDate, projectEndDate,
  scheduleStart, scheduleEnd,
  currentTeam = [], assignedPersonIds = [], onClose, onApplied,
}: Props) {
  // ── Schedule-window guard (mirrors useAssignMemberCascade) ──
  // When the project has a phase schedule, assignments outside it are rejected
  // by the server with an opaque 502 — so clamp the date inputs and explain
  // the rule in plain words BEFORE any request is made.
  //
  // The window applies ONLY in "full" display mode: in the no-schedule display
  // modes the schedule (if any exists) is hidden from users, dates are free,
  // and the server skips its window check too. Zeroing the window here turns
  // off the date input min/max, the apply-time validation, and the notes.
  // Intentional (v1): template modal follows the PROJECT-side display mode
  // even on OPM/LEM records — kept tenant-wide until it grows a module prop.
  const windowApplies = getBusinessRules().projectDisplayMode === "full";
  const schedStartYmd = windowApplies ? (scheduleStart || "").slice(0, 10) : "";
  const schedEndYmd = windowApplies ? (scheduleEnd || "").slice(0, 10) : "";
  const hasScheduleWindow = !!(schedStartYmd || schedEndYmd);
  const fmtNice = (ymd: string) => {
    const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
    return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const schedWindowLabel = `${schedStartYmd ? fmtNice(schedStartYmd) : "…"} – ${schedEndYmd ? fmtNice(schedEndYmd) : "…"}`;
  /* save mode */
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  /* apply mode */
  const [templates, setTemplates] = useState<AllocTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AllocTemplate | null>(null);
  const [applyStep, setApplyStep] = useState<1 | 2>(1);
  const [allPeople, setAllPeople] = useState<Person[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [slotPcts, setSlotPcts] = useState<Record<number, number>>({});
  const [slotStartDates, setSlotStartDates] = useState<Record<number, string>>({});
  const [slotEndDates, setSlotEndDates] = useState<Record<number, string>>({});

  /* create / edit sub-mode */
  const [applySubMode, setApplySubMode] = useState<"list" | "create" | "edit" | "copy">("list");
  const [editingTemplate, setEditingTemplate] = useState<AllocTemplate | null>(null);
  const [newTplName, setNewTplName] = useState("");
  const [newSlots, setNewSlots] = useState<NewSlotRow[]>([blankSlot()]);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  /* "are these slots enough?" confirmation before saving a new template */
  const [confirmSlots, setConfirmSlots] = useState(false);

  /* copy-from-project sub-mode */
  const [copySelectedId, setCopySelectedId] = useState("");
  const [copySelectedName, setCopySelectedName] = useState("");
  const [copyLoadingTeam, setCopyLoadingTeam] = useState(false);
  const [copySlots, setCopySlots] = useState<SlotDraft[]>([]);
  const [copyMembers, setCopyMembers] = useState<ProjectTeamMember[]>([]);
  const [copyTplName, setCopyTplName] = useState("");
  const [copySaving, setCopySaving] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyProjectsLoadedRef = useRef(false);

  /* global org options */
  const [allBUs, setAllBUs] = useState<BUOption[]>([]);
  const [allDivisions, setAllDivisions] = useState<DivOption[]>([]);
  // Division tier hidden → slot Role dropdowns can't be division-scoped;
  // this tenant-wide list (loaded once with the org data) backs them instead.
  const [allRoles, setAllRoles] = useState<Awaited<ReturnType<typeof getRolesByBU>>>([]);
  const [allDepts, setAllDepts] = useState<DeptOption[]>([]);
  const [allJobTitles, setAllJobTitles] = useState<JobTitleRow[]>([]);
  const [loadingOrg, setLoadingOrg] = useState(false);
  const orgLoadedRef = useRef(false);

  const saveDrafts: SlotDraft[] = currentTeam.map(m => ({
    buName: m.bu || null, divisionName: null, deptName: null,
    roleName: m.role || null, jobTitleName: m.title || null,
    defaultPct: typeof m.pct === "number" && m.pct > 0 ? m.pct : 40,
    sortOrder: 0,
    resourceId: null,
  }));

  useEffect(() => {
    if (!open) {
      setTemplateName(""); setSaving(false); setSaveError(""); setSaved(false);
      setSelectedTemplate(null); setApplyStep(1); setPicks({}); setSlotPcts({});
      setSlotStartDates({}); setSlotEndDates({});
      setApplyError(""); setApplySubMode("list"); setEditingTemplate(null);
      setNewTplName(""); setNewSlots([blankSlot()]); setCreateError("");
      setConfirmSlots(false);
      /* org data persists across opens — only loaded when user enters create/edit */
      /* copy state */
      setCopySelectedId(""); setCopySelectedName("");
      setCopySlots([]); setCopyMembers([]); setCopyTplName(""); setCopyError("");
      copyProjectsLoadedRef.current = false;
    }
  }, [open]);

  /* auto-load current project's team when entering copy sub-mode */
  useEffect(() => {
    if (!open || applySubMode !== "copy" || copyProjectsLoadedRef.current) return;
    copyProjectsLoadedRef.current = true;
    void handleSelectCopyProject(projectId, projectTitle || projectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applySubMode]);

  useEffect(() => {
    if (open && mode === "apply") {
      const cached = peekCache<AllocTemplate[]>(ALLOC_TEMPLATES_CACHE_KEY);
      if (cached) { setTemplates(cached); return; }
      setLoadingTemplates(true);
      getAllocTemplates().then(t => { setTemplates(t); setLoadingTemplates(false); }).catch(() => setLoadingTemplates(false));
    }
  }, [open, mode]);

  useEffect(() => {
    if (open && mode === "apply" && applyStep === 2 && allPeople.length === 0) {
      setLoadingPeople(true);
      getUserList().then(raw => { setAllPeople(extractPeople(raw as Record<string, unknown>[])); setLoadingPeople(false); }).catch(() => setLoadingPeople(false));
    }
  }, [open, mode, applyStep, allPeople.length]);

  /* auto-select best-matching person + initialise per-slot hrs when people load */
  useEffect(() => {
    if (!selectedTemplate || allPeople.length === 0 || loadingPeople) return;
    const assignedSet = new Set(assignedPersonIds.filter(Boolean));
    const autoPicks: Record<number, string> = {};
    const autoPcts: Record<number, number> = {};
    const usedIds = new Set<string>(); // prevent two slots auto-picking the same person
    selectedTemplate.slots.forEach((slot, i) => {
      autoPcts[i] = 0; // total hours — user fills in, no default
      if (picks[i]) { usedIds.add(picks[i]); return; } // don't override a manual pick
      // 1. Exact match by stored resourceId (copied-from-project templates)
      let match = slot.resourceId
        ? allPeople.find(p => p.id === slot.resourceId && !usedIds.has(p.id))
        : undefined;
      // 2. Fallback: role/title/bu heuristic for manually-built templates
      if (!match) {
        match = allPeople.find(p => {
          if (assignedSet.has(p.id) || usedIds.has(p.id)) return false;
          const pTitle = p.role.toLowerCase();
          const pBu = p.bu.toLowerCase();
          return (slot.roleName && pTitle.includes(slot.roleName.toLowerCase()))
            || (slot.jobTitleName && pTitle.includes(slot.jobTitleName.toLowerCase()))
            || (slot.buName && pBu.includes(slot.buName.toLowerCase()))
            || (slot.divisionName && pBu.includes(slot.divisionName.toLowerCase()));
        });
      }
      if (match) { autoPicks[i] = match.id; usedIds.add(match.id); }
    });
    setPicks(prev => ({ ...autoPicks, ...prev }));
    setSlotPcts(prev => ({ ...autoPcts, ...prev }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPeople, loadingPeople, selectedTemplate]);

  useEffect(() => {
    if (!open || (applySubMode !== "create" && applySubMode !== "edit") || orgLoadedRef.current) return;
    orgLoadedRef.current = true;
    setLoadingOrg(true);
    Promise.all([getBusinessUnits(), getDivisions(), getDepartments(), getJobTitles()]).then(([rawBUs, rawDivs, rawDepts, rawTitles]) => {
      setAllBUs((rawBUs as Record<string, unknown>[]).map(b => ({
        id: String(b.ID ?? b.Id ?? b.id ?? ""),
        name: String(b.Title ?? b.Name ?? b.name ?? ""),
      })).filter(b => b.id && b.name));

      setAllDivisions((rawDivs as { ID: number; Title: string; BusinessUnitIdLookup?: string | null }[]).map(d => ({
        id: String(d.ID), name: d.Title, buId: d.BusinessUnitIdLookup ?? null,
      })).filter(d => d.id && d.name));

      setAllDepts((rawDepts as Record<string, unknown>[]).map(d => ({
        id: String(d.ID ?? d.Id ?? d.id ?? ""),
        name: String(d.Title ?? d.Name ?? ""),
        divId: String(d.DivisionIdLookup ?? ""),
      })).filter(d => d.id && d.name));

      setAllJobTitles(Array.isArray(rawTitles) ? rawTitles.filter((r: JobTitleRow) => !r.Deleted) : []);
      setLoadingOrg(false);
      // Pre-warm the roles cache for every division so the Role dropdown is
      // instant when the user picks a division — no visible "Loading…" spinner.
      const divIds = (rawDivs as { ID: number }[]).map(d => String(d.ID)).filter(Boolean);
      divIds.forEach(id => void getRolesByBU(id).catch(() => undefined));
      // Division tier hidden → no division is ever picked; load the tenant-wide
      // roles list once (the server ignores the sentinel key's value).
      if (!getBusinessRules().showDivision) {
        void getRolesByBU("all").then(r => setAllRoles(Array.isArray(r) ? r : [])).catch(() => undefined);
      }
    }).catch(() => {
      // Allow a retry next time the user enters create/edit instead of
      // leaving the dropdowns empty for the rest of the session.
      orgLoadedRef.current = false;
      setLoadingOrg(false);
    });
  }, [open, mode, applySubMode]);

  if (!open) return null;

  /* ── slot helpers ── */
  function setSlot(i: number, patch: Partial<NewSlotRow>) {
    setNewSlots(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  function handleBUChange(i: number, buId: string) {
    const bu = allBUs.find(b => b.id === buId);
    setSlot(i, { buId, buName: bu?.name ?? "", divId: "", divisionName: "", deptId: "", deptName: "", roleId: "", roleName: "", roles: [], loadingRoles: false, jobTitleId: "", jobTitleName: "" });
  }

  async function handleDivChange(i: number, divId: string) {
    const div = allDivisions.find(d => d.id === divId);
    // Auto-fill the parent Business Unit when a division is picked while BU is
    // still "Any" — keeps the saved slot consistent (division implies its BU).
    const parentBU = div?.buId ? allBUs.find(b => b.id === div.buId) : undefined;
    const buPatch = parentBU ? { buId: parentBU.id, buName: parentBU.name } : {};
    setSlot(i, { ...buPatch, divId, divisionName: div?.name ?? "", deptId: "", deptName: "", roleId: "", roleName: "", loadingRoles: !!divId, roles: [], jobTitleId: "", jobTitleName: "" });
    if (!divId) return;
    try {
      const roles = await getRolesByBU(divId);
      setNewSlots(prev => prev.map((s, idx) => idx === i ? { ...s, roles, loadingRoles: false } : s));
    } catch {
      setNewSlots(prev => prev.map((s, idx) => idx === i ? { ...s, loadingRoles: false } : s));
    }
  }

  function handleDeptChange(i: number, deptId: string) {
    const dept = allDepts.find(d => d.id === deptId);
    setSlot(i, { deptId, deptName: dept?.name ?? "", jobTitleId: "", jobTitleName: "" });
  }

  function handleRoleChange(i: number, roleId: string) {
    const slot = newSlots[i];
    // Division-scoped slot roles first; tenant-wide fallback covers the
    // hidden-Division mode where slot.roles is never populated.
    const role = slot.roles.find(r => r.id === roleId) ?? allRoles.find(r => r.id === roleId);
    setSlot(i, { roleId, roleName: role?.name ?? "", jobTitleId: "", jobTitleName: "" });
  }

  function addSlot() { setNewSlots(prev => [...prev, blankSlot()]); }
  function removeSlot(i: number) { setNewSlots(prev => prev.filter((_, idx) => idx !== i)); }

  /* job titles for a slot: full catalog, filtered by dept if selected */
  function titlesForSlot(slot: NewSlotRow): JobTitleRow[] {
    if (!slot.deptId) return allJobTitles;
    return allJobTitles.filter(t => {
      const dk = t.DepartmentId == null ? "" : String(t.DepartmentId).trim();
      if (!dk) return true;
      return dk === slot.deptId;
    });
  }

  /* standard titles not yet in the (filtered) catalog for this slot */
  function suggestedForSlot(catalogTitles: JobTitleRow[]): string[] {
    const have = new Set(catalogTitles.map(t => (t.Title || "").trim().toLowerCase()));
    return STANDARD_JOB_TITLES.filter(n => !have.has(n.toLowerCase()));
  }

  /* pre-fill NewSlotRow[] from an existing template (manual mode for names) */
  function templateToSlots(t: AllocTemplate): NewSlotRow[] {
    return t.slots.map(s => ({
      ...blankSlot(),
      buName: s.buName || "",
      divisionName: s.divisionName || "",
      deptName: s.deptName || "",
      roleMode: "manual" as const,
      roleName: s.roleName || "",
      titleMode: "manual" as const,
      jobTitleName: s.jobTitleName || "",
      defaultPct: s.defaultPct ?? 40,
    }));
  }

  function handleEditTemplate(t: AllocTemplate) {
    setEditingTemplate(t);
    setNewTplName(t.name);
    setNewSlots(templateToSlots(t));
    setCreateError("");
    setApplySubMode("edit");
  }

  /* After creating a template, skip the list page and go straight to the
     "assign people" step (step 2) with the new template selected. */
  function goToAssignPeople(refreshed: AllocTemplate[], newId?: number) {
    const created = (newId != null ? refreshed.find(t => t.id === newId) : undefined)
      ?? refreshed[0]; // templates are ordered newest-first server-side
    if (!created) return;
    setSelectedTemplate(created);
    setPicks({}); setSlotPcts({}); setSlotStartDates({}); setSlotEndDates({});
    setApplyError("");
    setApplyStep(2);
  }

  /* ── copy-from-project handlers ── */
  async function handleSelectCopyProject(id: string, name: string) {
    setCopySelectedId(id);
    setCopySelectedName(name);
    setCopyLoadingTeam(true);
    setCopySlots([]);
    setCopyMembers([]);
    setCopyError("");
    setCopyTplName(name);
    try {
      const data = await getProjectTeam(id);
      const members = data.team ?? [];
      setCopyMembers(members);
      const memberSlots: SlotDraft[] = members.map((m, i) => ({
        buName: m.bu || m.memberBu || null,
        divisionName: null,
        deptName: m.dept || null,
        /* use name as roleName fallback so members with no role assigned still
           appear as a slot in the saved template */
        roleName: m.role || m.title || m.name || null,
        jobTitleName: m.title || null,
        defaultPct: m.eacHrs > 0 ? Math.round(m.eacHrs) : 40,
        sortOrder: i,
        resourceId: m.resourceId || null,
      }));
      const openSlots: SlotDraft[] = (data.openRoles ?? []).map((r, i) => ({
        buName: r.bu || null,
        divisionName: null,
        deptName: null,
        roleName: r.role || r.title || null,
        jobTitleName: r.title || null,
        defaultPct: r.eacHrs > 0 ? Math.round(r.eacHrs) : 40,
        sortOrder: memberSlots.length + i,
        resourceId: null,
      }));
      const all = [...memberSlots, ...openSlots];
      if (all.length === 0) {
        setCopyError("This project has no team members yet.");
      }
      setCopySlots(all);
    } catch {
      setCopyError("Could not load this project's team. Please try again.");
    } finally {
      setCopyLoadingTeam(false);
    }
  }

  async function handleCopySave() {
    if (!copyTplName.trim()) { setCopyError("Give the template a name."); return; }
    if (copySlots.length === 0) { setCopyError("Select a project with a team first."); return; }
    setCopySaving(true); setCopyError("");
    try {
      const res = await createAllocTemplate(copyTplName.trim(), copySlots);
      if (!res.ok) { setCopyError("Failed to save template. Please try again."); return; }
      const refreshed = res.templates ?? await getAllocTemplates();
      setTemplates(refreshed);
      setApplySubMode("list");
      setCopySelectedId(""); setCopySelectedName("");
      setCopySlots([]); setCopyMembers([]); setCopyTplName(""); copyProjectsLoadedRef.current = false;
      /* jump straight to assigning people on the just-created template */
      goToAssignPeople(refreshed, res.id);
    } catch { setCopyError("Failed to save template. Please try again."); }
    finally { setCopySaving(false); }
  }

  async function handleUpdateTemplate() {
    if (!editingTemplate) return;
    if (!newTplName.trim()) { setCreateError("Give the template a name."); return; }
    const validSlots = newSlots.filter(s => s.roleName || s.jobTitleName || s.divisionName);
    if (validSlots.length === 0) { setCreateError("Add at least one role slot with a Role, Job Title, or Division."); return; }
    setCreateSaving(true); setCreateError("");
    try {
      const drafts: SlotDraft[] = validSlots.map((s, i) => ({
        buName: s.buName || null, divisionName: s.divisionName || null,
        deptName: s.deptName || null, roleName: s.roleName || null,
        jobTitleName: s.jobTitleName || null, defaultPct: s.defaultPct, sortOrder: i,
        resourceId: null,
      }));
      const res = await updateAllocTemplate(editingTemplate.id, newTplName.trim(), drafts);
      if (!res.ok) { setCreateError("Failed to update. Please try again."); return; }
      if (res.templates) setTemplates(res.templates);
      else { const refreshed = await getAllocTemplates(); setTemplates(refreshed); }
      setApplySubMode("list"); setEditingTemplate(null);
      setNewTplName(""); setNewSlots([blankSlot()]);
    } catch { setCreateError("Failed to update. Please try again."); }
    finally { setCreateSaving(false); }
  }

  /* ── save handler (from current team) ── */
  async function handleSave() {
    if (!templateName.trim()) { setSaveError("Please enter a template name."); return; }
    if (saveDrafts.length === 0) { setSaveError("The team has no members to save."); return; }
    setSaving(true); setSaveError("");
    try {
      const res = await createAllocTemplate(templateName.trim(), saveDrafts);
      if (!res.ok) setSaveError("Failed to save template. Please try again.");
      else { setSaved(true); setTimeout(onClose, 800); }
    } catch { setSaveError("Failed to save template. Please try again."); }
    finally { setSaving(false); }
  }

  /* ── apply handlers ── */
  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await deleteAllocTemplate(id);
      if (res.templates) setTemplates(res.templates);
      else setTemplates(t => t.filter(x => x.id !== id));
      if (selectedTemplate?.id === id) setSelectedTemplate(null);
    } catch {}
    finally { setDeletingId(null); }
  }

  async function handleApply() {
    if (!selectedTemplate) return;
    if (!Object.values(picks).some(Boolean)) { setApplyError("Pick at least one person to assign."); return; }
    // Validate every filled slot's dates BEFORE sending anything — the server
    // answers out-of-window dates with an unexplained 502.
    for (let i = 0; i < selectedTemplate.slots.length; i++) {
      if (!picks[i]) continue;
      const slot = selectedTemplate.slots[i];
      const slotLabel = [slot.roleName, slot.jobTitleName].filter(Boolean).join(" · ") || `Slot ${i + 1}`;
      const effStart = (slotStartDates[i] || projectStartDate || "").slice(0, 10);
      const effEnd   = (slotEndDates[i]   || projectEndDate   || "").slice(0, 10);
      if (effStart && effEnd && effEnd < effStart) {
        setApplyError(`${slotLabel}: the end date is before the start date.`);
        return;
      }
      if (hasScheduleWindow) {
        if (schedStartYmd && effStart && effStart < schedStartYmd) {
          setApplyError(`${slotLabel}: the start date (${fmtNice(effStart)}) is before the project schedule begins. This project has a phase schedule, so assignment dates must stay within ${schedWindowLabel}.`);
          return;
        }
        if (schedEndYmd && effEnd && effEnd > schedEndYmd) {
          setApplyError(`${slotLabel}: the end date (${fmtNice(effEnd)}) is after the project schedule ends. This project has a phase schedule, so assignment dates must stay within ${schedWindowLabel}.`);
          return;
        }
      }
    }
    setApplying(true); setApplyError("");
    try {
      for (let i = 0; i < selectedTemplate.slots.length; i++) {
        const personId = picks[i];
        if (!personId) continue;
        const slot = selectedTemplate.slots[i];
        const person = allPeople.find(p => p.id === personId);
        if (!person) continue;
        const totalHrs = slotPcts[i] ?? 0;
        const slotStart = slotStartDates[i] || projectStartDate;
        const slotEnd   = slotEndDates[i]   || projectEndDate;
        const result = await assignResource({
          ProjectID: projectId,
          Allocations: [{
            AssignedTo: personId,
            AssignedToName: person.name,
            AllocationStartDate: slotStart,
            AllocationEndDate: slotEnd,
            // When the template slot has no BU/Division/Dept stored, fall back
            // to the selected person's own org data from their staff profile —
            // same data the Add Team Member modal uses.
            DivisionName: slot.divisionName || slot.buName || person.divisionName || null,
            CRMBusinessUnitChoice: slot.buName || person.buName || null,
            Department: slot.deptName || null,
            TypeName: slot.roleName ?? "",
            Title: slot.jobTitleName || person.title || "",
            JobTitleName: slot.jobTitleName || person.title || "",
            JobTitleId: (slot as any).jobTitleId || undefined,
            AllocationHour: totalHrs,
            PctAllocation: 0,
            SoftAllocation: "false",
            NonChargeable: false,
          }],
        });
        // The server can answer 200 with a rejection in the body — assignResource
        // returns raw response TEXT, so detect rejections by string and parse the
        // JSON for the server's own plain-language Message when present.
        const resultStr = typeof result === "string" ? result : JSON.stringify(result ?? "");
        const lower = resultStr.toLowerCase();
        if (lower.includes("schedulewindow")) {
          let serverMsg = "";
          try { serverMsg = (JSON.parse(resultStr) as { Message?: string }).Message || ""; } catch { /* not JSON */ }
          setApplyError(serverMsg || `${person.name}: assignment dates must stay within the project schedule (${schedWindowLabel}).`);
          onApplied?.();
          return;
        }
        if (lower.includes("allocationoutofbounds")) {
          const m = resultStr.match(/AllocationOutofbounds~\d+~([^~]+)~([^~]+)~([^~"]+)/i);
          const who = m?.[3]?.trim() || person.name;
          setApplyError(`RM ONE rejected: ${who}'s availability (${m?.[1] ?? "?"} – ${m?.[2] ?? "?"}) doesn't cover the assignment dates. Pick someone else or update their availability in the RM ONE portal.`);
          onApplied?.();
          return;
        }
        if (lower.includes("overlappingallocation")) {
          setApplyError(`${person.name} already has an overlapping allocation on this project, so this slot couldn't be assigned. Remove the existing allocation first, then try again.`);
          onApplied?.();
          return;
        }
      }
      onApplied?.(); onClose();
    } catch (e) { setApplyError(friendlyApplyError(e)); }
    finally { setApplying(false); }
  }

  /** Turn raw server failures ("(502) {json}") into plain words. */
  function friendlyApplyError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const p = JSON.parse(jsonMatch[0]) as { error?: string; detail?: string; Message?: string };
        // Skip the api-server's generic 502 wrapper ("Error saving assignment
        // to core2 — <raw exception>") — that's the jargon we're replacing.
        const isGenericWrapper = /error saving assignment/i.test(p.error || "");
        const text = [p.Message || p.error, p.detail].filter(Boolean).join(" — ");
        if (text && !isGenericWrapper) return text;
      } catch { /* not JSON — fall through */ }
    }
    // assignResource throws "(<status>) <body>" — anchor on that shape.
    if (/^\(50[234]\)/.test(raw.trim())) {
      return hasScheduleWindow
        ? `The assignment couldn't be saved. The most common cause is dates outside the project schedule — this project's schedule runs ${schedWindowLabel}, so keep each slot's dates within that range and try again.`
        : "The assignment couldn't be saved because the scheduling service rejected it. Please check the dates and hours, then try again.";
    }
    const cleaned = raw.replace(/^Error:\s*/, "").trim();
    return cleaned || "Something went wrong. Please try again.";
  }

  async function handleCreateNew() {
    if (!newTplName.trim()) { setCreateError("Give the template a name."); return; }
    const validSlots = newSlots.filter(s => s.roleName || s.jobTitleName || s.divisionName);
    if (validSlots.length === 0) { setCreateError("Add at least one role slot with a Role, Job Title, or Division."); return; }
    setCreateSaving(true); setCreateError("");
    try {
      const drafts: SlotDraft[] = validSlots.map((s, i) => ({
        buName: s.buName || null, divisionName: s.divisionName || null,
        deptName: s.deptName || null, roleName: s.roleName || null,
        jobTitleName: s.jobTitleName || null, defaultPct: s.defaultPct, sortOrder: i,
        resourceId: null,
      }));
      const res = await createAllocTemplate(newTplName.trim(), drafts);
      if (!res.ok) { setCreateError("Failed to save. Please try again."); return; }
      const refreshed = res.templates ?? await getAllocTemplates();
      setTemplates(refreshed);
      setApplySubMode("list");
      setNewTplName(""); setNewSlots([blankSlot()]);
      /* jump straight to assigning people on the just-created template */
      goToAssignPeople(refreshed, res.id);
    } catch { setCreateError("Failed to save. Please try again."); }
    finally { setCreateSaving(false); }
  }

  const isCreateMode = mode === "apply" && applySubMode === "create";
  const isEditMode   = mode === "apply" && applySubMode === "edit";
  const isCopyMode   = mode === "apply" && applySubMode === "copy";
  const validSlotCount = newSlots.filter(s => s.roleName || s.jobTitleName || s.divisionName).length;
  const title = isEditMode ? "Edit Template" : isCreateMode ? "New Template" : isCopyMode ? "Copy from Project" : mode === "save" ? "Save as Template" : "Apply Template";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: Z.DRAWER, display: "flex", alignItems: "center", justifyContent: "center", background: OVERLAY_BG }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: MODAL_BG, border: `1px solid ${BORDER}`, borderRadius: 18, width: "min(560px, 96vw)", maxHeight: "88vh", overflow: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: MODAL_BG, zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(isCreateMode || isEditMode || isCopyMode) && (
              <button onClick={() => { setApplySubMode("list"); setCreateError(""); setEditingTemplate(null); }}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: "0 4px 0 0", display: "flex" }}>
                <ArrowLeft size={15} />
              </button>
            )}
            <div style={{ width: 32, height: 32, borderRadius: 10, background: ACCENT + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Layers size={15} color={ACCENT} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 16, color: TEXT }}>{title}</span>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: 4, borderRadius: 6 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "18px 20px 20px" }}>

          {/* ── SAVE MODE ── */}
          {mode === "save" && (
            saveDrafts.length === 0
              ? <p style={{ color: MUTED, fontSize: 13, textAlign: "center", padding: "16px 0" }}>No team members to save. Assign people to the project first.</p>
              : <>
                  <p style={{ color: MUTED, fontSize: 13, marginBottom: 14 }}>Save the current team's role structure as a reusable template. People are not saved — only roles, divisions, and default allocation percentages.</p>
                  <div style={{ marginBottom: 14 }}>{saveDrafts.map((s, i) => <SlotRow key={i} slot={s} index={i} />)}</div>
                  <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6, fontWeight: 600 }}>TEMPLATE NAME</label>
                  <input value={templateName} onChange={e => setTemplateName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void handleSave(); }}
                    placeholder="e.g. Bridge Construction Team" style={{ ...selStyle(), padding: "9px 12px" }} />
                  {saveError && <div style={{ color: "#f08080", fontSize: 12, marginTop: 8 }}>{saveError}</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                    <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 13 }}>Cancel</button>
                    <button onClick={() => void handleSave()} disabled={saving || saved} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", cursor: saving || saved ? "default" : "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: saving ? 0.7 : 1 }}>
                      {saved ? <><Check size={13} /> Saved!</> : saving ? <><Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> Saving…</> : "Save Template"}
                    </button>
                  </div>
                </>
          )}

          {/* ── APPLY MODE ── */}
          {mode === "apply" && (
            <>
              {/* ── CREATE / EDIT sub-mode ── */}
              {(applySubMode === "create" || applySubMode === "edit") && (
                <>
                  <p style={{ color: MUTED, fontSize: 13, marginBottom: 16 }}>
                    {applySubMode === "edit"
                      ? "Edit the template name and role slots below. People are never stored — only roles and org context."
                      : "Define role slots for the new template. People are not saved — you'll assign them when you apply."}
                  </p>

                  <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6, fontWeight: 600 }}>TEMPLATE NAME</label>
                  <input value={newTplName} onChange={e => setNewTplName(e.target.value)} placeholder="e.g. Retail Fit-Out Team"
                    style={{ ...selStyle(), padding: "9px 12px", marginBottom: 20 }} />

                  <>
                      <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 10, fontWeight: 600 }}>
                        ROLE SLOTS {loadingOrg && <Loader2 size={11} color={MUTED} style={{ display: "inline", verticalAlign: "middle", marginLeft: 4, animation: "spin 0.8s linear infinite" }} />}
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {newSlots.map((slot, i) => {
                          const showDiv = getBusinessRules().showDivision;
                          const filteredDivs = slot.buId ? allDivisions.filter(d => d.buId === slot.buId) : allDivisions;
                          const filteredDepts = slot.divId ? allDepts.filter(d => d.divId === slot.divId) : allDepts;
                          const slotRoles = slot.divId ? slot.roles : (!showDiv ? allRoles : slot.roles);
                          const titleOptions = titlesForSlot(slot);

                          return (
                            <div key={i} style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "rgba(255,255,255,0.02)" }}>
                              {/* slot header */}
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                                <span style={{ fontSize: 11, color: MUTED, fontWeight: 700, letterSpacing: "0.05em" }}>SLOT {i + 1}</span>
                                {newSlots.length > 1 && (
                                  <button onClick={() => removeSlot(i)} style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: 2 }}><X size={12} /></button>
                                )}
                              </div>

                              {/* Row 1: BU + Division */}
                              <div style={{ display: "grid", gridTemplateColumns: showDiv ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 8 }}>
                                <div>
                                  {fieldLabel("Business Unit")}
                                  <select value={slot.buId} onChange={e => handleBUChange(i, e.target.value)} style={selStyle()}>
                                    <option value="">— Any —</option>
                                    {allBUs.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                  </select>
                                </div>
                                {showDiv && (
                                <div>
                                  {fieldLabel("Division")}
                                  <select value={slot.divId} onChange={e => void handleDivChange(i, e.target.value)}
                                    disabled={loadingOrg}
                                    style={selStyle({ opacity: loadingOrg ? 0.45 : 1 })}>
                                    <option value="">— Any —</option>
                                    {filteredDivs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                  </select>
                                </div>
                                )}
                              </div>

                              {/* Row 2: Department */}
                              <div style={{ marginBottom: 8 }}>
                                {fieldLabel("Department")}
                                <select value={slot.deptId} onChange={e => handleDeptChange(i, e.target.value)}
                                  disabled={filteredDepts.length === 0}
                                  style={selStyle({ opacity: filteredDepts.length === 0 ? 0.45 : 1 })}>
                                  <option value="">— Any —</option>
                                  {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                              </div>

                              {/* Row 3: Role + Job Title */}
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                                {/* Role — dropdown OR manual entry */}
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                    {fieldLabel("Role")}
                                    <button
                                      onClick={() => setSlot(i, { roleMode: slot.roleMode === "manual" ? "dropdown" : "manual", roleId: "", roleName: "" })}
                                      style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: ACCENT, fontSize: 10, padding: 0, fontWeight: 600 }}
                                      title={slot.roleMode === "manual" ? "Use dropdown" : "Enter manually"}
                                    >
                                      <PencilLine size={10} />
                                      {slot.roleMode === "manual" ? "Use list" : "Manual"}
                                    </button>
                                  </div>
                                  {slot.roleMode === "manual" ? (
                                    <input
                                      value={slot.roleName}
                                      onChange={e => setSlot(i, { roleName: e.target.value })}
                                      placeholder="Type role name…"
                                      style={{ ...selStyle(), cursor: "text" }}
                                    />
                                  ) : (
                                    <select value={slot.roleId}
                                      onChange={e => handleRoleChange(i, e.target.value)}
                                      disabled={(!slot.divId && showDiv) || slot.loadingRoles}
                                      style={selStyle({ opacity: (!slot.divId && showDiv) ? 0.45 : 1 })}>
                                      <option value="">{slot.loadingRoles ? "Loading…" : (slot.divId || !showDiv) ? "— Select —" : "— Pick Division first —"}</option>
                                      {slotRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                  )}
                                </div>

                                {/* Job Title — full catalog + suggested + manual */}
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                                    {fieldLabel("Job Title")}
                                    <button
                                      onClick={() => setSlot(i, { titleMode: slot.titleMode === "manual" ? "dropdown" : "manual", jobTitleId: "", jobTitleName: "" })}
                                      style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, color: ACCENT, fontSize: 10, padding: 0, fontWeight: 600 }}
                                      title={slot.titleMode === "manual" ? "Use dropdown" : "Enter manually"}
                                    >
                                      <PencilLine size={10} />
                                      {slot.titleMode === "manual" ? "Use list" : "Manual"}
                                    </button>
                                  </div>
                                  {slot.titleMode === "manual" ? (
                                    <input
                                      value={slot.jobTitleName}
                                      onChange={e => setSlot(i, { jobTitleName: e.target.value })}
                                      placeholder="Type job title…"
                                      style={{ ...selStyle(), cursor: "text" }}
                                    />
                                  ) : (
                                    <select value={slot.jobTitleId}
                                      onChange={e => {
                                        const v = e.target.value;
                                        if (v.startsWith("__suggest__:")) {
                                          const name = v.slice("__suggest__:".length);
                                          setSlot(i, { jobTitleId: v, jobTitleName: name });
                                        } else {
                                          const jt = allJobTitles.find(t => String(t.ID) === v);
                                          setSlot(i, { jobTitleId: v, jobTitleName: jt?.Title ?? "" });
                                        }
                                      }}
                                      style={selStyle()}>
                                      <option value="">— Select —</option>
                                      {/* Standard titles FIRST (client ask) — see EditStaffModal. */}
                                      {suggestedForSlot(titleOptions).length > 0 && (
                                        <optgroup label="Suggested — picking adds it to your catalogue">
                                          {suggestedForSlot(titleOptions).map(n => (
                                            <option key={`sug-${n}`} value={`__suggest__:${n}`}>{n}</option>
                                          ))}
                                        </optgroup>
                                      )}
                                      {titleOptions.length > 0 && (
                                        <optgroup label="Your titles">
                                          {titleOptions.map(t => <option key={t.ID} value={String(t.ID)}>{t.Title}</option>)}
                                        </optgroup>
                                      )}
                                    </select>
                                  )}
                                </div>
                              </div>

                            </div>
                          );
                        })}
                      </div>

                      <button onClick={addSlot} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 8, marginTop: 10, width: "100%", border: `1.5px dashed ${ACCENT}`, background: ACCENT + "14", color: ACCENT, cursor: "pointer", fontSize: 13, fontWeight: 700, justifyContent: "center" }}>
                        <Plus size={14} /> Add another slot
                      </button>
                  </>

                  {createError && <div style={{ color: "#f08080", fontSize: 12, marginTop: 10 }}>{createError}</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                    <button onClick={() => { setApplySubMode("list"); setCreateError(""); setEditingTemplate(null); }} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 13 }}>Cancel</button>
                    <button
                      onClick={() => {
                        if (applySubMode === "edit") { void handleUpdateTemplate(); return; }
                        /* create — validate first, then ask whether the slots are enough */
                        if (!newTplName.trim()) { setCreateError("Give the template a name."); return; }
                        const valid = newSlots.filter(s => s.roleName || s.jobTitleName || s.divisionName);
                        if (valid.length === 0) { setCreateError("Add at least one role slot with a Role, Job Title, or Division."); return; }
                        setCreateError("");
                        setConfirmSlots(true);
                      }}
                      disabled={createSaving}
                      style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", cursor: createSaving ? "default" : "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: createSaving ? 0.7 : 1 }}>
                      {createSaving
                        ? <><Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> Saving…</>
                        : <><Check size={13} /> {applySubMode === "edit" ? "Update Template" : "Save Template"}</>}
                    </button>
                  </div>
                </>
              )}

              {/* ── COPY sub-mode ── */}
              {applySubMode === "copy" && (
                <>
                  {/* Source project banner */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 8, background: "rgba(107,165,57,0.1)", border: `1px solid rgba(107,165,57,0.25)`, marginBottom: 16 }}>
                    <FolderInput size={14} style={{ color: ACCENT, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>
                      {copySelectedName || projectTitle || projectId}
                    </span>
                    <span style={{ fontSize: 11, color: MUTED, marginLeft: "auto" }}>{projectId}</span>
                  </div>

                  {/* Loading team */}
                  {copyLoadingTeam && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: MUTED, fontSize: 13 }}>
                      <Loader2 size={14} style={{ animation: "spin 0.8s linear infinite" }} /> Loading team…
                    </div>
                  )}

                  {/* Team preview */}
                  {(copyLoadingTeam === false && copyMembers.length > 0) && (
                    <>
                      {/* Template name — at the top */}
                      <label style={{ display: "block", fontSize: 12, color: MUTED, marginBottom: 6, fontWeight: 600 }}>TEMPLATE NAME</label>
                      <input
                        value={copyTplName}
                        onChange={e => setCopyTplName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void handleCopySave(); }}
                        placeholder="e.g. Bridge Project Team"
                        autoFocus
                        style={{ ...selStyle(), padding: "9px 12px", marginBottom: 16 }}
                      />

                      <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, marginBottom: 8 }}>
                        {copyMembers.length} {copyMembers.length === 1 ? "TEAM MEMBER" : "TEAM MEMBERS"}
                      </div>
                      <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                        {copyMembers.map((m, i) => {
                          const hrs = m.eacHrs > 0 ? Math.round(m.eacHrs) : null;
                          const initials = m.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
                          const avatarColors = ["#6BA539","#5b8cf7","#E87722","#a855f7","#ec4899","#14b8a6","#f59e0b"];
                          const avatarBg = avatarColors[i % avatarColors.length];
                          /* field chips: label → value, only shown when non-empty */
                          const fields: { label: string; value: string; color: string }[] = [
                            { label: "BU",    value: m.memberBu || "", color: "#5b8cf7" },
                            { label: "Div",   value: m.bu || "",       color: "#a855f7" },
                            { label: "Dept",  value: m.dept || "",     color: "#14b8a6" },
                            { label: "Role",  value: m.role || "",     color: ACCENT },
                            { label: "Title", value: m.title || "",    color: ORANGE },
                          ].filter(f => f.value);
                          return (
                            <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
                              {/* name row */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: fields.length ? 8 : 0 }}>
                                <div style={{ width: 26, height: 26, borderRadius: "50%", background: avatarBg + "33", border: `1px solid ${avatarBg}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: avatarBg, flexShrink: 0 }}>
                                  {initials || "?"}
                                </div>
                                <span style={{ fontSize: 13, color: TEXT, fontWeight: 600, flex: 1 }}>{m.name}</span>
                                {hrs !== null && <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT }}>{hrs}h</span>}
                              </div>
                              {/* org + role chips */}
                              {fields.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {fields.map(f => (
                                    <span key={f.label} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 20, background: f.color + "18", border: `1px solid ${f.color}44`, fontSize: 11 }}>
                                      <span style={{ color: f.color, fontWeight: 600 }}>{f.label}</span>
                                      <span style={{ color: TEXT }}>{f.value}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {copyError && <div style={{ color: "#f08080", fontSize: 12, marginTop: 8 }}>{copyError}</div>}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                    <button onClick={() => { setApplySubMode("list"); setCopyError(""); }}
                      style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 13 }}>
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleCopySave()}
                      disabled={copySaving || copySlots.length === 0}
                      style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", cursor: copySaving || copySlots.length === 0 ? "default" : "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: copySaving || copySlots.length === 0 ? 0.5 : 1 }}>
                      {copySaving
                        ? <><Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> Saving…</>
                        : <><Check size={13} /> Save Template</>}
                    </button>
                  </div>
                </>
              )}

              {/* ── LIST sub-mode ── */}
              {applySubMode === "list" && (
                <>
                  {applyStep === 1 && (
                    <>
                      <p style={{ color: MUTED, fontSize: 13, marginBottom: 14 }}>Choose a saved template to apply to this project. You'll assign people to each role slot in the next step.</p>
                      {loadingTemplates ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Loader2 size={20} color={ACCENT} style={{ animation: "spin 0.8s linear infinite" }} /></div>
                      ) : templates.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "24px 16px", border: `1px dashed ${BORDER}`, borderRadius: 10, color: MUTED, fontSize: 13 }}>No templates yet.</div>
                      ) : (
                        /* Scroll INSIDE the list only — the header above and the
                           New template / Copy from project / Cancel buttons below
                           stay pinned and always visible, no matter how many
                           templates there are. */
                        <div style={{ maxHeight: "min(46vh, 440px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
                          {templates.map(t => (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "rgba(255,255,255,0.02)", cursor: "pointer" }}
                              onClick={() => { setSelectedTemplate(t); setPicks({}); setApplyStep(2); }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: TEXT }}>{t.name}</div>
                                <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
                                  {t.slots.length} role {t.slots.length === 1 ? "slot" : "slots"}
                                  {t.slots[0]?.roleName && ` · ${t.slots.slice(0, 3).map(s => s.roleName).join(", ")}${t.slots.length > 3 ? "…" : ""}`}
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <button onClick={e => { e.stopPropagation(); handleEditTemplate(t); }}
                                  title="Edit template"
                                  style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: 4, borderRadius: 6 }}>
                                  <PencilLine size={13} />
                                </button>
                                <button onClick={e => { e.stopPropagation(); void handleDelete(t.id); }} disabled={deletingId === t.id}
                                  title="Delete template"
                                  style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: 4, borderRadius: 6, opacity: deletingId === t.id ? 0.4 : 1 }}>
                                  {deletingId === t.id ? <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : <Trash2 size={13} />}
                                </button>
                                <ChevronRight size={14} color={MUTED} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button onClick={() => { setApplySubMode("create"); setCreateError(""); setNewTplName(""); setNewSlots([blankSlot()]); }}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, flex: 1, border: `1px dashed ${BORDER}`, background: "rgba(107,165,57,0.06)", color: ACCENT, cursor: "pointer", fontSize: 13, fontWeight: 600, justifyContent: "center" }}>
                          <Plus size={13} /> New template
                        </button>
                        <button onClick={() => { setApplySubMode("copy"); setCopySelectedId(""); setCopySelectedName(""); setCopySlots([]); setCopyTplName(""); setCopyError(""); }}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, flex: 1, border: `1px dashed ${BORDER}`, background: "rgba(91,140,247,0.06)", color: "#5b8cf7", cursor: "pointer", fontSize: 13, fontWeight: 600, justifyContent: "center" }}>
                          <FolderInput size={13} /> Copy from project
                        </button>
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                        <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 13 }}>Cancel</button>
                      </div>
                    </>
                  )}

                  {applyStep === 2 && selectedTemplate && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <button onClick={() => setApplyStep(1)} style={{ background: "transparent", border: "none", cursor: "pointer", color: MUTED, padding: 0 }}>← Back</button>
                        <span style={{ fontSize: 13, color: MUTED }}>Template:</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{selectedTemplate.name}</span>
                      </div>
                      <p style={{ color: MUTED, fontSize: 12, marginBottom: hasScheduleWindow ? 6 : 14 }}>Assign a person to each role slot. Enter total hours for the assignment and adjust the date range if needed, or set a person to "skip" to leave a slot empty.</p>
                      {hasScheduleWindow && (
                        <p style={{ color: MUTED, fontSize: 12, marginBottom: 14 }}>
                          This project has a phase schedule — assignment dates must stay within <span style={{ color: TEXT, fontWeight: 600 }}>{schedWindowLabel}</span>.
                        </p>
                      )}
                      {loadingPeople ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Loader2 size={20} color={ACCENT} style={{ animation: "spin 0.8s linear infinite" }} /></div>
                      ) : (
                        /* Same pinned-footer treatment as the template list —
                           only the slot cards scroll; Back / Assign Selected
                           stay visible below. */
                        <div style={{ maxHeight: "min(52vh, 500px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 2 }}>
                          {selectedTemplate.slots.map((slot, i) => {
                            const label = [slot.roleName, slot.jobTitleName].filter(Boolean).join(" · ") || `Slot ${i + 1}`;
                            const bu = slot.buName || slot.divisionName;
                            const filtered = allPeople.filter(p => {
                              if (!slot.roleName && !slot.jobTitleName) return true;
                              const pTitle = p.role.toLowerCase(); const pBu = p.bu.toLowerCase();
                              return (slot.roleName && pTitle.includes(slot.roleName.toLowerCase()))
                                || (slot.jobTitleName && pTitle.includes(slot.jobTitleName.toLowerCase()))
                                || (slot.buName && pBu.includes(slot.buName.toLowerCase()));
                            });
                            const assignedSet = new Set(assignedPersonIds.filter(Boolean));
                            const available = allPeople.filter(p => !assignedSet.has(p.id));
                            const filteredAvail = available.filter(p => {
                              if (!slot.roleName && !slot.jobTitleName) return true;
                              const pTitle = p.role.toLowerCase(); const pBu = p.bu.toLowerCase();
                              return (slot.roleName && pTitle.includes(slot.roleName.toLowerCase()))
                                || (slot.jobTitleName && pTitle.includes(slot.jobTitleName.toLowerCase()))
                                || (slot.buName && pBu.includes(slot.buName.toLowerCase()));
                            });
                            const options = filteredAvail.length > 0 ? filteredAvail : available;
                            const currentHrs  = slotPcts[i] ?? 0;
                            const currentStart = slotStartDates[i] || projectStartDate;
                            const currentEnd   = slotEndDates[i]   || projectEndDate;
                            const dateInputStyle: React.CSSProperties = { ...selStyle({ cursor: "text", padding: "6px 8px", flex: 1 }) };
                            return (
                              <div key={i} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "rgba(255,255,255,0.02)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{label}</span>
                                  {bu && <span style={chipStyle("#5b8cf7")}>{bu}</span>}
                                </div>
                                {/* Person picker + total hours */}
                                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                                  <select
                                    value={picks[i] ?? ""}
                                    onChange={e => setPicks(prev => ({ ...prev, [i]: e.target.value }))}
                                    style={{ ...selStyle(), flex: 1 }}
                                  >
                                    <option value="">— skip this slot —</option>
                                    {options.map(p => <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ""}</option>)}
                                  </select>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                    <input
                                      type="number" min={0} step={1}
                                      value={currentHrs || ""}
                                      placeholder="0"
                                      onChange={e => setSlotPcts(prev => ({ ...prev, [i]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                      style={{ ...selStyle({ width: 74, textAlign: "center", cursor: "text", padding: "7px 6px" }) }}
                                    />
                                    <span style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>hrs total</span>
                                  </div>
                                </div>
                                {/* Date range */}
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>Start date</div>
                                    <ScheduleWindowTip active={hasScheduleWindow} windowLabel={schedWindowLabel}>
                                      <DateField value={currentStart}
                                        min={schedStartYmd || undefined} max={schedEndYmd || undefined}
                                        onChange={v => setSlotStartDates(prev => ({ ...prev, [i]: v }))}
                                        style={dateInputStyle}
                                      />
                                    </ScheduleWindowTip>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>End date</div>
                                    <ScheduleWindowTip active={hasScheduleWindow} windowLabel={schedWindowLabel}>
                                      <DateField value={currentEnd}
                                        min={schedStartYmd || undefined} max={schedEndYmd || undefined}
                                        onChange={v => setSlotEndDates(prev => ({ ...prev, [i]: v }))}
                                        style={dateInputStyle}
                                      />
                                    </ScheduleWindowTip>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {applyError && <div style={{ color: "#f08080", fontSize: 12, marginTop: 10 }}>{applyError}</div>}
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                        <button onClick={() => setApplyStep(1)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 13 }}>Back</button>
                        <button onClick={() => void handleApply()} disabled={applying} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: ORANGE, color: "#fff", cursor: applying ? "default" : "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: applying ? 0.7 : 1 }}>
                          {applying ? <><Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> Assigning…</> : <><Plus size={13} /> Assign Selected</>}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── "enough slots?" confirmation before saving a new template ── */}
      {confirmSlots && (
        <div style={{ position: "fixed", inset: 0, zIndex: Z.DRAWER_SUB, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}
          onClick={e => { if (e.target === e.currentTarget) setConfirmSlots(false); }}>
          <div style={{ background: MODAL_BG, border: `1px solid ${BORDER}`, borderRadius: 14, width: "min(420px, 92vw)", padding: "22px 22px 18px", boxShadow: "0 20px 48px rgba(0,0,0,0.55)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: ACCENT + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Layers size={15} color={ACCENT} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>Save this template?</span>
            </div>
            <p style={{ color: MUTED, fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
              It has <span style={{ color: TEXT, fontWeight: 700 }}>{validSlotCount}</span> role {validSlotCount === 1 ? "slot" : "slots"}.
              {" "}Is that enough, or do you want to add more? After saving you'll go straight to assigning people.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmSlots(false)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1.5px dashed ${ACCENT}`, background: ACCENT + "10", color: ACCENT, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Plus size={13} /> Add more slots
              </button>
              <button onClick={() => { setConfirmSlots(false); void handleCreateNew(); }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Check size={13} /> Save & assign people
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
