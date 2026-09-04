import { useEffect, useMemo, useState } from "react";
import { X, UserPlus, Loader2, Check, Mail, AlertCircle } from "lucide-react";
import {
  getDivisions, getRolesByBU, getDepartments, getJobTitles, getBusinessUnits,
  createStaff, createRole, createJobTitle, createDepartment, createBusinessUnit, createDivision,
  addUserSkill, addUserExperienceTag,
  bustCache,
  type AssignRole, type JobTitleRow,
} from "@/lib/api";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { getBusinessRules } from "@/lib/businessRules";
import { resolveDivisionForSave } from "@/lib/orgHierarchy";
import { fetchAccessLevels, type AccessLevelDef } from "@/lib/permissions";
import { Z } from "@/lib/zLayers";

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

type Dept = { ID: string; Title: string; DivisionIdLookup: string | null };

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

export function AddStaffModal({
  open, onClose, onCreated, tenantId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, inviteSent: boolean) => void;
  tenantId?: string;
}) {
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

  // Inline "add new" for Division / Business Unit / Role / Job Title so the catalogue isn't a dead end.
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

  // Load business units + departments when opened.
  useEffect(() => {
    if (!open) return;
    setName(""); setEmail(""); setBusinessUnit(""); setBu(""); setDepartmentId(""); setRoleId(""); setJobTitleId("");
    setAccessLevel("User"); setSendInvite(true); setError(null); setDone(null); setEmailTouched(false);
    setEmployeeType(""); setPhoneNumber(""); setEmployeeId(""); setSkills(""); setExperienceTags("");
    setRoles([]); setTitles([]);
    setAddingDiv(false); setNewDivName(""); setSavingDiv(false);
    setAddingBU(false); setNewBUName(""); setSavingBU(false);
    setAddingRole(false); setNewRoleName(""); setSavingRole(false);
    setAddingTitle(false); setNewTitleName(""); setSavingTitle(false);
    setAddingDept(false); setNewDeptName(""); setSavingDept(false);
    // Bust caches so the division/dept/title lists are always fresh (avoids showing
    // stale empty data if the first call failed or happened before auth settled).
    bustCache("divisions"); bustCache("departments"); bustCache("business-units"); bustCache("job-titles");
    // Admin-defined levels for the dropdown — soft-fail: the built-ins
    // always work, custom options just don't appear. Fetched on every open
    // so a level created moments ago in Settings shows up immediately.
    fetchAccessLevels(tenantId).then(setCustomLevels).catch(() => setCustomLevels([]));
    setOrgLoading(true);
    Promise.all([
      getDivisions(tenantId).catch(() => [] as unknown[]),
      getDepartments(tenantId).catch(() => [] as unknown[]),
      getJobTitles(tenantId).catch(() => [] as JobTitleRow[]),
      getBusinessUnits(tenantId).catch(() => [] as unknown[]),
    ]).then(([divsRaw, deptsRaw, titlesRaw, buRaw]) => {
      setTitles(Array.isArray(titlesRaw) ? titlesRaw as JobTitleRow[] : []);
      // Real Business Units — the optional top tier that groups divisions.
      // Picking one only narrows the Division list; the person is still
      // persisted against the Division (the BU is derivable from its parent).
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
  }, [open]);

  // Load roles when a BU is chosen. (Job titles are loaded once from the
  // tenant-wide catalogue on open and are independent of the chosen role.)
  useEffect(() => {
    // Division tier hidden → no division is ever picked, but the roles list
    // is tenant-wide server-side; use a sentinel key so it still loads.
    const divKey = bu || (!getBusinessRules().showDivision ? "all" : "");
    if (!open || !divKey) { setRoles([]); return; }
    setRoleId("");
    getRolesByBU(divKey).then(r => {
      const raw = Array.isArray(r) ? r : [];
      const seen = new Set<string>();
      setRoles(raw.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; }));
    }).catch(() => setRoles([]));
  }, [open, bu]);

  // Divisions narrowed to the chosen Business Unit. Fall back to ALL divisions
  // if the BU filter yields nothing (imported divisions often have no BU link).
  const filteredDivisions = useMemo(() => {
    if (!businessUnit) return bus;
    const filtered = bus.filter(d => d.buId === businessUnit);
    return filtered.length > 0 ? filtered : bus;
  }, [bus, businessUnit]);

  // Set of all known (current-tenant) division IDs so we can detect "foreign"
  // DivisionIdLookup values that came from imported orphan rows.
  const divIds = useMemo(() => new Set(bus.map(b => b.id)), [bus]);

  // Departments narrowed STRICTLY to the chosen division — same rule as the
  // project/opportunity create forms so every picker shows the same list.
  // Unattached departments (no DivisionIdLookup, or a link pointing at a
  // deleted/foreign division) only surface as a fallback when the selected
  // division has no departments of its own, so the picker is never uselessly
  // empty for imported org data.
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

  // Job titles scoped to the chosen department — mirrors the org chart's
  // per-department grouping (jtByDeptId keyed by String(DepartmentId)).
  // A title is shown if:
  //   • no department is selected yet, OR
  //   • it has no DepartmentId (unassigned in the tenant catalogue), OR
  //   • its DepartmentId points to an unknown/foreign department — treat those
  //     as unassigned so they surface in every context, OR
  //   • its DepartmentId matches the selected department exactly.
  const deptIds = useMemo(() => new Set(allDepts.map(d => d.ID)), [allDepts]);
  const filteredTitles = useMemo(
    () => titles.filter(t => {
      if (!departmentId) return true;
      const dk = t.DepartmentId == null ? "" : String(t.DepartmentId).trim();
      if (!dk) return true;
      if (!deptIds.has(dk)) return true; // foreign / orphaned — show everywhere
      return dk === departmentId;
    }),
    [titles, departmentId, deptIds],
  );

  // If the department changes and the picked job title no longer belongs to it,
  // clear the selection so a foreign-department title can't be submitted.
  useEffect(() => {
    if (jobTitleId && !filteredTitles.some(t => String(t.ID) === jobTitleId)) setJobTitleId("");
  }, [filteredTitles, jobTitleId]);

  // Likewise, if the division changes and the picked department no longer
  // belongs to it, clear the selection so a stale department can't be submitted.
  useEffect(() => {
    if (departmentId && !depts.some(d => d.ID === departmentId)) setDepartmentId("");
  }, [depts, departmentId]);

  // Standard titles (CEO, CFO, PM, …) not yet in the visible catalogue are
  // offered as ready-to-pick suggestions so users never have to type them —
  // picking one creates the title in the catalogue (typos break persona match).
  const suggestedTitles = useMemo(
    () => STANDARD_JOB_TITLES.filter(
      n => !filteredTitles.some(t => (t.Title || "").trim().toLowerCase() === n.toLowerCase()),
    ),
    [filteredTitles],
  );

  // Same-name departments under different divisions are distinct entities —
  // when the visible list contains duplicates, append the division name so the
  // user can tell them apart.
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
    } finally {
      setSavingDiv(false);
    }
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
    } finally {
      setSavingBU(false);
    }
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
    } finally {
      setSavingRole(false);
    }
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
    } finally {
      setSavingTitle(false);
    }
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
    } finally {
      setSavingDept(false);
    }
  }

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const emailInvalid = emailTouched && email.trim().length > 0 && !isValidEmail(email);
  const canSubmit = name.trim().length > 0 && isValidEmail(email) && !submitting;

  async function submit() {
    if (!canSubmit) {
      setError(!name.trim() ? "Please enter a name." : "Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const roleName = roles.find(r => r.id === roleId)?.name || "";
      // Division tier hidden → resolve the hidden bridge division so the
      // person still lands with a connected Division→BU chain. Bridge
      // resolution is token-scoped (logged-in tenant), so skip it when a
      // super-admin drives this modal against another tenant.
      const resolvedDivisionId = tenantId ? bu : await resolveDivisionForSave(bu, businessUnit);
      const result = await createStaff({
        name: name.trim(), email: email.trim(),
        divisionId: resolvedDivisionId || undefined,
        departmentId: departmentId || undefined,
        jobTitleId: jobTitleId || undefined,
        roleId: roleId || undefined,
        roleName: roleName || undefined,
        accessLevel: accessLevel || "",
        sendInvite,
        tenantId: tenantId || undefined,
        employeeType: employeeType || undefined,
        phoneNumber: phoneNumber || undefined,
        employeeId: employeeId || undefined,
      });
      // Write skills and experience tags to Postgres after user is created.
      if (result.userGuid) {
        const guid = result.userGuid;
        const skillList = skills.split(",").map(s => s.trim()).filter(Boolean);
        const tagList = experienceTags.split(",").map(t => t.trim()).filter(Boolean);
        await Promise.all([
          ...skillList.map(s => addUserSkill(guid, s).catch(() => {})),
          ...tagList.map(t => addUserExperienceTag(guid, t).catch(() => {})),
        ]);
      }
      const doneName = name.trim();
      setDone({
        name: doneName,
        invited: !!sendInvite,
        emailed: !!result.invite?.emailed,
        link: result.invite?.link,
        message: result.invite?.message,
      });
      // When no invite is being sent, close immediately (no confirmation needed).
      // When an invite IS sent, keep the modal open so the done screen is visible;
      // the Done button will call onCreated to close the whole flow.
      if (!sendInvite) {
        onCreated(doneName, false);
      }
    } catch (e) {
      setError((e as Error)?.message || "Could not create staff member.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,30,42,0.55)", zIndex: Z.MODAL,
        // Keep the card itself static and centered; long content scrolls
        // INSIDE the card body instead of scrolling the whole popup away.
        display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
        // Radix modal dialogs set pointer-events:none on <body>; this portal
        // must opt back in or it appears frozen when stacked above a Dialog.
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460, background: C.bg, borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)", overflow: "hidden",
          // Cap to the viewport so small screens still show the header and
          // the internal scroller handles the overflow.
          maxHeight: "calc(100vh - 32px)", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: `1px solid ${C.borderSoft}`, flexShrink: 0,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: C.green + "1A",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <UserPlus size={18} color={C.green} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Add Staff Member</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>Create a new person in your organization</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}>
            <X size={20} />
          </button>
        </div>

        {done ? (
          <div style={{ padding: "22px 20px", overflowY: "auto", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", background: C.green + "1A",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Check size={18} color={C.green} />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>
                {done.name} added
              </div>
            </div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.5, margin: "0 0 12px" }}>
              They now appear on the Resources page (currently on the bench at 0%).
            </p>
            {done.invited && (
              <div style={{
                padding: "11px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
                background: done.emailed ? C.green + "12" : C.orange + "14",
                border: `1px solid ${done.emailed ? C.green + "44" : C.orange + "55"}`,
                color: C.text, display: "flex", gap: 8,
              }}>
                {done.emailed
                  ? <><Mail size={15} color={C.green} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>A secure link to set their password has been emailed to them. It expires in 48 hours.</span></>
                  : <><AlertCircle size={15} color={C.orange} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>The account was created, but the invite email could not be sent{done.message ? ` (${done.message})` : ""}. {done.link ? "Share this secure link with them directly:" : "Try sending the invite again later."}</span></>}
              </div>
            )}
            {done.invited && !done.emailed && done.link && (
              <div style={{
                marginTop: 8, padding: "9px 11px", borderRadius: 9, background: C.card,
                border: `1px solid ${C.border}`, fontSize: 11.5, color: C.text, wordBreak: "break-all",
              }}>
                {done.link}
              </div>
            )}
            <button
              onClick={() => { onCreated(done.name, !!(done.invited)); onClose(); }}
              style={{
                marginTop: 18, width: "100%", padding: "11px", borderRadius: 10, border: "none",
                background: C.green, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13, overflowY: "auto", minHeight: 0 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Full name *</label>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                style={{ ...inputStyle, ...(emailInvalid ? { borderColor: "#ef4444", outline: "none" } : {}) }}
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (emailTouched) setEmailTouched(false); }}
                onBlur={() => { if (email.trim()) setEmailTouched(true); }}
                placeholder="jane@company.com"
              />
              {emailInvalid && (
                <p style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>Please enter a valid email address (e.g. jane@company.com)</p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Phone Number</label>
                <input style={inputStyle} type="tel" value={phoneNumber}
                  placeholder="e.g. +1 555-000-1234"
                  onChange={e => setPhoneNumber(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Employee ID</label>
                <input style={inputStyle} value={employeeId} placeholder="Badge / HR / Payroll ID"
                  onChange={e => setEmployeeId(e.target.value)} />
              </div>
            </div>

            {getBusinessRules().showBusinessUnit && (
            <div>
              <label style={labelStyle}>Business Unit</label>
              <select
                style={inputStyle}
                value={businessUnit}
                onChange={e => {
                  if (e.target.value === "__addbu__") { setAddingBU(true); return; }
                  setBusinessUnit(e.target.value);
                  // A new BU narrows the division list, so clear the dependent picks.
                  setBu(""); setDepartmentId(""); setRoleId("");
                }}
              >
                <option value="">Select business unit</option>
                {buEntities.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                <option value="__addbu__">➕ Add new business unit…</option>
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
                    if (e.target.value === "__adddiv__") { setAddingDiv(true); return; }
                    setBu(e.target.value);
                    setRoleId("");
                  }}
                >
                  <option value="">Select division</option>
                  {filteredDivisions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  <option value="__adddiv__">➕ Add new division…</option>
                </select>
                {addingDiv && (
                  <div style={addRowStyle}>
                    <input
                      autoFocus style={{ ...inputStyle, flex: 1 }} value={newDivName}
                      placeholder="e.g. Architecture, MEP Engineering"
                      onChange={e => setNewDivName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddDiv(); } }}
                    />
                    <button type="button" style={addBtnStyle} disabled={!newDivName.trim() || savingDiv} onClick={() => void handleAddDiv()}>
                      {savingDiv ? "…" : "Add"}
                    </button>
                    <button type="button" style={cancelBtnStyle} onClick={() => { setAddingDiv(false); setNewDivName(""); }}>✕</button>
                  </div>
                )}
              </div>
              )}
              {getBusinessRules().showDepartment && (<div style={{ flex: 1 }}>
                <label style={labelStyle}>Department</label>
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
              </div>)}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Role</label>
                <select
                  style={inputStyle} value={roleId}
                  onChange={e => {
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
                  disabled={orgLoading || savingTitle}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "__add__") { setAddingTitle(true); return; }
                    if (v.startsWith("__suggest__:")) { void handleAddTitle(v.slice("__suggest__:".length)); return; }
                    setJobTitleId(v);
                  }}
                >
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

            <div>
              <label style={labelStyle}>Employee Type</label>
              <select style={inputStyle} value={employeeType} onChange={e => setEmployeeType(e.target.value)}>
                <option value="">Select type (optional)</option>
                <option value="Full-Time">Full-Time</option>
                <option value="Part-Time">Part-Time</option>
                <option value="As Needed">As Needed</option>
                <option value="Temporary">Temporary</option>
                <option value="SCA Contingency Staff">SCA Contingency Staff</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Skills <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— comma-separated</span></label>
              <input style={inputStyle} value={skills}
                placeholder="e.g. Revit, AutoCAD, Project Management"
                onChange={e => setSkills(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Experience Tags <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— comma-separated</span></label>
              <input style={inputStyle} value={experienceTags}
                placeholder="e.g. Healthcare, Commercial, Transit"
                onChange={e => setExperienceTags(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Access level</label>
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
            </div>

            <label style={{
              display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer",
              padding: "10px 11px", borderRadius: 10, background: C.card, border: `1px solid ${C.borderSoft}`,
            }}>
              <input
                type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)}
                style={{ marginTop: 2, width: 15, height: 15, accentColor: C.green }}
              />
              <span style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45 }}>
                <strong>Email a login invite</strong> — sends a secure link so they can set their own password and sign in. Leave unchecked to add them as a resource only.
              </span>
            </label>

            {error && (
              <div style={{
                padding: "9px 11px", borderRadius: 9, background: C.red + "12",
                border: `1px solid ${C.red}44`, color: C.red, fontSize: 12.5,
                display: "flex", gap: 7, alignItems: "center",
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
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
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  flex: 2, padding: "11px", borderRadius: 10, border: "none",
                  background: canSubmit ? C.green : C.border, color: "#fff",
                  fontSize: 13.5, fontWeight: 800, cursor: canSubmit ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                }}
              >
                {submitting ? <><Loader2 size={15} style={{ animation: "spin 0.8s linear infinite" }} /> Creating…</> : <>Add Staff Member</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
