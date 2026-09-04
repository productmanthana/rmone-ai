/**
 * ImportGridPeek — read-only snapshot of the import grid, shown as a popup
 * ABOVE the full-screen import wizard (wizard sits at zIndex 9990).
 *
 * Several wizard steps make decisions about rows/columns the user can no
 * longer see (the wizard covers the grid): "are these rows duplicates?",
 * "did my column pick land in the right place?". This popup lets them peek
 * at the actual data without leaving the step. Nothing here is editable and
 * closing it changes nothing.
 */
import { Fragment, useEffect, useMemo, useRef } from "react";
import { X, Table2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Z } from "@/lib/zLayers";

export interface GridPeekCol { key: string; label: string }

export interface GridPeekState {
  title: string;
  note?: string;
  cols: GridPeekCol[];
  rows: Record<string, string>[];
  /** Grid column keys to highlight (e.g. columns just matched in the audit step). */
  highlightColKeys?: string[];
  /** Data-array row indices to highlight (e.g. rows flagged as possible duplicates). */
  highlightRows?: number[];
  /** 2 for file uploads (# matches Excel row numbers — header line is row 1), 1 for typed rows. */
  rowNumOffset?: number;
}

export default function ImportGridPeek({ title, note, cols, rows, highlightColKeys, highlightRows, rowNumOffset = 2, onClose }: GridPeekState & { onClose: () => void }) {
  const hiCols = useMemo(() => new Set(highlightColKeys ?? []), [highlightColKeys]);
  const hiRows = useMemo(() => new Set(highlightRows ?? []), [highlightRows]);

  // Large files: rendering every cell of a 10k-row sheet would freeze the
  // popup. Keep the leading rows for context plus EVERY highlighted row
  // (±2 neighbours so a duplicate can be compared against the row beside
  // it) — the gaps collapse into "… skipped …" separator lines.
  const view = useMemo<{ idx: number; gapBefore: number }[]>(() => {
    const MAX_PLAIN = 800;
    if (rows.length <= MAX_PLAIN) return rows.map((_, i) => ({ idx: i, gapBefore: 0 }));
    const keep = new Set<number>();
    for (let i = 0; i < Math.min(rows.length, 60); i++) keep.add(i);
    for (const r of hiRows) {
      for (let d = -2; d <= 2; d++) {
        const i = r + d;
        if (i >= 0 && i < rows.length) keep.add(i);
      }
    }
    const sorted = [...keep].sort((a, b) => a - b);
    const out: { idx: number; gapBefore: number }[] = [];
    let prev = -1;
    for (const i of sorted) { out.push({ idx: i, gapBefore: i - prev - 1 }); prev = i; }
    return out;
  }, [rows, hiRows]);
  const truncated = view.length < rows.length;

  // Esc closes (capture phase so the grid's document-level handlers never
  // see it); the first highlighted row/column scrolls into view on open.
  const firstHiRowRef = useRef<HTMLTableRowElement | null>(null);
  const firstHiColRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    const t = setTimeout(() => {
      (firstHiRowRef.current ?? firstHiColRef.current)?.scrollIntoView({ block: "center", inline: "center" });
    }, 60);
    return () => clearTimeout(t);
  }, []);

  let hiRowTagged = false;
  let hiColTagged = false;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: Z.POPUP_TOP, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(96vw, 1400px)", maxHeight: "88vh" }}
      >
        {/* Header — one compact line */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 shrink-0 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Table2 className="w-4 h-4 text-indigo-600" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 truncate">{title}</h2>
          <span className="text-[11px] text-gray-400 flex-shrink-0">read-only view</span>
          {note && <span className="text-xs text-gray-500 truncate hidden sm:inline">— {note}</span>}
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto min-h-0" style={{ overscrollBehavior: "contain" }}>
          <table className="text-[11px]" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-2 py-1.5 text-left text-[10px] font-bold text-gray-400 whitespace-nowrap">#</th>
                {cols.map(c => {
                  const hi = hiCols.has(c.key);
                  const ref = hi && !hiColTagged ? (hiColTagged = true, firstHiColRef) : undefined;
                  return (
                    <th
                      key={c.key}
                      ref={ref}
                      className={`sticky top-0 z-20 border-b border-gray-200 px-2.5 py-1.5 text-left font-bold whitespace-nowrap ${hi ? "bg-indigo-100 text-indigo-800" : "bg-gray-50 text-gray-600"}`}
                      style={{ minWidth: 110, maxWidth: 260 }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {hi && <CheckCircle2 className="w-3 h-3 text-indigo-600" />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {view.map(({ idx, gapBefore }) => {
                const r = rows[idx];
                const hi = hiRows.has(idx);
                const ref = hi && !hiRowTagged ? (hiRowTagged = true, firstHiRowRef) : undefined;
                return (
                  <Fragment key={idx}>
                    {gapBefore > 0 && (
                      <tr key={`gap-${idx}`}>
                        <td colSpan={cols.length + 1} className="px-3 py-1 text-center text-[10px] text-gray-400 bg-gray-50/60 border-b border-gray-100 italic">
                          … {gapBefore.toLocaleString()} row{gapBefore !== 1 ? "s" : ""} skipped …
                        </td>
                      </tr>
                    )}
                    <tr key={idx} ref={ref} className={hi ? "bg-amber-50" : idx % 2 ? "bg-gray-50/40" : "bg-white"}>
                      <td className={`sticky left-0 z-10 border-r border-b border-gray-100 px-2 py-1 text-[10px] font-semibold whitespace-nowrap ${hi ? "bg-amber-100 text-amber-800" : "bg-gray-50 text-gray-400"}`}>
                        <span className="inline-flex items-center gap-1">
                          {idx + rowNumOffset}
                          {hi && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                        </span>
                      </td>
                      {cols.map(c => {
                        const v = String(r[c.key] ?? "");
                        return (
                          <td
                            key={c.key}
                            className={`border-b border-gray-100 px-2.5 py-1 whitespace-nowrap ${hiCols.has(c.key) ? "bg-indigo-50/70 text-indigo-900" : "text-gray-700"}`}
                            style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}
                            title={v || undefined}
                          >
                            {v || <span className="text-gray-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 shrink-0 flex-wrap">
          <span className="text-[11px] text-gray-500">
            {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""} · {cols.length} column{cols.length !== 1 ? "s" : ""}
            {truncated && <span className="text-gray-400"> (long file — leading rows and every highlighted row are shown)</span>}
          </span>
          {hiRows.size > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              <AlertTriangle className="w-3 h-3" /> {hiRows.size.toLocaleString()} highlighted row{hiRows.size !== 1 ? "s" : ""}
            </span>
          )}
          {hiCols.size > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
              <CheckCircle2 className="w-3 h-3" /> {hiCols.size} column{hiCols.size !== 1 ? "s" : ""} you matched
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
