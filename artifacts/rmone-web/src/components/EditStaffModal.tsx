import { useEffect, useMemo, useRef, useState } from "react";
import { X, Pencil, Loader2, AlertCircle, Plus, Mail, CheckCircle2 } from "lucide-react";
import { getBusinessRules } from "@/lib/businessRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import {
  getDivisions, getRolesByBU, getDepartments, getJobTitles, getBusinessUnits, createBusinessUnit,
  updateStaffAssignment, createRole, createJobTitle, createDepartment, getStoredUser, bustCache,
  getUserSkills, addUserSkill, deleteUserSkill,
  getUserExperienceTags, addUserExperienceTag, deleteUserExperienceTag,
  updateStaffExtra, authHeaders, notifyAllocationChanged,
  getResourceAvailability, addResourceAvailability, deleteResourceAvailabilityWindow,
  type AssignRole, type JobTitleRow, type LiveResourceProxy, type ResourceAvailabilityWindow,
} from "@/lib/api";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { getStaffCore } from "@/lib/api";
import { fetchAccessLevels, isCustomAcl, notifyPermissionsChanged, type AccessLevelDef } from "@/lib/permissions";
import { Z } from "@/lib/zLayers";

const C = {
  bg: "#FFFFFF",
  card: "#F5F8FA",
  border: "#D5DEE5",
  borderSoft: "#E8EDF2",
  green: "#6BA539",
  red: "#C8102E",
  text: "#253746",
  muted: "#6B7E8A",
};

const EMP_TYPE_OPTIONS = ["Full-Time", "Part-Time", "As Needed", "Temporary", "SCA Contingency Staff"];

type Dept = { ID: string; Title: string; DivisionIdLookup: string | null };
type Skill = { id: number; skillName: string; proficiency: number | null; isPrimary: boolean };
type Tag   = { id: number; tagName: string };

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
  letterSpacing: 0.4, marginBottom: 5, display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.border}`,
  fontSize: 13, color: C.text, background: C.bg, outline: "none", boxSizing: "border-box",
};
const addRowStyle: React.CSSProperties = {
  display: "flex", gap: 6, marginTop: 6, alignItems: "center",
};
const addBtnStyle: React.CSSProperties = {
  padding: "9px 13px", borderRadius: 9, border: "none", background: C.green,
  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.border}`,
  background: C.bg, color: C.muted, fontSize: 13, cursor: "pointer",
};
const dividerStyle: React.CSSProperties = {
  margin: "4px 0 2px", borderTop: `1px solid ${C.borderSoft}`,
};
const sectionHeadStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, color: C.muted, letterSpacing: 0.7,
  textTransform: "uppercase", marginBottom: 8,
};

export function EditStaffModal({
  open, resource, onClose, onSaved, tenantId,
}: {
  open: boolean;
  resource: LiveResourceProxy | null;
  onClose: () => void;
  onSaved: () => void;
  tenantId?: string;
}) {
  // ── Org/assignment fields ──
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [bu, setBu] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [jobTitleId, setJobTitleId] = useState("");
  // "" | "Admin" | "Manager" | "User" | "custom:<id>" (admin-defined level, #87)
  const [accessLevel, setAccessLevel] = useState<string>("");
  const [customLevels, setCustomLevels] = useState<AccessLevelDef[]>([]);

  const [buList, setBuList] = useState<{ id: string; label: string }[]>([]);
  const [bus, setBus] = useState<{ id: string; label: string; buId: string | null }[]>([]);
  const [allDepts, setAllDepts] = useState<Dept[]>([]);
  const [roles, setRoles] = useState<AssignRole[]>([]);
  const [titles, setTitles] = useState<JobTitleRow[]>([]);
  const divToBuRef = useRef<Map<string, string>>(new Map());
  // Fields the user already changed during this open — the live re-seed
  // (getStaffCore below) must never clobber an in-progress edit.
  const touchedRef = useRef<Set<string>>(new Set());
  // Synchronous locks: state-based guards (submitting/avAdding) lag a render
  // behind, so rapid double-clicks could double-fire the writes below.
  const submitLockRef = useRef(false);
  const avAddInFlightRef = useRef<Promise<boolean> | null>(null);

  const [addingBU, setAddingBU] = useState(false);
  const [newBUName, setNewBUName] = useState("");
  const [savingBU, setSavingBU] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [addingTitle, setAddingTitle] = useState(false);
  const [newTitleName, setNewTitleName] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [savingDept, setSavingDept] = useState(false);

  // ── Identity fields ──
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");

  // ── Contact fields ──
  const [empType, setEmpType] = useState("");
  const [phone, setPhone]     = useState("");

  // ── Skills ──
  const [pgSkills, setPgSkills]       = useState<Skill[]>([]);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [addingSkill, setAddingSkill] = useState(false);

  // ── Experience tags ──
  const [pgTags, setPgTags]       = useState<Tag[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  // ── Leave & availability ──
  const [avWindows, setAvWindows]   = useState<ResourceAvailabilityWindow[]>([]);
  const [avStart, setAvStart]       = useState("");
  const [avEnd, setAvEnd]           = useState("");
  const [avPct, setAvPct]           = useState("0");   // "0" = on leave
  const [avReason, setAvReason]     = useState("");
  const [avLeaveType, setAvLeaveType] = useState(""); // e.g. "PTO", "Vacation"
  const [avAdding, setAvAdding]     = useState(false);
  const [avError, setAvError]       = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Invite (set-password link) resend ──
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent]       = useState(false);
  const [inviteErr, setInviteErr]         = useState<string | null>(null);

  // Seed every field from the person's current values, then load the catalogs.
  useEffect(() => {
    if (!open || !resource) return;
    // Stale-response guard: a slow catalog fetch from a PREVIOUS open (other
    // person / other company) must never resolve late and overwrite this
    // open's catalogs or untouched fields.
    let cancelled = false;
    touchedRef.current = new Set();
    const divId = resource.divisionId || "";
    setBu(divId);
    setDepartmentId(resource.departmentId || "");
    setRoleId(resource.roleId || "");
    setJobTitleId(resource.jobTitleId || "");
    setBusinessUnitId("");
    const lvlRaw = String(resource.accessLevel ?? "").trim().toLowerCase();
    setAccessLevel(
      lvlRaw === "admin" ? "Admin"
      : lvlRaw === "manager" ? "Manager"
      : lvlRaw === "user" ? "User"
      : isCustomAcl(lvlRaw) ? lvlRaw
      : "");
    // Effective tenant for catalog fetches: resource.tenantId (GUID, always
    // correct) wins over the prop (which is the LOGGED-IN user's own tenant
    // and is wrong when a superadmin views another company's Resources page).
    const effTenantId = resource.tenantId || tenantId;
    // Admin-defined levels for the dropdown (#87) — soft-fail: the built-ins
    // always work, custom options just don't appear.
    fetchAccessLevels(effTenantId).then(l => { if (!cancelled) setCustomLevels(l); }).catch(() => { if (!cancelled) setCustomLevels([]); });
    setFullName(resource.name ?? "");
    setEmail(resource.username ?? "");
    setEmpType(resource.employeeType ?? "");
    setPhone(resource.phoneNumber ?? "");
    setError(null); setRoles([]);
    setAddingBU(false); setNewBUName(""); setSavingBU(false);
    setAddingRole(false); setNewRoleName(""); setSavingRole(false);
    setAddingTitle(false); setNewTitleName(""); setSavingTitle(false);
    setAddingDept(false); setNewDeptName(""); setSavingDept(false);
    setNewSkillInput(""); setAddingSkill(false);
    setNewTagInput("");   setAddingTag(false);
    setAvWindows([]); setAvStart(""); setAvEnd(""); setAvPct("0"); setAvReason(""); setAvLeaveType("");
    setAvAdding(false); setAvError(null);
    // Load leave/availability windows lazily (best-effort) — never block the modal.
    getResourceAvailability(resource.id, effTenantId || undefined).then(w => { if (!cancelled) setAvWindows(w); }).catch(() => { if (!cancelled) setAvWindows([]); });
    setInviteSending(false); setInviteSent(false); setInviteErr(null);
    bustCache("divisions"); bustCache("departments"); bustCache("business-units");
    // Load org catalogs + skills/tags in parallel
    Promise.all([
      getDivisions(effTenantId).catch(() => [] as unknown[]),
      getDepartments(effTenantId).catch(() => [] as unknown[]),
      getJobTitles(effTenantId).catch(() => [] as JobTitleRow[]),
      getBusinessUnits(effTenantId).catch(() => [] as unknown[]),
      getUserSkills(resource.id).catch(() => [] as Skill[]),
      getUserExperienceTags(resource.id).catch(() => [] as Tag[]),
      // Live row re-seed: the `resource` prop is the grid's in-tab copy and
      // can predate the person's latest saves (long-open tab). Pass the tenant
      // GUID so superadmins look up the person in the right company.
      getStaffCore(resource.id, effTenantId).catch(() => null),
    ]).then(([divsRaw, deptsRaw, titlesRaw, busRaw, skills, tags, freshRow]) => {
      if (cancelled) return;
      const rawTitles = Array.isArray(titlesRaw) ? titlesRaw as JobTitleRow[] : [];
      setTitles(rawTitles);
      setJobTitleId(prev => {
        if (prev) return prev;
        const nm = (resource?.role ?? "").trim().toLowerCase();
        if (!nm) return prev;
        const match = rawTitles.find(t => (t.Title || "").trim().toLowerCase() === nm);
        return match ? String(match.ID) : prev;
      });

      const busArr = Array.isArray(busRaw) ? busRaw as Record<string, unknown>[] : [];
      const buMapped = busArr.map(b => {
        const id = String(b.ID ?? b.Id ?? "");
        const short = String(b.ShortName ?? "").trim();
        const title = String(b.Title ?? "").trim();
        return { id, label: short && short !== title ? `${short} — ${title}` : (title || id) };
      }).filter(b => b.id);
      const buSeen = new Set<string>();
      setBuList(buMapped.filter(b => { if (buSeen.has(b.id)) return false; buSeen.add(b.id); return true; }));

      const divs = Array.isArray(divsRaw) ? divsRaw as Record<string, unknown>[] : [];
      const map = new Map<string, string>();
      const divMapped = divs.map(d => {
        const id = String(d.ID ?? d.Id ?? "");
        const short = String(d.ShortName ?? "").trim();
        const title = String(d.Title ?? "").trim();
        const label = short ? (title && title !== short ? `${short} — ${title}` : short) : title;
        const buId = d.BusinessUnitIdLookup != null ? String(d.BusinessUnitIdLookup) : null;
        if (id && buId) map.set(id, buId);
        return { id, label: label || id, buId };
      }).filter(b => b.id);
      divToBuRef.current = map;
      const divSeen = new Set<string>();
      setBus(divMapped.filter(b => { if (divSeen.has(b.id)) return false; divSeen.add(b.id); return true; }));

      // Apply the live row over the seeds for any field the user hasn't
      // touched yet. Division/department/access follow the live value even
      // when it is empty (honest blank); role/job title only overwrite with
      // a real value so the name-fallback matching below stays effective.
      let effDivId = divId;
      if (freshRow && typeof freshRow === "object") {
        const t = touchedRef.current;
        const fr = freshRow as Record<string, unknown>;
        const s = (v: unknown) => (v == null ? "" : String(v));
        if (!t.has("division")) { effDivId = s(fr.divisionId); setBu(effDivId); }
        if (!t.has("department")) setDepartmentId(s(fr.departmentId));
        if (!t.has("role") && s(fr.roleId)) setRoleId(s(fr.roleId));
        if (!t.has("jobTitle") && s(fr.jobTitleId)) setJobTitleId(s(fr.jobTitleId));
        if (!t.has("access")) {
          const lvl = s(fr.accessLevel).trim().toLowerCase();
          setAccessLevel(
            lvl === "admin" ? "Admin"
            : lvl === "manager" ? "Manager"
            : lvl === "user" ? "User"
            : isCustomAcl(lvl) ? lvl
            : "");
        }
        if (!t.has("empType") && s(fr.employeeType)) setEmpType(s(fr.employeeType));
      }
      if (effDivId && map.has(effDivId) && !touchedRef.current.has("bu")) setBusinessUnitId(map.get(effDivId)!);

      const depts = Array.isArray(deptsRaw) ? deptsRaw as Record<string, unknown>[] : [];
      const deptMapped = depts.map(d => ({
        ID: String(d.ID ?? d.Id ?? ""),
        Title: String(d.Title ?? d.Name ?? "").trim(),
        DivisionIdLookup: d.DivisionIdLookup == null ? null : String(d.DivisionIdLookup),
      })).filter(d => d.ID);
      const deptSeen = new Set<string>();
      setAllDepts(deptMapped.filter(d => { if (deptSeen.has(d.ID)) return false; deptSeen.add(d.ID); return true; }));

      setPgSkills(Array.isArray(skills) ? skills as Skill[] : []);
      setPgTags(Array.isArray(tags) ? tags as Tag[] : []);
    });
    return () => { cancelled = true; };
  }, [open, resource]);

  useEffect(() => {
    // Division tier hidden → no division is ever picked, but the roles list
    // is tenant-wide server-side; use a sentinel key so it still loads.
    const divKey = bu || (!getBusinessRules().showDivision ? "all" : "");
    if (!open || !divKey) { setRoles([]); return; }
    let cancelled = false;
    // Pass the person's company so superadmins see THAT company's roles, not
    // their own login tenant's (route override is superadmin-gated).
    getRolesByBU(divKey, resource?.tenantId || tenantId || undefined).then(r => {
      if (cancelled) return;
      const raw = Array.isArray(r) ? r : [];
      const seen = new Set<string>();
      const deduped = raw.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
      setRoles(deduped);
      setRoleId(prev => {
        if (prev) return prev;
        const nm = (resource?.roleName ?? "").trim().toLowerCase();
        if (!nm) return prev;
        const match = deduped.find(x => x.name.toLowerCase() === nm);
        return match ? match.id : prev;
      });
    }).catch(() => { if (!cancelled) setRoles([]); });
    return () => { cancelled = true; };
  }, [open, bu]);

  const divIds = useMemo(() => new Set(bus.map(b => b.id)), [bus]);
  const depts = useMemo(() => {
    let list: typeof allDepts;
    if (!bu) {
      // No division picked yet. If a Business Unit IS picked and the tenant
      // has divisions linked to it, narrow to departments owned by that BU's
      // divisions. Tenants with partial hierarchies stay fully usable: with
      // no divisions at all (BU+Dept only) or no BU links, we fall back to
      // the full list so the picker is never empty.
      const buDivIds = businessUnitId
        ? new Set(bus.filter(b => b.buId === businessUnitId).map(b => b.id))
        : null;
      if (buDivIds && buDivIds.size > 0) {
        const underBu = allDepts.filter(d => {
          const dlk = d.DivisionIdLookup;
          return dlk != null && dlk !== "" && buDivIds.has(String(dlk));
        });
        list = underBu.length > 0 ? underBu : allDepts;
      } else {
        list = allDepts;
      }
    } else {
      const own = allDepts.filter(d => String(d.DivisionIdLookup ?? "") === bu);
      list = own.length > 0 ? own : allDepts.filter(d => {
        const dlk = d.DivisionIdLookup;
        return dlk == null || dlk === "" || !divIds.has(String(dlk));
      });
    }
    if (departmentId && !list.some(d => d.ID === departmentId)) {
      const cur = allDepts.find(d => d.ID === departmentId);
      if (cur) list = [cur, ...list];
    }
    return list;
  }, [allDepts, bu, divIds, departmentId, businessUnitId, bus]);

  const deptIds = useMemo(() => new Set(allDepts.map(d => d.ID)), [allDepts]);
  const filteredTitles = useMemo(
    () => titles.filter(t => {
      if (jobTitleId && String(t.ID) === jobTitleId) return true;
      if (!departmentId) return true;
      const dk = t.DepartmentId == null ? "" : String(t.DepartmentId).trim();
      if (!dk) return true;
      if (!deptIds.has(dk)) return true;
      return dk === departmentId;
    }),
    [titles, departmentId, deptIds, jobTitleId],
  );
  const suggestedTitles = useMemo(
    () => STANDARD_JOB_TITLES.filter(
      n => !filteredTitles.some(t => (t.Title || "").trim().toLowerCase() === n.toLowerCase()),
    ),
    [filteredTitles],
  );
  const divLabelById = useMemo(() => new Map(bus.map(b => [b.id, b.label])), [bus]);
  const divIdSet = useMemo(() => new Set(bus.map(b => b.id)), [bus]);
  const dupDeptTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of depts) { const k = d.Title.toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [depts]);
  const deptLabel = (d: { ID: string; Title: string; DivisionIdLookup: string | null }) => {
    if (!dupDeptTitles.has(d.Title.toLowerCase())) return d.Title;
    const dlk = d.DivisionIdLookup == null ? "" : String(d.DivisionIdLookup);
    const div = dlk && divIdSet.has(dlk) ? divLabelById.get(dlk) : "";
    return div ? `${d.Title} (${div})` : `${d.Title} (Unassigned)`;
  };
  const filteredBus = useMemo(
    () => bus.filter(d => !businessUnitId || !d.buId || d.buId === businessUnitId),
    [bus, businessUnitId],
  );

  // ── Handlers ──
  async function handleAddBU() {
    const nm = newBUName.trim();
    if (!nm || savingBU) return;
    setSavingBU(true); setError(null);
    try {
      const created = await createBusinessUnit(nm);
      setBuList(prev => prev.some(b => b.id === created.id) ? prev : [...prev, { id: created.id, label: created.name }].sort((a, b) => a.label.localeCompare(b.label)));
      setBusinessUnitId(created.id);
      setAddingBU(false); setNewBUName("");
    } catch (e) { setError((e as Error)?.message || "Could not add the business unit."); }
    finally { setSavingBU(false); }
  }

  async function handleAddRole() {
    const nm = newRoleName.trim();
    if (!nm || savingRole) return;
    setSavingRole(true); setError(null);
    try {
      const created = await createRole(nm);
      setRoles(prev => prev.some(r => r.id === created.id) ? prev : [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setRoleId(created.id);
      setAddingRole(false); setNewRoleName("");
    } catch (e) { setError((e as Error)?.message || "Could not add the role."); }
    finally { setSavingRole(false); }
  }

  async function handleAddTitle(nameArg?: string) {
    const nm = (nameArg ?? newTitleName).trim();
    if (!nm || savingTitle) return;
    setSavingTitle(true); setError(null);
    try {
      const created = await createJobTitle(nm, departmentId || undefined);
      const idNum = Number(created.id);
      setTitles(prev => prev.some(t => String(t.ID) === String(created.id))
        ? prev
        : [...prev, { ID: idNum, Title: created.name, JobTitleName: created.name, DepartmentId: departmentId || undefined } as JobTitleRow]
            .sort((a, b) => (a.Title || "").localeCompare(b.Title || "")));
      setJobTitleId(String(created.id));
      setAddingTitle(false); setNewTitleName("");
    } catch (e) { setError((e as Error)?.message || "Could not add the job title."); }
    finally { setSavingTitle(false); }
  }

  async function handleAddDept() {
    const nm = newDeptName.trim();
    if (!nm || savingDept) return;
    setSavingDept(true); setError(null);
    try {
      const created = await createDepartment(nm);
      setAllDepts(prev => prev.some(d => d.ID === created.id) ? prev : [...prev, { ID: created.id, Title: created.name, DivisionIdLookup: null }].sort((a, b) => a.Title.localeCompare(b.Title)));
      setDepartmentId(created.id);
      setAddingDept(false); setNewDeptName("");
    } catch (e) { setError((e as Error)?.message || "Could not add the department."); }
    finally { setSavingDept(false); }
  }

  async function handleAddSkill() {
    const nm = newSkillInput.trim();
    if (!nm || addingSkill || !resource) return;
    setAddingSkill(true);
    try {
      await addUserSkill(resource.id, nm);
      const fresh = await getUserSkills(resource.id);
      setPgSkills(fresh);
      setNewSkillInput("");
    } catch { /* ignore */ }
    finally { setAddingSkill(false); }
  }

  async function handleDeleteSkill(id: number) {
    if (!resource) return;
    try {
      await deleteUserSkill(resource.id, id);
      setPgSkills(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ }
  }

  async function handleAddTag() {
    const nm = newTagInput.trim();
    if (!nm || addingTag || !resource) return;
    setAddingTag(true);
    try {
      await addUserExperienceTag(resource.id, nm);
      const fresh = await getUserExperienceTags(resource.id);
      setPgTags(fresh);
      setNewTagInput("");
    } catch { /* ignore */ }
    finally { setAddingTag(false); }
  }

  async function handleDeleteTag(id: number) {
    if (!resource) return;
    try {
      await deleteUserExperienceTag(resource.id, id);
      setPgTags(prev => prev.filter(t => t.id !== id));
    } catch { /* ignore */ }
  }

  // Format "YYYY-MM-DD" → "12 Aug 2026" for the window list, safely.
  function fmtDate(d: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return d;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = Number(m[2]) - 1;
    return `${Number(m[3])} ${months[mi] ?? m[2]} ${m[1]}`;
  }

  function handleAddAvailability(): Promise<boolean> {
    // Single-flight: a Save that lands during a manual "+ Add" (or a rapid
    // double-click) shares the in-flight request instead of double-POSTing
    // the same window — and never reports a false failure for a request
    // that is still succeeding.
    if (avAddInFlightRef.current) return avAddInFlightRef.current;
    const p = doAddAvailability();
    avAddInFlightRef.current = p;
    void p.finally(() => { avAddInFlightRef.current = null; });
    return p;
  }

  async function doAddAvailability(): Promise<boolean> {
    if (!resource) return false;
    setAvError(null);
    if (!avStart || !avEnd) { setAvError("Please choose both a start date and an end date."); return false; }
    if (avEnd < avStart) { setAvError("The end date must be on or after the start date."); return false; }
    const pctNum = Math.round(Number(avPct));
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 99) {
      setAvError("Availability must be a number from 0 to 99."); return false;
    }
    setAvAdding(true);
    try {
      const created = await addResourceAvailability(resource.id, {
        startDate: avStart, endDate: avEnd, availabilityPct: pctNum,
        reason: avReason.trim() || undefined,
        leaveType: avLeaveType.trim() || undefined,
      }, resource.tenantId || tenantId || undefined);
      // Server is idempotent on dates: re-adding the same period UPDATES the
      // existing row and returns it — replace by id so the list never shows
      // the same window twice.
      setAvWindows(prev => [...prev.filter(w => w.id !== created.id), created]);
      setAvStart(""); setAvEnd(""); setAvPct("0"); setAvReason(""); setAvLeaveType("");
      return true;
    } catch (e) {
      setAvError((e as Error)?.message || "Could not add this leave/availability period.");
      return false;
    } finally {
      setAvAdding(false);
    }
  }

  async function handleDeleteAvailability(id: number) {
    if (!resource) return;
    try {
      await deleteResourceAvailabilityWindow(resource.id, id, resource.tenantId || tenantId || undefined);
      setAvWindows(prev => prev.filter(w => w.id !== id));
    } catch (e) {
      setAvError((e as Error)?.message || "Could not remove this period.");
    }
  }

  async function submit() {
    // Ref lock is synchronous — two rapid Save clicks can both pass a
    // state-based guard before React re-renders, double-firing every write.
    if (!resource || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      await doSubmit();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  async function doSubmit() {
    if (!resource) return;
    const nameTrim  = fullName.trim();
    const emailTrim = email.trim().toLowerCase();
    if (!nameTrim) { setError("The name cannot be empty."); return; }
    if (!emailTrim || !emailTrim.includes("@") || emailTrim.includes(" ")) {
      setError("Please enter a valid login email address."); return;
    }
    // A leave period typed into the form but never "+ Add"ed used to be
    // SILENTLY DISCARDED on Save Changes — users filled the dates, hit Save,
    // and the leave never existed. Auto-add any pending leave entry so
    // "Save Changes" saves everything visible in the form; if it can't be
    // added (bad dates), block the save with a loud error instead.
    if (avStart || avEnd) {
      const added = await handleAddAvailability();
      if (!added) {
        setError("The leave period below couldn't be saved — fix or clear its dates, then save again.");
        return;
      }
    }
    setError(null);
    try {
      const roleName = roles.find(r => r.id === roleId)?.name || "";
      // Only send identity fields when they actually changed — a username
      // change is a login change, so we never write it back redundantly.
      const nameChanged  = nameTrim !== (resource.name ?? "").trim();
      const emailChanged = emailTrim !== (resource.username ?? "").trim().toLowerCase();
      // Both writes run silent: notifying after the FIRST one triggers a
      // roster refetch that races the still-pending second write — the
      // refetch captures a pre-write snapshot and the just-saved fields
      // (employee type / phone) look like they vanished until a page reload.
      // Bust + notify exactly once, after BOTH writes have landed.
      // Division tier hidden → resolve the hidden bridge division so the
      // person keeps a connected Division→BU chain. Bridge resolution is
      // token-scoped (logged-in tenant), so skip it when a super-admin
      // drives this modal against another tenant.
      const resolvedDivisionId = tenantId ? bu : await resolveDivisionForSave(bu, businessUnitId);
      await Promise.all([
        updateStaffAssignment(resource.id, {
          divisionId: resolvedDivisionId || undefined,
          departmentId: departmentId || undefined,
          roleId: roleId || undefined,
          jobTitleId: jobTitleId || undefined,
          roleName: roleName || undefined,
          accessLevel: accessLevel || undefined,
          // Superadmin editing another company: write into THAT company's row
          // (server-gated; ignored for normal users). Without it the
          // tenant-scoped update matches nothing and silently no-ops.
          tenantId: resource.tenantId || tenantId || undefined,
        }, { silent: true }),
        updateStaffExtra(resource.id, {
          employeeType: empType || null,
          phoneNumber: phone.trim() || null,
          ...(nameChanged  ? { name: nameTrim } : {}),
          ...(emailChanged ? { username: emailTrim } : {}),
          tenantId: resource.tenantId || tenantId || undefined,
        }, { silent: true }),
      ]);
      bustCache("resource-allocations:");
      notifyAllocationChanged();
      // The access-level dropdown may have changed WHO CAN DO WHAT — make
      // every open page (this tab + sibling tabs) re-read permissions right
      // away instead of waiting for a manual refresh. (When the edited person
      // is someone else in a different browser session, their tab self-heals
      // via the focus/TTL refetch in lib/permissions.)
      notifyPermissionsChanged();
      onSaved();
      onClose();
    } catch (e) {
      // A partial failure may still have landed ONE of the two writes — bust
      // and notify anyway so the roster never serves a half-updated snapshot
      // from the 5-minute cache. An extra refetch on total failure is harmless.
      // Same for permissions: the access-level write may have landed even
      // though the other one failed, so re-sync gating everywhere too.
      bustCache("resource-allocations:");
      notifyAllocationChanged();
      notifyPermissionsChanged();
      setError((e as Error)?.message || "Could not save changes.");
    }
  }

  // Send (or resend) the set-password invite email for this person. Success is
  // only reported when the backend confirms the email actually went out.
  async function handleResendInvite() {
    if (!resource || inviteSending) return;
    const tid = resource?.tenantId || tenantId || getStoredUser()?.tenant || "";
    if (!tid) { setInviteErr("No tenant found for this session."); return; }
    setInviteSending(true); setInviteErr(null); setInviteSent(false);
    try {
      const res = await fetch("/api/onboarding/invites/send", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tid, userGuids: [resource.id] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const ok = (d.failedCount ?? 0) === 0 && (d.sentCount ?? 0) > 0;
      if (!ok) throw new Error(d.failed?.[0]?.reason || "The invite email could not be sent.");
      setInviteSent(true);
      setTimeout(() => setInviteSent(false), 4000);
    } catch (e) {
      setInviteErr((e as Error)?.message || "Failed to send the invite.");
    } finally {
      setInviteSending(false);
    }
  }

  if (!open || !resource) return null;

  const inviteEmail = (resource.username || "").trim();
  const canInvite = inviteEmail.includes("@") && getStoredUser()?.isAdmin !== false;

  return (
    <div
      onClick={onClose}
      style={{
        // z-index must beat EVERY surface that can open this modal: the staff
        // View-Details popup (1000), the expanded-card overlay (1200) and the
        // risk/demand popups (10000) — otherwise Edit renders BEHIND them.
        position: "fixed", inset: 0, background: "rgba(15,30,42,0.55)", zIndex: Z.EDIT_MODAL,
        // Card stays static and centered; long content scrolls INSIDE the
        // card body (see "Scrollable body" below), never the overlay.
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        // Radix modal dialogs set pointer-events:none on <body>; this portal
        // must opt back in or it appears frozen when stacked above a Dialog.
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 500, background: C.bg, borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)", overflow: "hidden",
          // Small-laptop friendliness: the modal itself never grows past the
          // viewport — the body scrolls INSIDE while header + actions stay
          // pinned and always visible.
          maxHeight: "min(92vh, 860px)", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header (pinned) */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: `1px solid ${C.borderSoft}`, flexShrink: 0,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: C.green + "1A",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Pencil size={17} color={C.green} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Edit Staff Details</div>
            <div style={{
              fontSize: 11.5, color: C.muted, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{resource.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}>
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{
          padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13,
          overflowY: "auto", flex: 1, minHeight: 0,
        }}>

          {/* ── Section: Name & Email ── */}
          <div style={sectionHeadStyle}>Name &amp; Email</div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Jane Smith"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Login Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@company.com"
                style={inputStyle}
              />
            </div>
          </div>

          {/* ── Section: Role & Organization ── */}
          <div style={dividerStyle} />
          <div style={sectionHeadStyle}>Role &amp; Organization</div>

          {getBusinessRules().showBusinessUnit && (
          <div>
            <label style={labelStyle}>Business Unit</label>
            <select
              style={inputStyle} value={businessUnitId}
              onChange={e => {
                const v = e.target.value;
                touchedRef.current.add("bu");
                if (v === "__add__") { setAddingBU(true); return; }
                setBusinessUnitId(v);
                if (v && bu) {
                  const divBuId = divToBuRef.current.get(bu);
                  if (divBuId && divBuId !== v) { touchedRef.current.add("division"); touchedRef.current.add("role"); setBu(""); setRoleId(""); }
                }
              }}
            >
              <option value="">— All / Unassigned —</option>
              {buList.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              <option value="__add__">➕ Add new business unit…</option>
            </select>
            {addingBU && (
              <div style={addRowStyle}>
                <input
                  autoFocus style={{ ...inputStyle, flex: 1 }} value={newBUName}
                  placeholder="e.g. Architecture, Engineering"
                  onChange={e => setNewBUName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddBU(); } }}
                />
                <button type="button" style={addBtnStyle} disabled={!newBUName.trim() || savingBU} onClick={() => void handleAddBU()}>
                  {savingBU ? "…" : "Add"}
                </button>
                <button type="button" style={cancelBtnStyle} onClick={() => { setAddingBU(false); setNewBUName(""); }}>✕</button>
              </div>
            )}
          </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            {getBusinessRules().showDivision && (
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Division</label>
              <select
                style={inputStyle} value={bu}
                onChange={e => {
                  const v = e.target.value;
                  touchedRef.current.add("division"); touchedRef.current.add("role"); touchedRef.current.add("bu");
                  setBu(v); setRoleId("");
                  if (v) {
                    const buId = divToBuRef.current.get(v);
                    if (buId) setBusinessUnitId(buId);
                  }
                }}
              >
                <option value="">Select division</option>
                {filteredBus.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            )}
            {getBusinessRules().showDepartment && (
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Department</label>
                <select style={inputStyle} value={departmentId} onChange={e => {
                  touchedRef.current.add("department");
                  if (e.target.value === "__adddept__") { setAddingDept(true); return; }
                  setDepartmentId(e.target.value);
                }}>
                  <option value="">Select department</option>
                  {depts.map(d => <option key={d.ID} value={d.ID}>{deptLabel(d)}</option>)}
                  <option value="__adddept__">➕ Add new department…</option>
                </select>
                {addingDept && (
                  <div style={addRowStyle}>
                    <input
                      autoFocus style={{ ...inputStyle, flex: 1 }} value={newDeptName}
                      placeholder="e.g. Engineering, Design"
                      onChange={e => setNewDeptName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddDept(); } }}
                    />
                    <button type="button" style={addBtnStyle} disabled={!newDeptName.trim() || savingDept} onClick={() => void handleAddDept()}>
                      {savingDept ? "…" : "Add"}
                    </button>
                    <button type="button" style={cancelBtnStyle} onClick={() => { setAddingDept(false); setNewDeptName(""); }}>✕</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Role</label>
              <select
                style={inputStyle} value={roleId}
                onChange={e => {
                  touchedRef.current.add("role");
                  if (e.target.value === "__add__") { setAddingRole(true); return; }
                  setRoleId(e.target.value);
                }}
              >
                <option value="">Select role</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="__add__">➕ Add new role…</option>
              </select>
              {addingRole && (
                <div style={addRowStyle}>
                  <input
                    autoFocus style={{ ...inputStyle, flex: 1 }} value={newRoleName}
                    placeholder="e.g. CEO, CFO, COO"
                    onChange={e => setNewRoleName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddRole(); } }}
                  />
                  <button type="button" style={addBtnStyle} disabled={!newRoleName.trim() || savingRole} onClick={() => void handleAddRole()}>
                    {savingRole ? "…" : "Add"}
                  </button>
                  <button type="button" style={cancelBtnStyle} onClick={() => { setAddingRole(false); setNewRoleName(""); }}>✕</button>
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Job Title</label>
              <select
                style={inputStyle} value={jobTitleId}
                disabled={savingTitle}
                onChange={e => {
                  const v = e.target.value;
                  touchedRef.current.add("jobTitle");
                  if (v === "__add__") { setAddingTitle(true); return; }
                  if (v.startsWith("__suggest__:")) { void handleAddTitle(v.slice("__suggest__:".length)); return; }
                  setJobTitleId(v);
                }}
              >
                <option value="">Select job title</option>
                {/* Standard titles FIRST (client ask): the ready-made list leads
                    so common picks are one scroll away; the tenant's own
                    catalogue follows in its own group. */}
                {suggestedTitles.length > 0 && (
                  <optgroup label="Suggested — picking adds it to your catalogue">
                    {suggestedTitles.map(n => <option key={`sug-${n}`} value={`__suggest__:${n}`}>{n}</option>)}
                  </optgroup>
                )}
                {filteredTitles.length > 0 && (
                  <optgroup label="Your titles">
                    {filteredTitles.map(t => <option key={t.ID} value={String(t.ID)}>{t.Title}</option>)}
                  </optgroup>
                )}
                <option value="__add__">➕ Add new job title…</option>
              </select>
              {addingTitle && (
                <div style={addRowStyle}>
                  <input
                    autoFocus style={{ ...inputStyle, flex: 1 }} value={newTitleName}
                    placeholder="e.g. Chief Executive Officer"
                    onChange={e => setNewTitleName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddTitle(); } }}
                  />
                  <button type="button" style={addBtnStyle} disabled={!newTitleName.trim() || savingTitle} onClick={() => void handleAddTitle()}>
                    {savingTitle ? "…" : "Add"}
                  </button>
                  <button type="button" style={cancelBtnStyle} onClick={() => { setAddingTitle(false); setNewTitleName(""); }}>✕</button>
                </div>
              )}
            </div>
          </div>

          {/* Access Level + Employee Type — compact half-width pair */}
          <div style={{ display: "flex", gap: 10 }}>
            {getStoredUser()?.isAdmin !== false && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={labelStyle}>Access Level</label>
                <select
                  style={inputStyle} value={accessLevel}
                  onChange={e => { touchedRef.current.add("access"); setAccessLevel(e.target.value); }}
                >
                  <option value="">— Not set —</option>
                  <option value="Admin">Admin — full system access</option>
                  <option value="Manager">Manager — can edit projects &amp; people</option>
                  <option value="User">User — view only</option>
                  {customLevels.length > 0 && (
                    <optgroup label="Custom levels (Settings → Access Levels)">
                      {customLevels.map(l => (
                        <option key={l.id} value={`custom:${l.id}`}>{l.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {isCustomAcl(accessLevel) && !customLevels.some(l => `custom:${l.id}` === accessLevel) && (
                    <option value={accessLevel}>Deleted level — pick another (currently view-only)</option>
                  )}
                </select>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Employee Type</label>
              <select style={inputStyle} value={empType} onChange={e => { touchedRef.current.add("empType"); setEmpType(e.target.value); }}>
                <option value="">— none —</option>
                {EMP_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* ── Invite / password-setup link ── */}
          {canInvite && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderRadius: 10, border: `1px solid ${C.borderSoft}`, background: C.card,
            }}>
              <Mail size={16} color={C.muted} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>Login invite</div>
                <div style={{
                  fontSize: 11, color: C.muted, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  Sends a password-setup link to {inviteEmail}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleResendInvite()}
                disabled={inviteSending}
                style={{
                  padding: "8px 13px", borderRadius: 9, whiteSpace: "nowrap",
                  border: inviteSent ? "none" : `1px solid ${C.green}`,
                  background: inviteSent ? C.green : C.bg,
                  color: inviteSent ? "#fff" : C.green,
                  fontSize: 12.5, fontWeight: 700,
                  cursor: inviteSending ? "default" : "pointer",
                  opacity: inviteSending ? 0.6 : 1,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {inviteSending
                  ? <><Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} /> Sending…</>
                  : inviteSent
                    ? <><CheckCircle2 size={13} /> Sent!</>
                    : <>Resend invite</>}
              </button>
            </div>
          )}
          {inviteErr && (
            <div style={{
              padding: "8px 11px", borderRadius: 9, background: C.red + "12",
              border: `1px solid ${C.red}44`, color: C.red, fontSize: 12,
              display: "flex", gap: 7, alignItems: "center",
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} /> {inviteErr}
            </div>
          )}

          {/* ── Section: Contact & Skills (one compact row) ── */}
          <div style={dividerStyle} />
          <div style={sectionHeadStyle}>Contact &amp; Skills</div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Phone</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 555-000-0000"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Skills</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={newSkillInput}
                  onChange={e => setNewSkillInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newSkillInput.trim()) { e.preventDefault(); void handleAddSkill(); } }}
                  placeholder="Add skill…"
                  style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "7px 11px" }}
                />
                <button
                  disabled={addingSkill || !newSkillInput.trim()}
                  onClick={() => void handleAddSkill()}
                  style={{
                    ...addBtnStyle, padding: "7px 12px", opacity: addingSkill || !newSkillInput.trim() ? 0.5 : 1,
                    display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                  }}
                >
                  <Plus size={13} /> {addingSkill ? "…" : "Add"}
                </button>
              </div>
            </div>
          </div>
          {(pgSkills.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {pgSkills.map(s => (
                <span key={s.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 999,
                  border: `1px solid ${C.border}`, background: C.card,
                  fontSize: 12, fontWeight: 600, color: C.text,
                }}>
                  {s.isPrimary && <span style={{ fontSize: 10, color: C.green, fontWeight: 900 }}>★</span>}
                  {s.skillName}
                  {s.proficiency != null && <span style={{ fontSize: 10, color: C.muted }}>· {s.proficiency}/5</span>}
                  <button
                    onClick={() => void handleDeleteSkill(s.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: "0 0 0 2px", display: "flex", lineHeight: 1 }}
                    title="Remove"
                  >✕</button>
                </span>
              ))}
            </div>
          )}

          {/* ── Section: Experience Tags (own row) ── */}
          <div style={dividerStyle} />
          <div style={sectionHeadStyle}>Experience Tags</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 2 }}>
            {pgTags.map(t => (
              <span key={t.id} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 999,
                backgroundColor: C.green + "18", color: C.green,
                border: `1px solid ${C.green}30`,
                fontSize: 12, fontWeight: 600,
              }}>
                {t.tagName}
                <button
                  onClick={() => void handleDeleteTag(t.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.green, opacity: 0.7, padding: "0 0 0 2px", display: "flex", lineHeight: 1 }}
                  title="Remove"
                >✕</button>
              </span>
            ))}
            {pgTags.length === 0 && <span style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>None yet</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newTagInput.trim()) { e.preventDefault(); void handleAddTag(); } }}
              placeholder="Add experience tag…"
              style={{ ...inputStyle, flex: 1, padding: "7px 11px" }}
            />
            <button
              disabled={addingTag || !newTagInput.trim()}
              onClick={() => void handleAddTag()}
              style={{
                ...addBtnStyle, padding: "7px 14px", opacity: addingTag || !newTagInput.trim() ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Plus size={13} /> {addingTag ? "…" : "Add"}
            </button>
          </div>

          {/* ── Section: Leave & availability ── */}
          <div style={dividerStyle} />
          <div style={sectionHeadStyle}>Leave &amp; availability</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>
            Weeks in this period count the person at the reduced availability in workload views.
          </div>

          {avWindows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 2 }}>
              {avWindows.map(w => (
                <div key={w.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 11px", borderRadius: 9,
                  border: `1px solid ${C.border}`, background: C.card,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>
                      {fmtDate(w.startDate)} – {fmtDate(w.endDate)}
                      {" · "}
                      {w.leaveType || (w.availabilityPct === 0 ? "On leave" : `Available ${w.availabilityPct}%`)}
                      {w.leaveType && w.availabilityPct > 0 && ` (${w.availabilityPct}%)`}
                    </div>
                    {w.reason && (
                      <div style={{
                        fontSize: 11, color: C.muted, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{w.reason}</div>
                    )}
                  </div>
                  <button
                    onClick={() => void handleDeleteAvailability(w.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 2, display: "flex", lineHeight: 1, flexShrink: 0 }}
                    title="Remove"
                  ><X size={15} /></button>
                </div>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>No leave or reduced-availability periods set.</span>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Start date</label>
              <input type="date" value={avStart} onChange={e => setAvStart(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>End date</label>
              <input type="date" value={avEnd} onChange={e => setAvEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Availability</label>
              <select value={avPct} onChange={e => setAvPct(e.target.value)} style={inputStyle}>
                <option value="0">On leave (0%)</option>
                <option value="25">25%</option>
                <option value="50">50%</option>
                <option value="75">75%</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={labelStyle}>Leave type (optional)</label>
              <select value={avLeaveType} onChange={e => setAvLeaveType(e.target.value)} style={inputStyle}>
                <option value="">— Select type —</option>
                <optgroup label="Time Off">
                  <option>Bereavement Leave</option>
                  <option>Executive PTO</option>
                  <option>Jury Duty</option>
                  <option>Military Leave</option>
                  <option>PTO</option>
                  <option>PTO - Regular PT</option>
                  <option>PTO HR</option>
                  <option>Unpaid Time Off</option>
                  <option>Vacation - Union</option>
                  <option>Vacation - Union 15 Days</option>
                </optgroup>
                <optgroup label="Other">
                  <option>Admin</option>
                  <option>Training</option>
                </optgroup>
              </select>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, marginTop: 4 }}>
            <label style={labelStyle}>Notes (optional)</label>
            <input
              type="text"
              value={avReason}
              onChange={e => setAvReason(e.target.value)}
              placeholder="e.g. Family medical leave"
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button
              disabled={avAdding}
              onClick={() => void handleAddAvailability()}
              style={{
                ...addBtnStyle, opacity: avAdding ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Plus size={13} /> {avAdding ? "…" : "Add"}
            </button>
          </div>
          {avError && (
            <div style={{
              padding: "8px 11px", borderRadius: 9, background: C.red + "12",
              border: `1px solid ${C.red}44`, color: C.red, fontSize: 12,
              display: "flex", gap: 7, alignItems: "center",
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} /> {avError}
            </div>
          )}

        </div>

        {/* Pinned footer: error + actions always visible while body scrolls */}
        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${C.borderSoft}`,
          display: "flex", flexDirection: "column", gap: 10, flexShrink: 0,
        }}>
          {error && (
            <div style={{
              padding: "9px 11px", borderRadius: 9, background: C.red + "12",
              border: `1px solid ${C.red}44`, color: C.red, fontSize: 12.5,
              display: "flex", gap: 7, alignItems: "center",
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${C.border}`,
                background: C.bg, color: C.text, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={submitting}
              style={{
                flex: 2, padding: "11px", borderRadius: 10, border: "none",
                background: submitting ? C.border : C.green, color: "#fff",
                fontSize: 13.5, fontWeight: 800, cursor: submitting ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              {submitting ? <><Loader2 size={15} style={{ animation: "spin 0.8s linear infinite" }} /> Saving…</> : <>Save Changes</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
