// ── Upload review grid ────────────────────────────────────────────────────
// Replaces the old blocking validation popups ("Exact duplicate rows found",
// "Some values aren't valid", missing-ID and mismatched-ID dialogs) with one
// Excel-style review table, modeled on the data-cleaning "— Review" sheets:
//   • one tab per module sheet (Projects / Team Assignments / Schedule)
//   • only the rows that need attention, but with EVERY column visible
//   • fix bad values right in the table (dropdowns for option columns)
//   • a Decision column per row — Include in import / Skip this row
//   • a Remarks column explaining exactly why the row was flagged
// Nothing is imported until the user works through EVERY tab: the footer
// buttons are a per-tab stepper — "Skip all on this tab" / "Include all on
// this tab" apply ONLY to the current tab's flagged rows and then move to
// the next tab; the import itself only fires from the LAST tab's buttons.
// Errors never hard-block (EXCEPTION: strict-key violations on strictKeys
// surfaces — the server rejects the whole upload over one such row, so those
// must be fixed or skipped; the Continue-time gate enforces it):
// "Include all" is otherwise an explicit override that
// imports flagged rows as-is (the server still validates); "Skip all"
// drops them instead. Only the orphan safety net (skipping a parent row
// leaves child rows pointing at nothing) pulls rows back for one more
// decision.
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Search, X,
} from "lucide-react";
import { Table2 as PeekTableIcon } from "lucide-react";
import {
  type ColDef, type Row, type TabDef, type ReviewIssue, type ReviewIssueKind, type DbRefCheck,
  STATUS_OPTS, scanAllIssues, REQUIRED_ID_BY_CARD, REQUIRED_COMPANY_BY_CARD,
  REQUIRED_ID_BY_CARD_STRICT,
} from "@/lib/importValidation";

const BRAND_GREEN = "#6BA539";

// Suggested starting ID shown in the auto-fill prompt, per module. Standard
// module prefixes so resolveTicketMod routes them correctly; the user can
// type any pattern they like (their value is used verbatim).
const AUTOFILL_SAMPLE: Record<string, string> = {
  projects: "PMM-001",
  opportunities: "OPM-001",
  leads: "LEM-001",
  companies: "COM-001",
};

const COMPANY_NAME_KEY_BY_CARD: Record<string, string> = {
  projects: "companyName",
  opportunities: "opp_company",
  leads: "ld_company",
  companies: "co_name",
};

// "LEM-001" → LEM-001, LEM-002, … (trailing digits set the start number and
// zero-padding). A pattern without trailing digits starts at 001.
function buildSequentialIds(pattern: string, count: number): string[] | null {
  const p = pattern.trim();
  if (!p) return null;
  const m = p.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1] : p;
  const start = m ? parseInt(m[2], 10) : 1;
  const pad = m ? m[2].length : 3;
  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(pad, "0")}`);
}

function buildSequentialIdsSkipping(pattern: string, count: number, reserved: Set<string>): string[] | null {
  const p = pattern.trim();
  if (!p) return null;
  const m = p.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1] : p;
  let next = m ? parseInt(m[2], 10) : 1;
  const pad = m ? m[2].length : 3;
  const out: string[] = [];
  while (out.length < count && next < Number.MAX_SAFE_INTEGER) {
    const candidate = `${prefix}${String(next).padStart(pad, "0")}`;
    next++;
    if (reserved.has(candidate.toLowerCase())) continue;
    reserved.add(candidate.toLowerCase());
    out.push(candidate);
  }
  return out.length === count ? out : null;
}

function normalizedCompanyName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface SheetData { cols: ColDef[]; rows: Row[]; sheetName: string }

type Decision = "include" | "skip";
const PAGE_SIZE = 100;

const rowKeyOf = (tabIdx: number, rowIdx: number) => `${tabIdx}:${rowIdx}`;

// ── Single editable cell ──────────────────────────────────────────────────
// Local draft state so typing doesn't re-run the full-file scan on every
// keystroke — the value commits on blur or Enter.
function EditCell({ col, value, invalid, onCommit }: {
  col: ColDef;
  value: string;
  invalid: string | null;      // current validation error for this cell (null = fine)
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const isHardSelect = (col.type === "select" || col.type === "status") && !col.softOpts;
  const opts = col.type === "status" ? STATUS_OPTS : (col.opts ?? []);

  const base = "w-full h-7 rounded border px-1.5 text-[11px] focus:outline-none focus:ring-1 transition-colors";
  const tone = invalid
    ? "border-red-300 bg-red-50 text-red-800 focus:ring-red-300"
    : "border-gray-200 bg-white text-gray-800 focus:ring-indigo-300";

  if (isHardSelect && opts.length) {
    // Keep the current value visible in the list so the select doesn't
    // silently blank it. Status values are tenant-defined and accepted
    // verbatim (no "(not allowed)" marker); for other hard selects the
    // marker flags a value that still needs fixing.
    const hasCurrent = !shown || opts.some(o => o.toLowerCase() === shown.trim().toLowerCase());
    return (
      <select
        value={shown}
        onChange={e => onCommit(e.target.value)}
        className={`${base} ${tone} cursor-pointer`}
        title={invalid ?? col.label}
      >
        <option value="">— blank —</option>
        {!hasCurrent && <option value={shown}>{col.type === "status" ? shown : `${shown} (not allowed)`}</option>}
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input
      value={shown}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); }}
      onKeyDown={e => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
      placeholder={col.type === "date" ? "2026-03-15" : col.type === "currency" ? "1500000" : ""}
      className={`${base} ${tone}`}
      title={invalid ?? col.label}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function ImportReviewGrid({ tabs, data, cardId, clientHasData, rowNumOffset = 1, dbRefCheck = null, embedded = false, strictKeys = false, onCancel, onContinue, onPeekGrid }: {
  tabs: TabDef[];
  data: SheetData[];                    // submit-time snapshot, index-aligned with tabs
  cardId: string;
  clientHasData: boolean;
  // 2 for file uploads (# column matches Excel's row numbers — Excel counts
  // the header line as row 1), 1 for rows typed into the grid by hand.
  rowNumOffset?: number;
  // DB-backed Project/Opp ID check for the standalone Assignments/Schedule
  // cards (null = ID list unavailable → check skipped, server guard remains).
  // Deliberately NOT part of the Continue-time orphan safety net: a DB-unknown
  // ID can't be fixed by skipping other rows, so re-flagging it there would
  // loop forever — "Include" sends it to the server, which validates again.
  dbRefCheck?: DbRefCheck | null;
  /** Render inline (inside the import wizard) instead of as a fixed overlay. */
  embedded?: boolean;
  /** Mirror the caller's strict-keys scan so flags found at the submit gate
   *  (missing Company ID, name-without-email) don't vanish from this review's
   *  own re-scans — the issue lists here are re-derived, not passed in. */
  strictKeys?: boolean;
  onCancel: () => void;
  onContinue: (fixed: SheetData[]) => void;
  /** Open a read-only popup of the FULL submitted data for a tab — the wizard
   *  covers the grid, so judging duplicates needs a way to see the real rows.
   *  Receives the tab index and the data-row indices to highlight. */
  onPeekGrid?: (tabIdx: number, highlightRowIdxs: number[]) => void;
}) {
  // Edits keyed by row, then column — applied over the snapshot, never
  // written back to the underlying grid state (indices there can shift).
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Rows the Continue-time safety re-scan flagged AFTER the initial scan
  // (e.g. an edited ID no longer matches, or skipping a Projects row
  // orphaned its assignments). They join the table like any other row.
  const [extraRowKeys, setExtraRowKeys] = useState<Set<string>>(new Set());
  const [rescanNotice, setRescanNotice] = useState<string | null>(null);
  // "Apply to all identical values" prompt after a cell edit.
  const [bulkPrompt, setBulkPrompt] = useState<{
    tabIdx: number; colKey: string; colLabel: string; oldVal: string; newVal: string; rowIdxs: number[];
  } | null>(null);

  // Rows with edits applied — the single source every scan/render reads.
  const effective = useMemo<SheetData[]>(() => data.map((d, tabIdx) => ({
    ...d,
    rows: d.rows.map((r, rowIdx) => {
      const e = edits[rowKeyOf(tabIdx, rowIdx)];
      return e ? { ...r, ...e } : r;
    }),
  })), [data, edits]);

  // Initial scan — frozen: this defines which rows are "review rows".
  // (data is a stable snapshot prop, so this runs once per open.)
  const initialIssues = useMemo(
    () => scanAllIssues(cardId, tabs.map((t, i) => ({ tab: t, rows: data[i].rows })), clientHasData, { rowNumOffset, dbRefs: dbRefCheck, strictKeys }),
    [cardId, tabs, data, clientHasData, rowNumOffset, dbRefCheck, strictKeys],
  );

  // Initial issues grouped by row — the live scan excludes skip-decision rows
  // entirely, so a skipped row has no "current" issues. The Remarks column
  // falls back to these frozen reasons so a skipped row still explains WHY it
  // was flagged instead of showing a bare "Will be skipped".
  const initialByRow = useMemo(() => {
    const m = new Map<string, ReviewIssue[]>();
    for (const iss of initialIssues) {
      const k = rowKeyOf(iss.tabIdx, iss.rowIdx);
      const arr = m.get(k) ?? [];
      arr.push(iss);
      m.set(k, arr);
    }
    return m;
  }, [initialIssues]);

  // Default decision per row: rows that were flagged ONLY as duplicates or
  // orphans start as Skip (matches the old behavior exactly — one click
  // through reproduces "Skip duplicates & continue" + the silent orphan
  // drop, but now the user can see and override each row).
  const defaultDecision = useMemo(() => {
    const kindsByRow = new Map<string, Set<string>>();
    for (const iss of initialIssues) {
      const k = rowKeyOf(iss.tabIdx, iss.rowIdx);
      const s = kindsByRow.get(k) ?? new Set<string>();
      s.add(iss.kind);
      kindsByRow.set(k, s);
    }
    const m = new Map<string, Decision>();
    for (const [k, kinds] of kindsByRow) {
      const onlySkippable = [...kinds].every(x => x === "duplicate" || x === "orphan");
      m.set(k, onlySkippable ? "skip" : "include");
    }
    return m;
  }, [initialIssues]);

  const decisionOf = (k: string): Decision => decisions[k] ?? defaultDecision.get(k) ?? "include";

  // Live scan — reruns when an edit or a decision commits. It scans ONLY the
  // rows that will actually be imported (skip-decision rows are removed
  // first), so it always agrees with the Continue-time re-scan: skipping a
  // Projects row immediately flags its child rows as orphaned, and skipping
  // one exact duplicate clears its twin's flag. Issue row indices are mapped
  // back to snapshot positions for display.
  const currentIssues = useMemo(() => {
    const keptIdx: number[][] = [];
    const kept = tabs.map((t, tabIdx) => {
      const idxs: number[] = [];
      const rows = effective[tabIdx].rows.filter((_, rowIdx) => {
        const k = rowKeyOf(tabIdx, rowIdx);
        const keep = (decisions[k] ?? defaultDecision.get(k) ?? "include") !== "skip";
        if (keep) idxs.push(rowIdx);
        return keep;
      });
      keptIdx.push(idxs);
      return { tab: t, rows };
    });
    // rowNums maps each KEPT row back to its display number (snapshot
    // position + offset) so "Exact copy of row N" stays accurate even
    // after earlier rows were skipped out of the scan.
    const rowNums = keptIdx.map(idxs => idxs.map(i => i + rowNumOffset));
    return scanAllIssues(cardId, kept, clientHasData, { rowNumOffset, rowNums, dbRefs: dbRefCheck, strictKeys }).map(iss => ({
      ...iss,
      rowIdx: keptIdx[iss.tabIdx]?.[iss.rowIdx] ?? iss.rowIdx,
    }));
  }, [cardId, tabs, effective, clientHasData, decisions, defaultDecision, rowNumOffset, dbRefCheck, strictKeys]);
  const currentByRow = useMemo(() => {
    const m = new Map<string, ReviewIssue[]>();
    for (const iss of currentIssues) {
      const k = rowKeyOf(iss.tabIdx, iss.rowIdx);
      const arr = m.get(k) ?? [];
      arr.push(iss);
      m.set(k, arr);
    }
    return m;
  }, [currentIssues]);

  // The review row set: initially-flagged rows + any re-scan additions +
  // any rows the live scan flags (an edit can create a brand-new issue).
  const reviewRowKeys = useMemo(() => {
    const s = new Set<string>();
    for (const iss of initialIssues) s.add(rowKeyOf(iss.tabIdx, iss.rowIdx));
    for (const k of extraRowKeys) s.add(k);
    for (const iss of currentIssues) s.add(rowKeyOf(iss.tabIdx, iss.rowIdx));
    return s;
  }, [initialIssues, extraRowKeys, currentIssues]);

  // A row is resolved when it's skipped, or included with no outstanding
  // problems (a kept exact-duplicate is the user's explicit choice, and a
  // new access level is created in the next wizard step — only real
  // value/ID problems block the import).
  const blockingIssues = (k: string) => (currentByRow.get(k) ?? []).filter(i => i.kind !== "duplicate" && i.kind !== "newOption");
  const isResolved = (k: string) => decisionOf(k) === "skip" || blockingIssues(k).length === 0;

  // Per-tab review rows, sorted by row number.
  const rowsByTab = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const k of reviewRowKeys) {
      const [t, r] = k.split(":").map(Number);
      const arr = m.get(t) ?? [];
      arr.push(r);
      m.set(t, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  }, [reviewRowKeys]);

  const tabIdxsWithRows = useMemo(
    () => tabs.map((_, i) => i).filter(i => (rowsByTab.get(i) ?? []).length > 0),
    [tabs, rowsByTab],
  );
  const [activeTabIdx, setActiveTabIdx] = useState<number>(() => tabIdxsWithRows[0] ?? 0);
  const curTabIdx = tabIdxsWithRows.includes(activeTabIdx) ? activeTabIdx : (tabIdxsWithRows[0] ?? 0);
  const [pageByTab, setPageByTab] = useState<Record<number, number>>({});
  // Per-tab search over the review rows (search only finds rows — the bulk
  // footer buttons always act on the WHOLE tab, not the filtered subset).
  const [searchByTab, setSearchByTab] = useState<Record<number, string>>({});

  // Stepper position + gating. A tab counts as "stepped" only after one of
  // the footer buttons was clicked on it — merely clicking around the tab
  // strip does NOT count, so jumping straight to the last tab can't one-click
  // import rows the user never looked at. Import unlocks only when every
  // OTHER tab with rows has been stepped through.
  const stepPos = Math.max(0, tabIdxsWithRows.indexOf(curTabIdx));
  const [steppedTabs, setSteppedTabs] = useState<Set<number>>(new Set());
  const isFinalStep = tabIdxsWithRows.every(ti => ti === curTabIdx || steppedTabs.has(ti));
  // Row keys whose Decision came from a bulk footer click (not hand-picked).
  // Re-clicking a bulk button on a revisited tab overrides THESE rows too,
  // so "Previous tab" + the opposite button actually undoes a bulk choice.
  const bulkAppliedRef = useRef<Set<string>>(new Set());

  // Breakdown of issue kinds for the header summary: "14 exact duplicates · 2 invalid values"
  // A row may have multiple kinds; each bucket counts distinct rows with ≥1 issue of that kind.
  const kindSummary = useMemo(() => {
    const byKind = new Map<ReviewIssueKind, Set<string>>();
    for (const iss of initialIssues) {
      const k = rowKeyOf(iss.tabIdx, iss.rowIdx);
      const s = byKind.get(iss.kind) ?? new Set<string>();
      s.add(k);
      byKind.set(iss.kind, s);
    }
    const order: ReviewIssueKind[] = ["duplicate", "spanConflict", "sameId", "invalid", "newOption", "missingId", "orphan"];
    const labels: Record<ReviewIssueKind, [string, string]> = {
      duplicate:    ["exact duplicate",          "exact duplicates"],
      spanConflict: ["same-span hour conflict",  "same-span hour conflicts"],
      sameId:       ["row sharing an ID",        "rows sharing an ID"],
      invalid:      ["invalid value",            "invalid values"],
      newOption:    ["new access level",         "new access levels"],
      missingId:    ["missing ID",               "missing IDs"],
      orphan:       ["orphaned row",             "orphaned rows"],
    };
    const parts: string[] = [];
    for (const kind of order) {
      const n = byKind.get(kind)?.size ?? 0;
      if (n > 0) parts.push(`${n.toLocaleString()} ${labels[kind][n === 1 ? 0 : 1]}`);
    }
    return parts;
  }, [initialIssues]);

  const unresolvedCount = useMemo(
    () => [...reviewRowKeys].filter(k => !isResolved(k)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewRowKeys, decisions, defaultDecision, currentByRow],
  );
  const skippedCount = useMemo(
    () => [...reviewRowKeys].filter(k => decisionOf(k) === "skip").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewRowKeys, decisions, defaultDecision],
  );

  const totalRows = data.reduce((s, d, i) => s + d.rows.filter(r => tabs[i].cols.some(c => (r[c.key] ?? "").trim())).length, 0);
  const willImport = totalRows - skippedCount;

  // ── Edit commit + "apply to all identical" ──────────────────────────────
  const commitEdit = (tabIdx: number, rowIdx: number, colKey: string, colLabel: string, newVal: string) => {
    const k = rowKeyOf(tabIdx, rowIdx);
    const oldVal = (effective[tabIdx].rows[rowIdx][colKey] ?? "").trim();
    setEdits(prev => ({ ...prev, [k]: { ...(prev[k] ?? {}), [colKey]: newVal } }));
    setRescanNotice(null);
    // Offer to fix the SAME wrong value on every other flagged row in this
    // tab+column (e.g. Status "Awarded Final Pricing Approved" on 500 rows).
    if (oldVal && newVal.trim() && newVal.trim() !== oldVal) {
      const siblings: number[] = [];
      for (const rIdx of rowsByTab.get(tabIdx) ?? []) {
        if (rIdx === rowIdx) continue;
        const rk = rowKeyOf(tabIdx, rIdx);
        const v = (effective[tabIdx].rows[rIdx][colKey] ?? "").trim();
        const hasIssueHere = (currentByRow.get(rk) ?? []).some(i => i.colKey === colKey);
        if (v === oldVal && hasIssueHere) siblings.push(rIdx);
      }
      if (siblings.length > 0) {
        setBulkPrompt({ tabIdx, colKey, colLabel, oldVal, newVal: newVal.trim(), rowIdxs: siblings });
        return;
      }
    }
    setBulkPrompt(null);
  };

  const applyBulk = () => {
    if (!bulkPrompt) return;
    setEdits(prev => {
      const next = { ...prev };
      for (const rIdx of bulkPrompt.rowIdxs) {
        const k = rowKeyOf(bulkPrompt.tabIdx, rIdx);
        next[k] = { ...(next[k] ?? {}), [bulkPrompt.colKey]: bulkPrompt.newVal };
      }
      return next;
    });
    setBulkPrompt(null);
  };

  // ── Auto-fill IDs ────────────────────────────────────────────────────────
  // Offered ONLY when the module's ID column is blank on EVERY populated row
  // of the main tab. If even one row already has an ID (in the file or typed
  // here), the offer disappears — the file follows the client's own numbering
  // and minted defaults must never be mixed with real ERP ids (same rule as
  // the data-cleaning engine's sequential mint). Not offered for the team
  // card (its ID is a login email) or for child tabs (their Project ID must
  // reference a parent row, not start a fresh sequence).
  const curTab = tabs[curTabIdx];
  const autoFillInfo = useMemo(() => {
    const sample = AUTOFILL_SAMPLE[cardId];
    const req = REQUIRED_ID_BY_CARD[cardId];
    if (!sample || !req || !curTab || curTab.id !== "main") return null;
    const rows = effective[curTabIdx]?.rows ?? [];
    const rowIdxs: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!curTab.cols.some(c => (r[c.key] ?? "").trim())) continue;
      if ((r[req.key] ?? "").trim()) return null; // one real ID exists → keep the user's numbering
      rowIdxs.push(i);
    }
    return rowIdxs.length ? { key: req.key, label: req.label, sample, rowIdxs } : null;
  }, [cardId, curTab, effective, curTabIdx]);

  // null = prompt closed; string = the starting-ID draft being typed.
  const [autoFillDraft, setAutoFillDraft] = useState<string | null>(null);

  const applyAutoFill = () => {
    if (!autoFillInfo || autoFillDraft === null) return;
    const ids = buildSequentialIds(autoFillDraft, autoFillInfo.rowIdxs.length);
    if (!ids) return;
    setEdits(prev => {
      const next = { ...prev };
      autoFillInfo.rowIdxs.forEach((rIdx, i) => {
        const k = rowKeyOf(curTabIdx, rIdx);
        next[k] = { ...(next[k] ?? {}), [autoFillInfo.key]: ids[i] };
      });
      return next;
    });
    setAutoFillDraft(null);
    setBulkPrompt(null);
    setRescanNotice(null);
  };

  // Company IDs are different from record IDs: many project rows can name the
  // same company. Reuse an ID already present for that company, and generate
  // one new ID per distinct company name rather than one per row.
  const companyAutoFillInfo = useMemo(() => {
    if (!strictKeys || !curTab || curTab.id !== "main") return null;
    const req = cardId === "companies"
      ? REQUIRED_ID_BY_CARD_STRICT.companies
      : REQUIRED_COMPANY_BY_CARD[cardId];
    const nameKey = COMPANY_NAME_KEY_BY_CARD[cardId];
    if (!req || !nameKey) return null;
    const rows = effective[curTabIdx]?.rows ?? [];
    const rowIdxs: number[] = [];
    const existingByName = new Map<string, string>();
    const ambiguousNames = new Set<string>();
    const reservedIds = new Set<string>();
    let missingRowCount = 0;
    let blankNameCount = 0;
    for (const row of rows) {
      const populated = curTab.cols.some(c => (row[c.key] ?? "").trim());
      if (!populated) continue;
      const companyId = (row[req.key] ?? "").trim();
      const companyName = (row[nameKey] ?? "").trim();
      if (companyId) {
        reservedIds.add(companyId.toLowerCase());
        if (companyName) {
          const normalizedName = normalizedCompanyName(companyName);
          const prior = existingByName.get(normalizedName);
          if (prior && prior.toLowerCase() !== companyId.toLowerCase()) ambiguousNames.add(normalizedName);
          else if (!prior) existingByName.set(normalizedName, companyId);
        }
      }
    }
    let ambiguousNameCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const populated = curTab.cols.some(c => (row[c.key] ?? "").trim());
      if (!populated || (row[req.key] ?? "").trim()) continue;
      missingRowCount++;
      const companyName = (row[nameKey] ?? "").trim();
      if (!companyName) {
        blankNameCount++;
        continue;
      }
      if (ambiguousNames.has(normalizedCompanyName(companyName))) {
        ambiguousNameCount++;
        continue;
      }
      rowIdxs.push(i);
    }
    if (!rowIdxs.length) return null;
    const newNames = new Set<string>();
    for (const rowIdx of rowIdxs) {
      const key = normalizedCompanyName(rows[rowIdx][nameKey] ?? "");
      if (key && !existingByName.has(key)) newNames.add(key);
    }
    return {
      key: req.key,
      label: req.label,
      nameKey,
      rowIdxs,
      existingByName,
      reservedIds,
      newNameCount: newNames.size,
      missingRowCount,
      blankNameCount,
      ambiguousNameCount,
    };
  }, [cardId, curTab, curTabIdx, effective, strictKeys]);

  const [companyAutoFillDraft, setCompanyAutoFillDraft] = useState<string | null>(null);

  const applyCompanyAutoFill = () => {
    if (!companyAutoFillInfo) return;
    const generated = buildSequentialIdsSkipping(
      companyAutoFillDraft ?? AUTOFILL_SAMPLE.companies,
      companyAutoFillInfo.newNameCount,
      new Set(companyAutoFillInfo.reservedIds),
    );
    if (companyAutoFillInfo.newNameCount > 0 && !generated) return;
    let generatedIndex = 0;
    const idsByName = new Map<string, string>();
    setEdits(prev => {
      const next = { ...prev };
      for (const rIdx of companyAutoFillInfo.rowIdxs) {
        const row = effective[curTabIdx]?.rows[rIdx];
        if (!row) continue;
        const nameKey = normalizedCompanyName(row[companyAutoFillInfo.nameKey] ?? "");
        let id = companyAutoFillInfo.existingByName.get(nameKey) ?? idsByName.get(nameKey);
        if (!id) {
          id = generated?.[generatedIndex++];
          if (id) idsByName.set(nameKey, id);
        }
        if (!id) continue;
        const key = rowKeyOf(curTabIdx, rIdx);
        next[key] = { ...(next[key] ?? {}), [companyAutoFillInfo.key]: id };
      }
      return next;
    });
    setCompanyAutoFillDraft(null);
    setBulkPrompt(null);
    setRescanNotice(null);
  };

  // ── Continue: apply the one-click tab decision, orphan check, hand off ──
  // Per-tab stepper: mode "include" = keep this tab's flagged rows as-is —
  // an explicit override, even for required-field errors (the server still
  // validates every row). mode "skip" = leave this tab's flagged rows out.
  // Rows where the user already picked a Decision by hand keep that choice;
  // rows a previous bulk click decided can be re-decided by another bulk
  // click (tracked in bulkAppliedRef). Until every OTHER tab with rows has
  // been stepped through, the buttons commit this tab's decisions and move
  // to the next un-stepped tab — nothing is imported. Only the final step
  // runs the orphan safety net and hands the rows off for import.
  const handleContinue = (mode: Decision) => {
    const nextDecisions: Record<string, Decision> = { ...decisions };
    for (const rIdx of rowsByTab.get(curTabIdx) ?? []) {
      const k = rowKeyOf(curTabIdx, rIdx);
      // Hand-picked decisions win; undecided rows AND rows a previous bulk
      // click decided both take the new mode (lets a revisit change course).
      if (decisions[k] === undefined || bulkAppliedRef.current.has(k)) {
        nextDecisions[k] = mode;
        bulkAppliedRef.current.add(k);
      }
    }
    if (!isFinalStep) {
      // Commit this tab's decisions and move to the next un-stepped tab. The
      // live scan re-runs off the committed decisions, so skipping parent
      // rows here immediately flags newly-orphaned child rows on other tabs.
      setDecisions(nextDecisions);
      setSteppedTabs(prev => new Set(prev).add(curTabIdx));
      setBulkPrompt(null);
      setRescanNotice(null);
      const next = tabIdxsWithRows.find(ti => ti > curTabIdx && !steppedTabs.has(ti))
        ?? tabIdxsWithRows.find(ti => ti !== curTabIdx && !steppedTabs.has(ti));
      if (next !== undefined) setActiveTabIdx(next);
      return;
    }
    const decOf = (k: string): Decision => nextDecisions[k] ?? defaultDecision.get(k) ?? "include";
    // Drop skipped rows; keep a map back to original indices so re-scan
    // findings can rejoin the table under their original row numbers.
    const keptIdx: number[][] = [];
    const fixed: SheetData[] = effective.map((d, tabIdx) => {
      const kept: Row[] = [];
      const idxs: number[] = [];
      d.rows.forEach((r, rowIdx) => {
        if (decOf(rowKeyOf(tabIdx, rowIdx)) === "skip") return;
        kept.push(r);
        idxs.push(rowIdx);
      });
      keptIdx.push(idxs);
      return { ...d, rows: kept };
    });
    // Empty-import guard: if every row across every tab ended up skipped,
    // there is nothing left to import — proceeding would run a do-nothing
    // job that still reports "complete" (user-reported confusion: "Skip all"
    // on a fully-flagged file imported nothing, silently). Block WITHOUT
    // committing the bulk decision (same transient pattern as the nets
    // below) so the next click re-applies cleanly.
    if (fixed.every(d => d.rows.length === 0)) {
      setRescanNotice(
        "Nothing would be imported — every row is set to be left out. " +
        "Switch at least one row back to \"Include in import\" (or use \"Keep these rows & import\"), " +
        "or Cancel to go back to the grid.",
      );
      return;
    }
    // Strict-key gate (strictKeys surfaces): the server's update-mode gate
    // rejects the WHOLE upload over one row missing its identity key, so
    // "Include" is not a valid override for these — every included row must
    // carry its keys or be skipped. Re-scanned on the kept rows so fixes and
    // skips clear it live; blocks Continue WITHOUT committing the bulk
    // decision (same pattern as the orphan net below).
    if (strictKeys) {
      const strictLeft = scanAllIssues(
        cardId, tabs.map((t, i) => ({ tab: t, rows: fixed[i].rows })), clientHasData,
        { skipDuplicates: true, rowNumOffset, strictKeys: true },
      ).filter(iss => iss.strict);
      if (strictLeft.length > 0) {
        const mapped = strictLeft.map(iss => rowKeyOf(iss.tabIdx, keptIdx[iss.tabIdx][iss.rowIdx]));
        setExtraRowKeys(prev => new Set([...prev, ...mapped]));
        setRescanNotice(
          `${new Set(mapped).size.toLocaleString()} included row${new Set(mapped).size !== 1 ? "s are" : " is"} still missing a required ID or email — ` +
          "records, companies and people are matched by ID/email only, and the server rejects the whole upload over a single row without one. " +
          "Fix those rows (the Remarks column names the column) or set them to \"Skip this row\", then continue again.",
        );
        return;
      }
    }
    // Orphan safety net only: skipping a parent row can leave child rows
    // pointing at nothing — those rejoin the table for one more decision.
    // Value/ID errors never block here; including them is the user's call —
    // EXCEPT strict-key violations, gated above.
    const remaining = scanAllIssues(
      cardId, tabs.map((t, i) => ({ tab: t, rows: fixed[i].rows })), clientHasData,
      { skipDuplicates: true, rowNumOffset },
    ).filter(iss => iss.kind === "orphan");
    if (remaining.length > 0) {
      // Abort WITHOUT committing the bulk decision: it stays transient for
      // this attempt, so the next button click re-applies cleanly (otherwise
      // the bulk choice masquerades as hand-picked decisions and the same
      // orphan notice loops forever). Orphan rows default to "include" via
      // decisionOf's fallback — no forced decision needed.
      const mapped = remaining.map(iss => rowKeyOf(iss.tabIdx, keptIdx[iss.tabIdx][iss.rowIdx]));
      setExtraRowKeys(prev => new Set([...prev, ...mapped]));
      setRescanNotice(
        `${mapped.length.toLocaleString()} more row${remaining.length !== 1 ? "s" : ""} need${remaining.length === 1 ? "s" : ""} a look — ` +
        "skipping some rows left these pointing at nothing. Include or skip them, then continue again.",
      );
      return;
    }
    setDecisions(nextDecisions);
    onContinue(fixed);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const tab = tabs[curTabIdx];
  const sheet = effective[curTabIdx];
  const tabRowIdxs = rowsByTab.get(curTabIdx) ?? [];
  // Search filters which rows are LISTED — bulk footer actions still cover
  // the whole tab. Matches any data cell (case-insensitive) or the row number.
  const searchQ = (searchByTab[curTabIdx] ?? "").trim().toLowerCase();
  const visibleRowIdxs = useMemo(() => {
    if (!searchQ) return tabRowIdxs;
    const cols = tabs[curTabIdx]?.cols ?? [];
    const rows = effective[curTabIdx]?.rows ?? [];
    return tabRowIdxs.filter(rIdx =>
      String(rIdx + rowNumOffset) === searchQ ||
      cols.some(c => (rows[rIdx]?.[c.key] ?? "").toLowerCase().includes(searchQ)));
  }, [searchQ, tabRowIdxs, tabs, curTabIdx, effective, rowNumOffset]);
  const pageCount = Math.max(1, Math.ceil(visibleRowIdxs.length / PAGE_SIZE));
  const page = Math.min(pageByTab[curTabIdx] ?? 0, pageCount - 1);
  const pageRows = visibleRowIdxs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Put the mandatory ID column first so it sits right next to the row number.
  const idKey = (() => {
    const req = tab.id === "main"
      ? { projects: "projectId", opportunities: "opp_erpJob", leads: "ld_id", team: "st_email" }[cardId]
      : { assignments: "asg_projectId", schedule: "sch_projectId" }[tab.id];
    return req ?? null;
  })();
  const orderedCols = useMemo(() => {
    if (!idKey) return tab.cols;
    const idCol = tab.cols.find(c => c.key === idKey);
    return idCol ? [idCol, ...tab.cols.filter(c => c.key !== idKey)] : tab.cols;
  }, [tab, idKey]);

  return (
    <div
      className={embedded
        ? "w-full flex items-stretch justify-center"
        : "fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-3 sm:p-6"}
      style={embedded ? { height: "calc(100vh - 240px)", minHeight: 420 } : undefined}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full h-full max-w-[1500px] max-h-[94vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">
              Review needed — {reviewRowKeys.size.toLocaleString()} row{reviewRowKeys.size !== 1 ? "s" : ""} to look at
              {kindSummary.length > 0 && (
                <span className="font-normal text-gray-500 text-sm ml-1.5">
                  ({kindSummary.join(" · ")})
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-600 mt-0.5">
              Nothing has been imported yet. Fix values right in the table, or set a row's Decision to
              "Skip this row" to leave it out. The Remarks column explains each flag.
              {rowNumOffset === 2 && <b> Row numbers match your Excel file (its first row is the header).</b>}
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Close — nothing is imported">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Module tabs */}
        <div className="flex items-center gap-1 px-5 border-b border-gray-100 shrink-0 overflow-x-auto">
          {tabIdxsWithRows.map(ti => {
            const n = (rowsByTab.get(ti) ?? []).length;
            const open = (rowsByTab.get(ti) ?? []).filter(r => !isResolved(rowKeyOf(ti, r))).length;
            const active = ti === curTabIdx;
            return (
              <button key={ti} onClick={() => setActiveTabIdx(ti)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                  active ? "border-indigo-500 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                {tabs[ti].label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  open > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {open > 0 ? `${open.toLocaleString()} open` : "done"}
                </span>
                <span className="text-[10px] text-gray-400">{n.toLocaleString()} row{n !== 1 ? "s" : ""}</span>
              </button>
            );
          })}
          {/* Per-tab search — filters the listed rows; footer bulk actions
              still cover the whole tab. */}
          <div className="ml-auto flex items-center gap-1.5 py-1.5 pl-3 shrink-0">
            {onPeekGrid && (
              <button
                onClick={() => {
                  // Duplicate rows first: comparing "which is what" is the
                  // whole point of the peek. No duplicates on this tab →
                  // highlight every row under review instead.
                  const all = rowsByTab.get(curTabIdx) ?? [];
                  const dups = all.filter(ri => (initialByRow.get(rowKeyOf(curTabIdx, ri)) ?? []).some(iss => iss.kind === "duplicate" || iss.kind === "sameId"));
                  onPeekGrid(curTabIdx, dups.length ? dups : all);
                }}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-indigo-200 bg-indigo-50 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap"
                title="See your full uploaded data (read-only) — the rows under review are highlighted"
              >
                <PeekTableIcon className="w-3.5 h-3.5" /> View grid
              </button>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={searchByTab[curTabIdx] ?? ""}
                onChange={e => {
                  const v = e.target.value;
                  setSearchByTab(prev => ({ ...prev, [curTabIdx]: v }));
                  setPageByTab(prev => ({ ...prev, [curTabIdx]: 0 }));
                }}
                placeholder={`Search ${tabs[curTabIdx]?.label ?? "this tab"}…`}
                className="h-7 w-52 rounded-md border border-gray-200 bg-white pl-7 pr-6 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
              {(searchByTab[curTabIdx] ?? "") && (
                <button
                  onClick={() => setSearchByTab(prev => ({ ...prev, [curTabIdx]: "" }))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {searchQ && (
              <span className="text-[10px] text-gray-500 whitespace-nowrap">
                {visibleRowIdxs.length.toLocaleString()} of {tabRowIdxs.length.toLocaleString()} row{tabRowIdxs.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Bulk-fix prompt */}
        {bulkPrompt && (
          <div className="flex items-center gap-3 px-5 py-2 bg-indigo-50 border-b border-indigo-100 shrink-0">
            <span className="text-xs text-indigo-800">
              Change <b>{bulkPrompt.colLabel}</b> from "{bulkPrompt.oldVal}" to "{bulkPrompt.newVal}" on{" "}
              <b>{bulkPrompt.rowIdxs.length.toLocaleString()} more row{bulkPrompt.rowIdxs.length !== 1 ? "s" : ""}</b> with the same value?
            </span>
            <button onClick={applyBulk}
              className="text-[11px] font-semibold text-white rounded-md px-2.5 py-1 hover:opacity-90"
              style={{ backgroundColor: BRAND_GREEN }}>
              Yes, fix them all
            </button>
            <button onClick={() => setBulkPrompt(null)}
              className="text-[11px] font-medium text-gray-500 hover:text-gray-800">
              No, just this one
            </button>
          </div>
        )}

        {/* Auto-fill IDs offer — only when NO row in the file has an ID */}
        {autoFillInfo && (
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-2 bg-sky-50 border-b border-sky-100 shrink-0">
            {autoFillDraft === null ? (
              <>
                <span className="text-xs text-sky-900">
                  No row in this file has a <b>{autoFillInfo.label}</b> yet. Want us to number them all for you?
                </span>
                <button
                  onClick={() => setAutoFillDraft(autoFillInfo.sample)}
                  className="text-[11px] font-semibold text-white rounded-md px-2.5 py-1 hover:opacity-90"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  Fill {autoFillInfo.label}s automatically
                </button>
              </>
            ) : (
              <>
                <span className="text-xs font-medium text-sky-900 dark:text-sky-300">Starting ID:</span>
                <input
                  value={autoFillDraft}
                  onChange={e => setAutoFillDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") applyAutoFill();
                    if (e.key === "Escape") setAutoFillDraft(null);
                  }}
                  placeholder={autoFillInfo.sample}
                  autoFocus
                  className="h-7 w-32 rounded border border-sky-300 bg-white px-2 text-[11px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-sky-400 dark:bg-gray-800 dark:text-gray-100 dark:border-sky-600 dark:placeholder:text-gray-500 dark:focus:ring-sky-500"
                />
                <span className="text-[11px] text-sky-700 dark:text-sky-400">
                  {(() => {
                    const n = autoFillInfo.rowIdxs.length;
                    const preview = buildSequentialIds(autoFillDraft, Math.min(3, n));
                    return preview
                      ? <>→ {preview.join(", ")}{n > 3 ? ", …" : ""} for all {n.toLocaleString()} row{n !== 1 ? "s" : ""}, top to bottom</>
                      : <>Type a starting ID, e.g. {autoFillInfo.sample}</>;
                  })()}
                </span>
                <button
                  onClick={applyAutoFill}
                  disabled={!autoFillDraft.trim()}
                  className="text-[11px] font-semibold text-white rounded-md px-2.5 py-1 hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  Fill {autoFillInfo.rowIdxs.length.toLocaleString()} ID{autoFillInfo.rowIdxs.length !== 1 ? "s" : ""}
                </button>
                <button
                  onClick={() => setAutoFillDraft(null)}
                  className="text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
                {clientHasData && (
                  <span className="w-full text-[11px] text-amber-700 dark:text-amber-400">
                    Heads up: your workspace already has records. If one of these IDs is already
                    in use, that existing record will be updated — pick a starting ID you know is new.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Company IDs are required on recurring/update imports. Unlike a
            project ID, one company ID must be shared by every row with the
            same company name, so this offer groups names before numbering. */}
        {companyAutoFillInfo && (
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-2 bg-emerald-50 border-b border-emerald-100 shrink-0">
            {companyAutoFillDraft === null ? (
              <>
                <span className="text-xs text-emerald-900">
                  {companyAutoFillInfo.missingRowCount.toLocaleString()} populated row{companyAutoFillInfo.missingRowCount !== 1 ? "s are" : " is"} missing a <b>Company ID</b>.
                  {" "}{companyAutoFillInfo.newNameCount > 0
                    ? <>We can assign one ID to each of the {companyAutoFillInfo.newNameCount.toLocaleString()} new compan{companyAutoFillInfo.newNameCount === 1 ? "y" : "ies"}.</>
                    : <>We can reuse the matching Company IDs already in this file.</>}
                </span>
                <button
                  onClick={() => {
                    if (companyAutoFillInfo.newNameCount === 0) applyCompanyAutoFill();
                    else setCompanyAutoFillDraft(AUTOFILL_SAMPLE.companies);
                  }}
                  className="text-[11px] font-semibold text-white rounded-md px-2.5 py-1 hover:opacity-90"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  {companyAutoFillInfo.newNameCount > 0 ? "Prefill Company IDs" : "Fill matching Company IDs"}
                </button>
                {companyAutoFillInfo.blankNameCount > 0 && (
                  <span className="w-full text-[11px] text-amber-700">
                    {companyAutoFillInfo.blankNameCount.toLocaleString()} row{companyAutoFillInfo.blankNameCount !== 1 ? "s have" : " has"} no Company Name, so those still need a manual Company ID.
                  </span>
                )}
                {companyAutoFillInfo.ambiguousNameCount > 0 && (
                  <span className="w-full text-[11px] text-amber-700">
                    {companyAutoFillInfo.ambiguousNameCount.toLocaleString()} row{companyAutoFillInfo.ambiguousNameCount !== 1 ? "s use" : " uses"} a company name that already has different IDs in this file, so those are left for manual review.
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-xs font-medium text-emerald-900">Starting Company ID:</span>
                <input
                  value={companyAutoFillDraft}
                  onChange={e => setCompanyAutoFillDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") applyCompanyAutoFill();
                    if (e.key === "Escape") setCompanyAutoFillDraft(null);
                  }}
                  placeholder={AUTOFILL_SAMPLE.companies}
                  autoFocus
                  className="h-7 w-32 rounded border border-emerald-300 bg-white px-2 text-[11px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
                <span className="text-[11px] text-emerald-700">
                  {(() => {
                    const n = companyAutoFillInfo.newNameCount;
                    const preview = buildSequentialIdsSkipping(companyAutoFillDraft, Math.min(3, n), new Set(companyAutoFillInfo.reservedIds));
                    return preview
                      ? <>→ {preview.join(", ")}{n > 3 ? ", …" : ""} for each new company; repeated names share one ID</>
                      : <>Type a starting ID, e.g. {AUTOFILL_SAMPLE.companies}</>;
                  })()}
                </span>
                <button
                  onClick={applyCompanyAutoFill}
                  disabled={!companyAutoFillDraft.trim() || (companyAutoFillInfo.newNameCount > 0 && !buildSequentialIdsSkipping(companyAutoFillDraft, companyAutoFillInfo.newNameCount, new Set(companyAutoFillInfo.reservedIds)))}
                  className="text-[11px] font-semibold text-white rounded-md px-2.5 py-1 hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  Fill {companyAutoFillInfo.rowIdxs.length.toLocaleString()} Company ID{companyAutoFillInfo.rowIdxs.length !== 1 ? "s" : ""}
                </button>
                <button
                  onClick={() => setCompanyAutoFillDraft(null)}
                  className="text-[11px] font-medium text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
                {clientHasData && (
                  <span className="w-full text-[11px] text-amber-700">
                    Heads up: existing records may be updated if a generated Company ID is already in use. Choose a starting ID you know is new.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Re-scan notice */}
        {rescanNotice && (
          <div className="flex items-center gap-2 px-5 py-2 bg-amber-50 border-b border-amber-100 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="text-xs text-amber-800">{rescanNotice}</span>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="border-separate border-spacing-0 text-[11px]" style={{ minWidth: "100%" }}>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap w-12"
                  title={rowNumOffset === 2 ? "Same row number you see in Excel" : undefined}>
                  {rowNumOffset === 2 ? "# (Excel row)" : "#"}
                </th>
                <th className="bg-gray-50 border-b border-r border-gray-200 px-2 py-2 text-left font-semibold text-gray-500" style={{ minWidth: 150 }}>Decision</th>
                <th className="bg-gray-50 border-b border-r border-gray-200 px-2 py-2 text-left font-semibold text-gray-500" style={{ minWidth: 260 }}>Remarks</th>
                {orderedCols.map(c => (
                  <th key={c.key} className="bg-gray-50 border-b border-r border-gray-200 px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap"
                    style={{ minWidth: Math.max(c.w, 90) }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(rowIdx => {
                const k = rowKeyOf(curTabIdx, rowIdx);
                const row = sheet.rows[rowIdx];
                const dec = decisionOf(k);
                const rowIssues = currentByRow.get(k) ?? [];
                const blocking = rowIssues.filter(i => i.kind !== "duplicate" && i.kind !== "spanConflict" && i.kind !== "newOption");
                const dupOnly          = rowIssues.length > 0 && blocking.length === 0 && rowIssues.every(i => i.kind === "duplicate");
                const spanConflictOnly = rowIssues.length > 0 && blocking.length === 0 && rowIssues.every(i => i.kind === "spanConflict");
                const clean = rowIssues.length === 0;
                // Skipped rows are excluded from the live scan, so explain the
                // skip with the frozen initial-scan reason instead.
                const skipWhy = rowIssues[0]?.reason ?? (initialByRow.get(k) ?? [])[0]?.reason ?? null;
                const issueByCol = new Map<string, string>();
                for (const iss of rowIssues) if (iss.colKey) issueByCol.set(iss.colKey, iss.reason);
                const skipped = dec === "skip";
                return (
                  <tr key={k} className={skipped ? "opacity-80" : ""}>
                    <td className="sticky left-0 z-[5] bg-white border-b border-r border-gray-100 px-2 py-1 text-gray-800 font-semibold">{rowIdx + rowNumOffset}</td>
                    <td className="border-b border-r border-gray-100 px-1.5 py-1">
                      <select
                        value={dec}
                        onChange={e => { bulkAppliedRef.current.delete(k); setDecisions(prev => ({ ...prev, [k]: e.target.value as Decision })); setRescanNotice(null); }}
                        className={`w-full h-7 rounded border px-1 text-[11px] font-medium cursor-pointer focus:outline-none ${
                          skipped ? "border-gray-300 bg-gray-100 text-gray-600" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}
                      >
                        <option value="include">Include in import</option>
                        <option value="skip">Skip this row</option>
                      </select>
                    </td>
                    <td className="border-b border-r border-gray-100 px-2 py-1" style={{ minWidth: 260, maxWidth: 380 }}>
                      {skipped ? (
                        <span className="text-gray-800 font-medium">Will be skipped{skipWhy ? ` — ${skipWhy}` : dupOnly ? " — exact duplicate" : spanConflictOnly ? " — same-span conflict" : ""}</span>
                      ) : clean ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3 h-3" /> Ready — will be imported
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          {dupOnly && (() => {
                            // Pull real values out of the row so the note
                            // reads like "Alex Smith on Alston AI Headquarters
                            // (Jan 1 – Dec 31, 2025) — both rows show 40 hrs."
                            const fmtDate = (v: unknown) => {
                              if (!v) return null;
                              const d = new Date(String(v) + (String(v).length === 10 ? "T00:00:00" : ""));
                              return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                            };
                            const person  = String(row.asg_name  ?? row.st_name  ?? "").trim();
                            const project = String(row.asg_project ?? row.asg_projectId ?? "").trim();
                            const hrs     = String(row.asg_totalHours ?? "").trim();
                            const pct     = String(row.asg_pctAlloc ?? "").trim();
                            const start   = fmtDate(row.asg_startDate);
                            const end     = fmtDate(row.asg_endDate);
                            const whoOn   = [person && <span key="p" className="font-semibold">{person}</span>, person && project && " on ", project && <span key="proj" className="font-semibold">{project}</span>].filter(Boolean);
                            const when    = start || end ? ` (${[start, end].filter(Boolean).join(" – ")})` : "";
                            const amount  = hrs  ? <><span className="font-semibold">{hrs} hrs</span></> :
                                            pct  ? <><span className="font-semibold">{pct}%</span></> : null;
                            const doubled = hrs ? <span className="font-semibold">{String(parseFloat(hrs) * 2) + " hrs"}</span> :
                                            pct ? <span className="font-semibold">{String(parseFloat(pct) * 2) + "%"}</span> : null;
                            return (
                              <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-snug space-y-0.5">
                                <div>
                                  {whoOn.length > 0 ? whoOn : <span className="font-semibold">This row</span>}
                                  {when} — both rows show {amount ?? "the same data"}.
                                </div>
                                <div>
                                  <span className="font-semibold">Including won't add them together</span> — only {amount ?? "one copy"} will be saved{doubled ? <>, not {doubled}</> : null}. To get a higher total, use one row with the full hours, or use different date ranges for each row.
                                </div>
                              </div>
                            );
                          })()}
                          {spanConflictOnly && (() => {
                            const fmtDate = (v: unknown) => {
                              if (!v) return null;
                              const d = new Date(String(v) + (String(v).length === 10 ? "T00:00:00" : ""));
                              return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                            };
                            const person  = String(row.asg_name ?? row.st_name ?? "").trim();
                            const project = String(row.asg_project ?? row.asg_projectId ?? "").trim();
                            const hrs     = String(row.asg_totalHours ?? "").trim();
                            const pct     = String(row.asg_pctAlloc ?? "").trim();
                            const start   = fmtDate(row.asg_startDate);
                            const end     = fmtDate(row.asg_endDate);
                            const whoOn   = [person && <span key="p" className="font-semibold">{person}</span>, person && project && " on ", project && <span key="proj" className="font-semibold">{project}</span>].filter(Boolean);
                            const when    = start || end ? ` (${[start, end].filter(Boolean).join(" – ")})` : "";
                            const amount  = hrs ? <span className="font-semibold">{hrs} hrs</span> : pct ? <span className="font-semibold">{pct}%</span> : null;
                            // Pull the other row's hours from the issue reason text (e.g. "row 5 (30 hrs)")
                            const otherHrMatch = rowIssues[0]?.reason.match(/row \d+\s*\(([^)]+)\)/);
                            const otherHrs = otherHrMatch ? <span className="font-semibold">{otherHrMatch[1]}</span> : null;
                            return (
                              <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-snug space-y-0.5">
                                <div>
                                  {whoOn.length > 0 ? whoOn : <span className="font-semibold">This row</span>}
                                  {when} — this row has {amount ?? "different hours"} but another row covers the same dates{otherHrs ? <> with {otherHrs}</>  : ""}.
                                </div>
                                <div>
                                  <span className="font-semibold">Hours are not added together</span> — only the last row in the file will be saved. To keep both amounts, give each row a different date range, or combine them into one row with the total hours.
                                </div>
                              </div>
                            );
                          })()}
                          {rowIssues.slice(0, 3).map((iss, i) => (
                            <div key={i} className={iss.kind === "duplicate" || iss.kind === "spanConflict" || iss.kind === "newOption" ? "text-amber-700" : "text-red-700"}>
                              {iss.reason}
                              {iss.suggestion && iss.colKey && (
                                <button
                                  onClick={() => commitEdit(curTabIdx, rowIdx, iss.colKey!, iss.colLabel ?? iss.colKey!, iss.suggestion!)}
                                  className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 hover:text-indigo-900 transition-colors"
                                  title={`Replace "${(sheet.rows[rowIdx]?.[iss.colKey] ?? "").trim()}" with "${iss.suggestion}"`}
                                >
                                  Use "{iss.suggestion}"
                                </button>
                              )}
                            </div>
                          ))}
                          {rowIssues.length > 3 && (
                            <div className="text-gray-400">+ {rowIssues.length - 3} more…</div>
                          )}
                        </div>
                      )}
                    </td>
                    {orderedCols.map(c => (
                      <td key={c.key} className="border-b border-r border-gray-100 px-1 py-1 align-top" style={{ minWidth: Math.max(c.w, 90) }}>
                        <EditCell
                          col={c}
                          value={row[c.key] ?? ""}
                          invalid={issueByCol.get(c.key) ?? null}
                          onCommit={v => commitEdit(curTabIdx, rowIdx, c.key, c.label, v)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 py-1.5 border-t border-gray-100 shrink-0">
            <button disabled={page === 0}
              onClick={() => setPageByTab(prev => ({ ...prev, [curTabIdx]: page - 1 }))}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-[11px] text-gray-500">
              Rows {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, visibleRowIdxs.length).toLocaleString()} of {visibleRowIdxs.length.toLocaleString()}
              {searchQ && <> matching "{searchByTab[curTabIdx]}"</>}
            </span>
            <button disabled={page >= pageCount - 1}
              onClick={() => setPageByTab(prev => ({ ...prev, [curTabIdx]: page + 1 }))}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
          <div className="flex-1 min-w-[160px] text-xs text-gray-600">
            <b>{willImport.toLocaleString()}</b> row{willImport !== 1 ? "s" : ""} will import
            {skippedCount > 0 && <> · <b>{skippedCount.toLocaleString()}</b> skipped</>}
            {unresolvedCount > 0 && (
              <> · <span className="text-amber-700 font-semibold">
                {unresolvedCount.toLocaleString()} with errors — included rows import as-is
              </span></>
            )}
          </div>
          {tabIdxsWithRows.length > 1 && (
            <span className="text-[11px] font-semibold text-gray-500 whitespace-nowrap">
              Tab {stepPos + 1} of {tabIdxsWithRows.length}
            </span>
          )}
          <button onClick={onCancel}
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100">
            Cancel — go back to the grid
          </button>
          {stepPos > 0 && (
            <button
              onClick={() => setActiveTabIdx(tabIdxsWithRows[stepPos - 1])}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 inline-flex items-center gap-1"
              title="Go back to the previous tab — nothing is changed"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous tab
            </button>
          )}
          <button
            onClick={() => handleContinue("skip")}
            className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-100 inline-flex items-center gap-1"
            title={isFinalStep
              ? "Leave this tab's flagged rows out and start the import. Rows where you already picked a Decision keep your choice."
              : "Leave this tab's flagged rows out and move to the next tab still to review. Nothing is imported yet. Rows where you already picked a Decision keep your choice."}
          >
            {isFinalStep ? "Leave these rows out & import the rest" : <>Leave these rows out &amp; next tab <ChevronRight className="w-3.5 h-3.5" /></>}
          </button>
          <button
            onClick={() => handleContinue("include")}
            className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold hover:opacity-90 inline-flex items-center gap-1"
            style={{ backgroundColor: BRAND_GREEN }}
            title={isFinalStep
              ? "Import this tab's flagged rows as-is, even ones with errors. Rows where you already picked a Decision keep your choice."
              : "Keep this tab's flagged rows as-is and move to the next tab still to review. Nothing is imported yet. Rows where you already picked a Decision keep your choice."}
          >
            {isFinalStep ? "Keep these rows & import" : <>Keep these rows &amp; next tab <ChevronRight className="w-3.5 h-3.5" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
