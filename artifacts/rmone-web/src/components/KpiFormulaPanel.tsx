import { useEffect, useState, useMemo } from "react";
import { X, ArrowUpRight, Search } from "lucide-react";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { effectiveIssueLink, type IssueLink } from "@/lib/issueLink";

/** One pre-formatted project entry used for dynamic top-table sorting. */
type ProjectEntry = {
  /** e.g. "PMM-26-000005 · Global HQ Tower Phase 1" */
  label: string;
  /** Per-sortKey: { raw number for sorting, str for display, highlight renders value in orange } */
  values: Record<string, { raw: number; str: string; highlight?: boolean }>;
};

export type KpiFormulaDetail = {
  currentReading: string;
  howCalculated: string;
  formula: string;
  /** e.g. "PMM (active book) + OPM (pipeline)" — shown as pills between Formula and Impact */
  dataSource?: string;
  impact: string;
  tableTitle: string;
  /** Badge label inside the current-reading card. Defaults to "score". */
  scoreLabel?: string;
  /**
   * When set, replaces the numeric `valuePct%` display in the badge with a
   * custom formatted string (e.g. "5.58×" for a ratio metric).
   */
  scoreFormatted?: string;
  /**
   * Optional eyebrow override for this sub-driver (e.g. "FINANCIAL HEALTH · LIVE CALCULATION").
   * RoleHome falls back to "FIRM HEALTH · LIVE SIGNAL" when absent.
   */
  eyebrow?: string;
  /**
   * LIVE DATA stats block rendered after DATA SOURCE pills.
   * When present, liveData → topTable → Impact → primary table (no secondaryTable).
   * Rows with `sortKey` are clickable and re-sort the TOP PROJECTS block.
   */
  liveData?: {
    title: string;
    /** Optional pill rendered flush-right beside the title (e.g. "ALL PROJECTS"). */
    badge?: string;
    /** Optional italic caption rendered below the title (e.g. scope note). */
    subtitle?: string;
    rows: {
      label: string;
      value: string;
      /** Always-orange value (non-sortable highlight). Sortable rows get orange only when selected. */
      highlight?: boolean;
      /** When set, this row is clickable and will sort topTable by this key. */
      sortKey?: string;
      /** Title suffix shown in TOP PROJECTS header when this row is selected. */
      sortTitle?: string;
      /** Pre-formatted total for this sort dimension (shown in the TOTAL row). */
      sortTotal?: string;
    }[];
  };
  /**
   * Pre-formatted per-project data for dynamic top-table sorting.
   * When present, the panel derives the displayed TOP PROJECTS block from this
   * rather than the static `topTable` rows.
   */
  projects?: ProjectEntry[];
  /**
   * Override for the "TOP PROJECTS" heading prefix in the dynamic top table.
   * E.g. "ACTIVELY-ENGAGED PEOPLE" → title becomes "ACTIVELY-ENGAGED PEOPLE · {sortTitle}".
   */
  projectsTableTitle?: string;
  /**
   * Static TOP PROJECTS block (used when `projects` is absent or as a fallback).
   */
  topTable?: {
    title: string;
    rows: { label: string; value: string; highlight?: boolean }[];
    total?: string;
    totalValue?: string;
    footnote?: string;
  };
  /** Optional second table rendered below the primary records table (classic layout only). */
  secondaryTable?: {
    title: string;
    columns: { key: string; label: string; align?: "left" | "right" }[];
    rows: Record<string, string | number>[];
  };
};

type Props = {
  open: boolean;
  title: string;
  valuePct: number;
  /** e.g. "FIRM HEALTH · LIVE SIGNAL" — overridden per sub-driver via formula.eyebrow */
  eyebrow: string;
  formula: KpiFormulaDetail;
  detail: ActionDetail | null;
  onClose: () => void;
  /** Optional "Go to issue" fallback link; falls back to detail.goTo.
   *  Selecting a row with a real record retargets the button to it.
   *  No confident target → no button. */
  goTo?: IssueLink | null;
  /** Navigation callback (e.g. wouter setLocation). Button only renders
   *  when provided. */
  onNavigate?: (to: string) => void;
};

const BRAND = {
  bg: "var(--rm-panel)",
  card: "var(--rm-panel-soft)",
  border: "var(--rm-panel-border)",
  muted: "var(--rm-text-muted)",
  orange: "#E87722",
};

export function KpiFormulaPanel({
  open,
  title,
  valuePct,
  eyebrow,
  formula,
  detail,
  onClose,
  goTo,
  onNavigate,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  // The sort key currently active in the LIVE DATA section.
  // Initialised to the first sortable row's key when the panel opens.
  const firstSortKey = formula.liveData?.rows.find((r) => r.sortKey)?.sortKey ?? "";
  const [selectedLiveSort, setSelectedLiveSort] = useState<string>(firstSortKey);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setQuery("");
      return;
    }
    setSelected(null);
    setQuery("");
    // Reset sort selection to the default (first sortable row) each time the panel opens.
    setSelectedLiveSort(formula.liveData?.rows.find((r) => r.sortKey)?.sortKey ?? "");

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the active TOP PROJECTS block dynamically when `projects` is present.
  const dynamicTopTable = useMemo(() => {
    if (!formula.projects || !selectedLiveSort) return null;
    const sorted = [...formula.projects].sort(
      (a, b) => (b.values[selectedLiveSort]?.raw ?? 0) - (a.values[selectedLiveSort]?.raw ?? 0),
    );
    const top10 = sorted.slice(0, 10);
    const activeRow = formula.liveData?.rows.find((r) => r.sortKey === selectedLiveSort);
    const tablePrefix = formula.projectsTableTitle ?? "TOP PROJECTS";
    const sortTitleSuffix = activeRow?.sortTitle ? ` · ${activeRow.sortTitle}` : "";
    return {
      title: `${tablePrefix}${sortTitleSuffix}`,
      rows: top10.map((p) => ({
        label: p.label,
        value: p.values[selectedLiveSort]?.str ?? "—",
        highlight: p.values[selectedLiveSort]?.highlight,
      })),
      ...(activeRow?.sortTotal ? {
        total: `TOTAL · ALL ${formula.projects.length} ${formula.projectsTableTitle ? "ENTRIES" : `PROJECT${formula.projects.length === 1 ? "" : "S"}`}`,
        totalValue: activeRow.sortTotal,
      } : {}),
      footnote: top10.length < formula.projects.length
        ? `Showing top ${top10.length} of ${formula.projects.length}`
        : undefined,
    };
  }, [formula.projects, formula.liveData?.rows, formula.projectsTableTitle, selectedLiveSort]);

  if (!open) return null;

  const rows = detail?.rows ?? [];
  const columns = detail?.columns ?? [];
  // Search filters by any visible column OR the hidden record ID
  // (_ticket / _id). Entries keep their ORIGINAL index so selection and
  // per-row testids stay correct while filtered.
  const q = query.trim().toLowerCase();
  const visibleRows = q
    ? rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => {
          const rec = r as Record<string, unknown>;
          return (
            columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)) ||
            String(rec._ticket ?? "").toLowerCase().includes(q) ||
            String(rec._id ?? "").toLowerCase().includes(q)
          );
        })
    : rows.map((r, i) => ({ r, i }));
  // A selection hidden by the active filter is treated as no selection
  // (and restored automatically if the filter is cleared).
  const effSelected =
    selected !== null && visibleRows.some(({ i }) => i === selected)
      ? selected
      : null;
  const selectedRow = effSelected !== null ? rows[effSelected] ?? null : null;
  const issueLink = onNavigate
    ? effectiveIssueLink(detail, goTo, selectedRow)
    : null;
  const barPct = Math.max(0, Math.min(100, valuePct));
  const isFinancialLayout = !!formula.liveData;
  const activeTopTable = dynamicTopTable ?? formula.topTable;

  function toggleRow(i: number) {
    setSelected((prev) => (prev === i ? null : i));
  }

  const sharedCardStyle = {
    backgroundColor: BRAND.card,
    border: `1px solid ${BRAND.border}`,
  };

  return (
    <div
      className="fixed inset-0 z-[180]"
      onClick={onClose}
      data-testid="kpi-formula-panel-overlay"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(15,26,36,0.55)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />
      <aside
        className="absolute top-0 right-0 h-full w-full max-w-lg flex flex-col"
        style={{
          backgroundColor: BRAND.bg,
          color: "var(--rm-text)",
          borderLeft: "1px solid var(--rm-panel-border)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.45)",
          animation: "rmone-detail-slide 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        data-testid="kpi-formula-panel"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: BRAND.border }}
        >
          <div className="min-w-0">
            <div
              className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: BRAND.muted }}
            >
              {formula.eyebrow ?? eyebrow}
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[19px] font-extrabold leading-tight" style={{ color: "var(--rm-text)" }}>
                {title}
              </span>
              <span className="text-[22px] font-extrabold leading-tight" style={{ color: BRAND.orange }}>
                {valuePct}%
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 transition-colors"
            style={{ color: BRAND.muted }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--rm-panel-soft)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            aria-label="Close"
            data-testid="kpi-formula-panel-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: BRAND.border }}>
              <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: BRAND.orange }} />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10.5px]" style={{ color: BRAND.muted }}>0%</span>
              <span className="text-[10.5px]" style={{ color: BRAND.muted }}>100%</span>
            </div>
          </div>

          {/* Current reading */}
          <div className="rounded-xl p-3.5 mb-4 flex items-center justify-between gap-3" style={sharedCardStyle}>
            <div className="min-w-0">
              <div className="text-[9.5px] font-extrabold uppercase tracking-wider mb-1.5" style={{ color: BRAND.muted }}>
                Current reading
              </div>
              <div className="text-[13.5px] font-bold leading-snug" style={{ color: "var(--rm-text)" }}>
                {formula.currentReading}
              </div>
            </div>
            <div
              className="shrink-0 rounded-lg px-3 py-2 text-center"
              style={{ backgroundColor: "rgba(232,119,34,0.14)", border: `1px solid ${BRAND.orange}55` }}
            >
              <div className="text-[18px] font-extrabold leading-none" style={{ color: BRAND.orange }}>{formula.scoreFormatted ?? `${valuePct}%`}</div>
              <div className="text-[8.5px] font-bold uppercase tracking-wider mt-0.5" style={{ color: BRAND.orange }}>
                {formula.scoreLabel ?? "score"}
              </div>
            </div>
          </div>

          {/* How it's calculated */}
          <div className="rounded-xl p-3.5 mb-4" style={sharedCardStyle}>
            <div className="text-[9.5px] font-extrabold uppercase tracking-wider mb-1.5" style={{ color: BRAND.muted }}>
              How it's calculated
            </div>
            <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--rm-text)" }}>
              {formula.howCalculated}
            </div>
          </div>

          {/* Formula */}
          <div className="rounded-xl p-3.5 mb-4" style={sharedCardStyle}>
            <div className="text-[9.5px] font-extrabold uppercase tracking-wider mb-1.5" style={{ color: BRAND.muted }}>
              Formula
            </div>
            <div className="text-[12px] leading-relaxed" style={{ color: "var(--rm-text)", fontFamily: "monospace" }}>
              {formula.formula.split("=").map((part, i, arr) => (
                <span key={i}>
                  {i === arr.length - 1
                    ? <span style={{ color: BRAND.orange, fontWeight: 700 }}>{part}</span>
                    : <>{part}=</>}
                </span>
              ))}
            </div>
          </div>

          {/* DATA SOURCE pills */}
          {formula.dataSource && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-[9.5px] font-extrabold uppercase tracking-wider" style={{ color: BRAND.muted }}>
                Data Source
              </span>
              <span
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: BRAND.card, border: `1px solid ${BRAND.border}`, color: "var(--rm-text)" }}
              >
                {formula.dataSource}
              </span>
              <span
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: "rgba(232,119,34,0.12)", border: `1px solid ${BRAND.orange}55`, color: BRAND.orange }}
              >
                RM ONE · LIVE
              </span>
            </div>
          )}

          {/* ── FINANCIAL LAYOUT ── */}
          {isFinancialLayout && (
            <>
              {/* LIVE DATA stats block */}
              {formula.liveData && (
                <div className="mb-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[9.5px] font-extrabold uppercase tracking-wider" style={{ color: BRAND.muted }}>
                      {formula.liveData.title}
                    </div>
                    {formula.liveData.badge && (
                      <span
                        className="text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ml-2"
                        style={{ backgroundColor: BRAND.card, border: `1px solid ${BRAND.border}`, color: BRAND.muted }}
                      >
                        {formula.liveData.badge}
                      </span>
                    )}
                  </div>
                  {formula.liveData.subtitle && (
                    <div className="text-[10px] italic mb-2 mt-0.5" style={{ color: BRAND.muted, opacity: 0.75 }}>
                      {formula.liveData.subtitle}
                    </div>
                  )}
                  {!formula.liveData.subtitle && <div className="mb-2" />}
                  <div className="rounded-xl overflow-hidden" style={sharedCardStyle}>
                    {formula.liveData.rows.map((row, i, arr) => {
                      const isSortable = !!row.sortKey;
                      const isSelected = isSortable && row.sortKey === selectedLiveSort;
                      const valueColor =
                        row.highlight || isSelected ? BRAND.orange : "var(--rm-text)";
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3.5 py-2.5"
                          style={{
                            borderBottom: i < arr.length - 1 ? `1px solid ${BRAND.border}` : "none",
                            cursor: isSortable ? "pointer" : "default",
                            backgroundColor: isSelected ? "rgba(232,119,34,0.06)" : "transparent",
                            transition: "background-color 0.12s",
                          }}
                          onClick={isSortable ? () => setSelectedLiveSort(row.sortKey!) : undefined}
                          onMouseEnter={isSortable ? (e) => {
                            if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(232,119,34,0.04)";
                          } : undefined}
                          onMouseLeave={isSortable ? (e) => {
                            (e.currentTarget as HTMLElement).style.backgroundColor = isSelected ? "rgba(232,119,34,0.06)" : "transparent";
                          } : undefined}
                        >
                          <span className="text-[12.5px]" style={{ color: "var(--rm-text)" }}>
                            {row.label}
                          </span>
                          <span
                            className="text-[13px] font-bold ml-4 shrink-0"
                            style={{ color: valueColor }}
                          >
                            {row.value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TOP PROJECTS — driven by activeTopTable (dynamic or static) */}
              {activeTopTable && (
                <div className="mb-4">
                  <div
                    className="text-[9.5px] font-extrabold uppercase tracking-wider mb-2"
                    style={{ color: BRAND.orange }}
                  >
                    {activeTopTable.title}
                  </div>
                  <div className="rounded-xl overflow-hidden" style={sharedCardStyle}>
                    {activeTopTable.rows.map((row, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3.5 py-2.5"
                        style={{ borderBottom: `1px solid ${BRAND.border}` }}
                      >
                        <span className="text-[12.5px] truncate mr-3" style={{ color: "var(--rm-text)" }}>
                          {row.label}
                        </span>
                        <span
                          className="text-[12.5px] font-semibold shrink-0"
                          style={{ color: row.highlight ? BRAND.orange : "var(--rm-text)" }}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                    {activeTopTable.total && (
                      <div
                        className="flex items-center justify-between px-3.5 py-2.5"
                        style={{ borderTop: `1px solid ${BRAND.border}` }}
                      >
                        <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: BRAND.orange }}>
                          {activeTopTable.total}
                        </span>
                        <span className="text-[13px] font-bold shrink-0" style={{ color: BRAND.orange }}>
                          {activeTopTable.totalValue}
                        </span>
                      </div>
                    )}
                    {activeTopTable.footnote && (
                      <div className="px-3.5 pb-2.5 text-right">
                        <span className="text-[10.5px]" style={{ color: BRAND.muted }}>
                          {activeTopTable.footnote}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <ImpactBlock formula={formula} brand={BRAND} />

              <div className="mt-5">
                <PrimaryTable
                  tableTitle={formula.tableTitle}
                  rows={rows}
                  visibleRows={visibleRows}
                  columns={columns}
                  detail={detail}
                  selected={effSelected}
                  toggleRow={toggleRow}
                  query={query}
                  setQuery={setQuery}
                  brand={BRAND}
                />
              </div>
            </>
          )}

          {/* ── CLASSIC LAYOUT ── */}
          {!isFinancialLayout && (
            <>
              <ImpactBlock formula={formula} brand={BRAND} />

              <PrimaryTable
                tableTitle={formula.tableTitle}
                rows={rows}
                visibleRows={visibleRows}
                columns={columns}
                detail={detail}
                selected={effSelected}
                toggleRow={toggleRow}
                query={query}
                setQuery={setQuery}
                brand={BRAND}
              />

              {formula.secondaryTable && formula.secondaryTable.rows.length > 0 && (
                <div className="mt-5">
                  <div className="text-[9.5px] font-extrabold uppercase tracking-wider mb-2" style={{ color: BRAND.muted }}>
                    {formula.secondaryTable.title}
                  </div>
                  <div className="rounded-lg overflow-hidden" style={{ backgroundColor: BRAND.card, border: `1px solid ${BRAND.border}` }}>
                    <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 26 }} />
                          {formula.secondaryTable.columns.map((c) => (
                            <th
                              key={c.key}
                              className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: BRAND.muted, borderBottom: `1px solid ${BRAND.border}`, textAlign: c.align ?? "left", backgroundColor: "var(--rm-panel-soft)" }}
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {formula.secondaryTable.rows.map((r, i) => (
                          <tr key={i} className="rmone-detail-row">
                            <td className="px-2 py-2" style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                              <div style={{ width: 10 }} />
                            </td>
                            {formula.secondaryTable!.columns.map((c) => (
                              <td
                                key={c.key}
                                className="px-2.5 py-2"
                                style={{ color: "var(--rm-text)", borderBottom: `1px solid ${BRAND.border}`, textAlign: c.align ?? "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}
                              >
                                {r[c.key] ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div
          className="px-5 py-3 border-t flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: BRAND.border, backgroundColor: "var(--rm-panel-soft)" }}
        >
          <span className="text-[11.5px]" style={{ color: BRAND.muted }}>
            Select rows above to ask AI about specific items
          </span>
          {issueLink && onNavigate && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate(issueLink.to);
              }}
              className="rounded-md px-3.5 py-1.5 text-[12px] font-bold inline-flex items-center gap-1.5 shrink-0 transition-colors"
              style={{
                color: "var(--rm-text)",
                border: "1px solid #6BA539",
                backgroundColor: "transparent",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "rgba(107,165,57,0.12)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
              title={`Go to issue — ${issueLink.label}`}
              data-testid="kpi-panel-goto-issue"
            >
              <ArrowUpRight className="h-3.5 w-3.5" style={{ color: "#6BA539" }} />
              {issueLink.label}
            </button>
          )}
        </div>

        <style>{`
          @keyframes rmone-detail-slide {
            from { transform: translateX(100%); opacity: 0.4; }
            to { transform: translateX(0); opacity: 1; }
          }
          .rmone-detail-row:hover td {
            background-color: rgba(232, 119, 34, 0.08);
          }
        `}</style>
      </aside>
    </div>
  );
}

/* ── Shared sub-components ─────────────────────────────────────────────── */

type BrandTokens = typeof BRAND;

function ImpactBlock({ formula, brand }: { formula: KpiFormulaDetail; brand: BrandTokens }) {
  return (
    <div className="rounded-xl p-3.5 mb-4" style={{ backgroundColor: "rgba(232,119,34,0.06)", border: `1px solid ${brand.orange}55` }}>
      <div className="text-[9.5px] font-extrabold uppercase tracking-wider mb-2" style={{ color: brand.orange }}>
        Impact on RM ONE
      </div>
      {formula.impact.split("\n").map((line, i) => {
        if (line === "") return <div key={i} className="h-2" />;
        const headerMatch = line.match(/^(.+?)\s*—\s*(\d+%)$/);
        if (headerMatch) {
          return (
            <div key={i} className="flex items-center justify-between mb-0.5 mt-1">
              <span className="text-[12.5px] font-bold" style={{ color: "var(--rm-text)" }}>{headerMatch[1]}</span>
              <span className="text-[13px] font-bold ml-2" style={{ color: brand.orange }}>{headerMatch[2]}</span>
            </div>
          );
        }
        const isFormula = line.startsWith("100");
        return (
          <div
            key={i}
            className={isFormula ? "text-[11px] mb-0.5" : "text-[12.5px] leading-relaxed mb-0.5"}
            style={{ color: isFormula ? brand.muted : "var(--rm-text)" }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

type DetailColumn = { key: string; label: string; align?: "left" | "right" };

// Search appears once the table is long enough to need it.
const SEARCH_THRESHOLD = 10;

function PrimaryTable({
  tableTitle, rows, visibleRows, columns, detail, selected, toggleRow, query, setQuery, brand,
}: {
  tableTitle: string;
  rows: Record<string, string | number>[];
  /** Filtered entries carrying their ORIGINAL index (see parent). */
  visibleRows: { r: Record<string, string | number>; i: number }[];
  columns: DetailColumn[];
  detail: ActionDetail | null;
  selected: number | null;
  toggleRow: (i: number) => void;
  query: string;
  setQuery: (q: string) => void;
  brand: BrandTokens;
}) {
  const q = query.trim().toLowerCase();
  const showSearch = rows.length > SEARCH_THRESHOLD;
  return (
    <>
      <div className="text-[9.5px] font-extrabold uppercase tracking-wider mb-2" style={{ color: brand.muted }}>
        {tableTitle}
      </div>
      {showSearch && (
        <div className="mb-2">
          {/* The icon centers against THIS wrapper — it must contain only the
              input, or the match-count line grows the box and drags the icon
              out of the field. */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: brand.muted }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or ID…"
              className="w-full rounded-lg pl-8 pr-3 py-1.5 text-[12px] outline-none"
              style={{ backgroundColor: brand.card, border: `1px solid ${brand.border}`, color: "var(--rm-text)" }}
              data-testid="kpi-formula-panel-search"
            />
          </div>
          {q && (
            <div className="text-[10.5px] mt-1" style={{ color: brand.muted }}>
              {visibleRows.length.toLocaleString()} of {rows.length.toLocaleString()} records match
            </div>
          )}
        </div>
      )}
      {rows.length === 0 || visibleRows.length === 0 ? (
        <div className="rounded-lg px-3 py-6 text-center text-[12px]" style={{ backgroundColor: brand.card, border: `1px solid ${brand.border}`, color: brand.muted }}>
          {rows.length === 0 ? detail?.emptyText ?? "No records to display." : "No records match your search."}
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: brand.card, border: `1px solid ${brand.border}` }}>
          <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ width: 26 }} />
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: brand.muted, borderBottom: `1px solid ${brand.border}`, textAlign: c.align ?? "left", backgroundColor: "var(--rm-panel-soft)" }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ r, i }) => {
                const isSel = selected === i;
                return (
                  <tr
                    key={i}
                    onClick={() => toggleRow(i)}
                    className="rmone-detail-row"
                    style={{ cursor: "pointer", backgroundColor: isSel ? "rgba(232,119,34,0.12)" : "transparent" }}
                    data-testid={`kpi-formula-panel-row-${i}`}
                  >
                    <td className="px-2 py-2" style={{ borderBottom: `1px solid ${brand.border}` }}>
                      <input
                        type="radio"
                        name="kpi-formula-panel-row"
                        checked={isSel}
                        onClick={(e) => { e.stopPropagation(); toggleRow(i); }}
                        onChange={() => {}}
                        style={{ accentColor: brand.orange }}
                        aria-label={`Select row ${i + 1}`}
                      />
                    </td>
                    {columns.map((c, ci) => {
                      const v = r[c.key];
                      // Show the record's ID under the first column so users
                      // always see WHICH project a row is — unless a visible
                      // column already includes it.
                      const ticket = ci === 0 ? String((r as Record<string, unknown>)._ticket ?? "").trim() : "";
                      const ticketShown = !ticket || columns.some((cc) => String(r[cc.key] ?? "").includes(ticket));
                      return (
                        <td
                          key={c.key}
                          className="px-2.5 py-2"
                          style={{ color: "var(--rm-text)", borderBottom: `1px solid ${brand.border}`, textAlign: c.align ?? "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140, verticalAlign: "top" }}
                          title={typeof v === "string" ? v : undefined}
                        >
                          {v ?? "—"}
                          {!ticketShown && (
                            <div className="text-[10.5px] mt-0.5" style={{ color: brand.muted }}>
                              {ticket}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
