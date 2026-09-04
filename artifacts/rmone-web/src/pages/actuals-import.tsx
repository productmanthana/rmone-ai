/**
 * Actuals Import — upload actual hours from Excel/CSV (admin only; reached
 * from the Actuals vs Forecast pages, not the nav menu).
 *
 * The file is parsed IN THE BROWSER (tolerant header matching), then rows are
 * sent in chunks and committed; the server validates every row, quarantines
 * bad ones as exceptions (never silently dropped, never auto-creating people
 * or projects), and reruns the affected projects' snapshots.
 *
 * Date rule: Excel serial dates are converted arithmetically (no timezone
 * drift); browser-parsed date strings get a +12h snap so "23:59:59 the night
 * before" lands on the intended day. The server snaps every date to its
 * week's UTC Monday.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, AlertTriangle, Lock, Upload, FileSpreadsheet, CheckCircle2,
  ChevronDown, ChevronRight, RefreshCw, ArrowLeft, Info, Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  beginActualsImport, sendActualsImportRows, commitActualsImport, abortActualsImport,
  listActualsImports, listActualsImportExceptions, rebuildAfSnapshots,
  getUsers, getModuleRecordsFresh,
  type AfImportBatchRow, type AfImportExceptionRow, type AfImportRowInput,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { fmtNum, mondayIsoOf, planUploadChunks } from "@/lib/afMath";

const BLUE = "#2563eb";
const GREEN = "#16a34a";
const CHUNK = 2000;

const card: React.CSSProperties = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  padding: 16,
};

/* ── tolerant header mapping ──────────────────────────────────────────── */

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const HEADER_SYNONYMS: Record<"employee" | "email" | "ticket" | "week" | "hours" | "role" | "division", string[]> = {
  employee: ["employee", "employeename", "resource", "resourcename", "person", "personname", "name", "staff", "user", "username", "fullname"],
  email: ["email", "employeeemail", "emailaddress", "workemail", "emailid", "useremail", "mail"],
  ticket: ["projectid", "project", "ticketid", "ticket", "projectnumber", "projectno", "projectcode", "jobid", "jobnumber", "jobno", "id", "projectticket", "opportunityid"],
  week: ["week", "weekdate", "weekof", "weekstarting", "weekstart", "weekstartdate", "date", "workdate", "weekending", "weekend", "weekenddate", "period", "periodending"],
  hours: ["hours", "hrs", "actualhours", "actualhrs", "hoursworked", "workedhours", "time", "totalhours", "qty", "quantity"],
  role: ["role", "rolename", "jobtitle", "title", "position"],
  division: ["division", "div", "divisionname", "businessunit", "bu", "department", "dept"],
};

function mapHeaders(headerRow: unknown[]): { idx: Partial<Record<keyof typeof HEADER_SYNONYMS, number>>; labels: string[] } {
  const idx: Partial<Record<keyof typeof HEADER_SYNONYMS, number>> = {};
  const labels = headerRow.map((h) => String(h ?? "").trim());
  const normed = labels.map(norm);
  for (const key of Object.keys(HEADER_SYNONYMS) as (keyof typeof HEADER_SYNONYMS)[]) {
    for (const syn of HEADER_SYNONYMS[key]) {
      const at = normed.indexOf(syn);
      if (at >= 0 && !Object.values(idx).includes(at)) { idx[key] = at; break; }
    }
  }
  return { idx, labels };
}

/* ── date + number coercion ───────────────────────────────────────────── */

/** Excel serial → ISO date via pure arithmetic (UTC, no timezone drift). */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null; // ~1954…2118
  const ms = Math.round((serial - 25569) * 86400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

function coerceDate(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return serialToIso(v) ?? String(v);
  if (v instanceof Date) {
    // Browser-built Date (often 23:59:59 the night before): snap +12h, take LOCAL parts.
    const d = new Date(v.getTime() + 12 * 3600_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/); // US M/D/Y
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return `${y}-${String(Number(us[1])).padStart(2, "0")}-${String(Number(us[2])).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) {
    const d = new Date(t + 12 * 3600_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return s; // let the server quarantine it as bad_week
}

function coerceHours(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return n; // NaN → JSON null → server bad_hours exception (never silently dropped)
}

/** Timesheet exports often carry one row per DAY or per task, while the
 * server stores one row per person + project + WEEK + role. Pre-combining in
 * the browser keeps the preview count honest and stops one person-week from
 * splitting across upload chunks. Only cleanly-parsed rows merge — anything
 * malformed passes through untouched so the server can quarantine it
 * row-by-row (loud, never silently dropped). */
function aggregateParsedRows(rows: AfImportRowInput[]): { rows: AfImportRowInput[]; combined: number } {
  const out: AfImportRowInput[] = [];
  const byKey = new Map<string, AfImportRowInput>();
  for (const r of rows) {
    const weekMon = /^\d{4}-\d{2}-\d{2}$/.test(r.week) ? mondayIsoOf(r.week) : null;
    if (!weekMon || !r.employee || !r.ticket || !Number.isFinite(r.hours)) {
      out.push(r); // let the server explain exactly what's wrong with this row
      continue;
    }
    const key = [
      r.employee.trim().toLowerCase(),
      r.ticket.trim().toLowerCase(),
      weekMon,
      (r.role ?? "").trim().toLowerCase(),
    ].join("|");
    const prev = byKey.get(key);
    if (prev) {
      prev.hours += r.hours;
      if (!prev.division && r.division) prev.division = r.division;
    } else {
      const copy: AfImportRowInput = { ...r, week: weekMon };
      byKey.set(key, copy);
      out.push(copy);
    }
  }
  return { rows: out, combined: rows.length - out.length };
}

/* ── pre-upload check (mirrors the server's matching exactly) ─────────── */

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const normTicket = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const EXAMPLE_ROW_RE = /example\s*[—–-]\s*replace/i;

/** Lookup maps built from RM ONE's live users + records so mistakes are
 * caught with exact reasons BEFORE upload. The server re-validates every
 * row authoritatively either way — this never weakens anything. */
interface RefData {
  byId: Set<string>;                          // user GUIDs (lowercased)
  byEmail: Map<string, string>;               // email → GUID
  byUsername: Map<string, string>;            // username → GUID
  byName: Map<string, string | "ambiguous">;  // normalized full name → GUID
  tickets: Map<string, string>;               // normalized ticket → DB verbatim id
}

type RowCheck = { ok: true; fixedTicket?: string } | { ok: false; reason: string };

function checkRow(r: AfImportRowInput, refs: RefData): RowCheck {
  const idText = r.employee.trim();
  if (EXAMPLE_ROW_RE.test(idText) || EXAMPLE_ROW_RE.test(r.name ?? "")) {
    return { ok: false, reason: "Template example row — replace it with real data." };
  }
  if (!idText || !r.ticket.trim() || !r.week.trim()) {
    return { ok: false, reason: "Employee, Project ID and Week are all required." };
  }
  // Person — same order as the server: ID → email → username → unique name.
  const low = idText.toLowerCase();
  let personId: string | undefined;
  if (GUID_RE.test(idText)) {
    if (!refs.byId.has(low)) return { ok: false, reason: `No user with ID “${idText}”.` };
    personId = low;
  } else {
    personId = refs.byEmail.get(low) ?? refs.byUsername.get(low);
    if (!personId) {
      const hit = refs.byName.get(normName(idText));
      if (hit === "ambiguous") return { ok: false, reason: `More than one person is named “${idText}” — use their email or ID instead.` };
      personId = hit;
    }
    if (!personId) return { ok: false, reason: `No user matches “${idText}” — check the spelling, or use their email or ID.` };
  }
  // An Email and a Name pointing at DIFFERENT people is a mistake — never guessed.
  if (r.email && r.name) {
    const nameHit = refs.byName.get(normName(r.name));
    if (nameHit && nameHit !== "ambiguous" && nameHit !== personId) {
      return { ok: false, reason: `“${r.name}” is a different person than “${r.email}” — fix whichever is wrong.` };
    }
  }
  const canonical = refs.tickets.get(normTicket(r.ticket));
  if (!canonical) return { ok: false, reason: `No project or opportunity with ID “${r.ticket}”.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.week) || !mondayIsoOf(r.week)) {
    return { ok: false, reason: `“${r.week}” is not a date.` };
  }
  if (!Number.isFinite(r.hours) || r.hours < 0) return { ok: false, reason: "Hours must be a number (0 or more)." };
  if (r.hours > 168) return { ok: false, reason: `${fmtNum(r.hours)} hours in one week is impossible (max 168).` };
  return canonical !== r.ticket.trim() ? { ok: true, fixedTicket: canonical } : { ok: true };
}

/* ── downloadable template ────────────────────────────────────────────── */

/** Client-built XLSX template. Sheet 1 = data (headers the tolerant mapper
 * recognizes + example rows the user replaces); Sheet 2 = instructions.
 * The parser only reads the FIRST sheet, so the instructions never upload.
 * Unmodified example rows quarantine loudly as exceptions server-side —
 * people and projects are never auto-created. */
function downloadTemplate() {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const monday = mondayIsoOf(todayIso) ?? todayIso;
  const data = XLSX.utils.aoa_to_sheet([
    ["Employee Email", "Employee Name", "Project ID", "Week Starting", "Actual Hours"],
    ["jane.smith@example.com (example — replace)", "Jane Smith", "PMM-26-000101", monday, 38.5],
    ["carlos.rivera@example.com (example — replace)", "Carlos Rivera", "OPM-26-000079", monday, 6.25],
  ]);
  data["!cols"] = [{ wch: 36 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 12 }];
  const info = XLSX.utils.aoa_to_sheet([
    ["Import Actual Hours — how to fill this template"],
    [],
    ["Required columns (first sheet):"],
    ["Employee Email", "The person's email in RM ONE — the safest identifier because it's unique to them. Their user ID also works here. If you can't use emails, leave this blank and fill Employee Name instead."],
    ["Project ID", "The record's ticket ID (e.g. PMM-26-000101 or OPM-26-000079). One file may mix many projects."],
    ["Week Starting", "Any date in the week (YYYY-MM-DD is safest) — every row is snapped to that week's Monday."],
    ["Actual Hours", "Hours actually worked that week. Decimals are fine (e.g. 1.75)."],
    [],
    ["Optional columns:"],
    ["Employee Name", "Optional when Email is filled — kept for readability. Name-only rows must match exactly ONE person in RM ONE; misspelled or shared names are set aside for review, never guessed."],
    ["Other columns", "Older files that still include Role or Division keep working — they're used when present, never required."],
    [],
    ["Checking before import:"],
    ["", "The upload screen checks every row against RM ONE first — unknown emails, misspelled names and unknown project IDs are flagged with the exact reason BEFORE anything is imported."],
    [],
    ["Planned vs Actual:"],
    ["", "Planned hours already come from the project plan in RM ONE — this file only supplies actuals."],
    ["", "After import, Actuals vs Forecast compares them week by week (variance = planned − actual)."],
    [],
    ["Bulk imports:"],
    ["", "Put all projects in ONE file — just include the Project ID on every row."],
    ["", "Daily or per-task rows are combined into weekly totals automatically."],
    [],
    ["Before uploading:"],
    ["", "Replace the example rows. People and projects are never auto-created — unknown or misspelled names become exceptions to review, nothing is guessed."],
  ]);
  info["!cols"] = [{ wch: 16 }, { wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, data, "Actual Hours");
  XLSX.utils.book_append_sheet(wb, info, "Instructions");
  XLSX.writeFile(wb, "actual-hours-template.xlsx");
}

/* ── downloadable flagged-rows workbook ───────────────────────────────── */

/** EVERY flagged row (the panel shows at most 30) as an XLSX the admin can
 * fix in Excel. Columns keep the ORIGINAL header labels, so the corrected
 * file re-imports as-is — the tolerant mapper resolves them exactly as it
 * did the first time — and the trailing "Reason" column matches no header
 * synonym, so re-uploads simply ignore it. Cell values are the parsed ones
 * the pre-check judged (dates already ISO, daily rows already combined into
 * weekly totals) — exactly what each Reason refers to. */
function downloadFlaggedRows(parsed: ParsedFile, flagged: { row: AfImportRowInput; reason: string }[]) {
  const WCH: Record<keyof typeof HEADER_SYNONYMS, number> = { employee: 22, email: 36, ticket: 16, week: 14, hours: 12, role: 20, division: 14 };
  const cell = (field: keyof typeof HEADER_SYNONYMS, r: AfImportRowInput): string | number =>
    field === "employee" ? r.name ?? ""
    : field === "email" ? r.email ?? ""
    : field === "ticket" ? r.ticket
    : field === "week" ? r.week
    : field === "hours" ? (Number.isFinite(r.hours) ? r.hours : "")
    : field === "role" ? r.role ?? ""
    : r.division ?? "";
  const ws = XLSX.utils.aoa_to_sheet([
    [...parsed.mapped.map((m) => m.label), "Reason"],
    ...flagged.map((e) => [...parsed.mapped.map((m) => cell(m.field, e.row)), e.reason]),
  ]);
  ws["!cols"] = [...parsed.mapped.map((m) => ({ wch: Math.max(WCH[m.field], m.label.length + 2) })), { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rows to fix");
  const base = parsed.filename.replace(/\.[^.]+$/, "").slice(0, 80) || "actual-hours";
  XLSX.writeFile(wb, `${base}-flagged-rows.xlsx`);
}

/* ── page ─────────────────────────────────────────────────────────────── */

interface ParsedFile {
  filename: string;
  sheet: string;
  mapped: { field: keyof typeof HEADER_SYNONYMS; key: string; label: string }[];
  missing: string[]; // required fields with no matching column
  rows: AfImportRowInput[];
  skippedBlank: number;
  combined: number; // daily/task rows merged into person-week totals
}

type Phase =
  | { step: "idle" }
  | { step: "uploading"; sent: number; total: number }
  | { step: "done"; accepted: number; exceptions: number; tickets: number; batchId: number };

export default function ActualsImportPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;

  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [batches, setBatches] = useState<AfImportBatchRow[] | null | undefined>(undefined);
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const [exceptions, setExceptions] = useState<Map<number, AfImportExceptionRow[] | null | undefined>>(new Map());
  const [rebuilding, setRebuilding] = useState<"idle" | "confirm" | "running">("idle");
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reference data for the pre-upload check: live users + project IDs.
  // undefined = loading, null = unavailable → fail OPEN (skip the pre-check;
  // the server still validates every row during upload, nothing gets weaker).
  const [refs, setRefs] = useState<RefData | null | undefined>(undefined);
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    Promise.all([
      getUsers(),
      // GENUINELY fresh record lists (same pattern as the create wizards):
      // a 5-min-stale cache could FALSE-flag a just-created project, and
      // flagged rows are skipped by default — staleness is not acceptable here.
      getModuleRecordsFresh("PMM").catch(() => null),
      getModuleRecordsFresh("OPM").catch(() => null),
    ]).then(([users, pmm, opm]) => {
      if (!alive) return;
      // A missing/partial source would false-flag valid rows → no pre-check
      // at all instead (fail OPEN; the server validates during upload).
      if (!pmm || !opm || !Array.isArray(pmm.data) || !Array.isArray(opm.data)) { setRefs(null); return; }
      const byId = new Set<string>();
      const byEmail = new Map<string, string>();
      const byUsername = new Map<string, string>();
      const byName = new Map<string, string | "ambiguous">();
      for (const u of users) {
        const id = String(u.id ?? "").trim().toLowerCase();
        if (!id) continue;
        byId.add(id);
        const email = String(u.email ?? "").trim().toLowerCase();
        if (email) byEmail.set(email, id);
        const username = String(u.username ?? "").trim().toLowerCase();
        if (username) byUsername.set(username, id);
        const nn = normName(String(u.name ?? ""));
        if (nn) byName.set(nn, byName.has(nn) ? "ambiguous" : id);
      }
      const tickets = new Map<string, string>();
      for (const list of [pmm.data, opm.data]) {
        for (const rec of list ?? []) {
          const id = String((rec as Record<string, unknown>).TicketId ?? "").trim();
          if (id) tickets.set(normTicket(id), id);
        }
      }
      // Zero tickets across BOTH modules = degraded or empty tenant — the
      // pre-check can't tell which, so it must not judge (fail open).
      if (tickets.size === 0) { setRefs(null); return; }
      setRefs({ byId, byEmail, byUsername, byName, tickets });
    }).catch(() => { if (alive) setRefs(null); });
    return () => { alive = false; };
  }, [isAdmin]);

  const refreshBatches = useCallback(() => {
    listActualsImports().then(setBatches).catch(() => setBatches(null));
  }, []);
  useEffect(() => { if (isAdmin) refreshBatches(); }, [isAdmin, refreshBatches]);

  const onFile = async (file: File) => {
    setParseError(null);
    setParsed(null);
    setPhase({ step: "idle" });
    setUploadError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); // no cellDates → serials stay numeric
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("The file has no sheets.");
      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
      // First row with ≥2 non-empty cells = header row.
      let headerAt = -1;
      for (let i = 0; i < Math.min(grid.length, 10); i++) {
        const filled = (grid[i] ?? []).filter((c) => String(c ?? "").trim() !== "").length;
        if (filled >= 2) { headerAt = i; break; }
      }
      if (headerAt < 0) throw new Error("Couldn't find a header row in the first sheet.");
      const { idx, labels } = mapHeaders(grid[headerAt] ?? []);
      const missing: string[] = [];
      if (idx.employee == null && idx.email == null) missing.push("Employee Email (or Employee Name)");
      if (idx.ticket == null) missing.push("Project ID");
      if (idx.week == null) missing.push("Week date");
      if (idx.hours == null) missing.push("Hours");
      const rows: AfImportRowInput[] = [];
      let skippedBlank = 0;
      if (missing.length === 0) {
        for (let i = headerAt + 1; i < grid.length; i++) {
          const r = grid[i] ?? [];
          const nameCell = idx.employee != null ? String(r[idx.employee] ?? "").trim() : "";
          const emailCell = idx.email != null ? String(r[idx.email] ?? "").trim() : "";
          // Email is the unique identifier, so it wins when both are present;
          // name-only files keep working (the pre-check enforces uniqueness).
          const employee = emailCell || nameCell;
          const ticket = String(r[idx.ticket!] ?? "").trim();
          const weekRaw = r[idx.week!];
          const hoursRaw = r[idx.hours!];
          if (!employee && !ticket && (weekRaw == null || weekRaw === "") && (hoursRaw == null || hoursRaw === "")) {
            skippedBlank++;
            continue; // entirely blank line
          }
          const row: AfImportRowInput = {
            employee,
            ticket,
            week: coerceDate(weekRaw),
            hours: coerceHours(hoursRaw),
          };
          if (emailCell) row.email = emailCell;
          if (nameCell) row.name = nameCell;
          if (idx.role != null) {
            const role = String(r[idx.role] ?? "").trim();
            if (role) row.role = role;
          }
          if (idx.division != null) {
            const division = String(r[idx.division] ?? "").trim();
            if (division) row.division = division;
          }
          rows.push(row);
        }
      }
      const mapped = (Object.keys(idx) as (keyof typeof HEADER_SYNONYMS)[])
        .filter((k) => idx[k] != null)
        .map((k) => ({
          field: k,
          key: k === "employee" ? "Employee Name" : k === "email" ? "Employee Email" : k === "ticket" ? "Project ID" : k === "week" ? "Week date" : k === "hours" ? "Hours" : k === "role" ? "Role" : "Division",
          label: labels[idx[k]!] || `column ${idx[k]! + 1}`,
        }));
      const agg = aggregateParsedRows(rows);
      setParsed({ filename: file.name, sheet: sheetName, mapped, missing, rows: agg.rows, skippedBlank, combined: agg.combined });
      if (missing.length === 0 && rows.length === 0) {
        setParseError("The sheet has headers but no data rows.");
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  // Pre-check every parsed row (import-module style): exact reasons BEFORE
  // upload. null = refs unavailable → skip straight to server validation.
  const checks = useMemo<RowCheck[] | null>(
    () => (parsed && parsed.missing.length === 0 && refs ? parsed.rows.map((r) => checkRow(r, refs)) : null),
    [parsed, refs],
  );
  const errorRows = useMemo(() => {
    if (!checks || !parsed) return [];
    const out: { at: number; row: AfImportRowInput; reason: string }[] = [];
    checks.forEach((c, i) => { if (!c.ok) out.push({ at: i, row: parsed.rows[i], reason: c.reason }); });
    return out;
  }, [checks, parsed]);
  const readyCount = parsed ? parsed.rows.length - errorRows.length : 0;

  const startUpload = async (skipFlagged: boolean) => {
    if (!parsed || parsed.missing.length > 0 || parsed.rows.length === 0) return;
    // Selection + chunking live in ONE pure helper so a regression test can
    // pin them: with "skip flagged", the chunks must slice the FILTERED row
    // list. Slicing the original list here once uploaded flagged rows (and
    // dropped trailing ready ones) while every count still balanced.
    const plan = planUploadChunks(parsed.rows, checks, skipFlagged, CHUNK);
    if (plan.total === 0) return;
    setUploadError(null);
    setPhase({ step: "uploading", sent: 0, total: plan.total });
    let createdBatchId: number | null = null;
    try {
      const batchId = await beginActualsImport(parsed.filename);
      createdBatchId = batchId;
      let accepted = 0;
      let exceptionCount = 0;
      let sent = 0;
      for (const chunk of plan.chunks) {
        const res = await sendActualsImportRows(batchId, chunk);
        accepted += res.accepted;
        exceptionCount += res.exceptions;
        sent += chunk.length;
        setPhase({ step: "uploading", sent, total: plan.total });
      }
      const commit = await commitActualsImport(batchId, plan.total);
      setPhase({ step: "done", accepted, exceptions: exceptionCount, tickets: commit.tickets, batchId });
      refreshBatches();
      if (exceptionCount > 0) {
        setOpenBatch(batchId);
        loadExceptions(batchId);
      }
    } catch (e) {
      // LOUD failure — nothing here may pretend success. Best-effort abort
      // wipes the half-uploaded batch so stray rows can't leak into a later
      // rebuild; the banner tells the truth either way.
      const msg = e instanceof Error ? e.message : String(e);
      let outcome = "Nothing was saved.";
      if (createdBatchId != null) {
        try {
          await abortActualsImport(createdBatchId);
          outcome =
            "The incomplete upload was removed. Re-upload the file to try again — if it was correcting earlier imports, those person-weeks were cleared with it until you do.";
        } catch {
          outcome =
            "Some rows may have been uploaded but were NOT finalized. Re-uploading the same file will overwrite them.";
        }
      }
      setUploadError(`Import failed — ${outcome} ${msg}`);
      setPhase({ step: "idle" });
      refreshBatches();
    }
  };

  const loadExceptions = (batchId: number) => {
    setExceptions((m) => (m.has(batchId) ? m : new Map(m).set(batchId, undefined)));
    listActualsImportExceptions(batchId)
      .then((list) => setExceptions((m) => new Map(m).set(batchId, list)))
      .catch(() => setExceptions((m) => new Map(m).set(batchId, null)));
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 24, display: "flex", justifyContent: "center", marginTop: 40 }}>
        <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 620 }}>
          <Lock size={20} style={{ color: "hsl(var(--muted-foreground))", marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Administrator access required</div>
            <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
              Importing actual hours changes financial history for everyone, so it's limited to administrators.
            </div>
            <Link href="/actuals-forecast" style={{ color: BLUE, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10 }}>
              <ArrowLeft size={13} /> Back to Actuals vs Forecast
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${BLUE}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Upload size={19} style={{ color: BLUE }} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Import Actual Hours</h1>
          <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
            Excel or CSV — needs Employee Email (or Name), Project ID, Week date and Hours columns.
            Every row is checked against RM ONE before anything imports; planned hours already come from the plan — you only import actuals.
          </div>
        </div>
        <Link href="/actuals-forecast" style={{ color: BLUE, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}>
          <ArrowLeft size={13} /> Actuals vs Forecast
        </Link>
      </div>

      {/* upload card */}
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => fileRef.current?.click()}
            disabled={phase.step === "uploading"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 8,
              border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#fff", background: BLUE,
              opacity: phase.step === "uploading" ? 0.6 : 1,
            }}>
            <FileSpreadsheet size={15} /> Choose file…
          </button>
          <button type="button" onClick={downloadTemplate}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 8,
              border: "1px solid hsl(var(--border))", fontSize: 13, fontWeight: 600, cursor: "pointer",
              color: "hsl(var(--foreground))", background: "transparent",
            }}>
            <Download size={15} /> Download template
          </button>
          {parsed && (
            <span style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
              {parsed.filename} · sheet “{parsed.sheet}” · {parsed.rows.length.toLocaleString()} data row{parsed.rows.length === 1 ? "" : "s"}
              {parsed.skippedBlank > 0 ? ` (${parsed.skippedBlank} blank skipped)` : ""}
              {parsed.combined > 0 ? ` · ${parsed.combined.toLocaleString()} daily/task rows combined into weekly totals` : ""}
            </span>
          )}
        </div>

        {parseError && <ErrorBanner text={parseError} />}
        {uploadError && <ErrorBanner text={uploadError} />}

        {parsed && parsed.missing.length > 0 && (
          <ErrorBanner text={`Couldn't find required column${parsed.missing.length === 1 ? "" : "s"}: ${parsed.missing.join(", ")}. Rename the headers and re-pick the file.`} />
        )}

        {parsed && parsed.missing.length === 0 && (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {parsed.mapped.map((m) => (
                <span key={m.key} style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "hsl(var(--muted))",
                  border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))",
                }}>
                  <b style={{ color: "hsl(var(--foreground))" }}>{m.key}</b> ← “{m.label}”
                </span>
              ))}
            </div>

            {parsed.rows.length > 0 && phase.step !== "done" && (
              refs === undefined ? (
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                  <Loader2 size={13} className="animate-spin" /> Checking rows against RM ONE…
                </div>
              ) : refs === null ? (
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#b45309" }}>
                  <Info size={13} style={{ flexShrink: 0 }} /> Couldn't pre-check against RM ONE right now — rows will be validated during the import instead.
                </div>
              ) : checks && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={chipOk}><CheckCircle2 size={12} /> {readyCount.toLocaleString()} ready</span>
                  {errorRows.length > 0 && (
                    <span style={chipBad}><AlertTriangle size={12} /> {errorRows.length.toLocaleString()} need{errorRows.length === 1 ? "s" : ""} fixing</span>
                  )}
                </div>
              )
            )}

            {parsed.rows.length > 0 && phase.step !== "done" && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                  {/* Role/Division columns appear only when the file actually has them */}
                  <thead><tr>{[
                    ...(checks ? ["Status"] : []), "Employee", "Project ID", "Week", "Hours",
                    ...(parsed.mapped.some((m) => m.field === "role") ? ["Role"] : []),
                    ...(parsed.mapped.some((m) => m.field === "division") ? ["Division"] : []),
                  ].map((h) => (
                    <th key={h} style={{ ...thStyle, textAlign: "left" }}>{h}</th>))}
                  </tr></thead>
                  <tbody>
                    {parsed.rows.slice(0, 8).map((r, i) => {
                      const c = checks?.[i];
                      return (
                        <tr key={i} style={c && !c.ok ? { background: "#dc262608" } : undefined}>
                          {c && (
                            <td style={{ ...tdPrev, maxWidth: 340 }}>
                              {c.ok ? (
                                <span style={{ color: GREEN, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <CheckCircle2 size={12} style={{ flexShrink: 0 }} /> ok{c.fixedTicket ? <Dim> → {c.fixedTicket}</Dim> : null}
                                </span>
                              ) : (
                                <span style={{ color: "#dc2626", display: "inline-flex", alignItems: "center", gap: 4 }} title={c.reason}>
                                  <AlertTriangle size={12} style={{ flexShrink: 0 }} /> {c.reason}
                                </span>
                              )}
                            </td>
                          )}
                          <td style={tdPrev}>{r.email ? <>{r.email}{r.name ? <Dim> · {r.name}</Dim> : null}</> : (r.employee || <Dim>—</Dim>)}</td>
                          <td style={tdPrev}>{r.ticket || <Dim>—</Dim>}</td>
                          <td style={tdPrev}>{r.week || <Dim>—</Dim>}</td>
                          <td style={tdPrev}>{Number.isFinite(r.hours) ? fmtNum(r.hours) : <Dim>?</Dim>}</td>
                          {parsed.mapped.some((m) => m.field === "role") && <td style={tdPrev}>{r.role ?? <Dim>—</Dim>}</td>}
                          {parsed.mapped.some((m) => m.field === "division") && <td style={tdPrev}>{r.division ?? <Dim>—</Dim>}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {parsed.rows.length > 8 && (
                  <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>…and {(parsed.rows.length - 8).toLocaleString()} more rows</div>
                )}
              </div>
            )}

            {errorRows.length > 0 && phase.step === "idle" && (
              <div style={{ border: "1px solid #dc262640", background: "#dc26260d", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 220 }}>
                    {errorRows.length.toLocaleString()} row{errorRows.length === 1 ? "" : "s"} need{errorRows.length === 1 ? "s" : ""} fixing — {errorRows.length === 1 ? "it" : "they"} won't be imported unless corrected
                  </span>
                  <button type="button" onClick={() => downloadFlaggedRows(parsed, errorRows)}
                    title="Every flagged row with its reason — fix the file in Excel and choose it again"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 7,
                      border: "1px solid #dc262640", background: "hsl(var(--card))", color: "#dc2626",
                      fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                    <Download size={12} /> Download flagged rows
                  </button>
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                  {errorRows.slice(0, 30).map((e) => (
                    <div key={e.at} style={{ fontSize: 11.5 }}>
                      <b>{e.row.employee || "(no employee)"}</b> · {e.row.ticket || "(no project)"} · {e.row.week || "(no week)"} — <span style={{ color: "#b45309" }}>{e.reason}</span>
                    </div>
                  ))}
                  {errorRows.length > 30 && (
                    <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>…and {(errorRows.length - 30).toLocaleString()} more</div>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
                  Fix these rows in the file and choose it again — the downloaded workbook re-imports as-is once corrected (its Reason column is ignored).
                  Or import the ready rows now and upload the fixed rows later.
                </div>
              </div>
            )}

            {phase.step === "idle" && parsed.rows.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {/* while reference data loads, checks are still unknown — hold
                    the upload rather than silently bypassing the pre-check */}
                <button type="button" onClick={() => startUpload(true)} disabled={readyCount === 0 || refs === undefined}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 8,
                    border: "none", fontSize: 13, fontWeight: 600, cursor: readyCount === 0 || refs === undefined ? "default" : "pointer",
                    color: "#fff", background: GREEN, opacity: readyCount === 0 || refs === undefined ? 0.5 : 1,
                  }}>
                  <Upload size={15} /> {refs === undefined ? "Checking rows…" : <>Import {readyCount.toLocaleString()} row{readyCount === 1 ? "" : "s"}{errorRows.length > 0 ? ` (skip ${errorRows.length.toLocaleString()})` : ""}</>}
                </button>
                {errorRows.length > 0 && (
                  <button type="button" onClick={() => startUpload(false)}
                    style={{ background: "none", border: "none", padding: 0, fontSize: 11.5, color: BLUE, cursor: "pointer", textDecoration: "underline" }}>
                    import everything anyway — the server re-checks every row
                  </button>
                )}
                <span style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>
                  {checks
                    ? "The server double-checks every row during import — people and projects are never auto-created."
                    : "Rows that fail validation become exceptions to review — people and projects are never auto-created."}
                </span>
              </div>
            )}
          </>
        )}

        {phase.step === "uploading" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <Loader2 size={14} className="animate-spin" style={{ color: BLUE }} />
              Sending rows… {phase.sent.toLocaleString()} / {phase.total.toLocaleString()}
              {phase.sent >= phase.total && " · finalizing and rebuilding snapshots (can take a minute)…"}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "hsl(var(--muted))", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((phase.sent / Math.max(1, phase.total)) * 100)}%`, background: BLUE, transition: "width .3s" }} />
            </div>
          </div>
        )}

        {phase.step === "done" && (
          <div style={{
            display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10,
            background: `${GREEN}0d`, border: `1px solid ${GREEN}40`,
          }}>
            <CheckCircle2 size={17} style={{ color: GREEN, marginTop: 1 }} />
            <div style={{ fontSize: 12.5 }}>
              <b>Import finished.</b> {phase.accepted.toLocaleString()} row{phase.accepted === 1 ? "" : "s"} accepted
              {phase.exceptions > 0 ? <>, <b style={{ color: "#b45309" }}>{phase.exceptions.toLocaleString()} exception{phase.exceptions === 1 ? "" : "s"}</b> to review below</> : ", no exceptions"}.
              {" "}Snapshots were rebuilt for {phase.tickets} project{phase.tickets === 1 ? "" : "s"} —{" "}
              <Link href="/actuals-forecast" style={{ color: BLUE }}>see the graphs</Link>.
            </div>
          </div>
        )}
      </div>

      {/* batch history */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>Import history</span>
          <button type="button" onClick={refreshBatches} style={miniBtn}><RefreshCw size={12} /> Refresh</button>
        </div>
        {batches === undefined ? (
          <div style={{ padding: 18, display: "flex", justifyContent: "center" }}><Loader2 size={16} className="animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} /></div>
        ) : batches === null ? (
          <div style={{ padding: 16, fontSize: 12.5, color: "#b45309" }}>Couldn't load the import history.</div>
        ) : batches.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>No imports yet.</div>
        ) : (
          <div>
            {batches.map((b) => {
              const open = openBatch === b.id;
              const exc = exceptions.get(b.id);
              const failed = b.status === "failed";
              const withExc = (b.rowsException ?? 0) > 0;
              return (
                <div key={b.id} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                  <button type="button"
                    onClick={() => { const next = open ? null : b.id; setOpenBatch(next); if (next && withExc) loadExceptions(b.id); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                      background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontSize: 12.5,
                      color: "hsl(var(--foreground))",
                    }}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{b.filename}</span>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>{b.uploadedBy}</span>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>{b.createdAt ? new Date(b.createdAt).toLocaleString() : "—"}</span>
                    <span>{(b.rowsOk ?? 0).toLocaleString()} ok</span>
                    {withExc && <span style={{ color: "#b45309", fontWeight: 600 }}>{(b.rowsException ?? 0).toLocaleString()} exceptions</span>}
                    <span style={{
                      padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                      background: failed ? "#dc26260d" : b.status.startsWith("completed") ? `${GREEN}0d` : "hsl(var(--muted))",
                      color: failed ? "#dc2626" : b.status.startsWith("completed") ? GREEN : "hsl(var(--muted-foreground))",
                      border: `1px solid ${failed ? "#dc262640" : b.status.startsWith("completed") ? `${GREEN}40` : "hsl(var(--border))"}`,
                    }}>{b.status.replace(/_/g, " ")}</span>
                  </button>
                  {open && (
                    <div style={{ padding: "4px 16px 14px 40px" }}>
                      {!withExc ? (
                        <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>No exceptions in this batch.</div>
                      ) : exc === undefined ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                          <Loader2 size={13} className="animate-spin" /> Loading exceptions…
                        </div>
                      ) : exc === null ? (
                        <div style={{ fontSize: 12, color: "#b45309" }}>Couldn't load the exceptions for this batch.</div>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                            <thead><tr>{["Reason", "Details", "Row"].map((h) => <th key={h} style={{ ...thStyle, textAlign: "left" }}>{h}</th>)}</tr></thead>
                            <tbody>
                              {exc.map((x) => (
                                <tr key={x.id}>
                                  <td style={{ ...tdPrev, fontWeight: 600, color: "#b45309", whiteSpace: "nowrap" }}>{x.reason.replace(/_/g, " ")}</td>
                                  <td style={tdPrev}>{x.detail}</td>
                                  <td style={{ ...tdPrev, fontFamily: "monospace", fontSize: 11 }}>{typeof x.row === "string" ? x.row : JSON.stringify(x.row)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* rebuild card */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Info size={15} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 12.5, color: "hsl(var(--muted-foreground))", minWidth: 260 }}>
          Snapshots refresh automatically every hour. A full recompute rebuilds open weeks and fills gaps from the current plan —
          <b> already-frozen weeks are never rewritten</b>.
        </div>
        {rebuilding === "confirm" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Recompute all projects?</span>
            <button type="button" style={{ ...miniBtn, background: BLUE, color: "#fff", border: "none" }}
              onClick={async () => {
                setRebuilding("running"); setRebuildMsg(null);
                try {
                  await rebuildAfSnapshots({});
                  setRebuildMsg("Recompute finished.");
                } catch (e) {
                  setRebuildMsg(`Recompute failed: ${e instanceof Error ? e.message : String(e)}`);
                } finally { setRebuilding("idle"); }
              }}>Yes, recompute</button>
            <button type="button" style={miniBtn} onClick={() => setRebuilding("idle")}>Cancel</button>
          </div>
        ) : (
          <button type="button" disabled={rebuilding === "running"} style={miniBtn} onClick={() => setRebuilding("confirm")}>
            {rebuilding === "running" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Recompute snapshots
          </button>
        )}
        {rebuildMsg && <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{rebuildMsg}</span>}
      </div>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "hsl(var(--muted-foreground))" }}>{children}</span>;
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div style={{
      display: "flex", gap: 9, alignItems: "flex-start", padding: 12, borderRadius: 10,
      background: "#dc26260d", border: "1px solid #dc262640", fontSize: 12.5, color: "#dc2626",
    }}>
      <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
      <span>{text}</span>
    </div>
  );
}

const chipOk: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: GREEN,
  padding: "3px 10px", borderRadius: 999, background: `${GREEN}0d`, border: `1px solid ${GREEN}40`,
};
const chipBad: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#dc2626",
  padding: "3px 10px", borderRadius: 999, background: "#dc26260d", border: "1px solid #dc262640",
};
const miniBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7,
  border: "1px solid hsl(var(--border))", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  color: "hsl(var(--foreground))", background: "hsl(var(--card))",
};
const thStyle: React.CSSProperties = {
  padding: "6px 10px", fontSize: 11, whiteSpace: "nowrap",
  borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))",
  color: "hsl(var(--muted-foreground))",
};
const tdPrev: React.CSSProperties = {
  padding: "5px 10px", borderBottom: "1px solid hsl(var(--border))", whiteSpace: "nowrap",
  maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
};
