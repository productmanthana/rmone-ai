import { useEffect, useState } from "react";
import { X, Sparkles, Info, ArrowUpRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { deriveRowLink, effectiveIssueLink, type IssueLink } from "@/lib/issueLink";

export type DetailTier = {
  label: string;
  /** Hex / CSS color used for the tier chip foreground + ring. */
  color: string;
};

export type DetailExplanation = {
  /**
   * Describes what is happening. A plain string renders as a paragraph;
   * a string[] renders as a scannable bullet list — one item per line.
   */
  what: string | string[];
  why: string;
  /** Optional jargon-free translation, rendered as "In plain words". */
  plain?: string;
};

type Props = {
  open: boolean;
  /** Header title (large, bold). */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** Optional small chip rendered above the title (e.g. CRITICAL / LIVE). */
  tier?: DetailTier;
  /** Small uppercase label rendered next to the tier chip. */
  kindLabel: string;
  /** Two-paragraph explanation card at the top of the body. */
  explanation: DetailExplanation;
  /** Records table payload (ActionDetail from homeIntelligence). */
  detail: ActionDetail | null;
  onClose: () => void;
  onAskAI: (payload: { selectedIndexes: number[] }) => void;
  /** Optional override for the Ask AI button label. */
  askLabel?: string;
  /** Optional "Go to issue" fallback link; falls back to detail.goTo.
   *  Selecting a row with a real record retargets the button to it.
   *  No confident target → no button. */
  goTo?: IssueLink | null;
  /** Navigation callback (e.g. wouter setLocation). Button only renders
   *  when provided. */
  onNavigate?: (to: string) => void;
  /** Optional contextual Quick Action button(s) shown in the footer when a
    *  row is selected — e.g. "Add Open Position" for demand-coverage alerts.
    *  Called with the currently selected row (or null if none). */
  quickAction?: {
    label: string;
    onClick: (row: Record<string, string | number> | null) => void;
  } | {
    label: string;
    onClick: (row: Record<string, string | number> | null) => void;
  }[] | null;
};

const BRAND = {
  bg: "var(--rm-panel)",
  card: "var(--rm-panel-soft)",
  border: "var(--rm-panel-border)",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  lightGreen: "#A9C23F",
  muted: "var(--rm-text-muted)",
};

// Rows shown per page in the affected-records table. Keeps the panel
// responsive even when a risk carries thousands of records — the pager
// below the table exposes every page by number.
const PAGE_SIZE = 8;

// Date-like cell values ("Jul 19, 24" / "Aug 3, 2025") must render on ONE
// line — the table's default wrap style would split them at the space and
// stack month/day above the year in narrow columns.
const DATE_CELL_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(, ?\d{2,4})?$/;

/** Compact page-number list with ellipsis gaps (-1 = gap), e.g.
 *  [0, -1, 41, 42, 43, -1, 1249] for page 42 of 1250. */
function pageList(current: number, count: number): number[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const keep = new Set<number>([0, count - 1, current - 1, current, current + 1]);
  const pages = [...keep].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);
  const out: number[] = [];
  let prev = -1;
  for (const p of pages) {
    if (p - prev === 2) out.push(p - 1);
    else if (p - prev > 2) out.push(-1);
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Generic right-edge slide-in side panel. Used for risk-feed rows,
 * portfolio (KPI) drill-downs, and recommended-action drill-downs.
 *
 * Renders an explanation card ("What's happening / Why it matters") on
 * top of the same affected-records table from ActionModal, plus a
 * footer with Close + Ask AI. The caller computes the explanation copy
 * for each kind so the panel itself stays presentational.
 */
export function RiskSidePanel({
  open,
  title,
  subtitle,
  tier,
  kindLabel,
  explanation,
  detail,
  onClose,
  onAskAI,
  askLabel = "Ask AI",
  goTo,
  onNavigate,
  quickAction,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setPage(0);
      setQuery("");
      return;
    }
    setSelected(null);
    setPage(0);
    setQuery("");
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
  }, [open, onClose]);

  if (!open || !detail) return null;

  const rows = detail.rows ?? [];
  // Search filters the table by any visible column OR the hidden record ID
  // (_ticket / _id). Entries keep their ORIGINAL index so selection, Ask AI
  // payloads, and per-row links stay correct while filtered.
  const q = query.trim().toLowerCase();
  const indexed = rows.map((r, i) => ({ r, i }));
  const visible = q
    ? indexed.filter(({ r }) => {
        const rec = r as Record<string, unknown>;
        return (
          detail.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)) ||
          String(rec._ticket ?? "").toLowerCase().includes(q) ||
          String(rec._id ?? "").toLowerCase().includes(q)
        );
      })
    : indexed;
  const showSearch = rows.length > PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const startIdx = safePage * PAGE_SIZE;
  const pageRows = visible.slice(startIdx, startIdx + PAGE_SIZE);
  const radioName = `detail-row-${title}`;
  // A selection hidden by the active filter is treated as no selection
  // (and restored automatically if the filter is cleared).
  const effSelected =
    selected !== null && visible.some(({ i }) => i === selected)
      ? selected
      : null;
  const selectedRow = effSelected !== null ? rows[effSelected] ?? null : null;
  const quickActions = quickAction
    ? Array.isArray(quickAction) ? quickAction : [quickAction]
    : [];
  const issueLink = onNavigate
    ? effectiveIssueLink(detail, goTo, selectedRow)
    : null;
  // Per-row deep links (project record or a person's Timeline row). The
  // trailing link column only renders when at least one row has a target
  // so tables without links keep their exact current layout.
  const rowLinks = onNavigate
    ? rows.map((r) => deriveRowLink(r as Record<string, unknown>))
    : [];
  const hasRowLinks = rowLinks.some((l) => l !== null);

  function toggleRow(i: number) {
    setSelected((prev) => (prev === i ? null : i));
  }
  function askAI() {
    onAskAI({ selectedIndexes: effSelected !== null ? [effSelected] : [] });
  }

  return (
    <div
      className="fixed inset-0 z-[180]"
      onClick={onClose}
      data-testid="detail-panel-overlay"
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
        aria-label={kindLabel}
        data-testid="detail-panel"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 border-b"
          style={{ borderColor: BRAND.border }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {tier ? (
                <span
                  className="text-[9.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    color: tier.color,
                    backgroundColor: `${tier.color}22`,
                    border: `1px solid ${tier.color}55`,
                  }}
                >
                  {tier.label}
                </span>
              ) : null}
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: BRAND.muted }}
              >
                {kindLabel}
              </span>
            </div>
            <div className="text-[15px] font-bold leading-snug" style={{ color: "var(--rm-text)" }}>
              {title}
            </div>
            {subtitle ? (
              <div
                className="text-[12px] mt-0.5"
                style={{ color: BRAND.muted }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 transition-colors"
            style={{ color: BRAND.muted }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--rm-panel-soft)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "transparent")
            }
            aria-label="Close"
            data-testid="detail-panel-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Explanation card */}
          <div
            className="rounded-xl p-3.5 mb-4"
            style={{
              background:
                "linear-gradient(135deg, rgba(107,165,57,0.10), rgba(169,194,63,0.04))",
              border: "1px solid rgba(107,165,57,0.28)",
            }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Info size={11} color={BRAND.lightGreen} strokeWidth={2.5} />
              <span
                className="text-[9.5px] font-extrabold uppercase tracking-wider"
                style={{ color: BRAND.lightGreen }}
              >
                What's happening
              </span>
            </div>

            {/* "what" — paragraph or bullet list */}
            {Array.isArray(explanation.what) ? (
              <ul className="mb-2.5" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {explanation.what.filter(Boolean).map((line, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[13px] leading-snug"
                    style={{ color: "var(--rm-text)" }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        marginTop: 5,
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        backgroundColor: BRAND.lightGreen,
                        opacity: 0.75,
                      }}
                    />
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <div
                className="text-[13px] leading-relaxed mb-2.5"
                style={{ color: "var(--rm-text)" }}
              >
                {explanation.what}
              </div>
            )}

            {/* Divider */}
            <div style={{ height: 1, backgroundColor: "rgba(107,165,57,0.18)", marginBottom: 10 }} />

            {explanation.plain ? (
              <div
                className="text-[12.5px] leading-snug mb-2.5"
                style={{ color: "var(--rm-text-muted)" }}
              >
                <span style={{ color: BRAND.lightGreen, fontWeight: 700 }}>
                  In plain words ·{" "}
                </span>
                {explanation.plain}
              </div>
            ) : null}

            <div
              className="text-[12.5px] leading-snug"
              style={{ color: "var(--rm-text-muted)" }}
            >
              <span style={{ color: BRAND.lightGreen, fontWeight: 700 }}>
                Why it matters ·{" "}
              </span>
              {explanation.why}
            </div>
          </div>

          {/* Records table */}
          <div className="flex items-center justify-between mb-2">
            <div
              className="text-[9.5px] font-extrabold uppercase tracking-wider"
              style={{ color: "var(--rm-text-muted)" }}
            >
              Affected records
            </div>
            <div className="text-[10.5px]" style={{ color: BRAND.muted }}>
              {rows.length.toLocaleString()} record{rows.length === 1 ? "" : "s"} · pick 1 for AI
            </div>
          </div>
          {showSearch && (
            <div className="mb-2">
              {/* The icon centers against THIS wrapper — it must contain only
                  the input, or extra siblings (the match-count line) grow the
                  box and drag the icon out of the field. */}
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: BRAND.muted }}
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search by name or ID…"
                  className="w-full rounded-lg pl-8 pr-3 py-1.5 text-[12px] outline-none"
                  style={{
                    backgroundColor: BRAND.card,
                    border: `1px solid ${BRAND.border}`,
                    color: "var(--rm-text)",
                  }}
                  data-testid="detail-panel-search"
                />
              </div>
              {q && (
                <div className="text-[10.5px] mt-1" style={{ color: BRAND.muted }}>
                  {visible.length.toLocaleString()} of {rows.length.toLocaleString()} records match
                </div>
              )}
            </div>
          )}
          {rows.length === 0 || visible.length === 0 ? (
            <div
              className="rounded-lg px-3 py-6 text-center text-[12px]"
              style={{
                backgroundColor: BRAND.card,
                border: `1px solid ${BRAND.border}`,
                color: BRAND.muted,
              }}
            >
              {rows.length === 0
                ? detail.emptyText ?? "No records to display."
                : "No records match your search."}
            </div>
          ) : (
            <div
              className="rounded-lg overflow-hidden"
              style={{
                backgroundColor: BRAND.card,
                border: `1px solid ${BRAND.border}`,
              }}
            >
              <table
                className="w-full text-[12px]"
                style={{ borderCollapse: "collapse" }}
              >
                <thead>
                  <tr>
                    <th style={{ width: 30 }} />
                    {detail.columns.map((c) => (
                      <th
                        key={c.key}
                        className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          color: "var(--rm-text-muted)",
                          borderBottom: `1px solid ${BRAND.border}`,
                          textAlign: c.align ?? "left",
                          backgroundColor: "var(--rm-panel-soft)",
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                    {hasRowLinks && (
                      <th
                        style={{
                          width: 34,
                          borderBottom: `1px solid ${BRAND.border}`,
                          backgroundColor: "var(--rm-panel-soft)",
                        }}
                      />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ r, i: gi }) => {
                    const isSel = selected === gi;
                    return (
                      <tr
                        key={gi}
                        onClick={() => toggleRow(gi)}
                        className="rmone-detail-row"
                        style={{
                          cursor: "pointer",
                          backgroundColor: isSel
                            ? "rgba(107,165,57,0.14)"
                            : "transparent",
                        }}
                        data-testid={`detail-panel-row-${gi}`}
                      >
                        <td
                          className="px-2 py-2"
                          style={{ borderBottom: `1px solid ${BRAND.border}` }}
                        >
                          <input
                            type="radio"
                            name={radioName}
                            checked={isSel}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRow(gi);
                            }}
                            onChange={() => {}}
                            style={{ accentColor: BRAND.green }}
                            aria-label={`Select row ${gi + 1}`}
                          />
                        </td>
                        {detail.columns.map((c, ci) => {
                          const v = r[c.key];
                          // Surface the record's ID under the first column so
                          // users always see WHICH project/record a row is —
                          // unless a visible column already shows it.
                          const ticket =
                            ci === 0
                              ? String((r as Record<string, unknown>)._ticket ?? "").trim()
                              : "";
                          const ticketShown =
                            !ticket ||
                            detail.columns.some((cc) =>
                              String(r[cc.key] ?? "").includes(ticket),
                            );
                          return (
                            <td
                              key={c.key}
                              className="px-2.5 py-2"
                              style={{
                                color: "var(--rm-text)",
                                borderBottom: `1px solid ${BRAND.border}`,
                                textAlign: c.align ?? "left",
                                whiteSpace:
                                  typeof v === "string" && DATE_CELL_RE.test(v.trim())
                                    ? "nowrap"
                                    : "normal",
                                wordBreak:
                                  typeof v === "string" && DATE_CELL_RE.test(v.trim())
                                    ? "normal"
                                    : "break-word",
                                verticalAlign: "top",
                              }}
                              title={typeof v === "string" ? v : undefined}
                            >
                              {v ?? "—"}
                              {!ticketShown && (
                                <div
                                  className="text-[10.5px] mt-0.5"
                                  style={{ color: BRAND.muted }}
                                >
                                  {ticket}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {hasRowLinks && (
                          <td
                            className="px-1.5 py-2"
                            style={{
                              borderBottom: `1px solid ${BRAND.border}`,
                              textAlign: "right",
                              verticalAlign: "top",
                            }}
                          >
                            {rowLinks[gi] && onNavigate ? (
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onClose();
                                  onNavigate(rowLinks[gi]!.to);
                                }}
                                className="rounded-md p-1 transition-colors"
                                style={{ color: BRAND.green }}
                                onMouseEnter={(ev) =>
                                  (ev.currentTarget.style.backgroundColor =
                                    "rgba(107,165,57,0.16)")
                                }
                                onMouseLeave={(ev) =>
                                  (ev.currentTarget.style.backgroundColor =
                                    "transparent")
                                }
                                title={rowLinks[gi]!.label}
                                aria-label={rowLinks[gi]!.label}
                                data-testid={`detail-panel-row-open-${gi}`}
                              >
                                <ArrowUpRight size={14} />
                              </button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pager — page numbers so even very large record sets stay
              browsable. Selection is global, so a pick survives page
              changes. */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
              <div className="text-[10.5px]" style={{ color: BRAND.muted }}>
                Showing {(startIdx + 1).toLocaleString()}–
                {Math.min(startIdx + PAGE_SIZE, visible.length).toLocaleString()} of{" "}
                {visible.length.toLocaleString()}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                  className="rounded-md p-1 transition-colors"
                  style={{
                    color: safePage === 0 ? "var(--rm-panel-border)" : BRAND.muted,
                    cursor: safePage === 0 ? "default" : "pointer",
                  }}
                  aria-label="Previous page"
                  data-testid="detail-panel-page-prev"
                >
                  <ChevronLeft size={14} />
                </button>
                {pageList(safePage, pageCount).map((p, i) =>
                  p === -1 ? (
                    <span
                      key={`gap-${i}`}
                      className="px-1 text-[11px]"
                      style={{ color: BRAND.muted }}
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className="rounded-md min-w-[26px] px-1.5 py-1 text-[11px] font-semibold transition-colors"
                      style={{
                        color: p === safePage ? "#0F1A24" : "var(--rm-text)",
                        backgroundColor:
                          p === safePage ? BRAND.lightGreen : BRAND.card,
                        border: `1px solid ${
                          p === safePage ? BRAND.lightGreen : BRAND.border
                        }`,
                      }}
                      aria-label={`Page ${p + 1}`}
                      aria-current={p === safePage ? "page" : undefined}
                      data-testid={`detail-panel-page-${p + 1}`}
                    >
                      {(p + 1).toLocaleString()}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                  disabled={safePage >= pageCount - 1}
                  className="rounded-md p-1 transition-colors"
                  style={{
                    color:
                      safePage >= pageCount - 1
                        ? "var(--rm-panel-border)"
                        : BRAND.muted,
                    cursor: safePage >= pageCount - 1 ? "default" : "pointer",
                  }}
                  aria-label="Next page"
                  data-testid="detail-panel-page-next"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div
          className="px-5 py-3 border-t flex items-center justify-between gap-3"
          style={{ borderColor: BRAND.border, backgroundColor: "var(--rm-panel-soft)" }}
        >
          <div className="text-[11px]" style={{ color: BRAND.muted }}>
            {selected !== null ? (
              <span style={{ color: BRAND.lightGreen, fontWeight: 600 }}>
                1 selected
              </span>
            ) : rows.length > 0 ? (
              <>Pick 1 row to enable Ask AI</>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{ color: "var(--rm-text-muted)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--rm-panel-border)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              Close
            </button>
            {issueLink && onNavigate && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigate(issueLink.to);
                }}
                className="rounded-md px-3.5 py-1.5 text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors"
                style={{
                  color: "var(--rm-text)",
                  border: `1px solid ${BRAND.green}`,
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "rgba(107,165,57,0.12)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
                title={`Go to issue — ${issueLink.label}`}
                data-testid="detail-panel-goto-issue"
              >
                <ArrowUpRight className="h-3.5 w-3.5" style={{ color: BRAND.green }} />
                {issueLink.label}
              </button>
            )}
            {effSelected !== null && quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => action.onClick(selectedRow)}
                className="rounded-md px-3.5 py-1.5 text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors"
                style={{
                  color: BRAND.green,
                  border: `1px solid ${BRAND.green}`,
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "rgba(107,165,57,0.12)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              onClick={askAI}
              disabled={selected === null}
              className="rounded-md px-4 py-1.5 text-[12px] font-bold text-white inline-flex items-center gap-1.5 transition-opacity"
              style={{
                backgroundColor: BRAND.greenBg,
                opacity: selected === null ? 0.4 : 1,
                cursor: selected === null ? "not-allowed" : "pointer",
              }}
              data-testid="detail-panel-ask-ai"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {askLabel}
            </button>
          </div>
        </div>

        <style>{`
          @keyframes rmone-detail-slide {
            from { transform: translateX(100%); opacity: 0.4; }
            to { transform: translateX(0); opacity: 1; }
          }
          .rmone-detail-row:hover td {
            background-color: rgba(107, 165, 57, 0.08);
          }
        `}</style>
      </aside>
    </div>
  );
}
