/**
 * AssignmentSetupCard — inline chat card that collects the three required
 * fields for a person→project assignment (Business Unit, Role, Title) using
 * dropdowns instead of typed text. On submit it sends a chat message in the
 * exact shape `BU: <bu>, Role: <role>, Title: <title>` so the existing
 * server-side DIRECT ASSIGNMENT history scan picks up the values and the
 * normal `assign_person` tool call proceeds — including the standard
 * "Want to enter hours?" follow-up.
 *
 * Rendered for the AI tag: [ASSIGN_SETUP:personName|projectId|projectName]
 *
 * Cascade — the client's official 4-API chain drives the dropdowns:
 *   - getProjectDivisionRoles(id) → Business Units for the ticket
 *   - getRolesByBU(divisionId)    → Roles for the chosen BU
 *   - getJobTitlesByRole(div,role)→ Titles for the chosen BU + Role
 * If any official call returns nothing (e.g. RM ONE unreachable), we fall back
 * to the previous heuristic derived from the project-division-roles blob so the
 * picker keeps working.
 */
import React from "react";
import { Send, AlertCircle, Loader2, Lock } from "lucide-react";
import {
  getDivisions, getProjectDivisionRoles, getUserList, getBusinessUnits,
  getRolesByBU, getJobTitlesByRole, buildTitleOptions, getPersonOrgDefaults,
  type AssignRole, type AssignTitle, type PersonOrgDefaults,
} from "@/lib/api";
import { withSuggestedTitleOptions } from "@/lib/standardTitles";
import { getBusinessRules } from "@/lib/businessRules";

const C = {
  green: "#6BA539",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  red: "#E03C3C",
  redSoft: "#FDECEC",
};

interface RoleRow {
  Name?: string; RoleName?: string; TypeName?: string; Title?: string; JobTitle?: string;
  DivisionShortName?: string; ShortName?: string; BU?: string; BusinessUnit?: string;
  DivisionId?: number; DivisionID?: number; DivisionIDLookup?: number;
  [k: string]: unknown;
}
interface PersonRow { id: string; title: string; }

interface Props {
  personName: string;
  projectId: string;
  projectName: string;
  onSubmit: (msg: string) => void;
  readOnly?: boolean;
}

export function AssignmentSetupCard({ personName, projectId, projectName, onSubmit, readOnly }: Props) {
  const [loading, setLoading] = React.useState(true);
  const [bus, setBus] = React.useState<{ id: string; label: string; short: string; buId?: string }[]>([]);
  const [buEntities, setBuEntities] = React.useState<{ id: string; label: string }[]>([]);
  const [roleRows, setRoleRows] = React.useState<RoleRow[]>([]);
  const [people, setPeople] = React.useState<PersonRow[]>([]);
  const [businessUnit, setBusinessUnit] = React.useState<string>("");
  const [bu, setBU] = React.useState<string>("");
  const [role, setRole] = React.useState<string>("");
  const [title, setTitle] = React.useState<string>("");
  // Specific JobTitle.ID for the chosen title (lets the user pick the right one
  // when a name is duplicated across departments). Resolution downstream is
  // still by name via chat — this just disambiguates the visible choice.
  const [titleId, setTitleId] = React.useState<string>("");
  const [errorMsg, setErrorMsg] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  // Official-cascade state (BU → Role → Title). Falls back to heuristic below
  // when these come back empty.
  const [apiRoles, setApiRoles] = React.useState<AssignRole[]>([]);
  const [apiTitles, setApiTitles] = React.useState<AssignTitle[]>([]);
  const [rolesLoading, setRolesLoading] = React.useState(false);
  const [titlesLoading, setTitlesLoading] = React.useState(false);

  // Existing staff record for this person, if any. When found we PREFILL and
  // LOCK BU/Division/Role/Title from their established profile instead of
  // making the client re-pick from empty dropdowns — the client should not be
  // able to override someone's already-established org placement via chat.
  const [personOrgLoading, setPersonOrgLoading] = React.useState(true);
  const [personOrg, setPersonOrg] = React.useState<PersonOrgDefaults | null>(null);
  const locked = !!personOrg?.found;

  React.useEffect(() => {
    let cancelled = false;
    setPersonOrgLoading(true);
    const _orgTimeout = new Promise<{ found: false }>(resolve => setTimeout(() => resolve({ found: false }), 8000));
    Promise.race([getPersonOrgDefaults(personName), _orgTimeout])
      .then((res) => { if (!cancelled) setPersonOrg(res); })
      .catch(() => { if (!cancelled) setPersonOrg(null); })
      .finally(() => { if (!cancelled) setPersonOrgLoading(false); });
    return () => { cancelled = true; };
  }, [personName]);

  // Once we know the person's existing org, apply it directly to the form
  // state so submit uses the SAME values shown, without depending on the
  // BU/Division/Role/Title option lists having finished loading.
  React.useEffect(() => {
    if (!personOrg?.found) return;
    if (personOrg.divisionId) setBU(personOrg.divisionId);
    setRole(personOrg.roleName || "");
    setTitle(personOrg.titleName || "");
    setErrorMsg("");
  }, [personOrg]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const _timeout = new Promise<[unknown[], unknown, Record<string, unknown>[], unknown[]]>(
      resolve => setTimeout(() => resolve([[], [], [], []]), 12000)
    );
    Promise.race([
      Promise.all([
        getDivisions().catch(() => [] as unknown[]),
        getProjectDivisionRoles(projectId).catch(() => [] as unknown),
        getUserList().catch(() => [] as Record<string, unknown>[]),
        getBusinessUnits().catch(() => [] as unknown[]),
      ]),
      _timeout,
    ]).then(([divsRaw, projRolesRaw, usersRaw, buRaw]) => {
      if (cancelled) return;
      const divs = Array.isArray(divsRaw) ? divsRaw as Record<string, unknown>[] : [];
      const projRoles = Array.isArray(projRolesRaw) ? projRolesRaw as Record<string, unknown>[] : [];
      // Real Business Unit entities — optional top tier that groups divisions.
      // Selecting one narrows the Division list; the assignment is still keyed
      // on the Division ShortName (the only value /assign-resource accepts).
      const buEnts = (Array.isArray(buRaw) ? buRaw as Record<string, unknown>[] : [])
        .map((b) => ({
          id: String(b.ID ?? b.Id ?? ""),
          label: String(b.ShortName ?? b.Title ?? b.Name ?? "").trim(),
        }))
        .filter((b) => b.id && b.label);
      setBuEntities(buEnts);
      // Authoritative divisions index (id → ShortName + Title + parent BU). The
      // /assign-resource backend only accepts the real division ShortName as
      // the BU value, so we MUST source `short` from here — never from a
      // role row's Title (which is the role title, not the BU).
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
      const allBUs = Array.from(divsById.entries())
        .map(([id, d]) => ({
          id, short: d.short, buId: d.buId,
          label: d.short ? `${d.short}${d.title && d.title !== d.short ? ` - ${d.title}` : ""}` : (d.title || ""),
        }))
        .filter((b) => b.short && b.label);
      const projBUs: { id: string; short: string; label: string; buId: string }[] = [];
      const seenProjBu = new Set<string>();
      for (const r of projRoles) {
        const id = String(r.DivisionIDLookup ?? r.DivisionID ?? "");
        if (!id || seenProjBu.has(id)) continue;
        const fromIdx = divsById.get(id);
        const short = (fromIdx?.short || String(r.DivisionShortName ?? "").trim()).trim();
        if (!short) continue; // skip rows we can't resolve to a real BU short
        const title = fromIdx?.title || "";
        seenProjBu.add(id);
        projBUs.push({
          id, short, buId: fromIdx?.buId || "",
          label: title && title !== short ? `${short} - ${title}` : short,
        });
      }
      const buList = projBUs.length ? projBUs : allBUs;
      setBus(buList);
      setRoleRows(projRoles as RoleRow[]);
      const userArr = Array.isArray(usersRaw) ? usersRaw : [];
      const ppl: PersonRow[] = [];
      for (const u of userArr) {
        const id = String(u.Id ?? "").toLowerCase();
        const t = String(u.JobProfile ?? "").trim();
        if (!id || !t) continue;
        ppl.push({ id, title: t });
      }
      setPeople(ppl);
      // Existing project → default/lock to its primary BU (proxy returns the
      // project's BUs primary-first), so the user only confirms Role + Title.
      // A brand-new project with no BU assigned falls back to allBUs and the
      // user picks one.
      if (projBUs.length > 0) { setBU(buList[0].id); if (buList[0].buId) setBusinessUnit(buList[0].buId); }
      else if (buList.length === 1) { setBU(buList[0].id); if (buList[0].buId) setBusinessUnit(buList[0].buId); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const buShort = React.useMemo(() => {
    const m = bus.find((b) => b.id === bu);
    // A locked prefill may reference a division outside the project's own
    // division list (e.g. a shared-services person); fall back to the
    // person's own division name so the submit message is still correct.
    if (m) return m.short;
    return locked ? (personOrg?.divisionName || "") : "";
  }, [bu, bus, locked, personOrg]);

  // Divisions shown below, narrowed to the chosen Business Unit when one is
  // selected (BU is an optional top tier). With no BU picked we show every
  // candidate division so nothing becomes unreachable.
  const filteredDivisions = React.useMemo(() => {
    if (!businessUnit) return bus;
    return bus.filter((d) => d.buId === businessUnit);
  }, [bus, businessUnit]);

  // OFFICIAL cascade — fetch Roles whenever the BU changes.
  React.useEffect(() => {
    // Division tier hidden → no division is ever picked, but the roles list
    // is tenant-wide server-side; use a sentinel key so it still loads.
    const divKey = bu || (!getBusinessRules().showDivision ? "all" : "");
    if (!divKey) { setApiRoles([]); return; }
    let cancelled = false;
    setRolesLoading(true);
    getRolesByBU(divKey)
      .then((rows) => { if (!cancelled) setApiRoles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiRoles([]); })
      .finally(() => { if (!cancelled) setRolesLoading(false); });
    return () => { cancelled = true; };
  }, [bu]);

  const selectedRoleId = React.useMemo(() => {
    const m = apiRoles.find((r) => r.name === role);
    return m ? m.id : "";
  }, [apiRoles, role]);

  // OFFICIAL cascade — fetch ALL tenant titles whenever a Role is chosen.
  // Pass "" as divisionIdLookup so the server returns the full catalogue
  // (sorted with role-matched titles first) rather than just the titles
  // linked to the selected division.
  React.useEffect(() => {
    if (!selectedRoleId) { setApiTitles([]); return; }
    let cancelled = false;
    setTitlesLoading(true);
    getJobTitlesByRole("", selectedRoleId)
      .then((rows) => { if (!cancelled) setApiTitles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setApiTitles([]); })
      .finally(() => { if (!cancelled) setTitlesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRoleId]);

  // ── Heuristic fallback (previous behaviour) ──
  const filteredRoleRows = React.useMemo(() => {
    if (!bu) return roleRows;
    const bn = buShort.toLowerCase();
    return roleRows.filter((r) => {
      const rid = String((r as Record<string, unknown>).DivisionIDLookup ?? (r as Record<string, unknown>).DivisionID ?? "");
      if (rid && rid === bu) return true;
      const rb = String(r.DivisionShortName ?? r.ShortName ?? r.BU ?? r.BusinessUnit ?? "").toLowerCase();
      if (bn && rb) return rb === bn;
      return !rid && !rb;
    });
  }, [roleRows, bu, buShort]);

  const heuristicRoleOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredRoleRows) {
      const v = String(r.Name ?? r.RoleName ?? r.TypeName ?? "").trim();
      if (v) set.add(v);
    }
    if (set.size === 0) for (const p of people) if (p.title) set.add(p.title);
    return Array.from(set).sort();
  }, [filteredRoleRows, people]);

  const heuristicTitleOptions = React.useMemo(() => {
    const rn = role.trim().toLowerCase();
    const set = new Set<string>();
    if (rn) {
      for (const r of filteredRoleRows) {
        const rrole = String(r.Name ?? r.RoleName ?? r.TypeName ?? "").trim().toLowerCase();
        if (rrole !== rn) continue;
        const v = String(r.Title ?? r.JobTitle ?? "").trim();
        if (v) set.add(v);
      }
    }
    if (set.size === 0) {
      for (const r of roleRows) {
        const v = String(r.Title ?? r.JobTitle ?? r.Name ?? r.RoleName ?? r.TypeName ?? "").trim();
        if (v) set.add(v);
      }
      for (const p of people) if (p.title) set.add(p.title);
    }
    return Array.from(set).sort();
  }, [filteredRoleRows, roleRows, people, role]);

  // Prefer the official API options; fall back to the heuristic when empty.
  const roleOptions = React.useMemo(() => {
    if (apiRoles.length > 0) {
      return Array.from(new Set(apiRoles.map((r) => r.name).filter(Boolean))).sort();
    }
    return heuristicRoleOptions;
  }, [apiRoles, heuristicRoleOptions]);

  const titleOptions = React.useMemo<{ id: string; name: string; label: string }[]>(() => {
    // Standard suggested titles always lead the list (name-as-id options; the
    // submit only carries the title NAME, so no catalogue id is needed).
    if (apiTitles.length > 0) {
      return withSuggestedTitleOptions(buildTitleOptions(apiTitles));
    }
    return withSuggestedTitleOptions(heuristicTitleOptions.map((n) => ({ id: n, name: n, label: n })));
  }, [apiTitles, heuristicTitleOptions]);

  const handleSubmit = () => {
    if (submitted) return;
    // When locked, BU/Division come from the existing staff profile and may
    // legitimately be blank — the user can't fix them here, so don't block.
    // Division tier hidden → the picker isn't rendered, so never require it
    // (the server accepts a blank division, same as the locked path).
    const buRequired = !locked && getBusinessRules().showDivision;
    if ((buRequired && !bu) || !role || !title) {
      const missing: string[] = [];
      if (buRequired && !bu) missing.push("Division");
      if (!role) missing.push("Role");
      if (!title) missing.push("Title");
      setErrorMsg(`Please pick ${missing.join(", ")} before continuing.`);
      return;
    }
    setErrorMsg("");
    setSubmitted(true);
    const titleIdSuffix = locked && personOrg?.jobTitleId ? `, TitleId: ${personOrg.jobTitleId}` : "";
    onSubmit(`BU: ${buShort}, Role: ${role}, Title: ${title}${titleIdSuffix}`);
  };

  const selectStyle: React.CSSProperties = {
    background: C.bg,
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    fontWeight: 600,
    fontSize: 13,
    padding: "10px 12px",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    appearance: "auto",
  };

  const labelStyle: React.CSSProperties = {
    color: C.textMuted, fontWeight: 600, fontSize: 11, marginBottom: 6,
    display: "block", textTransform: "uppercase", letterSpacing: 0.5,
  };

  const roleDisabled = submitted || (!bu && getBusinessRules().showDivision) || rolesLoading;
  const titleDisabled = submitted || !role || titlesLoading;

  return (
    <div style={{
      margin: "10px 0", borderRadius: 12, overflow: "hidden",
      border: `1px solid ${C.green}40`, background: C.bg,
    }}>
      <div style={{ background: C.bgSoft, padding: "12px 14px" }}>
        <div style={{ color: C.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 500 }}>
          Assignment Details
        </div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 15, marginTop: 4 }}>{personName}</div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
            color: "#7a5a00", background: "#FEF3C7", border: "1px solid #F59E0B",
            borderRadius: 4, padding: "2px 6px", lineHeight: "16px",
          }}>Project</span>
          <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>
            {projectId}{projectName && projectName !== projectId ? ` — ${projectName}` : ""}
          </span>
        </div>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {loading || personOrgLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: 12, padding: "8px 0" }}>
            <Loader2 size={14} className="spin" /> Loading options…
          </div>
        ) : locked ? (
          <>
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "10px 12px",
            }}>
              <Lock size={14} color={C.green} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
                <strong style={{ color: C.text }}>{personName}</strong> already has a staff profile —
                Business Unit and Division are fixed. You can still adjust Role and Title for this assignment.
              </div>
            </div>

            {/* BU — locked */}
            {[
              ["Business Unit", personOrg?.businessUnit],
              ["Division", buShort || personOrg?.divisionName],
              ["Department", personOrg?.departmentName],
            ].map(([label, value]) => (
              <div key={label as string}>
                <label style={labelStyle}>{label}</label>
                <div style={{ ...selectStyle, display: "flex", alignItems: "center", background: C.bgSoft, color: value ? C.text : C.textMuted }}>
                  {value || "—"}
                </div>
              </div>
            ))}

            {/* Role — editable */}
            <div>
              <label style={labelStyle}>Role *</label>
              <select
                value={role}
                onChange={(e) => { setRole(e.target.value); setTitle(""); setTitleId(""); setApiTitles([]); setErrorMsg(""); }}
                style={selectStyle}
                disabled={submitted || rolesLoading}
              >
                <option value="">{rolesLoading ? "Loading roles…" : "Select Role…"}</option>
                {role && !roleOptions.includes(role) && (
                  <option value={role}>{role}</option>
                )}
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Title — editable */}
            <div>
              <label style={labelStyle}>Title *</label>
              <select
                value={title}
                onChange={(e) => {
                  const opt = titleOptions.find((o) => o.name === e.target.value);
                  setTitleId(opt?.id || "");
                  setTitle(e.target.value);
                  setErrorMsg("");
                }}
                style={selectStyle}
                disabled={submitted || !role || titlesLoading}
              >
                <option value="">{!role ? "Pick Role first" : titlesLoading ? "Loading titles…" : "Select Title…"}</option>
                {title && !titleOptions.some((o) => o.name === title) && (
                  <option value={title}>{title}</option>
                )}
                {titleOptions.map((t) => (
                  <option key={t.id} value={t.name}>{t.label}</option>
                ))}
              </select>
            </div>

            {errorMsg ? (
              <div style={{
                background: C.redSoft, border: `1px solid ${C.red}`, borderRadius: 8,
                padding: "8px 12px", display: "flex", gap: 8, alignItems: "center",
              }}>
                <AlertCircle size={14} color={C.red} />
                <span style={{ color: C.red, fontWeight: 600, fontSize: 12 }}>{errorMsg}</span>
              </div>
            ) : null}

            {readOnly ? (
              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "var(--rm-panel-soft)",
                border: "1px solid var(--rm-panel-border)",
                fontSize: 12, color: "var(--rm-text-muted)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                Your access level (User) is view-only — assignment is disabled.
              </div>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitted}
                style={{
                  background: submitted ? C.textMuted : C.green, color: "#fff",
                  border: "none", borderRadius: 8, padding: "12px",
                  fontWeight: 700, fontSize: 14, cursor: submitted ? "default" : "pointer",
                  display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                }}
              >
                <Send size={14} /> {submitted ? "Sent…" : "Confirm Assignment"}
              </button>
            )}
          </>
        ) : (
          <>
            {getBusinessRules().showBusinessUnit && (
            <div>
              <label style={labelStyle}>Business Unit</label>
              <select
                value={businessUnit}
                onChange={(e) => { setBusinessUnit(e.target.value); setBU(""); setRole(""); setTitle(""); setTitleId(""); setApiTitles([]); setErrorMsg(""); }}
                style={selectStyle}
                disabled={submitted}
              >
                <option value="">All Business Units</option>
                {buEntities.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
            )}

            {getBusinessRules().showDivision && (
            <div>
              <label style={labelStyle}>Division *</label>
              <select
                value={bu}
                onChange={(e) => { setBU(e.target.value); setRole(""); setTitle(""); setTitleId(""); setApiTitles([]); setErrorMsg(""); }}
                style={selectStyle}
                disabled={submitted}
              >
                <option value="">Select Division…</option>
                {filteredDivisions.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
            )}

            <div>
              <label style={labelStyle}>Role *</label>
              <select
                value={role}
                onChange={(e) => { setRole(e.target.value); setTitle(""); setTitleId(""); setApiTitles([]); setErrorMsg(""); }}
                style={selectStyle}
                disabled={roleDisabled}
              >
                <option value="">{(!bu && getBusinessRules().showDivision) ? "Pick Division first" : rolesLoading ? "Loading roles…" : "Select Role…"}</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Title *</label>
              <select
                value={titleId}
                onChange={(e) => {
                  const opt = titleOptions.find((o) => o.id === e.target.value);
                  setTitleId(e.target.value);
                  setTitle(opt?.name || "");
                  setErrorMsg("");
                }}
                style={selectStyle}
                disabled={titleDisabled}
              >
                <option value="">{!role ? "Pick Role first" : titlesLoading ? "Loading titles…" : "Select Title…"}</option>
                {titleOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            {errorMsg ? (
              <div style={{
                background: C.redSoft, border: `1px solid ${C.red}`, borderRadius: 8,
                padding: "8px 12px", display: "flex", gap: 8, alignItems: "center",
              }}>
                <AlertCircle size={14} color={C.red} />
                <span style={{ color: C.red, fontWeight: 600, fontSize: 12 }}>{errorMsg}</span>
              </div>
            ) : null}

            {readOnly ? (
              <div style={{
                padding: "10px 12px", borderRadius: 8,
                background: "var(--rm-panel-soft)",
                border: "1px solid var(--rm-panel-border)",
                fontSize: 12, color: "var(--rm-text-muted)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                Your access level (User) is view-only — assignment is disabled.
              </div>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitted}
                style={{
                  background: submitted ? C.textMuted : C.green, color: "#fff",
                  border: "none", borderRadius: 8, padding: "12px",
                  fontWeight: 700, fontSize: 14, cursor: submitted ? "default" : "pointer",
                  display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                }}
              >
                <Send size={14} /> {submitted ? "Sent…" : "Confirm Assignment"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
