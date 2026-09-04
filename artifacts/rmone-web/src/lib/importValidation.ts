// ── Shared import validation ──────────────────────────────────────────────
// Extracted from InlineDataGrid.tsx so the upload review grid
// (ImportReviewGrid.tsx) can reuse the exact same rules without a module
// cycle. Both the inline grid and the review grid import from here — the
// validators must never drift between the two.

export type ColDef = {
  key: string;
  label: string;
  w: number;
  type?: "text" | "status" | "select" | "date" | "currency" | "number";
  opts?: readonly string[];
  softOpts?: boolean;
};
export interface TabDef { id: string; label: string; cols: ColDef[]; sheetName: string; }
export type Row = Record<string, string>;

// ── Mandatory ID columns ──────────────────────────────────────────────────
// IDs are user-supplied and required — RM ONE never auto-generates them. Every
// populated row must carry its ID before an import can run (a completely empty
// tab is fine). Companies has no ID requirement HERE (create/first-time uploads
// mint IDs like COM-26-000123) — but update-mode uploads require it, see
// REQUIRED_ID_BY_CARD_STRICT below.
export const REQUIRED_ID_BY_TAB: Record<string, { key: string; label: string }> = {
  assignments: { key: "asg_projectId", label: "Project / Opp ID" },
  schedule:    { key: "sch_projectId", label: "Project / Opp ID" },
};
export const REQUIRED_ID_BY_CARD: Record<string, { key: string; label: string }> = {
  projects:      { key: "projectId",  label: "Project ID" },
  opportunities: { key: "opp_erpJob", label: "Opportunity ID" },
  leads:         { key: "ld_id",      label: "Lead ID" },
  team:          { key: "st_email",   label: "Login Email" },
};
export function requiredIdFor(cardId: string, tabId: string): { key: string; label: string } | null {
  if (REQUIRED_ID_BY_TAB[tabId]) return REQUIRED_ID_BY_TAB[tabId];
  if (tabId === "main") return REQUIRED_ID_BY_CARD[cardId] ?? null;
  return null;
}

// ── Strict identity keys (Aug 2026) ───────────────────────────────────────
// Recurring imports match by key ONLY — no name fallbacks. Beyond the record
// ID above, record rows must carry the Company ID they belong to, and
// assignment rows naming a person must carry that person's login email
// (names/titles are display-only). Enforced only when the grid passes
// strictKeys (the recurring-import page); create-mode surfaces (onboarding,
// bulk create) keep the tolerant ladder. The server's update-mode gate
// (failureReason "strict_keys") is the backstop.
export const REQUIRED_COMPANY_BY_CARD: Record<string, { key: string; label: string }> = {
  projects:      { key: "companyId",     label: "Company ID" },
  opportunities: { key: "opp_companyId", label: "Company ID" },
  leads:         { key: "ld_companyId",  label: "Company ID" },
};

export const REQUIRED_ID_BY_CARD_STRICT: Record<string, { key: string; label: string }> = {
  companies: { key: "co_companyId", label: "Company ID" },
};
export const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;

export type MissingIdIssue = { tabLabel: string; colLabel: string; rows: number[] };

// Returns one issue per tab that has populated rows missing their mandatory ID.
// Row numbers are 1-based positions within that tab (skipping fully-empty rows
// doesn't renumber — the number matches what the user sees in the grid).
export function findMissingIds(
  cardId: string,
  tabsData: { tab: TabDef; rows: Row[] }[],
): MissingIdIssue[] {
  const issues: MissingIdIssue[] = [];
  for (const { tab, rows } of tabsData) {
    const req = requiredIdFor(cardId, tab.id);
    if (!req) continue;
    const bad: number[] = [];
    rows.forEach((r, i) => {
      const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
      if (populated && !(r[req.key] ?? "").trim()) bad.push(i + 1);
    });
    if (bad.length) issues.push({ tabLabel: tab.label, colLabel: req.label, rows: bad });
  }
  return issues;
}

export type DuplicateRowIssue = { tabLabel: string; colLabel: string; value: string; rows: number[] };

// ── Exact-duplicate detection (all modules, ALL tabs) ─────────────────────
// Two rows count as duplicates ONLY when EVERY template column matches
// (whitespace/case-insensitive) — costs, dates and hours included. If even
// one column differs, both rows are kept. The first occurrence stays; the
// later copies are skipped from the import.
export function scanExactDuplicates(
  tabsData: { tab: TabDef; rows: Row[] }[],
): { issues: DuplicateRowIssue[]; removed: number; rowsByTab: Row[][] } {
  const issues: DuplicateRowIssue[] = [];
  let removed = 0;
  const rowsByTab = tabsData.map(({ tab, rows }) => {
    const seen = new Map<string, { rows: number[]; preview: string }>();
    const keep: Row[] = [];
    rows.forEach((r, i) => {
      const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
      if (!populated) { keep.push(r); return; } // blank entry rows are not duplicates
      const key = tab.cols.map(c => (r[c.key] ?? "").trim().replace(/\s+/g, " ").toLowerCase()).join("\u0000");
      const e = seen.get(key);
      if (e) { e.rows.push(i + 1); removed++; return; } // exact copy — skip it
      const preview = tab.cols.map(c => (r[c.key] ?? "").trim()).filter(Boolean).slice(0, 3).join(" · ");
      seen.set(key, { rows: [i + 1], preview });
      keep.push(r);
    });
    for (const e of seen.values()) {
      if (e.rows.length > 1) {
        issues.push({ tabLabel: tab.label, colLabel: "Entire row", value: e.preview, rows: e.rows });
      }
    }
    return keep;
  });
  return { issues, removed, rowsByTab };
}

export type OrphanIdIssue = { tabLabel: string; colLabel: string; mainLabel: string; ids: string[]; rows: number[] };

// Cross-tab referential check: every Project ID used in the Assignments /
// Schedule tabs must exist in the main tab. When the main tab is empty the
// check is skipped ONLY if the client already has data in the database —
// the child tabs may then legitimately reference existing records. On a
// fresh tenant with no data anywhere, an empty main tab means the IDs can't
// exist at all, so every populated child row is an orphan.
export function findOrphanIds(
  cardId: string,
  tabsData: { tab: TabDef; rows: Row[] }[],
  clientMayHaveExistingRecords: boolean,
): OrphanIdIssue[] {
  const mainReq = REQUIRED_ID_BY_CARD[cardId];
  if (!mainReq) return [];
  const main = tabsData.find(t => t.tab.id === "main");
  if (!main) return [];
  const mainPopulated = main.rows.filter(r => main.tab.cols.some(c => (r[c.key] ?? "").trim()));
  if (!mainPopulated.length && clientMayHaveExistingRecords) return [];
  const idSet = new Set(
    mainPopulated.map(r => (r[mainReq.key] ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const issues: OrphanIdIssue[] = [];
  for (const { tab, rows } of tabsData) {
    if (tab.id === "main") continue;
    const req = REQUIRED_ID_BY_TAB[tab.id];
    if (!req) continue;
    const badRows: number[] = [];
    const badIds: string[] = [];
    rows.forEach((r, i) => {
      const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
      if (!populated) return;
      const id = (r[req.key] ?? "").trim();
      if (id && !idSet.has(id.toLowerCase())) {
        badRows.push(i + 1);
        if (!badIds.includes(id)) badIds.push(id);
      }
    });
    if (badRows.length) {
      issues.push({ tabLabel: tab.label, colLabel: req.label, mainLabel: main.tab.label, ids: badIds, rows: badRows });
    }
  }
  return issues;
}

// Same inputs as findOrphanIds but instead of returning issues it returns
// a copy of `data` with orphan rows silently removed from every child tab.
export function filterOrphanRows<T extends { rows: Row[] }>(
  cardId: string,
  tabs: TabDef[],
  data: T[],
  clientMayHaveExistingRecords: boolean,
): T[] {
  const mainReq = REQUIRED_ID_BY_CARD[cardId];
  if (!mainReq) return data;
  const mainIdx = tabs.findIndex(t => t.id === "main");
  if (mainIdx < 0) return data;
  const mainTab = tabs[mainIdx];
  const mainRows = data[mainIdx].rows;
  const mainPopulated = mainRows.filter(r => mainTab.cols.some(c => (r[c.key] ?? "").trim()));
  if (!mainPopulated.length && clientMayHaveExistingRecords) return data;
  const idSet = new Set(
    mainPopulated.map(r => (r[mainReq.key] ?? "").trim().toLowerCase()).filter(Boolean),
  );
  return data.map((d, i) => {
    const tab = tabs[i];
    if (tab.id === "main") return d;
    const req = REQUIRED_ID_BY_TAB[tab.id];
    if (!req) return d;
    return {
      ...d,
      rows: d.rows.filter(r => {
        const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
        if (!populated) return true;
        const id = (r[req.key] ?? "").trim();
        return !id || idSet.has(id.toLowerCase());
      }),
    };
  });
}

// ── DB-backed reference check (standalone Assignments / Schedule cards) ──
// The standalone Team Assignments / Schedule cards have no "main" tab to
// validate Project/Opp IDs against — instead the import page fetches the
// tenant's existing PMM + Opportunity ticket IDs once and passes this check
// down. `has` receives the RAW cell value (the grid auto-canonicalizes
// separator/case drift before rows reach validation). A null/absent check
// means the ID list couldn't be loaded: the client-side check is skipped
// entirely (fail open) and the server's ghost-reference guard remains the
// backstop.
// `suggest` is optional — returns the single closest existing ID when the
// edit distance is small and unambiguous (≤ 2 edits, no tie at minimum).
// When absent (or returning null) no suggestion is offered.
export interface DbRefCheck {
  has: (raw: string) => boolean;
  suggest?: (raw: string) => string | null;
}

/** Uppercase + strip everything non-alphanumeric: "pmm 26-020" → "PMM26020".
 *  Used to match user-typed ticket IDs against the DB's exact form despite
 *  hyphen/space/case drift. Never used to GUESS — only an unambiguous
 *  normalized match may rewrite a value to the DB's canonical spelling. */
export function normalizeTicketRef(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ── Date plausibility ─────────────────────────────────────────────────────
// Excel data-validation only guards typed values, not pasted ones, so
// arbitrary text can reach a date column no matter what guardrails the
// template file has. This is the real, app-side enforcement.
export function isPlausibleDateString(v: string): boolean {
  const s = v.trim();
  if (!s) return true; // blank is allowed (allowBlank)
  // Our own row-normalizer already turns real Excel/Sheets date cells into
  // yyyy-mm-dd, so accept that plus the common typed formats.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return !isNaN(Date.parse(s));
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(s)) return !isNaN(new Date(s).getTime());
  if (/^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}$/.test(s)) return !isNaN(new Date(s).getTime());
  return false;
}

/** Best-effort conversion of any readable date value to "YYYY-MM-DD" (the only
 *  format <input type="date"> displays). Returns null when the value cannot be
 *  read as a date. Parses date-only strings in LOCAL time — `new Date("2026-03-15")`
 *  is UTC midnight and would shift back a day in US timezones. */
export function normalizeDateInput(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let d: Date;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, dd] = s.split("-").map(Number);
    d = new Date(y, m - 1, dd);
  } else if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(s)) {
    d = new Date(s.replace(/[-.]/g, "/")); // M/D/Y parses as local time
  } else {
    d = new Date(s); // "Mar 15, 2026", ISO datetimes, etc.
  }
  if (isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Status options (shared by grid chips, templates and validation) ──────
export const STATUS_OPTS = ["Active", "On Hold", "Complete", "Pending", "Cancelled", "In Review"];

// ── Per-column value validation (Excel parity) ────────────────────────────
// Percent-style numeric columns, validated 0–100. Explicit key set — label
// sniffing would miss "Chance of Success" / "Gross Margin".
// opp_chance is NOT here — Chance of Success accepts free text (tenants use
// values like "(4) More Than 80%"); the DB column is nvarchar everywhere.
export const PERCENT_KEYS = new Set(["feePct", "pctComplete", "sch_pctComplete", "opp_margin"]);

/** Loose-match a value against an allowed-options list: case, hyphens,
 *  spacing and punctuation are ignored ("Full Time" / "full-time" /
 *  "FULLTIME" all resolve to "Full-Time"). Returns the CANONICAL option
 *  string when a match exists, else null. Used both to auto-correct
 *  uploaded values at ingest and to accept variants at validation. */
export function canonicalizeOpt(opts: readonly string[] | undefined, raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v || !opts?.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const key = norm(v);
  if (!key) return null;
  for (const o of opts) if (norm(o) === key) return o;
  return null;
}

// ── Tolerant number parsing (client mirror of the server's) ──────────────
// Mirrors artifacts/api-server/src/lib/pipeline.ts parseTolerantNumber so the
// preview grid accepts exactly what the import will: "$1.2M", "₹12,34,567",
// "3 Cr", "(1,200)", "35 pct", trailing currency codes. Word-number forms
// ("fifty percent") are server-side only — rare, and validation here would
// just soft-fail into the server accepting them anyway.
const MONEY_SUFFIX: Record<string, number> = {
  k: 1e3, m: 1e6, mm: 1e6, mn: 1e6, mil: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
  cr: 1e7, crore: 1e7, crores: 1e7,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5,
};

export function isEmptySentinel(s: string): boolean {
  return /^(-+|—|–|n\/?a|nil|none|null|tbd|tbc|#n\/a|#ref!|#value!)$/i.test(s.trim());
}

export function parseTolerantNumber(raw: string): number | null {
  let s = (raw ?? "").trim();
  if (!s || isEmptySentinel(s)) return null;
  let sign = 1;
  const paren = s.match(/^\((.+)\)$/);
  if (paren) { sign = -1; s = paren[1].trim(); }
  if (/^[^()]*\d\s*-$/.test(s)) { sign = -sign; s = s.replace(/-\s*$/, "").trim(); }
  s = s.replace(/^(₹|\$|£|€|rs\.?|inr|usd|gbp|eur)\s*/i, "").trim();
  const pct = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(%|pct\.?|percent(?:age)?)$/i);
  if (pct) return sign * Number(pct[1].replace(",", "."));
  const suf = s.match(/^(-?[\d,.\s]+)\s*([a-z]+)\.?$/i);
  if (suf && MONEY_SUFFIX[suf[2].toLowerCase()] != null) {
    const base = Number(suf[1].replace(/[,\s]/g, ""));
    if (Number.isFinite(base)) return sign * base * MONEY_SUFFIX[suf[2].toLowerCase()];
  }
  const numLike = s.replace(/[,\s%]/g, "").replace(/(usd|inr|gbp|eur)$/i, "");
  if (/^-?\d+(\.\d+)?$/.test(numLike) && numLike !== "") return sign * Number(numLike);
  return null;
}

/** True when this cell's only problem is naming an access level that doesn't
 *  exist yet. Those are CREATABLE mid-import — the wizard pauses on the
 *  New-levels step (reusing the New-groups popup) and creates them for real —
 *  so validation words them as a heads-up pointing forward, and the review
 *  grid treats them as non-blocking ("newOption"), not errors. Sentinel junk
 *  ("N/A", "-") is never offered as a level and keeps the hard error. */
export function isCreatableLevelValue(col: ColDef, raw: string): boolean {
  const v = (raw ?? "").trim();
  if (!v || isEmptySentinel(v)) return false;
  if (!col.key.endsWith("_accessLevel")) return false;
  if (col.type !== "select" || col.softOpts) return false;
  const opts = col.opts ?? [];
  if (!opts.length) return false;
  return canonicalizeOpt(opts, v) === null;
}

/** Returns an error message for a bad cell value, or null when valid.
 *  Columns with `opts` but no select/status type are free-text suggestion
 *  lists and are NOT hard-validated. Blank cells are always valid. */
export function validateCell(col: ColDef, raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (col.type === "date") {
    return isPlausibleDateString(v) ? null : `"${v}" is not a valid date — use e.g. 2026-03-15 or 3/15/2026`;
  }
  if (col.type === "number" || col.type === "currency") {
    // Tolerant clean-up, matching the server import ("$1.2M", "(1,200)",
    // "35 pct", "N/A" → blank). Sentinels count as blank, hence valid.
    if (isEmptySentinel(v)) return null;
    const n = parseTolerantNumber(v);
    if (n == null) {
      return col.type === "currency"
        ? `"${v}" is not a valid amount — enter a number like 1500000 or $1.5M`
        : `"${v}" is not a number`;
    }
    if (PERCENT_KEYS.has(col.key)) {
      if (n < 0 || n > 100) return `"${v}" must be between 0 and 100 (%)`;
    }
    return null;
  }
  if (col.type === "select" || col.type === "status") {
    if (col.softOpts) return null; // dynamic suggestion list — never hard-fail
    // Status values are tenant-defined: whatever the client's file says
    // ("Bidding", "Open", "Phase 1", …) is accepted verbatim and becomes a
    // first-class dropdown option everywhere. STATUS_OPTS is only a
    // suggestion list for the grid editors — never a validation gate.
    if (col.type === "status") return null;
    const opts = col.opts ?? [];
    if (!opts.length) return null;
    // Loose match: case/hyphen/spacing variants of an allowed option are
    // valid ("Full Time" ≙ "Full-Time") — the grid auto-corrects them to
    // the canonical spelling at upload, and anything that still reaches
    // validation as a variant is accepted rather than blocking the import.
    if (canonicalizeOpt(opts, v) !== null) return null;
    // Unknown access levels are NOT dead ends — the wizard's next step
    // creates them for real. Say so instead of flagging a hard error.
    if (isCreatableLevelValue(col, v)) {
      return `"${v}" is a new access level — keep the row and create "${v}" in the next step, or pick an existing level: ${opts.slice(0, 6).join(", ")}${opts.length > 6 ? ", …" : ""}`;
    }
    return `"${v}" is not an allowed option — use one of: ${opts.slice(0, 6).join(", ")}${opts.length > 6 ? ", …" : ""}`;
  }
  return null;
}

export interface InvalidCellIssue { tabLabel: string; colLabel: string; rows: number[]; reason: string; }
export function findInvalidCells(tabRows: { tab: TabDef; rows: Row[] }[]): InvalidCellIssue[] {
  const issues: InvalidCellIssue[] = [];
  for (const { tab, rows } of tabRows) {
    for (const col of tab.cols) {
      const bad: number[] = [];
      let reason = "";
      rows.forEach((r, i) => {
        const err = validateCell(col, r[col.key] ?? "");
        if (err) { bad.push(i + 1); if (!reason) reason = err; }
      });
      if (bad.length) issues.push({ tabLabel: tab.label, colLabel: col.label, rows: bad, reason });
    }
  }
  return issues;
}

// ── Unified pre-import scan (feeds the upload review grid) ───────────────
// One pass over the submit-time snapshot producing a flat, per-row issue
// list covering every gate that used to be its own popup:
//   duplicate    — later exact copies of an earlier row (first copy is clean)
//   sameId       — DIFFERENT rows sharing one identity ID (main tabs only) —
//                  they'd silently overwrite each other at import
//   invalid      — a cell fails per-column validation (date/number/enum/…)
//   newOption    — an Access Level cell names a level that doesn't exist YET;
//                  the wizard's New-levels step offers to create it for real,
//                  so the review shows it as a heads-up, not a blocking error
//   missingId    — a populated row is missing its mandatory ID
//   orphan       — child-tab row whose Project ID has no match on the main tab
//   spanConflict — assignment rows sharing person + project + dates but with
//                  DIFFERENT hours; the server keeps the last row, not the sum
export type ReviewIssueKind = "duplicate" | "sameId" | "invalid" | "newOption" | "missingId" | "orphan" | "spanConflict";
export interface ReviewIssue {
  tabIdx: number;
  rowIdx: number;           // 0-based position in the snapshot's row array
  kind: ReviewIssueKind;
  colKey?: string;          // cell-level issues point at their column
  colLabel?: string;
  reason: string;           // learner-friendly explanation for the Remarks column
  /** Closest existing ID when the typed value is a near-miss (≤ 2 edits,
   *  unambiguous). Present only on "orphan" issues from the DB ref check. */
  suggestion?: string;
  /** Strict-identity-key violation (strictKeys surfaces only): the server's
   *  update-mode gate would reject the WHOLE upload over this row, so
   *  "Include" is not a valid override — the row must be fixed or skipped.
   *  The review grid blocks Continue while any included row carries one. */
  strict?: boolean;
}

export function scanAllIssues(
  cardId: string,
  tabsData: { tab: TabDef; rows: Row[] }[],
  clientMayHaveExistingRecords: boolean,
  opts?: { skipDuplicates?: boolean; rowNumOffset?: number; rowNums?: number[][]; dbRefs?: DbRefCheck | null; strictKeys?: boolean },
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  // Row numbers shown in reasons: file uploads use Excel numbering (+2 —
  // Excel counts the header line as row 1), manual grid entry uses +1.
  // When the caller scans a FILTERED row set (skip-decision rows removed),
  // opts.rowNums[tabIdx][i] supplies the true display number for each kept
  // row so "Exact copy of row N" never drifts after skips.
  const off = opts?.rowNumOffset ?? 1;
  const numOf = (tabIdx: number, i: number) => opts?.rowNums?.[tabIdx]?.[i] ?? (i + off);

  tabsData.forEach(({ tab, rows }, tabIdx) => {
    const req = requiredIdFor(cardId, tab.id);
    const seen = new Map<string, number>(); // exact-dup fingerprint → first row idx
    const exactCopyIdx = new Set<number>(); // later exact copies — excluded from the same-ID check
    rows.forEach((r, i) => {
      const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
      if (!populated) return;
      // 1. Missing mandatory ID. Under strictKeys the server's block-all gate
      // rejects the whole upload over a blank key, so the issue is marked
      // strict (must be fixed or skipped — "Include" can't override it).
      if (req && !(r[req.key] ?? "").trim()) {
        issues.push({
          tabIdx, rowIdx: i, kind: "missingId", colKey: req.key, colLabel: req.label,
          reason: `${req.label} is required — every row must have one`,
          ...(opts?.strictKeys ? { strict: true } : {}),
        });
      }
      // 1b. Strict identity keys (Aug 2026) — key-only matching means a row
      // without its key can never match anything: the server rejects the
      // WHOLE upload (block-all), so flag it here before submitting.
      if (opts?.strictKeys) {
        // Companies card: every row must carry its Company ID in UPDATE mode —
        // company matching is ID-only, name fallbacks were retired (#366/#376).
        // First-time uploads (fresh tenant: clientMayHaveExistingRecords is
        // false, the grid submits in create mode) stay ID-optional — blank IDs
        // are minted server-side (e.g. COM-26-000123).
        const strictReq = tab.id === "main" && clientMayHaveExistingRecords
          ? REQUIRED_ID_BY_CARD_STRICT[cardId] : undefined;
        if (strictReq && !(r[strictReq.key] ?? "").trim()) {
          issues.push({
            tabIdx, rowIdx: i, kind: "missingId", colKey: strictReq.key, colLabel: strictReq.label, strict: true,
            reason: `${strictReq.label} is required — companies are matched by ID only (the company name is display-only and can change). Copy the ID from the Companies page (e.g. COM-26-000123), or put your own new ID here for a brand-new company`,
          });
        }
        const coReq = tab.id === "main" ? REQUIRED_COMPANY_BY_CARD[cardId] : undefined;
        if (coReq && !(r[coReq.key] ?? "").trim()) {
          issues.push({
            tabIdx, rowIdx: i, kind: "missingId", colKey: coReq.key, colLabel: coReq.label, strict: true,
            reason: `${coReq.label} is required — companies are matched by ID only (the company name is display-only). For a brand-new company, put a new ID here (e.g. COM-1001) plus its name — you'll get an explicit option to create it after the upload`,
          });
        }
        if (tab.id === "assignments") {
          const name = (r.asg_name ?? "").trim();
          const email = (r.asg_email ?? "").trim();
          if (name && !email && !EMAIL_SHAPE.test(name)) {
            issues.push({
              tabIdx, rowIdx: i, kind: "missingId", colKey: "asg_email", colLabel: "Email", strict: true,
              reason: "Email is required to identify the person — names are display-only. Leave BOTH Name and Email blank for an open (unfilled) position.",
            });
          } else if (email && !EMAIL_SHAPE.test(email)) {
            issues.push({
              tabIdx, rowIdx: i, kind: "invalid", colKey: "asg_email", colLabel: "Email", strict: true,
              reason: `Email: "${email}" doesn't look like an email address — people are matched by login email only`,
            });
          }
        }
        if (tab.id === "main" && cardId === "team") {
          const email = (r.st_email ?? "").trim();
          if (email && !EMAIL_SHAPE.test(email)) {
            issues.push({
              tabIdx, rowIdx: i, kind: "invalid", colKey: "st_email", colLabel: "Login Email", strict: true,
              reason: `Login Email: "${email}" doesn't look like an email address`,
            });
          }
        }
      }
      // 2. Per-column value validation
      for (const col of tab.cols) {
        const err = validateCell(col, r[col.key] ?? "");
        if (err) {
          const kind: ReviewIssueKind = isCreatableLevelValue(col, r[col.key] ?? "") ? "newOption" : "invalid";
          issues.push({ tabIdx, rowIdx: i, kind, colKey: col.key, colLabel: col.label, reason: `${col.label}: ${err}` });
        }
      }
      // 3. Exact duplicates — flag the later copies, first stays clean.
      // The fingerprint is tracked even when duplicate flags are suppressed
      // (skipDuplicates) so the same-ID check below still excludes exact
      // copies — those already have their own flag and skip-by-default flow.
      const key = tab.cols.map(c => (r[c.key] ?? "").trim().replace(/\s+/g, " ").toLowerCase()).join("\u0000");
      const first = seen.get(key);
      if (first !== undefined) {
        exactCopyIdx.add(i);
        if (!opts?.skipDuplicates) {
          issues.push({
            tabIdx, rowIdx: i, kind: "duplicate",
            reason: `Exact copy of row ${numOf(tabIdx, first)} — every column matches, including costs and dates`,
          });
        }
      } else {
        seen.set(key, i);
      }
    });

    // 3b. Same ID on multiple DIFFERENT rows — main tabs only (child tabs
    // like Assignments/Schedule legitimately repeat their Project ID many
    // times). Rows sharing an identity ID overwrite each other at import
    // (the later one wins), so EVERY row in the clash is flagged for a
    // decision — skipping one clears its twins via the live re-scan, same
    // as exact duplicates. Exact copies are excluded (flagged above with
    // skip-by-default). IDs compare on normalized form so separator/case
    // drift still clashes ("pmm 26 000011" ≙ "PMM-26-000011"); Login Emails
    // compare lowercased.
    if (tab.id === "main" && req) {
      const byId = new Map<string, number[]>();
      rows.forEach((r, i) => {
        if (exactCopyIdx.has(i)) return;
        const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
        if (!populated) return;
        const raw = (r[req.key] ?? "").trim();
        if (!raw) return; // blank IDs are the missingId check's job
        // Punctuation-only IDs normalize to "" — fall back to the raw form
        // (lowercased) so they still clash: the server writes TicketId
        // verbatim, so two "###" rows overwrite each other all the same.
        const norm = req.key === "st_email" ? raw.toLowerCase() : (normalizeTicketRef(raw) || raw.toLowerCase());
        const arr = byId.get(norm) ?? [];
        arr.push(i);
        byId.set(norm, arr);
      });
      for (const idxs of byId.values()) {
        if (idxs.length < 2) continue;
        for (const i of idxs) {
          const others = idxs.filter(j => j !== i).map(j => `row ${numOf(tabIdx, j)}`).join(", ");
          const shown = (rows[i][req.key] ?? "").trim();
          issues.push({
            tabIdx, rowIdx: i, kind: "sameId", colKey: req.key, colLabel: req.label,
            reason: `${req.label} "${shown}" is also on ${others} — rows with the same ID overwrite each other, so only one would survive. Keep one row per ID (skip the rest) or give each row its own ID`,
          });
        }
      }
    }

    // 3c. Same-span different-hours conflict (assignments tab only).
    // Two rows with the same person + project + start + end but different hours
    // will silently last-write-win on import — flag every row in the clash so
    // the user can decide which hours to keep (or combine into one row).
    // Exact-duplicate rows are excluded (already caught above, and their hours
    // are identical so there is no ambiguity about which value survives).
    if (tab.id === "assignments") {
      const spanGroups = new Map<string, { rowIdx: number; hrs: string }[]>();
      rows.forEach((r, i) => {
        if (exactCopyIdx.has(i)) return;
        const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
        if (!populated) return;
        const person  = (r.asg_name ?? r.asg_email ?? "").trim().toLowerCase();
        const project = (r.asg_projectId ?? r.asg_project ?? "").trim().toLowerCase();
        const start   = (r.asg_startDate ?? "").trim().toLowerCase();
        const end     = (r.asg_endDate ?? "").trim().toLowerCase();
        if (!person || !project || !start) return; // not enough info for a meaningful key
        const spanKey = `${person}\u0000${project}\u0000${start}\u0000${end}`;
        const hrs = (r.asg_totalHours ?? r.asg_pctAlloc ?? "").trim();
        const group = spanGroups.get(spanKey) ?? [];
        group.push({ rowIdx: i, hrs });
        spanGroups.set(spanKey, group);
      });
      for (const group of spanGroups.values()) {
        if (group.length < 2) continue;
        const hrsSet = new Set(group.map(g => g.hrs));
        if (hrsSet.size === 1) continue; // all same hours — exact-dup already covers it
        for (const { rowIdx, hrs } of group) {
          const others = group
            .filter(g => g.rowIdx !== rowIdx)
            .map(g => `row ${numOf(tabIdx, g.rowIdx)}${g.hrs ? ` (${g.hrs} hrs)` : ""}`)
            .join(", ");
          issues.push({
            tabIdx, rowIdx, kind: "spanConflict",
            reason: `Same person, project, and dates as ${others} but with different hours — the last row in the file wins; hours are not added together`,
          });
        }
      }
    }
  });

  // 4. Orphan child rows (same skip rule as findOrphanIds/filterOrphanRows)
  const mainReq = REQUIRED_ID_BY_CARD[cardId];
  const mainIdx = tabsData.findIndex(t => t.tab.id === "main");
  if (mainReq && mainIdx >= 0) {
    const main = tabsData[mainIdx];
    const mainPopulated = main.rows.filter(r => main.tab.cols.some(c => (r[c.key] ?? "").trim()));
    if (mainPopulated.length || !clientMayHaveExistingRecords) {
      const idSet = new Set(mainPopulated.map(r => (r[mainReq.key] ?? "").trim().toLowerCase()).filter(Boolean));
      tabsData.forEach(({ tab, rows }, tabIdx) => {
        if (tab.id === "main") return;
        const req = REQUIRED_ID_BY_TAB[tab.id];
        if (!req) return;
        rows.forEach((r, i) => {
          const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
          if (!populated) return;
          const id = (r[req.key] ?? "").trim();
          if (id && !idSet.has(id.toLowerCase())) {
            issues.push({
              tabIdx, rowIdx: i, kind: "orphan", colKey: req.key, colLabel: req.label,
              reason: `"${id}" doesn't match any row on the ${main.tab.label} tab`,
            });
          }
        });
      });
    }
  }

  // 5. DB-backed reference check (standalone Assignments / Schedule cards).
  // Same "orphan" kind as the cross-tab check so the review grid's decision
  // flow applies unchanged — but the reference universe is the tenant's
  // EXISTING Projects + Opportunities in the database. Only the standalone
  // cards pass dbRefs (they have no main tab), so blocks 4 and 5 never
  // double-flag the same row.
  if (opts?.dbRefs) {
    const dbRefs = opts.dbRefs;
    tabsData.forEach(({ tab, rows }, tabIdx) => {
      const req = REQUIRED_ID_BY_TAB[tab.id];
      if (!req) return;
      rows.forEach((r, i) => {
        const populated = tab.cols.some(c => (r[c.key] ?? "").trim());
        if (!populated) return;
        const id = (r[req.key] ?? "").trim();
        if (id && !dbRefs.has(id)) {
          const suggestion = dbRefs.suggest?.(id) ?? undefined;
          const hint = suggestion ? ` — did you mean "${suggestion}"?` : "";
          issues.push({
            tabIdx, rowIdx: i, kind: "orphan", colKey: req.key, colLabel: req.label,
            suggestion,
            reason: `"${id}" doesn't match any existing Project or Opportunity${hint} Check the ID, or import that record first`,
          });
        }
      });
    });
  }

  return issues;
}
