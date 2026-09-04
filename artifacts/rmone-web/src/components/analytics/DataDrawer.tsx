/* ─────────────────────────────────────────────────────────────
 * DataDrawer — the Analytics Center's shared "show me the data"
 * drawer. Every clickable number/chart on a mission page opens
 * this: the full underlying row list with search, per-row links
 * straight to the records (via lib/issueLink — never sniffed
 * from text) and the same PDF / Excel exports as the card.
 *
 * Stat chips (e.g. "Project Manager 103", "Full-Time 25") are
 * clickable when they carry a filterKey — click once to filter
 * the table to that group, click again (or click another chip)
 * to switch / clear.
 *
 * Explanation panel: opens with "What this means / How it is
 * calculated" plus period, source, measure and completeness.
 *
 * Pagination: real page controls replacing the fixed 200 cap.
 * Footer shows X–Y of Z (filtered) and source total.
 *
 * Total row: visible computed totals for safely summable columns.
 *
 * Accessibility: role=dialog, aria-modal, labelled search,
 * initial focus, focus trap, keyboard rows, Escape to close.
 * ──────────────────────────────────────────────────────────── */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { X, Search, FileText, FileSpreadsheet, Loader2, ArrowUpRight, ChevronLeft, Info, ChevronRight } from "lucide-react";
import {
  fmtCell,
  isSafelysummable,
  computeTotalRow,
  defaultExplanation,
  type CardModel,
  type CardRow,
} from "@/lib/analyticsCenter";
import { deriveRowLink } from "@/lib/issueLink";
import { MC } from "@/components/analytics/MissionKit";

/** Rows per page — large enough for comfortable reading */
const PAGE_SIZE = 100;

/* Above every app modal/popup — the drawer opens from tiles that may sit
 * under sticky headers and z-raised cards. DOM-order ties are not enough. */
const Z_DRAWER = 12000;

type ChipFilter = { key: string; label: string };

/* ── focus trap helpers ─────────────────────────────────────── */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

export function DataDrawer({ card, onClose, loading = false }: { card: CardModel | null; onClose: () => void; loading?: boolean }) {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chipFilter, setChipFilter] = useState<ChipFilter | null>(null);
  const [stack, setStack] = useState<CardModel[]>([]);
  const [page, setPage] = useState(0);
  const [showExplain, setShowExplain] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Element that had focus before the drawer opened — restored on close */
  const prevFocusRef = useRef<HTMLElement | null>(null);

  /* capture previous focus when drawer opens */
  useEffect(() => {
    if (card) {
      prevFocusRef.current = document.activeElement as HTMLElement;
    }
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* reset per root card */
  useEffect(() => {
    setQ(""); setErr(null); setStack([]); setChipFilter(null); setPage(0); setShowExplain(false);
  }, [card?.id]);

  /* reset page when filters change */
  useEffect(() => { setPage(0); }, [q, chipFilter]);

  /* initial focus on search input when drawer opens */
  useLayoutEffect(() => {
    if (card && searchRef.current) {
      searchRef.current.focus();
    }
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* restore focus on close — EVERY close path (Escape, ×, backdrop) must go
   * through here so keyboard users get their focus back */
  const handleClose = useCallback(() => {
    onClose();
    requestAnimationFrame(() => {
      prevFocusRef.current?.focus();
    });
  }, [onClose]);

  /* Escape closes; Tab traps focus inside drawer */
  useEffect(() => {
    if (!card) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (drawerRef.current) {
        trapFocus(drawerRef.current, e);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [card, handleClose]);

  // Active card: deepest in the stack, or the root card
  const currentCard = stack.length > 0 ? stack[stack.length - 1] : card;

  const filtered = useMemo(() => {
    if (!currentCard) return [];
    let rows: CardRow[] = currentCard.rows;

    if (chipFilter) {
      rows = rows.filter(row => {
        const val = row[chipFilter.key];
        return String(val ?? "—") === chipFilter.label || val === chipFilter.label;
      });
    }

    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(row => {
      const hay = Object.values(row).filter(v => typeof v === "string").join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [q, currentCard, chipFilter]);

  /* total row for the currently filtered population */
  const totalRow = useMemo(() => {
    if (!currentCard || filtered.length === 0) return null;
    return computeTotalRow(filtered, currentCard.columns, currentCard.explanation?.totals);
  }, [filtered, currentCard]);

  const hasSummable = useMemo(() => {
    if (!currentCard) return false;
    return currentCard.columns.some(isSafelysummable);
  }, [currentCard]);

  /* pagination */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const visible = filtered.slice(pageStart, pageEnd);

  if (!card) return null;

  const explanation = currentCard ? defaultExplanation(currentCard) : null;

  const runExport = async (kind: "pdf" | "xlsx") => {
    if (busy || !currentCard) return;
    setBusy(kind);
    setErr(null);
    try {
      const mod = await import("@/lib/exportCard");
      /* Export exactly the actively filtered population — not the full card */
      const exportCard: CardModel = {
        ...currentCard,
        rows: filtered,
        takeaway: filtered.length < currentCard.rows.length
          ? `${currentCard.takeaway} (filtered to ${filtered.length.toLocaleString("en-US")} of ${currentCard.rows.length.toLocaleString("en-US")} rows)`
          : currentCard.takeaway,
      };
      if (kind === "pdf") await mod.exportCardPdf(exportCard, totalRow ?? undefined);
      else await mod.exportCardExcel(exportCard, totalRow ?? undefined);
    } catch (e: any) {
      setErr(`Export failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(null);
    }
  };

  const openRow = (row: CardRow) => {
    if (row._subCard) {
      setQ(""); setChipFilter(null); setPage(0);
      setStack((s) => [...s, row._subCard as CardModel]);
      return;
    }
    const link = deriveRowLink(row);
    if (!link) return;
    handleClose();
    setLocation(link.to);
  };

  const chipTotal = chipFilter
    ? currentCard!.rows.filter(row => {
        const val = row[chipFilter.key];
        return String(val ?? "—") === chipFilter.label || val === chipFilter.label;
      }).length
    : null;

  const th: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
    color: MC.faint, textAlign: "left", padding: "8px 10px",
    borderBottom: `1px solid ${MC.border}`,
    position: "sticky", top: 0, height: 32, boxSizing: "border-box",
    background: "#22394B", zIndex: 3, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontSize: 11.5, color: MC.text, padding: "8px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 240,
  };

  const measureLabel: Record<string, string> = {
    planned: "Planned",
    actual: "Actual",
    derived: "Derived / Calculated",
  };

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={currentCard?.title ?? "Data drawer"}
      style={{ position: "fixed", inset: 0, zIndex: Z_DRAWER }}
    >
      {/* backdrop */}
      <div
        onClick={handleClose}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "rgba(8,14,20,0.6)", backdropFilter: "blur(2px)" }}
      />

      {/* drawer */}
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0,
        width: "min(780px, 94vw)",
        background: "linear-gradient(160deg, #2B4254 0%, #22394B 60%, #1D3140 100%)",
        borderLeft: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "-24px 0 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column",
        color: MC.text, fontFamily: "Inter, system-ui, sans-serif",
      }}>
        {/* header */}
        <div style={{ padding: "18px 22px 12px", borderBottom: `1px solid ${MC.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {stack.length > 0 && (
                <button
                  onClick={() => { setQ(""); setChipFilter(null); setPage(0); setStack((s) => s.slice(0, -1)); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    marginBottom: 6, padding: "2px 8px 2px 4px", borderRadius: 6,
                    background: "rgba(255,255,255,0.06)", border: `1px solid ${MC.border}`,
                    color: MC.muted, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <ChevronLeft size={13} /> Back
                </button>
              )}
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: MC.greenInk }}>
                Underlying data
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3 }}>{currentCard!.title}</div>
              <div style={{ fontSize: 11.5, color: MC.muted, marginTop: 3, lineHeight: 1.4 }}>
                {currentCard!.takeaway}
                {chipFilter && chipTotal !== null && (
                  <span style={{ color: MC.greenInk, marginLeft: 6 }}>
                    — showing {chipTotal.toLocaleString("en-US")} {chipFilter.label} rows
                  </span>
                )}
              </div>
            </div>
            {/* info + close */}
            <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
              {explanation && (
                <button
                  onClick={() => setShowExplain(v => !v)}
                  aria-pressed={showExplain}
                  aria-label="Toggle explanation panel"
                  title="What this means / How it is calculated"
                  style={{
                    width: 30, height: 30, borderRadius: 8, cursor: "pointer",
                    background: showExplain ? "rgba(168,214,114,0.15)" : "rgba(255,255,255,0.06)",
                    border: showExplain ? "1px solid rgba(168,214,114,0.55)" : `1px solid ${MC.border}`,
                    color: showExplain ? MC.greenInk : MC.muted,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Info size={14} />
                </button>
              )}
              <button
                ref={closeRef}
                onClick={handleClose}
                aria-label="Close data drawer"
                style={{
                  width: 30, height: 30, borderRadius: 8, cursor: "pointer",
                  background: "rgba(255,255,255,0.06)", border: `1px solid ${MC.border}`,
                  color: MC.muted, display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={15} />
              </button>
            </span>
          </div>

          {/* explanation panel */}
          {showExplain && explanation && (
            <div style={{
              marginTop: 12, padding: "12px 14px", borderRadius: 10,
              background: "rgba(168,214,114,0.07)", border: "1px solid rgba(168,214,114,0.2)",
              fontSize: 11.5, lineHeight: 1.6,
            }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: MC.greenInk, textTransform: "uppercase", fontSize: 9.5, letterSpacing: "0.1em" }}>
                  What this means
                </span>
                <div style={{ color: MC.text, marginTop: 3 }}>{explanation.meaning}</div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: MC.greenInk, textTransform: "uppercase", fontSize: 9.5, letterSpacing: "0.1em" }}>
                  How it is calculated
                </span>
                <div style={{ color: MC.muted, marginTop: 3 }}>{explanation.calculation}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 20px", marginTop: 6 }}>
                {explanation.period && (
                  <span style={{ fontSize: 11 }}>
                    <span style={{ color: MC.faint }}>Period: </span>
                    <span style={{ color: MC.text }}>{explanation.period}</span>
                  </span>
                )}
                {explanation.measure && (
                  <span style={{ fontSize: 11 }}>
                    <span style={{ color: MC.faint }}>Measure: </span>
                    <span style={{ color: MC.text }}>{measureLabel[explanation.measure] ?? explanation.measure}</span>
                  </span>
                )}
                {explanation.source && (
                  <span style={{ fontSize: 11 }}>
                    <span style={{ color: MC.faint }}>Source: </span>
                    <span style={{ color: MC.text }}>{explanation.source}</span>
                  </span>
                )}
                {explanation.completeness !== undefined && (
                  <span style={{ fontSize: 11 }}>
                    <span style={{ color: MC.faint }}>Completeness: </span>
                    <span style={{ color: MC.text }}>
                      {typeof explanation.completeness === "number"
                        ? `${Math.round(explanation.completeness * 100)}%`
                        : explanation.completeness}
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* headline stat chips */}
          {currentCard!.stats.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {currentCard!.stats.map(s => {
                const fk = s.filterKey;
                const isActive = !!fk && chipFilter?.key === fk && chipFilter?.label === s.label;
                const clickable = !!fk;
                return (
                  <span
                    key={s.label}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-pressed={clickable ? isActive : undefined}
                    title={clickable ? (isActive ? `Clear filter — show all rows` : `Filter to ${s.label} rows`) : undefined}
                    onClick={clickable ? () => setChipFilter(isActive ? null : { key: fk, label: s.label }) : undefined}
                    onKeyDown={clickable ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setChipFilter(isActive ? null : { key: fk, label: s.label });
                      }
                    } : undefined}
                    style={{
                      display: "inline-flex", alignItems: "baseline", gap: 6,
                      padding: "4px 10px", borderRadius: 8, fontSize: 11,
                      background: isActive ? "rgba(168,214,114,0.15)" : "rgba(255,255,255,0.05)",
                      border: isActive ? "1px solid rgba(168,214,114,0.55)" : `1px solid ${MC.border}`,
                      cursor: clickable ? "pointer" : "default",
                      userSelect: "none",
                      transition: "background 0.15s, border-color 0.15s",
                      outline: "none",
                    }}
                  >
                    <span style={{ color: isActive ? MC.greenInk : MC.faint }}>{s.label}</span>
                    <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: isActive ? MC.greenInk : MC.text }}>{s.value}</span>
                    {isActive && <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 1 }}>✕</span>}
                  </span>
                );
              })}
              {chipFilter && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => setChipFilter(null)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChipFilter(null); } }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 9px", borderRadius: 8, fontSize: 11,
                    background: "rgba(255,255,255,0.04)", border: `1px solid ${MC.border}`,
                    color: MC.muted, cursor: "pointer", userSelect: "none", outline: "none",
                  }}
                >
                  Show all
                </span>
              )}
            </div>
          )}

          {/* search */}
          <div style={{ position: "relative", marginTop: 12 }}>
            <Search size={13} aria-hidden="true" style={{ position: "absolute", left: 10, top: 9, color: MC.faint }} />
            <input
              ref={searchRef}
              id="drawer-search"
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label={loading ? "Loading underlying data" : `Search ${currentCard!.rows.length.toLocaleString("en-US")} rows`}
              placeholder={loading ? "Loading underlying data…" : `Search ${currentCard!.rows.length.toLocaleString("en-US")} rows…`}
              disabled={loading}
              style={{
                width: "100%", padding: "7px 12px 7px 30px", borderRadius: 9,
                background: "rgba(255,255,255,0.06)", border: `1px solid ${MC.border}`,
                color: MC.text, fontSize: 12, outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* table */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {loading ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: MC.muted, fontSize: 12 }}>
              <Loader2 size={18} className="animate-spin" style={{ margin: "0 auto 10px" }} />
              Loading the evidence behind this number…
            </div>
          ) : visible.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: MC.muted, fontSize: 12 }}>
              {currentCard!.rows.length === 0
                ? "No rows behind this number right now."
                : chipFilter && chipTotal === 0
                  ? `No rows with ${chipFilter.label} in the data.`
                  : "No rows match your search."}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} role="grid">
              <thead>
                <tr>
                  {currentCard!.columns.map(c => (
                    <th key={c.key} scope="col" style={{ ...th, textAlign: c.align === "right" ? "right" : "left" }}>{c.label}</th>
                  ))}
                  <th scope="col" style={{ ...th, width: 34 }} aria-label="Open record" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  const hasSub = !!row._subCard;
                  const link = !hasSub ? deriveRowLink(row) : null;
                  const clickable = hasSub || !!link;
                  return (
                    <tr
                      key={i}
                      role={clickable ? "row" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => openRow(row) : undefined}
                      onKeyDown={clickable ? (e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(row); }
                      } : undefined}
                      title={hasSub ? "Click to see events for this week" : link ? link.label : undefined}
                      style={{ cursor: clickable ? "pointer" : "default", outline: "none" }}
                      onMouseEnter={e => { if (clickable) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                      onFocus={e => { if (clickable) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                      onBlur={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      {currentCard!.columns.map(c => (
                        <td key={c.key} style={{
                          ...td,
                          textAlign: c.align === "right" ? "right" : "left",
                          fontWeight: c.align === "right" ? 700 : c.key === currentCard!.columns[0].key ? 650 : 400,
                          fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined,
                          color: c.align === "right" || c.key === currentCard!.columns[0].key ? MC.text : MC.muted,
                        }}>
                          {fmtCell(row[c.key], c)}
                        </td>
                      ))}
                      <td style={{ ...td, width: 34, textAlign: "center" }}>
                        {hasSub
                          ? <ChevronLeft size={13} style={{ color: MC.greenInk, verticalAlign: "middle", transform: "rotate(180deg)" }} />
                          : link && <ArrowUpRight size={13} style={{ color: MC.greenInk, verticalAlign: "middle" }} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Keep totals visible at the bottom while the row list scrolls.
                  Totals cover the entire filtered population, not only this
                  page. */}
              {hasSummable && totalRow && filtered.length > 0 && (
                <tfoot>
                  <tr>
                    {currentCard!.columns.map((c, idx) => (
                      <td
                        key={c.key}
                        style={{
                          ...td,
                          position: "sticky",
                          bottom: 0,
                          zIndex: 2,
                          textAlign: c.align === "right" ? "right" : "left",
                          fontWeight: 800,
                          fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined,
                          color: isSafelysummable(c) ? MC.greenInk : MC.faint,
                          borderTop: `2px solid ${MC.border}`,
                          borderBottom: "none",
                          background: "#294354",
                          fontSize: 11.5,
                        }}
                      >
                        {idx === 0
                          ? <span style={{ textTransform: "uppercase", fontSize: 9.5, letterSpacing: "0.08em" }}>Total</span>
                          : isSafelysummable(c) && totalRow[c.key] !== undefined
                            ? fmtCell(totalRow[c.key], c)
                            : ""}
                      </td>
                    ))}
                    <td
                      style={{
                        ...td,
                        position: "sticky",
                        bottom: 0,
                        zIndex: 2,
                        borderTop: `2px solid ${MC.border}`,
                        borderBottom: "none",
                        background: "#294354",
                      }}
                    />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        {/* footer: pagination + counts + exports */}
        <div style={{
          padding: "10px 22px", borderTop: `1px solid ${MC.border}`, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          {/* left: pagination + counts */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* pagination controls */}
            {totalPages > 1 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  aria-label="Previous page"
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: `1px solid ${MC.border}`,
                    background: "rgba(255,255,255,0.06)", color: MC.muted, cursor: safePage === 0 ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: safePage === 0 ? 0.4 : 1,
                  }}
                >
                  <ChevronLeft size={12} />
                </button>
                <span style={{ fontSize: 11, color: MC.faint, minWidth: 60, textAlign: "center" }}>
                  {safePage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  aria-label="Next page"
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: `1px solid ${MC.border}`,
                    background: "rgba(255,255,255,0.06)", color: MC.muted,
                    cursor: safePage >= totalPages - 1 ? "default" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: safePage >= totalPages - 1 ? 0.4 : 1,
                  }}
                >
                  <ChevronRight size={12} />
                </button>
              </span>
            )}
            {/* row count */}
            <span style={{ fontSize: 11, color: MC.faint }}>
              {filtered.length === 0
                ? "0 rows"
                : filtered.length === currentCard!.rows.length
                  ? <>
                      <strong style={{ color: MC.text }}>
                        {pageStart + 1}–{pageEnd}
                      </strong>
                      {" of "}
                      <strong style={{ color: MC.text }}>
                        {filtered.length.toLocaleString("en-US")}
                      </strong>
                      {" rows"}
                    </>
                  : <>
                      <strong style={{ color: MC.text }}>
                        {pageStart + 1}–{pageEnd}
                      </strong>
                      {" of "}
                      <strong style={{ color: MC.greenInk }}>
                        {filtered.length.toLocaleString("en-US")} filtered
                      </strong>
                      {" · "}
                      <span style={{ color: MC.faint }}>
                        {currentCard!.rows.length.toLocaleString("en-US")} source total
                      </span>
                    </>
              }
              {!stack.length && filtered.length > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>· click a row to open</span>
              )}
            </span>
          </div>

          {/* right: error + export buttons */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {err && <span style={{ fontSize: 11, color: MC.bad }}>{err}</span>}
            <ExportButton
              label="PDF"
              icon={FileText}
              loading={busy === "pdf"}
              disabled={loading || busy !== null || filtered.length === 0}
              onClick={() => runExport("pdf")}
            />
            <ExportButton
              label="Excel"
              icon={FileSpreadsheet}
              loading={busy === "xlsx"}
              disabled={loading || busy !== null || filtered.length === 0}
              onClick={() => runExport("xlsx")}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

function ExportButton({ label, icon: Icon, loading, disabled, onClick }: {
  label: string; icon: React.ElementType; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Export as ${label}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 13px", borderRadius: 9, cursor: disabled ? "default" : "pointer",
        background: loading ? "rgba(168,214,114,0.14)" : "transparent",
        border: "1px solid rgba(168,214,114,0.35)",
        fontSize: 11, fontWeight: 700, color: MC.greenInk,
        opacity: disabled && !loading ? 0.5 : 1, whiteSpace: "nowrap",
      }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {label}
    </button>
  );
}
