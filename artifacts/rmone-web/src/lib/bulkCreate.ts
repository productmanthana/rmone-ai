// ─────────────────────────────────────────────────────────────────────────────
// Bulk create (CSV) for Projects, Opportunities and Staff.
//
// Design: this is deliberately FRONTEND-DRIVEN. We download a CSV template,
// parse the filled file client-side, resolve the human-friendly names the user
// typed (Division / Department / Business Unit / Project Manager / etc.) into
// the live IDs using the SAME lookup endpoints the manual create forms use, and
// then create each row by calling the exact SAME create functions
// (createRecord / createStaff). That means bulk rows go through the identical,
// already-proven path as a single manual create — same read-only gating, same
// dedup, same tenant scoping, no new backend write endpoints, no mock data.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getDivisions, getDepartments, getBusinessUnits, getUsers,
  getJobTitles, getFieldOptions, getRolesByBU, getLifecycles,
  createRecord, createStaff, assignResource, createSchedule, bustCache,
  getFullProjectAllocations, updateHoursAllocation,
  createDivision, createDepartment, createBusinessUnit, createJobTitle,
} from "@/lib/api";
import { getBusinessRules } from "@/lib/businessRules";
import { STANDARD_JOB_TITLES } from "@/lib/standardTitles";
import { fetchAccessLevels, type AccessLevelDef } from "@/lib/permissions";

export type BulkEntity = "project" | "opportunity" | "staff";

/**
 * Where a column's dropdown list comes from. These mirror exactly the live
 * lookups the manual create forms use to populate their <Select> menus, so the
 * Excel dropdown shows the same choices the user would see in the app.
 *  - division           → getDivisions (Title)            [project/opp Division]
 *  - department         → getDepartments (Title)
 *  - businessUnit       → getBusinessUnits (ShortName/Title) [real BU; optional, filters Division]
 *  - staffDivision      → getDivisions (ShortName/Title)   [staff/team Division]
 *  - user               → getUsers (name)                  [PM / Owner]
 *  - stage              → getFieldOptions("status","OPM")
 *  - jobTitle           → getJobTitles (JobTitleName/Title)
 *  - role               → getRolesByBU across all divisions (name)
 *  - lifecycle          → getLifecycles (Name)                 [project Schedule]
 *  - accessLevel        → static Admin / Manager / User
 *  - sendInvite         → static yes / no
 */
export type OptionSource =
  | "division" | "department" | "businessUnit" | "staffDivision"
  | "user" | "stage" | "jobTitle" | "role" | "lifecycle"
  | "accessLevel" | "sendInvite";

export interface BulkColumn {
  /** Header text (what the user sees / fills in). Also the parse key — never decorate it. */
  header: string;
  required?: boolean;
  /** Example value, shown as a cell note (not a data row, so it's never imported). */
  example: string;
  /** Dropdown source. When set, the template cell is a data-validation dropdown. */
  options?: OptionSource;
  /** Cell kind for formatting/validation. */
  kind?: "text" | "number" | "date";
}

/**
 * One-to-many child sheet (Team / Schedule). These mirror the manual create
 * flow's post-create tabs: after a project/opp record exists you add team
 * members and (for projects) a schedule. In the workbook each child is its own
 * sheet whose rows link to a parent by the parent's Title (keyHeader), so the
 * whole create→team→schedule flow is captured in one file.
 */
export interface ChildSpec {
  /** Which create path the rows drive. */
  kind: "team" | "schedule";
  /** Sheet name in the workbook, e.g. "Team". */
  sheetName: string;
  /** Header of the column that names the parent record (links rows to a parent). */
  keyHeader: string;
  /** One-line note written above the header explaining the sheet. */
  intro: string;
  columns: BulkColumn[];
}

export interface BulkSpec {
  entity: BulkEntity;
  /** Human label, e.g. "Projects". */
  label: string;
  /** Singular label, e.g. "project". */
  singular: string;
  fileName: string;
  /** Primary sheet name in the workbook, e.g. "Projects". */
  sheetName: string;
  columns: BulkColumn[];
  /** Optional one-to-many child sheets (Team / Schedule). */
  children?: ChildSpec[];
}

/** Team-member columns, shared by the Project and Opportunity Team sheets. */
function teamColumns(keyHeader: string, parentExample: string): BulkColumn[] {
  return [
    { header: keyHeader, required: true, example: parentExample, kind: "text" },
    { header: "Team Member", required: true, example: "Jane Smith", options: "user" },
    { header: "Business Unit", example: "Commercial", options: "businessUnit" },
    { header: "Division", required: true, example: "Construction", options: "staffDivision" },
    { header: "Role", required: true, example: "Project Manager", options: "role" },
    { header: "Job Title", example: "Senior Engineer", options: "jobTitle" },
    { header: "Allocation %", example: "50", kind: "number" },
    { header: "Start Date", example: "2026-07-01", kind: "date" },
    { header: "End Date", example: "2027-06-30", kind: "date" },
  ];
}

export const BULK_SPECS: Record<BulkEntity, BulkSpec> = {
  project: {
    entity: "project",
    label: "Projects",
    singular: "project",
    fileName: "projects-template.xlsx",
    sheetName: "Projects",
    columns: [
      { header: "Project ID", required: true, example: "PRJ-2026-001", kind: "text" },
      { header: "Project Title", required: true, example: "Riverside Office Tower", kind: "text" },
      { header: "Contract Value", example: "2500000", kind: "number" },
      { header: "Project Manager", example: "Jane Smith", options: "user" },
      { header: "Division", required: true, example: "Construction", options: "division" },
      { header: "Department", example: "Operations", options: "department" },
      { header: "Business Unit", example: "Commercial", options: "businessUnit" },
      { header: "Target Start Date", example: "2026-07-01", kind: "date" },
      { header: "Target Completion Date", example: "2027-06-30", kind: "date" },
    ],
    children: [
      {
        kind: "team",
        sheetName: "Team",
        keyHeader: "Project Title",
        intro: "Add team members to projects from the Projects sheet. Project Title must match a row there exactly.",
        columns: teamColumns("Project Title", "Riverside Office Tower"),
      },
      {
        kind: "schedule",
        sheetName: "Schedule",
        keyHeader: "Project Title",
        intro: "Assign a lifecycle to projects from the Projects sheet. Its phases become the project schedule. Project Title must match exactly.",
        columns: [
          { header: "Project Title", required: true, example: "Riverside Office Tower", kind: "text" },
          { header: "Lifecycle", required: true, example: "Standard Construction", options: "lifecycle" },
        ],
      },
    ],
  },
  opportunity: {
    entity: "opportunity",
    label: "Opportunities",
    singular: "opportunity",
    fileName: "opportunities-template.xlsx",
    sheetName: "Opportunities",
    columns: [
      { header: "Opportunity ID", required: true, example: "OPP-2026-001", kind: "text" },
      { header: "Opportunity Title", required: true, example: "Downtown Transit Hub", kind: "text" },
      { header: "Estimated Value", example: "5000000", kind: "number" },
      { header: "Win Probability (%)", example: "60", kind: "text" },
      { header: "Stage", example: "Qualified", options: "stage" },
      { header: "Owner", example: "Jane Smith", options: "user" },
      { header: "Division", required: true, example: "Construction", options: "division" },
      { header: "Business Unit", example: "Commercial", options: "businessUnit" },
      { header: "Target Start Date", example: "2026-10-01", kind: "date" },
      { header: "Target End Date", example: "2027-06-30", kind: "date" },
    ],
    children: [
      {
        kind: "team",
        sheetName: "Team",
        keyHeader: "Opportunity Title",
        intro: "Add team members to opportunities from the Opportunities sheet. Opportunity Title must match a row there exactly.",
        columns: teamColumns("Opportunity Title", "Downtown Transit Hub"),
      },
    ],
  },
  staff: {
    entity: "staff",
    label: "Staff",
    singular: "staff member",
    fileName: "staff-template.xlsx",
    sheetName: "Staff",
    columns: [
      { header: "Name", required: true, example: "John Doe", kind: "text" },
      { header: "Email", required: true, example: "john.doe@example.com", kind: "text" },
      { header: "Business Unit", example: "Commercial", options: "businessUnit" },
      { header: "Division", example: "Construction", options: "staffDivision" },
      { header: "Department", example: "Operations", options: "department" },
      { header: "Role", example: "Project Manager", options: "role" },
      { header: "Job Title", example: "Senior Engineer", options: "jobTitle" },
      { header: "Access Level", example: "User", options: "accessLevel" },
      { header: "Send Invite", example: "no", options: "sendInvite" },
    ],
  },
};

// ── Live dropdown options ────────────────────────────────────────────────────

/** Static lists that mirror the manual form's fixed <Select> menus. */
const STATIC_OPTIONS: Partial<Record<OptionSource, string[]>> = {
  accessLevel: ["Admin", "Manager", "User"],
  sendInvite: ["yes", "no"],
};

function recName(r: AnyRec, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Fetch the live option lists for every dropdown column in a spec. Each list is
 * the exact same data the manual create form shows in its <Select>, so the Excel
 * dropdown and the in-app picker never diverge.
 */
async function loadOptionsForSpec(spec: BulkSpec): Promise<Map<OptionSource, string[]>> {
  const needed = new Set<OptionSource>();
  for (const c of spec.columns) if (c.options) needed.add(c.options);
  for (const child of spec.children ?? []) {
    for (const c of child.columns) if (c.options) needed.add(c.options);
  }

  const out = new Map<OptionSource, string[]>();
  await Promise.all(
    Array.from(needed).map(async (src) => {
      if (STATIC_OPTIONS[src]) {
        let opts = STATIC_OPTIONS[src]!.slice();
        // Access Level: built-ins + this tenant's admin-defined custom levels
        // (Settings → Access Levels), matched by name at upload. Soft-fail:
        // the built-ins always work.
        if (src === "accessLevel") {
          try {
            const levels = await fetchAccessLevels();
            const names = levels.map((l) => String(l.name ?? "").trim())
              .filter((n) => n && !opts.some((b) => b.toLowerCase() === n.toLowerCase()));
            opts = [...opts, ...names];
          } catch { /* built-ins only */ }
        }
        out.set(src, opts);
        return;
      }
      try {
        out.set(src, await loadOneOptionSource(src));
      } catch {
        // A failed lookup → no dropdown for that column (free text). The
        // upload-time resolver still validates the typed value against live data.
        out.set(src, []);
      }
    }),
  );
  return out;
}

async function loadOneOptionSource(src: OptionSource): Promise<string[]> {
  switch (src) {
    case "division": {
      const rows = (await getDivisions()) as AnyRec[];
      return uniqSorted(rows.map((d) => recName(d, ["Title", "ShortName", "Name"])));
    }
    case "staffDivision": {
      // The Division column (staff + team sheets) — the value written to
      // DivisionLookup/DivisionName and used to scope roles. The display string
      // MUST be a plain key the upload resolver's divMap is keyed by
      // (ShortName/Title/Name) — no decorated "SHORT — Title" label, or the
      // selected value won't resolve at upload.
      const rows = (await getDivisions()) as AnyRec[];
      return uniqSorted(rows.map((d) => recName(d, ["ShortName", "Title", "Name"])));
    }
    case "businessUnit": {
      // ShortName-first to match the opportunity resolver's canonical BU name
      // (buNameSet/buDisplay use ShortName ?? Title ?? Name); the project resolver
      // keys every name variant so this also resolves there.
      const rows = (await getBusinessUnits()) as AnyRec[];
      return uniqSorted(rows.map((b) => recName(b, ["ShortName", "Title", "Name"])));
    }
    case "department": {
      const rows = (await getDepartments()) as AnyRec[];
      return uniqSorted(rows.map((d) => recName(d, ["Title", "Name"])));
    }
    case "user": {
      const rows = (await getUsers()) as AnyRec[];
      return uniqSorted(rows.map((u) => recName(u, ["name", "Name"]))).slice(0, 500);
    }
    case "stage": {
      const rows = (await getFieldOptions("status", "OPM")) as unknown as string[];
      return uniqSorted((Array.isArray(rows) ? rows : []).map((s) => String(s)));
    }
    case "jobTitle": {
      const rows = (await getJobTitles()) as unknown as AnyRec[];
      // Offer the standard suggested titles even when the tenant catalogue
      // doesn't have them yet — the import paths create/accept them.
      const names = rows.map((t) => recName(t, ["JobTitleName", "Title", "Name"]));
      const have = new Set(names.map((n) => n.trim().toLowerCase()));
      for (const std of STANDARD_JOB_TITLES) if (!have.has(std.toLowerCase())) names.push(std);
      return uniqSorted(names);
    }
    case "role": {
      // Roles are scoped per-division upstream; gather across all divisions so the
      // staff dropdown shows every role (resolution still scopes role→id by BU).
      const divs = (await getDivisions()) as AnyRec[];
      const ids = divs.map((d) => String(d.ID ?? d.Id ?? "")).filter(Boolean);
      const lists = await Promise.all(
        ids.map((id) => getRolesByBU(id).then((r) => (Array.isArray(r) ? r : [])).catch(() => [])),
      );
      return uniqSorted(lists.flat().map((r) => recName(r as AnyRec, ["name", "Name"])));
    }
    case "lifecycle": {
      const rows = (await getLifecycles()) as AnyRec[];
      return uniqSorted((Array.isArray(rows) ? rows : []).map((l) => recName(l, ["Name", "Title"])));
    }
    default:
      return [];
  }
}

// ── Excel template (.xlsx) with native dropdowns ─────────────────────────────

function downloadBlob(data: BlobPart, fileName: string, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function colLetter(n: number): string {
  // 1 → A, 26 → Z, 27 → AA
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const TEMPLATE_DATA_ROWS = 500; // rows pre-armed with dropdowns / formatting

/** ExcelJS worksheet — typed loosely so we don't depend on exceljs types here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorksheet = any;

/**
 * Write a column set onto a worksheet: a styled header row (with cell notes),
 * date formatting, and native list validation backed by the shared hidden
 * "Lists" sheet. `listState.col` is the running Lists-sheet column index, shared
 * across every sheet so each dropdown gets its own backing column.
 */
function writeSheet(
  ws: AnyWorksheet,
  columns: BulkColumn[],
  options: Map<OptionSource, string[]>,
  lists: AnyWorksheet,
  listState: { col: number },
  headerRowIdx: number,
): void {
  const headerRow = ws.getRow(headerRowIdx);
  columns.forEach((c, idx) => { headerRow.getCell(idx + 1).value = c.header; });
  headerRow.height = 22;
  headerRow.eachCell((cell: AnyRec, col: number) => {
    const c = columns[col - 1];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern", pattern: "solid",
      fgColor: { argb: c?.required ? "FF6BA539" : "FF253746" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    const parts = [
      c?.required ? "Required." : "Optional.",
      c?.options ? "Pick from the dropdown." : c?.kind === "date" ? "Date (YYYY-MM-DD)." : c?.kind === "number" ? "Number." : "",
      c?.example ? `Example: ${c.example}` : "",
    ].filter(Boolean);
    if (parts.length) cell.note = parts.join(" ");
  });

  const firstDataRow = headerRowIdx + 1;
  const lastDataRow = headerRowIdx + TEMPLATE_DATA_ROWS;
  columns.forEach((c, idx) => {
    const colN = idx + 1;
    const letter = colLetter(colN);
    ws.getColumn(colN).width = Math.max(14, Math.min(40, c.header.length + 6));

    if (c.kind === "date") {
      // Apply Excel's native "date" data-validation so blank/typed cells
      // qualify for the built-in calendar-picker icon (Excel Online + desktop)
      // and free-text entries get rejected — mirrors applyDateColumnValidation
      // in the server-side onboarding template generator.
      for (let r = firstDataRow; r <= lastDataRow; r++) {
        const dCell = ws.getCell(`${letter}${r}`);
        dCell.numFmt = "yyyy-mm-dd";
        dCell.dataValidation = {
          type: "date",
          operator: "between",
          formulae: [new Date(1990, 0, 1), new Date(2100, 0, 1)],
          allowBlank: true,
          showErrorMessage: true,
          errorStyle: "error",
          errorTitle: "Not a valid date",
          error: "Please enter a real date (e.g. 2025-01-31). Text is not allowed in this column.",
          showInputMessage: true,
          promptTitle: "Date required",
          prompt: "Enter a date, e.g. 2025-01-31.",
        };
      }
    }

    if (!c.options) return;
    const opts = options.get(c.options) ?? [];
    if (opts.length === 0) return; // lookup failed/empty → leave as free text

    listState.col += 1;
    const lLetter = colLetter(listState.col);
    lists.getCell(`${lLetter}1`).value = c.header;
    opts.forEach((o, i) => { lists.getCell(`${lLetter}${i + 2}`).value = o; });
    const ref = `Lists!$${lLetter}$2:$${lLetter}$${opts.length + 1}`;

    const validation = {
      type: "list" as const,
      allowBlank: !c.required,
      formulae: [ref],
      showErrorMessage: true,
      errorStyle: "warning" as const,
      errorTitle: "Not in list",
      error: "This value isn't one of the live options. Use the dropdown to pick a valid one.",
    };
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      ws.getCell(`${letter}${r}`).dataValidation = validation;
    }
  });
}

/**
 * Build and download a real Excel workbook whose selectable columns are native
 * data-validation dropdowns populated with the same live options as the UI. The
 * primary sheet (Projects / Opportunities / Staff) plus any child sheets (Team /
 * Schedule) are all written into one workbook, sharing one hidden Lists sheet.
 * Async because it fetches those live options first.
 */
export async function downloadTemplate(spec: BulkSpec): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const options = await loadOptionsForSpec(spec);

  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";
  wb.created = new Date();
  const lists = wb.addWorksheet("Lists");
  lists.state = "veryHidden"; // hidden helper sheet backing the dropdowns
  const listState = { col: 0 };

  // Primary sheet (frozen header row).
  const ws = wb.addWorksheet(spec.sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  writeSheet(ws, spec.columns, options, lists, listState, 1);

  // Child sheets (Team / Schedule). Row 1 carries a plain-language intro, the
  // header sits on row 2, and validation/data start on row 3 — so the linking
  // instruction is impossible to miss.
  for (const child of spec.children ?? []) {
    const cws = wb.addWorksheet(child.sheetName, { views: [{ state: "frozen", ySplit: 2 }] });
    const introCell = cws.getCell("A1");
    introCell.value = child.intro;
    introCell.font = { italic: true, color: { argb: "FF6B7E8A" }, size: 10.5 };
    cws.mergeCells(1, 1, 1, Math.max(1, child.columns.length));
    writeSheet(cws, child.columns, options, lists, listState, 2);
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    buf,
    spec.fileName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

// ── File parsing (xlsx + csv) ────────────────────────────────────────────────

/** Robust CSV parser: handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (ch === "\r") {
      // swallow — handled by the \n branch (CRLF) or treated as EOL alone
      if (s[i + 1] !== "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row when the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export interface ParsedRow {
  /** 1-based line number in the source file (header = 1). */
  line: number;
  values: Record<string, string>;
}

/**
 * A parsed workbook: the primary records plus any child sheets keyed by child
 * kind ("team" / "schedule"). A CSV (single sheet) only ever fills `primary`.
 */
export interface ParsedTemplate {
  primary: ParsedRow[];
  team: ParsedRow[];
  schedule: ParsedRow[];
}

/** Total non-empty data rows across every sheet (for progress / counts). */
export function countRows(t: ParsedTemplate): number {
  return t.primary.length + t.team.length + t.schedule.length;
}

/**
 * Turn a raw grid into header-keyed rows, dropping only fully-empty rows.
 * `headerRowIdx` is the 0-based grid row that holds the headers (child sheets
 * carry an intro on row 0 and headers on row 1). Shared by CSV + Excel parsers.
 */
function rowsFromGrid(grid: string[][], headerRowIdx = 0): ParsedRow[] {
  if (grid.length <= headerRowIdx) return [];
  const headers = (grid[headerRowIdx] ?? []).map((h) => (h ?? "").trim());
  const out: ParsedRow[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => (c ?? "").trim() === "")) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) values[h] = (cells[i] ?? "").trim(); });
    out.push({ line: r + 1, values });
  }
  return out;
}

/** Parse a CSV file into header-keyed rows (we only drop fully-empty rows). */
export function parseRows(text: string, _spec?: BulkSpec): ParsedRow[] {
  return rowsFromGrid(parseCsv(text));
}

/** Render an Excel cell value as the plain string our resolver expects. */
function xlsxCellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    // Normalise to YYYY-MM-DD (date inputs in the manual forms use this shape).
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "object") {
    const o = value as AnyRec;
    if (typeof o.text === "string") return o.text.trim();
    if (o.result != null) return String(o.result).trim(); // formula cell
    if (Array.isArray(o.richText)) return o.richText.map((p: AnyRec) => String(p.text ?? "")).join("").trim();
    if (typeof o.hyperlink === "string") return o.hyperlink.trim();
    return "";
  }
  return String(value).trim();
}

/** Read one ExcelJS worksheet into a raw string grid. */
function worksheetToGrid(ws: AnyWorksheet): string[][] {
  const grid: string[][] = [];
  (ws.eachRow as (opt: AnyRec, cb: (row: AnyRec) => void) => void)(
    { includeEmpty: true },
    (row: AnyRec) => {
      const cells: string[] = [];
      (row.eachCell as (opt: AnyRec, cb: (cell: AnyRec, n: number) => void) => void)(
        { includeEmpty: true },
        (cell: AnyRec, colNumber: number) => {
          cells[colNumber - 1] = xlsxCellToString(cell.value);
        },
      );
      grid.push(cells);
    },
  );
  return grid;
}

/**
 * Parse an uploaded template file — Excel (.xlsx) or CSV — into a ParsedTemplate.
 * The primary sheet plus any child sheets (Team / Schedule) are read by name; a
 * CSV only fills `primary`. The example/sample is carried in cell notes (not a
 * data row), so a freshly-downloaded template parses to zero rows until filled.
 */
export async function parseFile(file: File, spec: BulkSpec): Promise<ParsedTemplate> {
  const empty: ParsedTemplate = { primary: [], team: [], schedule: [] };
  const name = (file.name || "").toLowerCase();
  const isXlsx =
    name.endsWith(".xlsx") ||
    file.type.includes("spreadsheetml") ||
    file.type === "application/vnd.ms-excel";

  if (isXlsx) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());

    const visible = wb.worksheets.filter(
      (w) => w.state !== "veryHidden" && w.state !== "hidden",
    );
    const byName = (n: string) =>
      visible.find((w) => norm(w.name) === norm(n));

    // Primary: the named primary sheet, else the first visible sheet that isn't a
    // known child sheet (back-compat with older single-sheet templates).
    const childNames = new Set((spec.children ?? []).map((c) => norm(c.sheetName)));
    const primaryWs =
      byName(spec.sheetName) ??
      visible.find((w) => !childNames.has(norm(w.name))) ??
      visible[0];
    if (!primaryWs) return empty;

    const out: ParsedTemplate = { primary: rowsFromGrid(worksheetToGrid(primaryWs)), team: [], schedule: [] };

    for (const child of spec.children ?? []) {
      const cws = byName(child.sheetName);
      if (!cws) continue;
      // Child sheets place headers on row 2 (intro on row 1 → grid index 1).
      const rows = rowsFromGrid(worksheetToGrid(cws), 1);
      if (child.kind === "team") out.team = rows;
      else if (child.kind === "schedule") out.schedule = rows;
    }
    return out;
  }

  return { ...empty, primary: parseRows(await file.text(), spec) };
}

// ── Resolution + create ──────────────────────────────────────────────────────

export interface RowResult {
  line: number;
  title: string;
  ok: boolean;
  /** New record id when ok. */
  id?: string;
  /** Plain-language reason when not ok. */
  error?: string;
  /** Non-blocking caveat when ok (e.g. added but allocation % couldn't be set). */
  note?: string;
  /** Which sheet/phase produced this row, e.g. "Projects", "Team", "Schedule". */
  section?: string;
}

export interface BulkProgress {
  done: number;
  total: number;
}

type AnyRec = Record<string, unknown>;
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

function makeNameMap(rows: AnyRec[], nameKeys: string[], idKeys: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of rows) {
    let id = "";
    for (const k of idKeys) { if (row[k] != null && String(row[k]).trim() !== "") { id = String(row[k]); break; } }
    if (!id) continue;
    for (const k of nameKeys) {
      const name = norm(row[k]);
      if (name && !m.has(name)) m.set(name, id);
    }
  }
  return m;
}

function asDate(v: string): string {
  const t = v.trim();
  if (!t) return "";
  // Accept YYYY-MM-DD (and pass through anything else the user typed).
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T00:00:00`;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    const iso = d.toISOString().slice(0, 10);
    return `${iso}T00:00:00`;
  }
  return t;
}

/**
 * Parse a numeric field. Blank → "0". A non-blank value that isn't a valid
 * number throws so the row fails explicitly instead of silently becoming 0.
 */
function num(v: string, label: string): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "0";
  const n = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${label} "${raw}" is not a valid number.`);
  return String(n);
}

/** Date helpers for team/schedule generation (mirror the manual flows). */
function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function offsetYmd(days: number): string {
  return ymd(new Date(Date.now() + days * 86400000));
}
function plusDaysYmd(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return offsetYmd(days);
  return ymd(new Date(d.getTime() + days * 86400000));
}
/** Normalise any user-typed date to YYYY-MM-DD, or "" if blank/unparseable. */
function normYmd(v: string): string {
  const t = (v ?? "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : ymd(d);
}

const MONTH_NUM: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const WEEK_KEY_RE = /^\d{2}-[A-Za-z]{3}-\d{2}$/;
/** Parse a weekly-grid key "DD-Mon-YY" → UTC-midnight Date (null if invalid). */
function parseWeekKey(key: string): Date | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const mo = MONTH_NUM[m[2].toLowerCase()];
  if (!mo) return null;
  const d = new Date(`20${m[3]}-${mo}-${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Apply a team member's requested intensity by writing weekly hours — the second
 * half of the manual flow (assignResource adds the person at 0%, then the
 * weekly-hours grid sets the real allocation). We convert the requested
 * percentage to hours (100% = 40h/week), find the member's allocation row in
 * the project's weekly grid, and POST hours for every week that overlaps the
 * member's [start, end] span (0 for the rest), mirroring WeeklyAllocationFormCard.
 * Returns true if hours were written; false if the project has no weekly grid
 * (e.g. no schedule yet) or the member row hasn't appeared, so the caller can
 * report the assignment as added-at-0%.
 */
async function setTeamMemberHours(
  projectId: string,
  personId: string,
  resolved: { divShort: string; roleName: string; jobTitle: string },
  pct: number,
  start: string,
  end: string,
): Promise<boolean> {
  const hours = Math.round((pct / 100) * getBusinessRules().workWeekHours);
  if (hours <= 0) return false;
  const startD = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime()) || endD < startD) return false;

  const pid = personId.trim().toLowerCase();
  const matches = (r: AnyRec) => String(r.AssignedTo ?? "").trim().toLowerCase() === pid;

  // The member may not appear instantly after assignResource (RM ONE
  // read-after-write lag), so retry the fetch a few times with backoff. This
  // matters for path selection below: an upstream member that's merely lagging
  // must be found here (PATH A), otherwise we'd fall through to the RDS-only
  // synthetic path (PATH B).
  let ea: AnyRec[] = [];
  let member: AnyRec | undefined;
  for (let attempt = 0; attempt < 3 && !member; attempt++) {
    if (attempt > 0) await sleep(900 * attempt);
    const data = (await getFullProjectAllocations(projectId)) as AnyRec;
    ea = (data?.ExistingAllocations as AnyRec[]) ?? [];
    const na = (data?.NewAllocations as AnyRec[]) ?? [];
    member = na.find(matches) || ea.find(matches);
  }

  // Identity/base fields the weekly-save SP needs (DivisionLookup / JobTitleLookup
  // / GroupId etc.). Prefer the member's own row when present (upstream returns it
  // with the numeric lookups); otherwise synthesize from the values we resolved
  // before assignResource — RDS already wrote those lookups onto the assignment
  // (ResourceWorkItems) row, which the save reuses.
  const baseFields: AnyRec = {
    AssignedTo: personId,
    ProjectID: projectId,
    PctAllocation: pct,
  };
  if (member) {
    for (const k of Object.keys(member)) {
      if (
        k === "AllocationStartDate" || k === "AllocationEndDate" || k === "AllocationHour" ||
        k === "isChanged" || k === "ID" ||
        k.includes("_stageStep") || k.includes("_stageColor") || WEEK_KEY_RE.test(k)
      ) continue;
      baseFields[k] = member[k];
    }
  }
  if (resolved.divShort) baseFields.DivisionName = resolved.divShort;
  if (resolved.roleName) { baseFields.TypeName = resolved.roleName; if (!baseFields.Title) baseFields.Title = resolved.roleName; }
  if (resolved.jobTitle) { baseFields.Title = resolved.jobTitle; baseFields.JobTitleName = resolved.jobTitle; }

  const allocations: AnyRec[] = [];

  // PATH A (upstream): the member row carries one "DD-Mon-YY" column per schedule
  // week. Map our [start, end] span onto those real schedule weeks so the saved
  // weeks line up exactly with the project's phase grid. This path is taken
  // whenever the member row came back (i.e. upstream): if it carries week
  // columns we fill them, and if it doesn't (project without a weekly schedule)
  // we deliberately DON'T guess — we keep the old "couldn't apply" behaviour
  // rather than write synthetic weeks an upstream schedule wouldn't recognise.
  if (member) {
    const weekKeys = Object.keys(member).filter((k) => WEEK_KEY_RE.test(k) && !k.includes("_"));
    if (weekKeys.length === 0) return false; // upstream member, no weekly grid
    const eaByWeek = new Map<string, AnyRec>();
    for (const r of ea) {
      if (!matches(r)) continue;
      const sd = String(r.AllocationStartDate ?? "").slice(0, 10);
      if (sd) eaByWeek.set(sd, r);
    }
    let covered = 0;
    for (const wk of weekKeys) {
      const ws = parseWeekKey(wk);
      if (!ws) continue;
      const we = new Date(ws.getTime() + 6 * 864e5);
      const inRange = ws <= endD && we >= startD; // week span overlaps [start, end]
      const sdKey = ymd(ws);
      const existing = eaByWeek.get(sdKey);
      allocations.push({
        ...baseFields,
        ID: existing?.ID ?? 0,
        GroupId: existing?.GroupId ?? baseFields.GroupId ?? "",
        AllocationStartDate: `${sdKey}T00:00:00`,
        AllocationEndDate: `${ymd(we)}T00:00:00`,
        AllocationHour: inRange ? hours : 0,
        isChanged: true,
      });
      if (inRange) covered++;
    }
    if (covered > 0) {
      await updateHoursAllocation({ ProjectID: projectId, Allocations: allocations });
      return true;
    }
    return false; // grid present but no week overlaps the span — don't guess
  }

  // PATH B (RDS): the member is absent ONLY on RDS/core2 tenants — their
  // allocations endpoint filters out a freshly-assigned 0% member and returns no
  // empty schedule-week columns, so even after the retries above it never
  // appears. (Upstream always returns the member, so it can't reach here.) Build
  // the weekly rows ourselves — one 7-day bucket across [start, end], each
  // carrying `hours`. The backend persists these as weekly ResourceAllocation
  // rows linked to the assignment row assignResource already created, which makes
  // the project's "% allocation" (peak weekly intensity = hours/40*100) and date
  // span resolve correctly.
  const DAY = 864e5;
  for (let t = startD.getTime(); t <= endD.getTime(); t += 7 * DAY) {
    const ws = new Date(t);
    const weEnd = Math.min(t + 6 * DAY, endD.getTime());
    allocations.push({
      ...baseFields,
      ID: 0,
      GroupId: baseFields.GroupId ?? "",
      AllocationStartDate: `${ymd(ws)}T00:00:00`,
      AllocationEndDate: `${ymd(new Date(weEnd))}T00:00:00`,
      AllocationHour: hours,
      isChanged: true,
    });
  }
  if (allocations.length === 0) return false;
  await updateHoursAllocation({ ProjectID: projectId, Allocations: allocations });
  return true;
}

/**
 * A parent record created in this run: its id and (best-effort) date span.
 * `ambiguous` is set when two primary rows share the same Title — child rows
 * then can't tell which parent they mean, so they fail explicitly instead of
 * silently binding to whichever was created last.
 */
interface CreatedParent { id: string; start: string; end: string; ambiguous?: boolean }

/**
 * Add team members from the Team sheet. Each row links to a parent (project /
 * opportunity) created in the same file by its Title, then goes through the EXACT
 * same assignResource path as the manual "Add team member" modal (BU → Role →
 * Title → Person cascade, person GUID from getUsers).
 */
async function processTeamRows(
  entity: BulkEntity,
  rows: ParsedRow[],
  createdMap: Map<string, CreatedParent>,
  divs: AnyRec[],
  users: AnyRec[],
  results: RowResult[],
  tick: () => void,
): Promise<void> {
  const keyHeader = entity === "project" ? "Project Title" : "Opportunity Title";
  const userMap = makeNameMap(users, ["name", "Name"], ["id", "Id", "ID"]);
  // division name (ShortName/Title/Name) → { id, short, buId } for DivisionName +
  // role scope. buId (the parent Business Unit) lets us validate an optional BU.
  const divInfo = new Map<string, { id: string; short: string; buId: string }>();
  for (const d of divs) {
    const id = String(d.ID ?? d.Id ?? "");
    const short = String(d.ShortName ?? d.Title ?? d.Name ?? "").trim();
    const buId = String(d.BusinessUnitIdLookup ?? "").trim();
    if (!id) continue;
    for (const nm of [d.ShortName, d.Title, d.Name]) {
      const k = norm(nm);
      if (k && !divInfo.has(k)) divInfo.set(k, { id, short, buId });
    }
  }
  // Real Business Unit entities (optional top tier). Picking one only validates
  // that the chosen Division belongs to it — the write stays Division-based.
  const buById = new Map<string, string>();   // buId → display
  const buByName = new Map<string, { id: string; display: string }>();
  const buRows = await getBusinessUnits().catch(() => [] as AnyRec[]);
  for (const b of buRows as AnyRec[]) {
    const id = String((b as AnyRec).ID ?? (b as AnyRec).Id ?? "").trim();
    const display = String((b as AnyRec).ShortName ?? (b as AnyRec).Title ?? (b as AnyRec).Name ?? "").trim();
    if (!id || !display) continue;
    buById.set(id, display);
    for (const nm of [(b as AnyRec).ShortName, (b as AnyRec).Title, (b as AnyRec).Name]) {
      const k = norm(nm);
      if (k && !buByName.has(k)) buByName.set(k, { id, display });
    }
  }
  const jobTitles = await getJobTitles().catch(() => [] as AnyRec[]);
  const titleSet = new Set<string>();
  const titleDisplay = new Map<string, string>();
  for (const t of jobTitles as AnyRec[]) {
    const nm = String(t.JobTitleName ?? t.Title ?? t.Name ?? "").trim();
    if (nm) { titleSet.add(norm(nm)); titleDisplay.set(norm(nm), nm); }
  }
  // Standard suggested titles are always accepted — the Excel dropdown offers
  // them even when the catalogue lacks them, and the assignment write carries
  // the title by NAME only (no catalogue id needed).
  for (const nm of STANDARD_JOB_TITLES) {
    const k = norm(nm);
    if (!titleSet.has(k)) { titleSet.add(k); titleDisplay.set(k, nm); }
  }
  const roleCache = new Map<string, Map<string, string>>(); // divisionId → roleNameLower → canonical

  for (const { line, values: v } of rows) {
    const parentName = (v[keyHeader] ?? "").trim();
    const memberName = (v["Team Member"] ?? "").trim();
    const label = `${memberName || "?"} → ${parentName || "?"}`;
    try {
      if (!parentName) throw new Error(`${keyHeader} is required.`);
      if (!memberName) throw new Error("Team Member is required.");
      const parent = createdMap.get(norm(parentName));
      if (!parent) throw new Error(`No ${entity} named "${parentName}" was created in this file — add it on the ${entity === "project" ? "Projects" : "Opportunities"} sheet.`);
      if (parent.ambiguous) throw new Error(`More than one ${entity} named "${parentName}" was created in this file — make the title unique to attach team members.`);

      const personId = userMap.get(norm(memberName));
      if (!personId) throw new Error(`Team Member "${memberName}" was not found.`);

      const divRaw = (v["Division"] ?? "").trim();
      if (!divRaw) throw new Error("Division is required.");
      const div = divInfo.get(norm(divRaw));
      if (!div) throw new Error(`Division "${divRaw}" was not found.`);

      // Optional Business Unit only validates that the Division sits under it
      // (BU is the top tier; it never changes the Division-based write).
      const buRaw = (v["Business Unit"] ?? "").trim();
      if (buRaw) {
        const bu = buByName.get(norm(buRaw));
        if (!bu) {
          const hint = divInfo.has(norm(buRaw))
            ? ` It looks like a Division — put it in the "Division" column instead.`
            : "";
          throw new Error(`Business Unit "${buRaw}" was not found.${hint}`);
        }
        if (div.buId && div.buId !== bu.id) {
          throw new Error(`Division "${div.short || divRaw}" is not under Business Unit "${bu.display}".`);
        }
      }

      const roleRaw = (v["Role"] ?? "").trim();
      if (!roleRaw) throw new Error("Role is required.");
      let rmap = roleCache.get(div.id);
      if (!rmap) {
        const roles = await getRolesByBU(div.id).catch(() => [] as AnyRec[]);
        rmap = new Map<string, string>();
        for (const r of roles as AnyRec[]) {
          const rn = String((r as AnyRec).name ?? (r as AnyRec).Name ?? "").trim();
          if (rn) rmap.set(norm(rn), rn);
        }
        roleCache.set(div.id, rmap);
      }
      const roleName = rmap.get(norm(roleRaw));
      if (!roleName) throw new Error(`Role "${roleRaw}" was not found for Division "${divRaw}".`);

      const jtRaw = (v["Job Title"] ?? "").trim();
      let jobTitle = "";
      if (jtRaw) {
        if (!titleSet.has(norm(jtRaw))) throw new Error(`Job Title "${jtRaw}" was not found.`);
        jobTitle = titleDisplay.get(norm(jtRaw)) ?? jtRaw;
      }

      // Blank → 0% (Allocation % is optional). A non-blank value that isn't a
      // valid number fails the row explicitly rather than silently becoming 0.
      const pctRaw = (v["Allocation %"] ?? "").trim();
      let pctAllocation = 0;
      if (pctRaw) {
        const pct = Number(pctRaw.replace(/[%\s,]/g, ""));
        if (!Number.isFinite(pct)) throw new Error(`Allocation % "${pctRaw}" is not a valid number.`);
        pctAllocation = pct;
      }

      const start = normYmd(v["Start Date"] ?? "") || parent.start || offsetYmd(0);
      const end = normYmd(v["End Date"] ?? "") || parent.end || plusDaysYmd(start, 365);

      const resTxt = await assignResource({
        ProjectID: parent.id,
        Allocations: [{
          AllocationStartDate: start,
          AllocationEndDate: end,
          AssignedTo: personId,
          AssignedToName: memberName,
          ID: 0,
          PctAllocation: pctAllocation,
          ProjectID: parent.id,
          TemplateID: 0,
          Title: jobTitle || null,
          JobTitleName: jobTitle || null,
          DivisionName: div.short || divRaw,
          Type: "",
          TypeName: roleName,
          SoftAllocation: "false",
          NonChargeable: false,
          IsResourceDisabled: false,
          IsResourceOverAllocated: false,
          IsPreconStage: false,
        }],
      });
      const low = (resTxt || "").toLowerCase();
      if (low.includes("allocationoutofbounds")) {
        throw new Error(`${memberName}'s availability doesn't cover ${start} – ${end}.`);
      }
      if (low.includes("overlappingallocation")) {
        throw new Error(`${memberName} already has an overlapping allocation on this ${entity}.`);
      }
      // The person is now on the project at 0%. If an allocation % was given,
      // set it the same way the manual flow does — by writing weekly hours
      // across the member's date span (assignResource alone never sets %).
      let note: string | undefined;
      if (pctAllocation > 0) {
        try {
          const applied = await setTeamMemberHours(
            parent.id, personId,
            { divShort: div.short || divRaw, roleName, jobTitle },
            pctAllocation, start, end,
          );
          if (!applied) {
            note = `Added — but ${pctAllocation}% over ${start} – ${end} couldn't be applied; open this ${entity}'s team tab to set the weekly hours.`;
          }
        } catch (e) {
          note = `Added, but setting ${pctAllocation}% failed: ${(e as Error)?.message || "weekly hours save was rejected."}`;
        }
      }
      results.push({ line, title: label, ok: true, note, section: "Team" });
    } catch (e) {
      results.push({ line, title: label, ok: false, error: (e as Error)?.message || "Could not add team member.", section: "Team" });
    }
    tick();
  }
}

/**
 * Assign a lifecycle (= schedule) to projects from the Schedule sheet, mirroring
 * the project-detail "Assign lifecycle" flow: the chosen lifecycle's stages
 * become schedule phases (PMM offsets: i*14 start, +13 due) and are saved via
 * the same createSchedule endpoint.
 */
async function processScheduleRows(
  rows: ParsedRow[],
  createdMap: Map<string, CreatedParent>,
  results: RowResult[],
  tick: () => void,
): Promise<void> {
  const lifecycles = await getLifecycles().catch(() => [] as AnyRec[]);
  const lcMap = new Map<string, AnyRec>();
  for (const lc of lifecycles as AnyRec[]) {
    const nm = norm((lc as AnyRec).Name ?? (lc as AnyRec).Title);
    if (nm && !lcMap.has(nm)) lcMap.set(nm, lc);
  }

  for (const { line, values: v } of rows) {
    const parentName = (v["Project Title"] ?? "").trim();
    const lcRaw = (v["Lifecycle"] ?? "").trim();
    const label = `${lcRaw || "?"} → ${parentName || "?"}`;
    try {
      if (!parentName) throw new Error("Project Title is required.");
      if (!lcRaw) throw new Error("Lifecycle is required.");
      const parent = createdMap.get(norm(parentName));
      if (!parent) throw new Error(`No project named "${parentName}" was created in this file — add it on the Projects sheet.`);
      if (parent.ambiguous) throw new Error(`More than one project named "${parentName}" was created in this file — make the title unique to assign a schedule.`);

      const lc = lcMap.get(norm(lcRaw));
      if (!lc) throw new Error(`Lifecycle "${lcRaw}" was not found.`);
      const lcId = String((lc as AnyRec).ID ?? (lc as AnyRec).Id ?? "");
      const stagesRaw = Array.isArray((lc as AnyRec).Stages) ? ((lc as AnyRec).Stages as AnyRec[]) : [];
      if (stagesRaw.length === 0) throw new Error(`Lifecycle "${lcRaw}" has no phases.`);
      const stages = [...stagesRaw].sort((a, b) => Number(a.StageStep ?? 0) - Number(b.StageStep ?? 0));

      const tasks = stages.map((stage, i) => {
        const baseOffset = i * 14;
        const step = Number(stage.StageStep ?? i + 1);
        return {
          ID: -(i + 1),
          Title: String(stage.Name ?? `Phase ${i + 1}`),
          StartDate: offsetYmd(baseOffset),
          DueDate: offsetYmd(baseOffset + 13),
          Status: "Not Started",
          PercentComplete: 0,
          ItemOrder: step,
          TicketId: parent.id,
          AssignedTo: "",
          isSelected: true,
          StageStep: step,
        };
      });

      await createSchedule({
        TicketID: parent.id,
        ProjectLifecycleID: lcId,
        ProjectScheduleExists: false,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: tasks,
      });
      results.push({ line, title: label, ok: true, section: "Schedule" });
    } catch (e) {
      results.push({ line, title: label, ok: false, error: (e as Error)?.message || "Could not assign schedule.", section: "Schedule" });
    }
    tick();
  }
}

/**
 * Resolve + create everything in a parsed workbook. Primary records are created
 * first (same single-create path as a manual create), then Team members and (for
 * projects) Schedules link to them by Title. Rows are processed sequentially;
 * one bad row never aborts the rest. Returns a flat per-row result tagged with
 * its source sheet (section).
 */
export async function runBulkCreate(
  entity: BulkEntity,
  parsed: ParsedTemplate,
  onProgress?: (p: BulkProgress) => void,
): Promise<RowResult[]> {
  const results: RowResult[] = [];
  const total = countRows(parsed);
  let done = 0;
  const tick = () => onProgress?.({ done: ++done, total });
  const rows = parsed.primary;

  if (entity === "staff") {
    const [divs, depts, titles, buRows, aclLevels] = await Promise.all([
      getDivisions().catch(() => [] as AnyRec[]),
      getDepartments().catch(() => [] as AnyRec[]),
      getJobTitles().catch(() => [] as AnyRec[]),
      getBusinessUnits().catch(() => [] as AnyRec[]),
      // Custom access levels (Settings → Access Levels) — soft-fail: the
      // built-in Admin/Manager/User always work without this fetch.
      fetchAccessLevels().catch(() => [] as AccessLevelDef[]),
    ]);
    // norm(level name) → "custom:<id>" marker (server normAcl accepts it verbatim).
    const aclMap = new Map<string, string>();
    for (const l of aclLevels) {
      const n = norm(String(l.name ?? ""));
      const id = String(l.id ?? "").trim();
      if (n && id) aclMap.set(n, `custom:${id}`);
    }
    const divMap = makeNameMap(divs as AnyRec[], ["ShortName", "Title", "Name"], ["ID", "Id"]);
    const deptMap = makeNameMap(depts as AnyRec[], ["Title", "Name"], ["ID", "Id"]);
    const titleMap = makeNameMap(titles as AnyRec[], ["Title", "JobTitleName", "Name"], ["ID", "Id"]);
    // divisionId → parent BU id, for validating an optional Business Unit.
    const divBuId = new Map<string, string>();
    for (const d of divs as AnyRec[]) {
      const id = String((d as AnyRec).ID ?? (d as AnyRec).Id ?? "").trim();
      if (id) divBuId.set(id, String((d as AnyRec).BusinessUnitIdLookup ?? "").trim());
    }
    // Real Business Unit entities (optional). buByName resolves a typed name → id.
    const buByName = new Map<string, { id: string; display: string }>();
    for (const b of buRows as AnyRec[]) {
      const id = String((b as AnyRec).ID ?? (b as AnyRec).Id ?? "").trim();
      const display = String((b as AnyRec).ShortName ?? (b as AnyRec).Title ?? (b as AnyRec).Name ?? "").trim();
      if (!id || !display) continue;
      for (const nm of [(b as AnyRec).ShortName, (b as AnyRec).Title, (b as AnyRec).Name]) {
        const k = norm(nm);
        if (k && !buByName.has(k)) buByName.set(k, { id, display });
      }
    }
    const roleCache = new Map<string, Map<string, string>>(); // divisionId → roleName→roleId

    for (let i = 0; i < rows.length; i++) {
      const { line, values: v } = rows[i];
      const name = (v["Name"] ?? "").trim();
      const email = (v["Email"] ?? "").trim();
      try {
        if (!name) throw new Error("Name is required.");
        if (!email.includes("@")) throw new Error("A valid email address is required.");

        // Optional Business Unit (top tier). Resolved first so a newly-created
        // Division can be linked to it; staff are still stored against the Division.
        const buRaw = (v["Business Unit"] ?? "").trim();
        let bu: { id: string; display: string } | undefined;
        if (buRaw) {
          bu = buByName.get(norm(buRaw));
          if (!bu) {
            const hint = divMap.has(norm(buRaw))
              ? ` It looks like a Division — put it in the "Division" column instead.`
              : "";
            throw new Error(`Business Unit "${buRaw}" was not found.${hint}`);
          }
        }

        let divisionId = "";
        const divRaw = (v["Division"] ?? "").trim();
        if (divRaw) {
          divisionId = divMap.get(norm(divRaw)) ?? "";
          if (!divisionId) {
            const created = await createDivision(divRaw, bu?.id);
            divisionId = String(created.id);
            divMap.set(norm(divRaw), divisionId);
            divBuId.set(divisionId, bu?.id ?? "");
          }
        }

        // A provided BU must match an existing Division's parent.
        if (bu && divisionId) {
          const dBu = divBuId.get(divisionId) ?? "";
          if (dBu && dBu !== bu.id) {
            throw new Error(`Division "${divRaw}" is not under Business Unit "${bu.display}".`);
          }
        }

        let departmentId = "";
        const deptRaw = (v["Department"] ?? "").trim();
        if (deptRaw) {
          departmentId = deptMap.get(norm(deptRaw)) ?? "";
          if (!departmentId) {
            const created = await createDepartment(deptRaw);
            departmentId = String(created.id);
            deptMap.set(norm(deptRaw), departmentId);
          }
        }
        let jobTitleId = "";
        const jtRaw = (v["Job Title"] ?? "").trim();
        if (jtRaw) {
          jobTitleId = titleMap.get(norm(jtRaw)) ?? "";
          if (!jobTitleId) {
            // Same pattern as Division/Department above — create the missing
            // title (idempotent server-side) instead of failing the row, so
            // the standard suggested titles in the dropdown always work.
            const created = await createJobTitle(jtRaw, departmentId || undefined);
            jobTitleId = String(created.id);
            titleMap.set(norm(jtRaw), jobTitleId);
          }
        }

        // Role → roleId is scoped to the chosen Division.
        const roleRaw = (v["Role"] ?? "").trim();
        let roleId = "";
        if (roleRaw) {
          if (!divisionId) throw new Error(`Role "${roleRaw}" requires a Division — add one in the Division column.`);
          let map = roleCache.get(divisionId);
          if (!map) {
            const roles = await getRolesByBU(divisionId);
            map = new Map<string, string>();
            for (const r of roles as AnyRec[]) {
              const rn = norm((r as AnyRec).name ?? (r as AnyRec).Name);
              const rid = String((r as AnyRec).id ?? (r as AnyRec).Id ?? "");
              if (rn && rid) map.set(rn, rid);
            }
            roleCache.set(divisionId, map);
          }
          roleId = map.get(norm(roleRaw)) ?? "";
          if (!roleId) throw new Error(`Role "${roleRaw}" was not found for that Division.`);
        }

        const aclRawStr = (v["Access Level"] ?? "").trim();
        const aclRaw = norm(aclRawStr);
        let accessLevel = aclRaw === "admin" ? "Admin" : aclRaw === "manager" ? "Manager" : aclRaw === "user" ? "User" : "";
        if (!accessLevel && aclRawStr) {
          // Custom level (Settings → Access Levels) — match by name and send
          // the "custom:<id>" marker the server's normAcl accepts verbatim.
          const custom = aclMap.get(aclRaw);
          if (!custom) throw new Error(`Access level "${aclRawStr}" was not found — use Admin, Manager, User, or a custom level from Settings → Access Levels.`);
          accessLevel = custom;
        }
        const inviteRaw = norm(v["Send Invite"]);
        const sendInvite = inviteRaw === "yes" || inviteRaw === "true" || inviteRaw === "1" || inviteRaw === "y";

        await createStaff({
          name, email,
          divisionId: divisionId || undefined,
          departmentId: departmentId || undefined,
          jobTitleId: jobTitleId || undefined,
          roleId: roleId || undefined,
          roleName: roleRaw || undefined,
          accessLevel,
          sendInvite,
        });
        results.push({ line, title: name, ok: true, section: "Staff" });
      } catch (e) {
        results.push({ line, title: name || email || `Row ${line}`, ok: false, error: (e as Error)?.message || "Failed to create staff member.", section: "Staff" });
      }
      tick();
    }
    return results;
  }

  // ── Project / Opportunity (both go through createRecord) ──
  const module = entity === "project" ? "PMM" : "OPM";
  const [divs, depts, bus, users, stages] = await Promise.all([
    getDivisions().catch(() => [] as AnyRec[]),
    entity === "project" ? getDepartments().catch(() => [] as AnyRec[]) : Promise.resolve([] as AnyRec[]),
    getBusinessUnits().catch(() => [] as AnyRec[]),
    getUsers().catch(() => [] as AnyRec[]),
    entity === "opportunity" ? getFieldOptions("status", "OPM").catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);
  const divMap = makeNameMap(divs as AnyRec[], ["Title", "ShortName", "Name"], ["ID", "Id"]);
  const deptMap = makeNameMap(depts as AnyRec[], ["Title", "Name"], ["ID", "Id"]);
  const buNameSet = new Set<string>(); // validate the BU name exists (BU persists by name)
  const buDisplay = new Map<string, string>(); // norm → canonical display name
  for (const b of bus as AnyRec[]) {
    const display = String((b as AnyRec).ShortName ?? (b as AnyRec).Title ?? (b as AnyRec).Name ?? "").trim();
    if (display) { buNameSet.add(norm(display)); buDisplay.set(norm(display), display); }
  }
  const userMap = makeNameMap(users as AnyRec[], ["name", "Name"], ["id", "Id", "ID"]);
  const stageSet = new Set<string>((stages as string[]).map((s) => norm(s)));
  const stageDisplay = new Map<string, string>();
  for (const s of stages as string[]) stageDisplay.set(norm(s), s);

  // Title (normalised) → created parent, so Team / Schedule rows can link to a
  // record made earlier in THIS same file.
  const createdMap = new Map<string, CreatedParent>();
  const sectionLabel = entity === "project" ? "Projects" : "Opportunities";

  for (let i = 0; i < rows.length; i++) {
    const { line, values: v } = rows[i];
    const titleKey = entity === "project" ? "Project Title" : "Opportunity Title";
    const title = (v[titleKey] ?? "").trim();
    try {
      if (!title) throw new Error(`${titleKey} is required.`);
      // IDs are mandatory — the backend never auto-generates them.
      const idKey = entity === "project" ? "Project ID" : "Opportunity ID";
      const recordId = (v[idKey] ?? "").trim();
      if (!recordId) throw new Error(`${idKey} is required.`);
      const divRaw = (v["Division"] ?? "").trim();
      if (!divRaw) throw new Error("Division is required.");
      let divisionId = divMap.get(norm(divRaw)) ?? "";
      if (!divisionId) {
        const created = await createDivision(divRaw);
        divisionId = String(created.id);
        divMap.set(norm(divRaw), divisionId);
      }

      const fields: { FieldName: string; Value: string }[] = [
        { FieldName: "Title", Value: title },
        { FieldName: "TicketId", Value: recordId },
        { FieldName: "DivisionID", Value: String(Number(divisionId) || 0) },
      ];

      if (entity === "project") {
        fields.push({ FieldName: "ApproxContractValue", Value: num(v["Contract Value"] ?? "", "Contract Value") });

        const deptRaw = (v["Department"] ?? "").trim();
        if (deptRaw) {
          let id = deptMap.get(norm(deptRaw));
          if (!id) {
            const created = await createDepartment(deptRaw);
            id = String(created.id);
            deptMap.set(norm(deptRaw), id);
          }
          fields.push({ FieldName: "DepartmentID", Value: String(Number(id) || 0) });
        }
        const buRaw = (v["Business Unit"] ?? "").trim();
        if (buRaw) {
          if (!buNameSet.has(norm(buRaw))) {
            const created = await createBusinessUnit(buRaw);
            buNameSet.add(norm(buRaw));
            buDisplay.set(norm(buRaw), created.name);
          }
          fields.push({ FieldName: "CRMBusinessUnitChoice", Value: buDisplay.get(norm(buRaw)) ?? buRaw });
        }
        const pmRaw = (v["Project Manager"] ?? "").trim();
        if (pmRaw) {
          const id = userMap.get(norm(pmRaw));
          if (!id) throw new Error(`Project Manager "${pmRaw}" was not found.`);
          fields.push({ FieldName: "PrimaryProjectManager", Value: id });
        }
        const start = asDate(v["Target Start Date"] ?? "");
        if (start) fields.push({ FieldName: "TargetStartDate", Value: start });
        const end = asDate(v["Target Completion Date"] ?? "");
        if (end) fields.push({ FieldName: "TargetCompletionDate", Value: end });
        fields.push({ FieldName: "CRMProjectStatusChoice", Value: "Pre-Con" });
      } else {
        fields.push({ FieldName: "ApproxContractValue", Value: num(v["Estimated Value"] ?? "", "Estimated Value") });
        // Free text allowed — tenants use values like "(4) More Than 80%".
        const probRaw = (v["Win Probability (%)"] ?? "").trim();
        if (probRaw) fields.push({ FieldName: "SuccessChance", Value: probRaw });

        const stageRaw = (v["Stage"] ?? "").trim();
        if (stageRaw) {
          if (!stageSet.has(norm(stageRaw))) throw new Error(`Stage "${stageRaw}" is not a valid stage.`);
          fields.push({ FieldName: "CRMOpportunityStatusChoice", Value: stageDisplay.get(norm(stageRaw)) ?? stageRaw });
        }
        const ownerRaw = (v["Owner"] ?? "").trim();
        if (ownerRaw) {
          const id = userMap.get(norm(ownerRaw));
          if (!id) throw new Error(`Owner "${ownerRaw}" was not found.`);
          fields.push({ FieldName: "OwnerUser", Value: id });
        }
        const buRaw = (v["Business Unit"] ?? "").trim();
        if (buRaw) {
          if (!buNameSet.has(norm(buRaw))) {
            const created = await createBusinessUnit(buRaw);
            buNameSet.add(norm(buRaw));
            buDisplay.set(norm(buRaw), created.name);
          }
          fields.push({ FieldName: "CRMBusinessUnitChoice", Value: buDisplay.get(norm(buRaw)) ?? buRaw });
        }
        const oppTs = asDate(v["Target Start Date"] ?? "");
        if (oppTs) fields.push({ FieldName: "TargetStartDate", Value: oppTs });
        const oppTe = asDate(v["Target End Date"] ?? "");
        if (oppTe) fields.push({ FieldName: "TargetCompletionDate", Value: oppTe });
        const cat = (v["Project Category"] ?? "").trim();
        if (cat) fields.push({ FieldName: "RequestCategory", Value: cat });
      }

      const res: AnyRec = await createRecord(module, fields) as AnyRec;
      if (res?.Status === false) {
        throw new Error(String(res?.error ?? `Failed to create ${entity}.`));
      }
      const data = res?.Data as AnyRec | undefined;
      const id = String(data?.TicketId ?? data?.ID ?? res?.TicketId ?? res?.ID ?? "");
      if (id) {
        // Remember this parent (and its date span) for Team / Schedule linking.
        // A repeated Title is flagged ambiguous so child rows fail explicitly.
        const pStart = entity === "project" ? normYmd(v["Target Start Date"] ?? "") : "";
        const pEnd = entity === "project" ? normYmd(v["Target Completion Date"] ?? "") : "";
        const key = norm(title);
        if (createdMap.has(key)) {
          const prev = createdMap.get(key)!;
          createdMap.set(key, { ...prev, ambiguous: true });
        } else {
          createdMap.set(key, { id, start: pStart, end: pEnd });
        }
      }
      results.push({ line, title, ok: true, id: id || undefined, section: sectionLabel });
    } catch (e) {
      results.push({ line, title: title || `Row ${line}`, ok: false, error: (e as Error)?.message || `Failed to create ${entity}.`, section: sectionLabel });
    }
    tick();
  }

  // Child sheets: (projects only) Schedules FIRST so the project has a phase
  // schedule — and therefore weekly buckets — before we set team allocation
  // hours; then Team members. Both link to parents created above by Title;
  // missing parents fail just that row.
  if (entity === "project" && parsed.schedule.length) {
    await processScheduleRows(parsed.schedule, createdMap, results, tick);
  }
  if (parsed.team.length) {
    await processTeamRows(entity, parsed.team, createdMap, divs as AnyRec[], users as AnyRec[], results, tick);
  }

  // Bust the module cache once so the list reflects the new records.
  bustCache(`module:${module}`);
  // Also bust the project-scoped caches. setTeamMemberHours polls
  // getFullProjectAllocations (key `project:allocations:<id>`) BEFORE writing the
  // hours, which caches an empty allocation set mid-run; without this the freshly
  // uploaded project/opportunity detail page would render that stale-empty cache
  // ("No Team Assigned") even though core2 has the team. Clearing `project:` forces
  // a fresh fetch of team/allocations/details/tasks when the record is opened.
  bustCache("project:");
  return results;
}
