import { useEffect, useRef, useState } from "react";
import { X, Download, Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
// exceljs is huge (~1 MB minified) — only type imports here; the runtime
// module is loaded on demand inside the two functions that use it, so it
// stays out of the app's startup bundle.
import type { DataValidation } from "exceljs";
import {
  getDivisions, getDepartments, getJobTitles, getBusinessUnits,
  createStaff, createDivision, createBusinessUnit, createJobTitle, authHeaders, bustCache,
  type JobTitleRow,
} from "@/lib/api";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { fetchAccessLevels, isCustomAcl, type AccessLevelDef } from "@/lib/permissions";
import { Z } from "@/lib/zLayers";

const ONBOARDING_API = "/api/onboarding";

const C = {
  bg: "#FFFFFF", card: "#F5F8FA", border: "#D5DEE5",
  green: "#6BA539", red: "#C8102E", text: "#253746", muted: "#6B7E8A",
  amber: "#E87722",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
  letterSpacing: 0.4, marginBottom: 4, display: "block",
};

// ── Column name normaliser ───────────────────────────────────────────────────
function norm(s: unknown) { return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

const COL_ALIASES: Record<string, string> = {
  // name
  fullname: "name", fullname_: "name", staffname: "name",
  // email
  emailaddress: "email", emailid: "email",
  // businessunit
  bu: "businessunit", businessunit: "businessunit",
  // division
  div: "division", divisionname: "division",
  // department
  dept: "department", departmentname: "department",
  // role
  rolename: "role",
  // jobtitle
  title: "jobtitle", position: "jobtitle", designation: "jobtitle", jobtitlename: "jobtitle",
  // accesslevel
  access: "accesslevel", role2: "accesslevel", userrole: "accesslevel",
  // sendinvite
  invite: "sendinvite", sendinvite: "sendinvite", emailinvite: "sendinvite",
};

function resolveCol(raw: string): string {
  const n = norm(raw);
  return COL_ALIASES[n] ?? n;
}

// ── Lookup maps ──────────────────────────────────────────────────────────────
interface LookupMaps {
  divByName: Map<string, string>;   // norm(name) → id
  deptByName: Map<string, string>;
  titleByName: Map<string, string>; // norm(title) → id (string)
  buByName: Map<string, string>;
  // Display-name arrays for Excel dropdown validation
  divNames: string[];
  deptNames: string[];
  titleNames: string[];
  buNames: string[];
  // Admin-defined access levels (Settings → Access Levels): norm(name) → "custom:<id>"
  aclByName: Map<string, string>;
  // norm("custom:<id>") → display name, so preview/results show the level name
  aclNameByMarker: Map<string, string>;
  aclNames: string[];
}

const EMPTY_LOOKUPS: LookupMaps = {
  divByName: new Map(), deptByName: new Map(), titleByName: new Map(), buByName: new Map(),
  divNames: [], deptNames: [], titleNames: [], buNames: [],
  aclByName: new Map(), aclNameByMarker: new Map(), aclNames: [],
};

async function loadLookups(tenantId?: string): Promise<LookupMaps> {
  // Pass tenantId through so the super-admin onboarding flow fetches the TARGET
  // tenant's catalogue. Without it the backend falls back to the caller's own
  // tenant (empty/wrong lists → e.g. no Job Title dropdown values).
  const tid = tenantId || undefined;
  const [divsRaw, deptsRaw, titlesRaw, buRaw, levelsRaw] = await Promise.all([
    getDivisions(tid).catch(() => []),
    getDepartments(tid).catch(() => []),
    getJobTitles(tid).catch(() => [] as JobTitleRow[]),
    getBusinessUnits(tid).catch(() => []),
    // Soft-fail: the built-in Admin/Manager/User always work, custom levels
    // just won't be recognized/offered when this fetch fails.
    fetchAccessLevels(tid).catch(() => [] as AccessLevelDef[]),
  ]);

  const divByName = new Map<string, string>();
  const divNames: string[] = [];
  for (const d of divsRaw as Record<string, unknown>[]) {
    const id = String(d.ID ?? d.Id ?? "");
    const short = String(d.ShortName ?? "").trim();
    const title = String(d.Title ?? "").trim();
    if (id) {
      const label = short || title;
      if (label && !divNames.includes(label)) divNames.push(label);
      if (short) divByName.set(norm(short), id);
      if (title) divByName.set(norm(title), id);
    }
  }

  const deptByName = new Map<string, string>();
  const deptNames: string[] = [];
  for (const d of deptsRaw as Record<string, unknown>[]) {
    const id = String(d.ID ?? d.Id ?? "");
    const title = String(d.Title ?? d.Name ?? "").trim();
    if (id && title) {
      deptByName.set(norm(title), id);
      if (!deptNames.includes(title)) deptNames.push(title);
    }
  }

  const titleByName = new Map<string, string>();
  const titleNames: string[] = [];
  for (const t of titlesRaw as JobTitleRow[]) {
    const id = String(t.ID);
    const title = String(t.Title ?? t.JobTitleName ?? "").trim();
    if (id && title) {
      titleByName.set(norm(title), id);
      if (!titleNames.includes(title)) titleNames.push(title);
    }
  }

  const buByName = new Map<string, string>();
  const buNames: string[] = [];
  for (const b of buRaw as Record<string, unknown>[]) {
    const id = String(b.ID ?? b.Id ?? "");
    const label = String(b.ShortName ?? b.Title ?? b.Name ?? "").trim();
    if (id && label) {
      buByName.set(norm(label), id);
      if (!buNames.includes(label)) buNames.push(label);
    }
  }

  const aclByName = new Map<string, string>();
  const aclNameByMarker = new Map<string, string>();
  const aclNames: string[] = [];
  for (const l of levelsRaw) {
    const name = String(l.name ?? "").trim();
    const id = String(l.id ?? "").trim();
    if (!name || !id) continue;
    const marker = `custom:${id}`;
    aclByName.set(norm(name), marker);
    aclNameByMarker.set(norm(marker), name);
    if (!aclNames.includes(name)) aclNames.push(name);
  }

  return { divByName, deptByName, titleByName, buByName, divNames, deptNames, titleNames, buNames, aclByName, aclNameByMarker, aclNames };
}

// ── Template download ────────────────────────────────────────────────────────
// Dropdown value lists that never change
const ACCESS_LEVELS = ["User", "Manager", "Admin"];
const SEND_INVITE_OPTS = ["Yes", "No"];

async function downloadTemplate(tenantId: string, lookups: LookupMaps) {
  // 1. Fetch existing staff so the template is pre-populated with real rows
  interface TemplateMember { name: string; email: string; divisionName: string | null; departmentName: string | null; jobTitle: string; accessLevel: string | null; }
  let existingStaff: TemplateMember[] = [];
  try {
    const res = await fetch(`${ONBOARDING_API}/invites?tenantId=${encodeURIComponent(tenantId)}`, { headers: authHeaders() });
    if (res.ok) {
      const d = await res.json() as { members: TemplateMember[] };
      existingStaff = (d.members ?? []).filter(m => m.email);
    }
  } catch { /* best-effort */ }

  // Union the tenant catalogue with any job titles already on existing staff so
  // every pre-filled value is also selectable from the dropdown ("all titles").
  const titleNamesEff = [...lookups.titleNames];
  for (const m of existingStaff) {
    const t = (m.jobTitle ?? "").trim();
    if (t && !titleNamesEff.some(x => x.toLowerCase() === t.toLowerCase())) titleNamesEff.push(t);
  }
  // Also offer the standard titles (CEO, CFO, PM, …) so bulk uploads never need
  // a hand-typed title — the import path auto-creates any that don't exist yet.
  for (const t of STANDARD_JOB_TITLES) {
    if (!titleNamesEff.some(x => x.toLowerCase() === t.toLowerCase())) titleNamesEff.push(t);
  }
  titleNamesEff.sort((a, b) => a.localeCompare(b));

  // Access-level dropdown = built-ins + this tenant's custom levels (by name).
  const accessLevelsEff = [...ACCESS_LEVELS, ...lookups.aclNames.filter(n => !ACCESS_LEVELS.some(b => b.toLowerCase() === n.toLowerCase()))];
  // Pre-filled rows carry "custom:<id>" markers — show the level's name instead.
  const aclDisplay = (raw: string | null): string => {
    const v = (raw ?? "").trim();
    if (!v) return "User";
    return lookups.aclNameByMarker.get(norm(v)) ?? v;
  };

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  // 2. Hidden reference sheet for dropdown validation
  //    Col A = Business Units, B = Divisions, C = Departments, D = Job Titles
  //    E = Access Levels, F = Send Invite
  const REF = "_Data";
  const refSheet = wb.addWorksheet(REF);
  refSheet.state = "veryHidden";
  const refCols = [
    lookups.buNames,
    lookups.divNames,
    lookups.deptNames,
    titleNamesEff,
    accessLevelsEff,
    SEND_INVITE_OPTS,
  ];
  refCols.forEach((vals, ci) => {
    vals.forEach((v, ri) => { refSheet.getCell(ri + 1, ci + 1).value = v; });
  });

  // Helper: build a list validation referencing the hidden sheet
  function listRef(col: string, count: number): Partial<DataValidation> {
    if (count === 0) return {};
    return {
      type: "list",
      formulae: [`${REF}!$${col}$1:$${col}$${count}`],
      showErrorMessage: false,
      showDropdown: true,
    } as Partial<DataValidation>;
  }

  // 3. Staff sheet
  const ws = wb.addWorksheet("Staff");
  ws.columns = [
    { header: "Full Name *",  key: "name",         width: 26 },
    { header: "Email *",      key: "email",        width: 32 },
    { header: "Business Unit",key: "businessUnit", width: 20 },
    { header: "Division",     key: "division",     width: 22 },
    { header: "Department",   key: "department",   width: 22 },
    { header: "Role",         key: "role",         width: 22 },
    { header: "Job Title",    key: "jobtitle",     width: 26 },
    { header: "Access Level", key: "accesslevel",  width: 16 },
    { header: "Send Invite",  key: "sendinvite",   width: 14 },
  ];
  const hdr = ws.getRow(1);
  hdr.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FF253746" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF6BA539" } } };
  });

  // 4. Pre-populate with existing staff (or placeholder rows if none yet)
  const dataRows: Record<string, string>[] = existingStaff.length > 0
    ? existingStaff.map(m => ({
        name: m.name ?? "",
        email: m.email ?? "",
        businessUnit: "",
        division: m.divisionName ?? "",
        department: m.departmentName ?? "",
        role: "",
        jobtitle: m.jobTitle ?? "",
        accesslevel: aclDisplay(m.accessLevel),
        sendinvite: "No",
      }))
    : [
        { name: "", email: "", businessUnit: "", division: "", department: "", role: "", jobtitle: "", accesslevel: "User", sendinvite: "Yes" },
        { name: "", email: "", businessUnit: "", division: "", department: "", role: "", jobtitle: "", accesslevel: "User", sendinvite: "Yes" },
      ];

  dataRows.forEach(row => ws.addRow(row));

  // 5. Add dropdown validation to every data row (2 … max 500 rows for new entries below too)
  const maxRow = Math.max(dataRows.length, 10) + 490; // cover blank rows users might add
  const dropConfig: Array<[string, ReturnType<typeof listRef>]> = [
    ["C", listRef("A", lookups.buNames.length)],
    ["D", listRef("B", lookups.divNames.length)],
    ["E", listRef("C", lookups.deptNames.length)],
    ["G", listRef("D", titleNamesEff.length)],
    ["H", listRef("E", accessLevelsEff.length)],
    ["I", listRef("F", SEND_INVITE_OPTS.length)],
  ];
  for (let row = 2; row <= maxRow; row++) {
    for (const [col, dv] of dropConfig) {
      if (dv.type) ws.getCell(`${col}${row}`).dataValidation = dv as DataValidation;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "staff-bulk-template.xlsx";
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Row type ─────────────────────────────────────────────────────────────────
interface ParsedRow {
  rowNum: number;
  name: string;
  email: string;
  businessUnit: string;
  division: string;
  department: string;
  role: string;
  jobTitle: string;
  // "Admin" | "Manager" | "User" | "custom:<id>" | "" — the value sent to the
  // server (lib/staff.ts normAcl passes custom markers through verbatim).
  accessLevel: string;
  // Display name for a custom level (preview/results show the name, not the marker).
  accessLevelName: string;
  sendInvite: boolean;
  // resolved IDs
  businessUnitId?: string;
  divisionId?: string;
  departmentId?: string;
  jobTitleId?: string;
  errors: string[];
  warnings: string[];
}

type ImportStatus = "pending" | "importing" | "ok" | "error";
interface RowResult extends ParsedRow {
  status: ImportStatus;
  resultMsg?: string;
}

// ── Parse helpers ─────────────────────────────────────────────────────────────
/** Built-ins normalize; custom levels match by name (case-insensitive) and
 *  resolve to the "custom:<id>" marker the server's normAcl accepts. A
 *  "custom:<id>" marker pasted verbatim is also accepted when it exists. */
function parseAccessLevel(raw: string, lookups: LookupMaps): { level: string; label: string } {
  const v = raw.trim().toLowerCase();
  if (v === "") return { level: "", label: "" };
  if (v === "admin") return { level: "Admin", label: "Admin" };
  if (v === "manager") return { level: "Manager", label: "Manager" };
  if (v === "user" || v === "view" || v === "view only") return { level: "User", label: "User" };
  const custom = lookups.aclByName.get(norm(raw));
  if (custom) return { level: custom, label: lookups.aclNameByMarker.get(norm(custom)) ?? raw.trim() };
  if (isCustomAcl(v) && lookups.aclNameByMarker.has(norm(v))) {
    return { level: v, label: lookups.aclNameByMarker.get(norm(v))! };
  }
  return { level: "", label: "" };
}

async function parseExcel(file: File, lookups: LookupMaps): Promise<ParsedRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no worksheets.");

  // First row = headers
  const headerRow = ws.getRow(1);
  const colMap: Record<number, string> = {};
  headerRow.eachCell((cell, colIdx) => {
    const key = resolveCol(String(cell.value ?? ""));
    colMap[colIdx] = key;
  });

  const rows: ParsedRow[] = [];
  ws.eachRow((row, rowIdx) => {
    if (rowIdx === 1) return; // skip header
    const get = (key: string): string => {
      for (const [ci, k] of Object.entries(colMap)) {
        if (k === key) {
          const v = row.getCell(Number(ci)).value;
          return v == null ? "" : String(v).trim();
        }
      }
      return "";
    };
    const name = get("name");
    const email = get("email");
    if (!name && !email) return; // blank row

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name) errors.push("Full Name is required");
    if (!email) errors.push("Email is required");
    else if (!email.includes("@")) errors.push("Email looks invalid");

    const buRaw  = get("businessunit");
    const divRaw = get("division");
    const deptRaw = get("department");
    const roleRaw = get("role");
    const jtRaw = get("jobtitle");
    const alRaw = get("accesslevel");
    const siRaw = get("sendinvite");

    let businessUnitId: string | undefined;
    if (buRaw) {
      businessUnitId = lookups.buByName.get(norm(buRaw));
      if (!businessUnitId) warnings.push(`Business unit "${buRaw}" not found — BU link will be skipped`);
    }

    let divisionId: string | undefined;
    if (divRaw) {
      divisionId = lookups.divByName.get(norm(divRaw));
      if (!divisionId) warnings.push(`Division "${divRaw}" not found — will be skipped`);
    }

    let departmentId: string | undefined;
    if (deptRaw) {
      departmentId = lookups.deptByName.get(norm(deptRaw));
      if (!departmentId) warnings.push(`Department "${deptRaw}" not found — will be skipped`);
    }

    let jobTitleId: string | undefined;
    if (jtRaw) {
      jobTitleId = lookups.titleByName.get(norm(jtRaw));
      if (!jobTitleId) warnings.push(`Job title "${jtRaw}" not found — will be created`);
    }

    const { level: accessLevel, label: accessLevelName } = parseAccessLevel(alRaw, lookups);
    if (alRaw && !accessLevel) {
      warnings.push(`Access level "${alRaw}" not recognized — the person will be created without one (grandfathered)`);
    }
    const siNorm = norm(siRaw);
    const sendInvite = siRaw === "" || siNorm === "yes" || siNorm === "y" || siNorm === "true" || siNorm === "1";

    rows.push({
      rowNum: rowIdx,
      name, email,
      businessUnit: buRaw, businessUnitId,
      division: divRaw, department: deptRaw, role: roleRaw, jobTitle: jtRaw,
      accessLevel, accessLevelName, sendInvite,
      divisionId, departmentId, jobTitleId,
      errors, warnings,
    });
  });
  return rows;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  tenantId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void; // refresh invite list after import
}

type Step = "upload" | "preview" | "results";

export default function BulkStaffUploadModal({ tenantId, open, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [lookups, setLookups] = useState<LookupMaps | null>(null);
  const [rows, setRows] = useState<RowResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("upload"); setRows([]); setParseError(null); setParsing(false); setImporting(false);
    // The org caches key on the endpoint name only (not tenantId), so a super-admin
    // switching tenants would otherwise see the previously-viewed tenant's lists.
    bustCache("divisions"); bustCache("departments"); bustCache("business-units"); bustCache("job-titles");
    loadLookups(tenantId).then(setLookups).catch(() => setLookups(EMPTY_LOOKUPS));
  }, [open, tenantId]);

  async function handleFile(file: File) {
    if (!lookups) return;
    setParseError(null); setParsing(true);
    try {
      const parsed = await parseExcel(file, lookups);
      if (parsed.length === 0) { setParseError("No data rows found. Make sure row 1 is headers and rows 2+ are data."); return; }
      setRows(parsed.map(r => ({ ...r, status: "pending" })));
      setStep("preview");
    } catch (e) {
      setParseError((e as Error).message || "Could not parse the file.");
    } finally {
      setParsing(false);
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  async function runImport() {
    setImporting(true);
    setStep("results");
    const updated = [...rows];
    // Titles created during this run, so ten rows saying "CEO" create it once.
    const createdTitleIds = new Map<string, string>(); // norm(title) → id
    for (let i = 0; i < updated.length; i++) {
      const r = updated[i];
      if (r.errors.length > 0) {
        updated[i] = { ...r, status: "error", resultMsg: r.errors.join("; ") };
        setRows([...updated]);
        continue;
      }
      updated[i] = { ...r, status: "importing" };
      setRows([...updated]);
      try {
        // If the row has a Business Unit, ensure it exists then re-link the
        // division to it. createDivision is idempotent — when the division
        // already exists it simply updates its BusinessUnitIdLookup.
        if (r.businessUnit && r.division) {
          try {
            let buId = r.businessUnitId;
            if (!buId) {
              // BU wasn't in the DB at parse time — create it now (idempotent)
              const created = await createBusinessUnit(r.businessUnit);
              buId = created.id;
            }
            await createDivision(r.division, buId);
          } catch { /* best-effort — don't fail the staff create over a BU link */ }
        }
        // Job title named in the sheet but missing from the catalogue at parse
        // time — create it now (idempotent) so the title is never silently
        // dropped (a dropped title lands the person on the default persona).
        let jobTitleId = r.jobTitleId;
        if (!jobTitleId && r.jobTitle) {
          const k = norm(r.jobTitle);
          jobTitleId = createdTitleIds.get(k);
          if (!jobTitleId) {
            const createdTitle = await createJobTitle(r.jobTitle, r.departmentId || undefined);
            jobTitleId = String(createdTitle.id);
            createdTitleIds.set(k, jobTitleId);
          }
        }
        await createStaff({
          name: r.name, email: r.email,
          divisionId: r.divisionId,
          departmentId: r.departmentId,
          jobTitleId,
          roleName: r.role || undefined,
          accessLevel: r.accessLevel || "User",
          sendInvite: r.sendInvite,
        });
        updated[i] = { ...r, status: "ok", resultMsg: r.sendInvite ? "Created + invite sent" : "Created" };
      } catch (e) {
        updated[i] = { ...r, status: "error", resultMsg: (e as Error).message || "Failed" };
      }
      setRows([...updated]);
    }
    setImporting(false);
    onDone();
  }

  const validRows = rows.filter(r => r.errors.length === 0);
  const errorRows = rows.filter(r => r.errors.length > 0);
  const doneCount = rows.filter(r => r.status === "ok").length;
  const failCount = rows.filter(r => r.status === "error" && r.errors.length === 0).length;

  if (!open) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: Z.POPUP, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}
      onClick={onClose}
    >
      <div
        style={{ background: C.bg, borderRadius: 14, width: "100%", maxWidth: 680, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Upload size={18} color={C.green} />
              <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Bulk Add Staff Members</span>
            </div>
            <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
              {step === "upload" && "Download the template, fill it in, then upload it here."}
              {step === "preview" && `${rows.length} rows found — ${validRows.length} valid, ${errorRows.length} with errors.`}
              {step === "results" && (importing ? "Importing…" : `Done — ${doneCount} added${failCount > 0 ? `, ${failCount} failed` : ""}.`)}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Template download */}
              <div style={{ background: C.card, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                <label style={labelStyle}>Step 1 — Download the template</label>
                <p style={{ fontSize: 13, color: C.muted, margin: "0 0 12px" }}>
                  Downloads a pre-filled template with your current team. Each organization column (Division, Department, Job Title, Access Level) has a dropdown showing the values that already exist in the system.
                </p>
                <button
                  onClick={() => void downloadTemplate(tenantId, lookups ?? EMPTY_LOOKUPS)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${C.green}`, background: "transparent", color: C.green, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  <Download size={14} /> Download template
                </button>
              </div>

              {/* File drop zone */}
              <div style={{ background: C.card, borderRadius: 10, padding: 16, border: `1px solid ${C.border}` }}>
                <label style={labelStyle}>Step 2 — Upload your completed file</label>
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragging ? C.green : C.border}`, borderRadius: 10,
                    padding: "32px 24px", textAlign: "center", cursor: "pointer",
                    background: dragging ? "#F0F7EA" : C.bg, transition: "all 0.15s",
                  }}
                >
                  {parsing ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: C.muted }}>
                      <Loader2 size={18} className="animate-spin" /> Parsing file…
                    </div>
                  ) : (
                    <>
                      <Upload size={28} color={C.muted} style={{ marginBottom: 10 }} />
                      <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: C.text }}>Drop your Excel file here</p>
                      <p style={{ margin: 0, fontSize: 12, color: C.muted }}>or click to browse · .xlsx or .csv</p>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" style={{ display: "none" }} onChange={onFileInput} />
                {parseError && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start", color: C.red, fontSize: 13 }}>
                    <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} /> {parseError}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Preview ── */}
          {step === "preview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: C.card }}>
                      {["Row", "Name", "Email", "Division", "Dept", "Role", "Job Title", "Access", "Invite", "Status"].map(h => (
                        <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.rowNum} style={{ borderBottom: `1px solid ${C.border}`, background: r.errors.length > 0 ? "#FFF5F5" : "transparent" }}>
                        <td style={{ padding: "6px 10px", color: C.muted }}>{r.rowNum}</td>
                        <td style={{ padding: "6px 10px", fontWeight: 600, color: C.text }}>{r.name || <span style={{ color: C.red }}>—</span>}</td>
                        <td style={{ padding: "6px 10px", color: C.muted }}>{r.email || <span style={{ color: C.red }}>—</span>}</td>
                        <td style={{ padding: "6px 10px", color: r.divisionId ? C.text : C.amber }}>{r.division || "—"}</td>
                        <td style={{ padding: "6px 10px", color: r.departmentId ? C.text : C.amber }}>{r.department || "—"}</td>
                        <td style={{ padding: "6px 10px", color: C.text }}>{r.role || "—"}</td>
                        <td style={{ padding: "6px 10px", color: r.jobTitleId ? C.text : C.amber }}>{r.jobTitle || "—"}</td>
                        <td style={{ padding: "6px 10px" }}>{r.accessLevelName || r.accessLevel || "User"}</td>
                        <td style={{ padding: "6px 10px" }}>{r.sendInvite ? "✓" : "—"}</td>
                        <td style={{ padding: "6px 10px" }}>
                          {r.errors.length > 0 ? (
                            <span style={{ color: C.red, fontWeight: 600 }} title={r.errors.join("; ")}>✕ Error</span>
                          ) : r.warnings.length > 0 ? (
                            <span style={{ color: C.amber }} title={r.warnings.join("; ")}>⚠ Warning</span>
                          ) : (
                            <span style={{ color: C.green }}>✓ Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errorRows.length > 0 && (
                <div style={{ background: "#FFF5F5", borderRadius: 8, padding: 12, border: `1px solid #FFCDD2`, fontSize: 12, color: C.red }}>
                  <strong>{errorRows.length} row{errorRows.length > 1 ? "s" : ""} have errors</strong> and will be skipped.
                  Fix them in your file and re-upload to include them.
                </div>
              )}
              {validRows.length === 0 && (
                <div style={{ textAlign: "center", color: C.muted, padding: 16 }}>No valid rows to import.</div>
              )}
            </div>
          )}

          {/* ── Step 3: Results ── */}
          {step === "results" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rows.map(r => (
                <div key={r.rowNum} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: r.status === "ok" ? "#F0F7EA" : r.status === "error" ? "#FFF5F5" : C.card }}>
                  {r.status === "ok" && <CheckCircle2 size={15} color={C.green} />}
                  {r.status === "error" && <AlertCircle size={15} color={C.red} />}
                  {r.status === "importing" && <Loader2 size={15} className="animate-spin" color={C.muted} />}
                  {r.status === "pending" && <div style={{ width: 15, height: 15, borderRadius: "50%", background: C.border }} />}
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text, minWidth: 140 }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{r.email}</span>
                  <span style={{ fontSize: 12, color: r.status === "ok" ? C.green : r.status === "error" ? C.red : C.muted }}>{r.resultMsg ?? (r.status === "pending" ? "Waiting…" : r.status === "importing" ? "Importing…" : "")}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {step === "upload" && (
            <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          )}
          {step === "preview" && (
            <>
              <button onClick={() => setStep("upload")} style={{ padding: "9px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Back</button>
              <button
                onClick={() => void runImport()}
                disabled={validRows.length === 0}
                style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: validRows.length === 0 ? "#BCC" : C.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: validRows.length === 0 ? "not-allowed" : "pointer" }}
              >
                Import {validRows.length} member{validRows.length !== 1 ? "s" : ""}
              </button>
            </>
          )}
          {step === "results" && !importing && (
            <button onClick={onClose} style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
