import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  getDivisions, getRolesByBU, getDepartments, getJobTitles, getBusinessUnits,
  createStaff, createRole, createJobTitle, createDepartment, createBusinessUnit, createDivision,
  addUserSkill, addUserExperienceTag,
  bustCache, notifyAllocationChanged,
  type AssignRole, type JobTitleRow,
} from "@/lib/api";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, UserPlus, Loader2, Check, Mail, AlertCircle,
} from "lucide-react";
import { fetchAccessLevels, usePermissionsVersion, type AccessLevelDef } from "@/lib/permissions";

type Dept = { ID: string; Title: string; DivisionIdLookup: string | null };

const C = {
  bg: "#FFFFFF",
  card: "#F5F8FA",
  border: "#D5DEE5",
  borderSoft: "#E8EDF2",
  green: "#6BA539",
  orange: "#E87722",
  red: "#C8102E",
  text: "#253746",
  muted: "#6B7E8A",
};

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

export default function StaffCreatePage() {
  useBusinessRulesVersion();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const [bu, setBu] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [jobTitleId, setJobTitleId] = useState("");
  // "Admin" | "Manager" | "User" | "custom:<id>" — custom levels come from
  // Settings → Staff & Resources → Access Levels (same contract as EditStaffModal).
  const [accessLevel, setAccessLevel] = useState<string>("User");
  const [customLevels, setCustomLevels] = useState<AccessLevelDef[]>([]);
  const [sendInvite, setSendInvite] = useState(true);

  const [buEntities, setBuEntities] = useState<{ id: string; label: string }[]>([]);
  const [bus, setBus] = useState<{ id: string; label: string; buId: string }[]>([]);
  const [allDepts, setAllDepts] = useState<Dept[]>([]);
  const [roles, setRoles] = useState<AssignRole[]>([]);
  const [titles, setTitles] = useState<JobTitleRow[]>([]);

  const [addingDiv, setAddingDiv] = useState(false);
  const [newDivName, setNewDivName] = useState("");
  const [savingDiv, setSavingDiv] = useState(false);
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

  const [employeeType, setEmployeeType] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [skills, setSkills] = useState("");
  const [experienceTags, setExperienceTags] = useState("");

  const [orgLoading, setOrgLoading] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { name: string; invited: boolean; emailed: boolean; link?: string; message?: string }>(null);

  // Admin-defined levels for the dropdown — soft-fail: the built-ins always
  // work, custom options just don't appear. Re-fetches when permissions
  // change (e.g. a level created in Settings while this page is open).
  const permsVersion = usePermissionsVersion();
  useEffect(() => {
    fetchAccessLevels().then(setCustomLevels).catch(() => setCustomLevels([]));
  }, [permsVersion]);

  useEffect(() => {
    // Do NOT bust org caches on mount — org data is busted by write operations
    // (create/rename/delete org entities). Busting here forces a cold DB hit
    // every time the form opens, producing the "Loading options…" spinner even
    // when CachePrewarm already has the data warm.
    setOrgLoading(true);
    Promise.all([
      getDivisions().catch(() => [] as unknown[]),
      getDepartments().catch(() => [] as unknown[]),
      getJobTitles().catch(() => [] as JobTitleRow[]),
      getBusinessUnits().catch(() => [] as unknown[]),
    ]).then(([divsRaw, deptsRaw, titlesRaw, buRaw]) => {
      setTitles(Array.isArray(titlesRaw) ? titlesRaw as JobTitleRow[] : []);
      setBuEntities((Array.isArray(buRaw) ? buRaw as Record<string, unknown>[] : [])
        .map(b => ({
          id: String(b.ID ?? b.Id ?? ""),
          label: String(b.ShortName ?? b.Title ?? b.Name ?? "").trim(),
        }))
        .filter(b => b.id && b.label));
      const divs = Array.isArray(divsRaw) ? divsRaw as Record<string, unknown>[] : [];
      const divMapped = divs.map(d => {
        const id = String(d.ID ?? d.Id ?? "");
        const short = String(d.ShortName ?? "").trim();
        const title = String(d.Title ?? "").trim();
        const label = short ? (title && title !== short ? `${short} — ${title}` : short) : title;
        return { id, label: label || id, buId: String(d.BusinessUnitIdLookup ?? "").trim() };
      }).filter(b => b.id);
      const divSeen = new Set<string>();
      setBus(divMapped.filter(b => { if (divSeen.has(b.id)) return false; divSeen.add(b.id); return true; }));
      const depts = Array.isArray(deptsRaw) ? deptsRaw as Record<string, unknown>[] : [];
      const deptMapped = depts.map(d => ({
        ID: String(d.ID ?? d.Id ?? ""),
        Title: String(d.Title ?? d.Name ?? "").trim(),
        DivisionIdLookup: d.DivisionIdLookup == null ? null : String(d.DivisionIdLookup),
      })).filter(d => d.ID);
      const deptSeen = new Set<string>();
      setAllDepts(deptMapped.filter(d => { if (deptSeen.has(d.ID)) return false; deptSeen.add(d.ID); return true; }));
      setOrgLoading(false);
    }).catch(() => setOrgLoading(false));
  }, []);

  useEffect(() => {
    // Division tier hidden → no division is ever picked, but the roles list
    // is tenant-wide server-side; use a sentinel key so it still loads.
    const divKey = bu || (!getBusinessRules().showDivision ? "all" : "");
    if (!divKey) { setRoles([]); return; }
    setRoleId("");
    getRolesByBU(divKey).then(r => {
      const raw = Array.isArray(r) ? r : [];
      const seen = new Set<string>();
      setRoles(raw.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; }));
    }).catch(() => setRoles([]));
  }, [bu]);

  const filteredDivisions = useMemo(() => {
    if (!businessUnit) return bus;
    const filtered = bus.filter(d => d.buId === businessUnit);
    return filtered.length > 0 ? filtered : bus;
  }, [bus, businessUnit]);

  const divIds = useMemo(() => new Set(bus.map(b => b.id)), [bus]);

  // Strict division→department filter (matches project/opportunity create);
  // unattached/orphaned departments only appear when the chosen division has
  // no departments of its own.
  const depts = useMemo(() => {
    if (!bu) {
      // No division picked yet. If a Business Unit IS picked and the tenant
      // has divisions linked to it, narrow to departments owned by that BU's
      // divisions. Partial hierarchies (no divisions at all, or divisions
      // without BU links) fall back to the full list — never empty.
      if (businessUnit) {
        const buDivIds = new Set(bus.filter(d => d.buId === businessUnit).map(d => d.id));
        if (buDivIds.size > 0) {
          const underBu = allDepts.filter(d => {
            const dlk = d.DivisionIdLookup;
            return dlk != null && dlk !== "" && buDivIds.has(String(dlk));
          });
          if (underBu.length > 0) return underBu;
        }
      }
      return allDepts;
    }
    const own = allDepts.filter(d => String(d.DivisionIdLookup ?? "") === bu);
    if (own.length > 0) return own;
    return allDepts.filter(d => {
      const dlk = d.DivisionIdLookup;
      return dlk == null || dlk === "" || !divIds.has(String(dlk));
    });
  }, [allDepts, bu, divIds, businessUnit, bus]);

  const deptIds = useMemo(() => new Set(allDepts.map(d => d.ID)), [allDepts]);
  const filteredTitles = useMemo(
    () => titles.filter(t => {
      if (!departmentId) return true;
      const dk = t.DepartmentId == null ? "" : String(t.DepartmentId).trim();
      if (!dk) return true;
      if (!deptIds.has(dk)) return true;
      return dk === departmentId;
    }),
    [titles, departmentId, deptIds],
  );

  useEffect(() => {
    if (jobTitleId && !filteredTitles.some(t => String(t.ID) === jobTitleId)) setJobTitleId("");
  }, [filteredTitles, jobTitleId]);

  // Likewise, if the division changes and the picked department no longer
  // belongs to it, clear the selection so a stale department can't be submitted.
  useEffect(() => {
    if (departmentId && !depts.some(d => d.ID === departmentId)) setDepartmentId("");
  }, [depts, departmentId]);

  const suggestedTitles = useMemo(
    () => STANDARD_JOB_TITLES.filter(
      n => !filteredTitles.some(t => (t.Title || "").trim().toLowerCase() === n.toLowerCase()),
    ),
    [filteredTitles],
  );

  const divLabelById = useMemo(() => new Map(bus.map(b => [b.id, b.label])), [bus]);
  const dupDeptTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of depts) { const k = d.Title.toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [depts]);
  const deptLabel = (d: Dept) => {
    if (!dupDeptTitles.has(d.Title.toLowerCase())) return d.Title;
    const dlk = d.DivisionIdLookup == null ? "" : String(d.DivisionIdLookup);
    const div = dlk && divIds.has(dlk) ? divLabelById.get(dlk) : "";
    return div ? `${d.Title} (${div})` : `${d.Title} (Unassigned)`;
  };

  async function handleAddDiv() {
    const nm = newDivName.trim();
    if (!nm || savingDiv) return;
    setSavingDiv(true); setError(null);
    try {
      const created = await createDivision(nm, businessUnit || undefined);
      setBus(prev => prev.some(b => b.id === created.id)
        ? prev
        : [...prev, { id: created.id, label: created.name, buId: businessUnit }].sort((a, b) => a.label.localeCompare(b.label)));
      setBu(created.id);
      setAddingDiv(false); setNewDivName("");
    } catch (e) {
      setError((e as Error)?.message || "Could not add the division.");
    } finally { setSavingDiv(false); }
  }

  async function handleAddBU() {
    const nm = newBUName.trim();
    if (!nm || savingBU) return;
    setSavingBU(true); setError(null);
    try {
      const created = await createBusinessUnit(nm);
      setBuEntities(prev => prev.some(b => b.id === created.id) ? prev : [...prev, { id: created.id, label: created.name }].sort((a, b) => a.label.localeCompare(b.label)));
      setBusinessUnit(created.id);
      setAddingBU(false); setNewBUName("");
    } catch (e) {
      setError((e as Error)?.message || "Could not add the business unit.");
    } finally { setSavingBU(false); }
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
    } catch (e) {
      setError((e as Error)?.message || "Could not add the role.");
    } finally { setSavingRole(false); }
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
    } catch (e) {
      setError((e as Error)?.message || "Could not add the job title.");
    } finally { setSavingTitle(false); }
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
    } catch (e) {
      setError((e as Error)?.message || "Could not add the department.");
    } finally { setSavingDept(false); }
  }

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const emailInvalid = emailTouched && email.trim().length > 0 && !isValidEmail(email);
  const canSubmit = name.trim().length > 0 && isValidEmail(email) && !submitting;

  async function submit() {
    if (!canSubmit) {
      setError(!name.trim() ? "Please enter a name." : "Please enter a valid email address.");
      return;
    }
    setSubmitting(true); setError(null);
    try {
      const roleName = roles.find(r => r.id === roleId)?.name || "";
      // Division tier hidden → resolve the hidden bridge division so the
      // person still lands with a connected Division→BU chain.
      const resolvedDivisionId = await resolveDivisionForSave(bu, businessUnit);
      const result = await createStaff({
        name: name.trim(), email: email.trim(),
        divisionId: resolvedDivisionId || undefined,
        departmentId: departmentId || undefined,
        jobTitleId: jobTitleId || undefined,
        roleId: roleId || undefined,
        roleName: roleName || undefined,
        accessLevel: accessLevel || "",
        sendInvite,
        employeeType: employeeType || undefined,
        phoneNumber: phoneNumber || undefined,
        employeeId: employeeId || undefined,
      });
      if (result.userGuid) {
        const guid = result.userGuid;
        const skillList = skills.split(",").map(s => s.trim()).filter(Boolean);
        const tagList = experienceTags.split(",").map(t => t.trim()).filter(Boolean);
        await Promise.all([
          ...skillList.map(s => addUserSkill(guid, s).catch(() => {})),
          ...tagList.map(t => addUserExperienceTag(guid, t).catch(() => {})),
        ]);
      }
      // Make the new person visible everywhere immediately: clear the api
      // cache (roster, allocations, utilization, pickers) so the Resources
      // page and staff pickers fetch fresh data on arrival instead of
      // serving the pre-create 5-minute cache entry. Also stamp the
      // allocation-changed timestamp/event the Resources page watches, so
      // its React Query data refetches on arrival too.
      bustCache();
      notifyAllocationChanged();
      setDone({
        name: name.trim(),
        invited: !!sendInvite,
        emailed: !!result.invite?.emailed,
        link: result.invite?.link,
        message: result.invite?.message,
      });
    } catch (e) {
      setError((e as Error)?.message || "Could not create staff member.");
    } finally { setSubmitting(false); }
  }

  const rules = getBusinessRules();

  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: "#F0F4F7", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
        <div style={{ width: "100%", maxWidth: 480, background: C.bg, borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.10)", overflow: "hidden" }}>
          <div style={{ padding: "28px 28px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Check size={22} color={C.green} />
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{done.name} added</div>
                <div style={{ fontSize: 12.5, color: C.muted }}>They now appear on the Resources page at 0%.</div>
              </div>
            </div>
            {done.invited && (
              <div style={{
                padding: "12px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                background: done.emailed ? C.green + "12" : C.orange + "14",
                border: `1px solid ${done.emailed ? C.green + "44" : C.orange + "55"}`,
                color: C.text, display: "flex", gap: 9, marginBottom: 16,
              }}>
                {done.emailed
                  ? <><Mail size={15} color={C.green} style={{ flexShrink: 0, marginTop: 1 }} /><span>A secure link to set their password has been emailed. It expires in 48 hours.</span></>
                  : <><AlertCircle size={15} color={C.orange} style={{ flexShrink: 0, marginTop: 1 }} /><span>Account created, but the invite email could not be sent{done.message ? ` (${done.message})` : ""}. {done.link ? "Share this secure link directly:" : "Try sending the invite again later."}</span></>}
              </div>
            )}
            {done.invited && !done.emailed && done.link && (
              <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, fontSize: 12, color: C.text, wordBreak: "break-all" }}>
                {done.link}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setDone(null); setName(""); setEmail(""); setBu(""); setBusinessUnit(""); setDepartmentId(""); setRoleId(""); setJobTitleId(""); setSkills(""); setExperienceTags(""); setEmployeeId(""); setPhoneNumber(""); setEmployeeType(""); setAccessLevel("User"); setSendInvite(true); }}
                style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Add Another
              </button>
              <button
                onClick={() => { toast({ title: `${done.name} added`, description: "They appear on the Resources page." }); setLocation("/resources"); }}
                style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: C.green, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}
              >
                Go to Resources
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F0F4F7" }}>
      {/* Top bar */}
      <div style={{ background: C.bg, borderBottom: `1px solid ${C.borderSoft}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={() => setLocation("/resources")}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 13, fontWeight: 600, padding: "4px 8px", borderRadius: 7 }}
        >
          <ArrowLeft size={16} /> Back to Resources
        </button>
        <div style={{ width: 1, height: 20, background: C.borderSoft }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: C.green + "1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <UserPlus size={17} color={C.green} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Add Staff Member</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>Create a new person in your organization</div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div style={{ maxWidth: 680, margin: "32px auto", padding: "0 16px 48px" }}>
        <div style={{ background: C.bg, borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden" }}>

          {/* Identity */}
          <SectionHeader title="Identity" />
          <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <TwoCol>
              <Field label="Full Name *">
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" autoFocus />
              </Field>
              <Field label="Email *">
                <input
                  style={{ ...inputStyle, ...(emailInvalid ? { borderColor: C.red } : {}) }}
                  type="email" value={email}
                  onChange={e => { setEmail(e.target.value); if (emailTouched) setEmailTouched(false); }}
                  onBlur={() => { if (email.trim()) setEmailTouched(true); }}
                  placeholder="jane@company.com"
                />
                {emailInvalid && <p style={{ color: C.red, fontSize: 11, marginTop: 3 }}>Please enter a valid email address.</p>}
              </Field>
            </TwoCol>
            <Field label="Employee ID" style={{ maxWidth: 320 }}>
              <input style={inputStyle} value={employeeId} placeholder="Badge / HR / Payroll ID" onChange={e => setEmployeeId(e.target.value)} />
            </Field>
          </div>

          {/* Organization */}
          <SectionHeader title="Organization" />
          <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>

            {rules.showBusinessUnit && (
              <Field label="Business Unit">
                <select style={inputStyle} value={businessUnit} onChange={e => {
                  if (e.target.value === "__addbu__") { setAddingBU(true); return; }
                  setBusinessUnit(e.target.value);
                  setBu(""); setDepartmentId(""); setRoleId("");
                }}>
                  <option value="">Select business unit</option>
                  {buEntities.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  <option value="__addbu__">➕ Add new business unit…</option>
                </select>
                {addingBU && (
                  <div style={addRowStyle}>
                    <input autoFocus style={{ ...inputStyle, flex: 1 }} value={newBUName} placeholder="e.g. Architecture, Engineering"
                      onChange={e => setNewBUName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddBU(); } }} />
                    <button type="button" style={addBtnStyle} disabled={!newBUName.trim() || savingBU} onClick={() => void handleAddBU()}>{savingBU ? "…" : "Add"}</button>
                    <button type="button" style={cancelBtnStyle} onClick={() => { setAddingBU(false); setNewBUName(""); }}>✕</button>
                  </div>
                )}
              </Field>
            )}

            <TwoCol>
              {rules.showDivision && (
              <Field label="Division">
                <select style={inputStyle} value={bu} onChange={e => {
                  if (e.target.value === "__adddiv__") { setAddingDiv(true); return; }
                  setBu(e.target.value); setRoleId("");
                }}>
                  <option value="">Select division</option>
                  {filteredDivisions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  <option value="__adddiv__">➕ Add new division…</option>
                </select>
                {addingDiv && (
                  <div style={addRowStyle}>
                    <input autoFocus style={{ ...inputStyle, flex: 1 }} value={newDivName} placeholder="e.g. Architecture, MEP Engineering"
                      onChange={e => setNewDivName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddDiv(); } }} />
                    <button type="button" style={addBtnStyle} disabled={!newDivName.trim() || savingDiv} onClick={() => void handleAddDiv()}>{savingDiv ? "…" : "Add"}</button>
                    <button type="button" style={cancelBtnStyle} onClick={() => { setAddingDiv(false); setNewDivName(""); }}>✕</button>
                  </div>
                )}
              </Field>
              )}

              {rules.showDepartment && (
                <Field label="Department">
                  <select style={inputStyle} value={departmentId} disabled={orgLoading} onChange={e => {
                    if (e.target.value === "__adddept__") { setAddingDept(true); return; }
                    setDepartmentId(e.target.value);
                  }}>
                    {orgLoading
                      ? <option value="">Loading departments…</option>
                      : <>
                          <option value="">Select department</option>
                          {depts.map(d => <option key={d.ID} value={d.ID}>{deptLabel(d)}</option>)}
                          <option value="__adddept__">➕ Add new department…</option>
                        </>
                    }
                  </select>
                  {addingDept && (
                    <div style={addRowStyle}>
                      <input autoFocus style={{ ...inputStyle, flex: 1 }} value={newDeptName} placeholder="e.g. Engineering, Design"
                        onChange={e => setNewDeptName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddDept(); } }} />
                      <button type="button" style={addBtnStyle} disabled={!newDeptName.trim() || savingDept} onClick={() => void handleAddDept()}>{savingDept ? "…" : "Add"}</button>
                      <button type="button" style={cancelBtnStyle} onClick={() => { setAddingDept(false); setNewDeptName(""); }}>✕</button>
                    </div>
                  )}
                </Field>
              )}
            </TwoCol>

            <TwoCol>
              <Field label="Role">
                <select style={inputStyle} value={roleId} onChange={e => {
                  if (e.target.value === "__add__") { setAddingRole(true); return; }
                  setRoleId(e.target.value);
                }}>
                  <option value="">Select role</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  <option value="__add__">➕ Add new role…</option>
                </select>
                {addingRole && (
                  <div style={addRowStyle}>
                    <input autoFocus style={{ ...inputStyle, flex: 1 }} value={newRoleName} placeholder="e.g. CEO, CFO, COO"
                      onChange={e => setNewRoleName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddRole(); } }} />
                    <button type="button" style={addBtnStyle} disabled={!newRoleName.trim() || savingRole} onClick={() => void handleAddRole()}>{savingRole ? "…" : "Add"}</button>
                    <button type="button" style={cancelBtnStyle} onClick={() => { setAddingRole(false); setNewRoleName(""); }}>✕</button>
                  </div>
                )}
              </Field>

              <Field label="Job Title">
                <select style={inputStyle} value={jobTitleId} disabled={orgLoading || savingTitle}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "__add__") { setAddingTitle(true); return; }
                    if (v.startsWith("__suggest__:")) { void handleAddTitle(v.slice("__suggest__:".length)); return; }
                    setJobTitleId(v);
                  }}>
                  {orgLoading
                    ? <option value="">Loading job titles…</option>
                    : <>
                        <option value="">Select job title</option>
                        {/* Standard titles FIRST (client ask) — see EditStaffModal. */}
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
                      </>
                  }
                </select>
                {addingTitle && (
                  <div style={addRowStyle}>
                    <input autoFocus style={{ ...inputStyle, flex: 1 }} value={newTitleName} placeholder="e.g. Chief Executive Officer"
                      onChange={e => setNewTitleName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddTitle(); } }} />
                    <button type="button" style={addBtnStyle} disabled={!newTitleName.trim() || savingTitle} onClick={() => void handleAddTitle()}>{savingTitle ? "…" : "Add"}</button>
                    <button type="button" style={cancelBtnStyle} onClick={() => { setAddingTitle(false); setNewTitleName(""); }}>✕</button>
                  </div>
                )}
              </Field>
            </TwoCol>
          </div>

          {/* Additional details */}
          <SectionHeader title="Additional Details" />
          <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <TwoCol>
              <Field label="Employee Type">
                <select style={inputStyle} value={employeeType} onChange={e => setEmployeeType(e.target.value)}>
                  <option value="">Select type (optional)</option>
                  <option value="Full-Time">Full-Time</option>
                  <option value="Part-Time">Part-Time</option>
                  <option value="As Needed">As Needed</option>
                  <option value="Temporary">Temporary</option>
                  <option value="SCA Contingency Staff">SCA Contingency Staff</option>
                </select>
              </Field>
              <Field label="Phone Number">
                <input style={inputStyle} type="tel" value={phoneNumber}
                  placeholder="e.g. +1 555-000-1234" onChange={e => setPhoneNumber(e.target.value)} />
              </Field>
            </TwoCol>
            <Field label={<>Skills <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— comma-separated</span></>}>
              <input style={inputStyle} value={skills} placeholder="e.g. Revit, AutoCAD, Project Management" onChange={e => setSkills(e.target.value)} />
            </Field>
            <Field label={<>Experience Tags <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— comma-separated</span></>}>
              <input style={inputStyle} value={experienceTags} placeholder="e.g. Healthcare, Commercial, Transit" onChange={e => setExperienceTags(e.target.value)} />
            </Field>
          </div>

          {/* Access & Invite */}
          <SectionHeader title="Access & Invite" />
          <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Access Level" style={{ maxWidth: 320 }}>
              <select style={inputStyle} value={accessLevel} onChange={e => setAccessLevel(e.target.value)}>
                <option value="Admin">Admin — full access</option>
                <option value="Manager">Manager — can edit</option>
                <option value="User">User — view only</option>
                {customLevels.length > 0 && (
                  <optgroup label="Custom levels (Settings → Access Levels)">
                    {customLevels.map(l => (
                      <option key={l.id} value={`custom:${l.id}`}>{l.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer",
              padding: "12px 14px", borderRadius: 10, background: C.card, border: `1px solid ${C.borderSoft}`,
            }}>
              <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)}
                style={{ marginTop: 2, width: 15, height: 15, accentColor: C.green }} />
              <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                <strong>Email a login invite</strong> — sends a secure link so they can set their own password and sign in. Leave unchecked to add them as a resource only.
              </span>
            </label>
          </div>

          {/* Footer */}
          <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.borderSoft}`, display: "flex", flexDirection: "column", gap: 12 }}>
            {error && (
              <div style={{ padding: "10px 12px", borderRadius: 9, background: C.red + "12", border: `1px solid ${C.red}44`, color: C.red, fontSize: 12.5, display: "flex", gap: 7, alignItems: "center" }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setLocation("/resources")}
                style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  flex: 2, padding: "12px", borderRadius: 10, border: "none",
                  background: canSubmit ? C.green : C.border, color: "#fff",
                  fontSize: 13.5, fontWeight: 800, cursor: canSubmit ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                }}
              >
                {submitting
                  ? <><Loader2 size={16} style={{ animation: "spin 0.8s linear infinite" }} /> Creating…</>
                  : <>Add Staff Member</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ padding: "12px 24px 0", borderTop: `1px solid ${C.borderSoft}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8, paddingTop: 6 }}>
        {title}
      </div>
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {children}
    </div>
  );
}

function Field({ label, children, style }: { label: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
