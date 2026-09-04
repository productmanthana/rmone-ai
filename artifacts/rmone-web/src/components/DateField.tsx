/* ────────────────────────────────────────────────────────────────────────────
   DateField — the app-wide replacement for <input type="date">.

   Why not the native picker: users (especially older ones) struggled with it —
   the year is hard to reach (endless month-arrow clicking), and pressing the
   up/down arrow keys silently changes a date segment and closes the popup.

   Design (follows NN/g + GOV.UK + Material date-picker guidance):
   • Users can simply TYPE the date (07/25/2026, 7-25-26, "Jul 25 2026" …) —
     it is normalized on blur/Enter via normalizeDateInput.
   • The calendar button opens a LARGE popup with:
       – Month dropdown + Year dropdown (jump straight to any year — the #1
         complaint with the native picker)
       – Big ‹ › buttons that move one month at a time
       – Large 38px day cells (easy touch/click targets)
       – Today / Clear shortcuts
   • Value contract is identical to <input type="date">: value is "YYYY-MM-DD"
     or "", onChange receives the same. min/max clamp both typed & picked dates.
   ──────────────────────────────────────────────────────────────────────────── */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ForwardedRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { normalizeDateInput } from "../lib/importValidation";
import { Z } from "@/lib/zLayers";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const ymd = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const todayYmd = () => {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth(), n.getDate());
};
/** ISO "YYYY-MM-DD" → "MM/DD/YYYY" for display; anything else returned as-is. */
const fmtUs = (iso: string) => {
  if (!isYmd(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};
const clampYmd = (iso: string, min?: string, max?: string) => {
  if (!isYmd(iso)) return iso;
  if (min && isYmd(min) && iso < min) return min;
  if (max && isYmd(max) && iso > max) return max;
  return iso;
};

export type DateFieldProps = {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  /** When false, TYPED dates are committed as-is instead of being snapped
   *  into [min, max] — for callers that show their own out-of-range warning
   *  (silent snapping hides WHY the value changed). Calendar days outside the
   *  range stay greyed out either way. Default: true (snap). */
  clampTyped?: boolean;
  /** When set, clicking a greyed-out (out-of-range) calendar day is no longer
   *  a silent dead click: the day stays unpickable, but this message appears
   *  inside the calendar so the user learns WHY the date is unavailable
   *  (e.g. "edit the schedule first"). Without it, out-of-range days are
   *  plain disabled buttons — unchanged legacy behavior. */
  outOfRangeNotice?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
  title?: string;
  "aria-label"?: string;
  placeholder?: string;
  /** Styles for the text input (merged over the defaults). */
  style?: CSSProperties;
  /** className for the text input (e.g. shadcn form styling). */
  className?: string;
  /** Styles for the outer wrapper (width/flex live here). */
  wrapStyle?: CSSProperties;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Fires on Enter with the freshly-committed value (state updates from
      onChange are not yet visible in the caller's closure at that point). */
  onEnter?: (v: string) => void;
  /** Extra hook for grid cells that must stop row-selection on mousedown. */
  onMouseDownCapture?: (e: React.MouseEvent) => void;
  /** Open the calendar as soon as the field mounts (grid cell edit mode). */
  openOnMount?: boolean;
  /** Compact = tighter paddings for dense grid rows. */
  compact?: boolean;
};

export type DateFieldHandle = {
  /** Parse + commit whatever is typed RIGHT NOW; returns the committed value.
      For save buttons that preventDefault on mousedown (so blur never fires). */
  commitNow: () => string;
};

function DateFieldImpl(props: DateFieldProps, fwdRef: ForwardedRef<DateFieldHandle>) {
  const {
    value, onChange, min, max, clampTyped, outOfRangeNotice, disabled, required, autoFocus, id, title,
    placeholder, style, className, wrapStyle, onKeyDown, onEnter, onMouseDownCapture,
    openOnMount, compact,
  } = props;

  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editingRef = useRef(false);

  const [text, setText] = useState(fmtUs(value || ""));
  const [open, setOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  // Armed when the user clicks an out-of-range day and outOfRangeNotice is set.
  const [showRangeNotice, setShowRangeNotice] = useState(false);
  const yearWrapRef = useRef<HTMLDivElement | null>(null);
  const yearListRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  // The month shown in the calendar (year, month0).
  const seed = isYmd(value) ? value : todayYmd();
  const [view, setView] = useState({ y: +seed.slice(0, 4), m: +seed.slice(5, 7) - 1 });

  // Reflect external value changes while the user is NOT typing.
  useEffect(() => {
    if (!editingRef.current) setText(fmtUs(value || ""));
    if (isYmd(value)) setView({ y: +value.slice(0, 4), m: +value.slice(5, 7) - 1 });
  }, [value]);

  /** Parse + commit the typed text; returns the value that is now in effect. */
  const commitText = (raw: string): string => {
    const s = raw.trim();
    if (!s) { if (value) onChange(""); setText(""); return ""; }
    const iso = normalizeDateInput(s);
    if (iso) {
      const snapped = clampTyped === false ? iso : clampYmd(iso, min, max);
      setText(fmtUs(snapped));
      if (snapped !== value) onChange(snapped);
      return snapped;
    }
    // Unreadable — fall back to the last good value instead of keeping junk.
    setText(fmtUs(value || ""));
    return value || "";
  };

  useImperativeHandle(fwdRef, () => ({
    commitNow: () => commitText(inputRef.current?.value ?? text),
  }));

  const POP_W = 300, POP_H = 372;
  const place = () => {
    const a = anchorRef.current; if (!a) return;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - POP_W - 8));
    const up = r.bottom + 6 + POP_H > vh - 8 && r.top - 6 - POP_H > 8;
    const top = up ? r.top - 6 - POP_H : Math.min(r.bottom + 6, vh - POP_H - 8);
    setPos({ top, left, up });
  };
  const openCal = () => {
    if (disabled) return;
    const base = isYmd(value) ? value : todayYmd();
    setView({ y: +base.slice(0, 4), m: +base.slice(5, 7) - 1 });
    place();
    setYearOpen(false);
    setShowRangeNotice(false);
    setOpen(true);
  };

  // When the year menu opens, scroll the current year into the middle.
  useEffect(() => {
    if (!yearOpen) return;
    const list = yearListRef.current;
    const sel = list?.querySelector<HTMLElement>("[data-selected='true']");
    if (list && sel) list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2;
  }, [yearOpen]);

  useEffect(() => { if (openOnMount) setTimeout(openCal, 0); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  // Close on outside click / Escape; keep glued to the anchor on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const move = () => place();
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Year list: ALWAYS the full scrollable range — min/max only grey out days,
  // they never shrink this list (a one-entry dropdown reads as broken).
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    let lo = now - 75, hi = now + 15;
    if (min && isYmd(min)) lo = Math.min(lo, +min.slice(0, 4));
    if (max && isYmd(max)) hi = Math.max(hi, +max.slice(0, 4));
    lo = Math.min(lo, view.y); hi = Math.max(hi, view.y);
    const list: number[] = [];
    for (let y = hi; y >= lo; y--) list.push(y);
    return list;
  }, [min, max, view.y]);

  const shiftMonth = (delta: number) => {
    setView(v => {
      const m = v.m + delta;
      const y = v.y + Math.floor(m / 12);
      return { y, m: ((m % 12) + 12) % 12 };
    });
  };

  const pick = (iso: string) => {
    onChange(iso);
    setText(fmtUs(iso));
    setShowRangeNotice(false);
    setOpen(false);
  };

  /* ---- calendar grid for the viewed month ---- */
  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const startOffset = first.getDay(); // 0=Sun
    const cells: { iso: string; day: number; inMonth: boolean }[] = [];
    const start = new Date(view.y, view.m, 1 - startOffset);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({ iso: ymd(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === view.m });
    }
    return cells;
  }, [view]);

  const today = todayYmd();
  const outOfRange = (iso: string) => (!!min && isYmd(min) && iso < min) || (!!max && isYmd(max) && iso > max);

  /* ---- styles ---- */
  const pad = compact ? "4px 6px" : "8px 10px";
  const inputStyle: CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: pad, paddingRight: 30,
    borderRadius: 8, border: "1px solid var(--rm-panel-border, #d6dce4)",
    backgroundColor: "var(--rm-panel-soft, #f6f8fa)", color: "var(--rm-text, #16232e)",
    fontSize: compact ? 12 : 13, outline: "none", fontFamily: "inherit",
    ...style,
  };
  const navBtn: CSSProperties = {
    width: 34, height: 34, borderRadius: 8, border: "1px solid #d6dce4",
    background: "#fff", color: "#16232e", fontSize: 17, fontWeight: 700,
    cursor: "pointer", lineHeight: 1, flexShrink: 0,
  };
  const selStyle: CSSProperties = {
    padding: "7px 6px", borderRadius: 8, border: "1px solid #d6dce4",
    background: "#fff", color: "#16232e", fontSize: 14, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div ref={anchorRef} style={{ position: "relative", display: "inline-block", width: "100%", ...wrapStyle }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={className}
        title={title}
        aria-label={props["aria-label"]}
        placeholder={placeholder ?? "mm/dd/yyyy"}
        value={text}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        onFocus={() => { editingRef.current = true; }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { editingRef.current = false; commitText(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const committed = commitText((e.target as HTMLInputElement).value);
            onEnter?.(committed);
          }
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); openCal(); return; }
          onKeyDown?.(e);
        }}
        onMouseDownCapture={onMouseDownCapture as any}
        style={inputStyle}
      />
      <button
        type="button"
        aria-label="Open calendar"
        title="Open calendar"
        disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openCal(); }}
        style={{
          position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
          width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", background: "transparent", cursor: disabled ? "default" : "pointer",
          color: "var(--rm-text-muted, #5b6b7a)", padding: 0, borderRadius: 6,
        }}
      >
        {/* simple calendar glyph — no icon-lib dependency */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Choose date"
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: POP_W, zIndex: Z.SPLASH,
            background: "#fff", border: "1px solid #d6dce4", borderRadius: 14,
            boxShadow: "0 12px 34px rgba(10,30,50,0.22)", padding: 12, boxSizing: "border-box",
            fontFamily: "inherit", color: "#16232e",
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            // Clicking anywhere else in the popup dismisses the year menu.
            if (yearOpen && !yearWrapRef.current?.contains(e.target as Node)) setYearOpen(false);
          }}
        >
          {/* Month / Year controls — dropdowns jump anywhere instantly */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <button type="button" aria-label="Previous month" style={navBtn} onClick={() => shiftMonth(-1)}>‹</button>
            <select
              aria-label="Month"
              value={view.m}
              onChange={(e) => setView(v => ({ ...v, m: +e.target.value }))}
              style={{ ...selStyle, flex: 1, minWidth: 0 }}
            >
              {MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
            </select>
            {/* Custom year picker: native <select> popups can open upward and
                dump the full list — this one always drops DOWN with a short
                scrollable window centered on the current year. */}
            <div ref={yearWrapRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                aria-label="Year"
                aria-expanded={yearOpen}
                onClick={() => setYearOpen(o => !o)}
                style={{ ...selStyle, width: 84, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}
              >
                {view.y}
                <span style={{ fontSize: 10, color: "#5b6b7a" }}>▼</span>
              </button>
              {yearOpen && (
                <div
                  ref={yearListRef}
                  role="listbox"
                  aria-label="Choose year"
                  style={{
                    position: "absolute", top: "calc(100% + 4px)", right: 0, width: 92,
                    maxHeight: 208, overflowY: "auto", zIndex: 5,
                    background: "#fff", border: "1px solid #d6dce4", borderRadius: 10,
                    boxShadow: "0 8px 22px rgba(10,30,50,0.2)", padding: 4, boxSizing: "border-box",
                  }}
                >
                  {years.map(y => {
                    const sel = y === view.y;
                    return (
                      <button
                        key={y}
                        type="button"
                        role="option"
                        aria-selected={sel}
                        data-selected={sel ? "true" : undefined}
                        onClick={() => { setView(v => ({ ...v, y })); setYearOpen(false); }}
                        style={{
                          display: "block", width: "100%", textAlign: "center",
                          padding: "7px 6px", border: "none", borderRadius: 7,
                          background: sel ? "#2f6feb" : "transparent",
                          color: sel ? "#fff" : "#16232e",
                          fontSize: 14, fontWeight: sel ? 800 : 600,
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                        onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = "#eef3f8"; }}
                        onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button type="button" aria-label="Next month" style={navBtn} onClick={() => shiftMonth(1)}>›</button>
          </div>

          {/* Weekday header */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
            {WEEKDAYS.map(w => (
              <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#7a8896", padding: "4px 0" }}>{w}</div>
            ))}
          </div>

          {/* Day grid — large 38px targets */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {grid.map(c => {
              const sel = c.iso === value;
              const isToday = c.iso === today;
              const dis = outOfRange(c.iso);
              // With a notice configured, out-of-range days stay clickable so
              // the click can EXPLAIN itself instead of dying silently — but
              // they never commit a date.
              const explains = dis && !!outOfRangeNotice;
              return (
                <button
                  key={c.iso}
                  type="button"
                  disabled={dis && !explains}
                  aria-disabled={explains || undefined}
                  onClick={() => {
                    if (dis) { if (explains) setShowRangeNotice(true); return; }
                    pick(c.iso);
                  }}
                  style={{
                    height: 38, borderRadius: 9, fontSize: 14, fontFamily: "inherit",
                    fontWeight: sel ? 800 : 600,
                    cursor: dis ? (explains ? "not-allowed" : "default") : "pointer",
                    border: isToday && !sel ? "2px solid #6BA539" : "1px solid transparent",
                    background: sel ? "#2f6feb" : "transparent",
                    color: dis ? "#c3ccd4" : sel ? "#fff" : c.inMonth ? "#16232e" : "#9aa7b2",
                  }}
                  onMouseEnter={(e) => { if (!dis && !sel) (e.currentTarget as HTMLButtonElement).style.background = "#eef3f8"; }}
                  onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          {/* Why greyed-out days can't be picked — shown on demand */}
          {showRangeNotice && outOfRangeNotice && (
            <div role="status" style={{
              marginTop: 8, padding: "8px 10px", borderRadius: 9,
              backgroundColor: "#FEF3C7", border: "1px solid #F59E0B",
              color: "#92400E", fontSize: 11.5, fontWeight: 600, lineHeight: 1.45,
            }}>
              {outOfRangeNotice}
            </div>
          )}

          {/* Footer shortcuts */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
            <button
              type="button"
              onClick={() => { onChange(""); setText(""); setOpen(false); }}
              style={{ border: "none", background: "transparent", color: "#5b6b7a", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "6px 8px", fontFamily: "inherit" }}
            >
              Clear
            </button>
            <button
              type="button"
              disabled={outOfRange(today) && !outOfRangeNotice}
              aria-disabled={(outOfRange(today) && !!outOfRangeNotice) || undefined}
              onClick={() => {
                if (outOfRange(today)) { setShowRangeNotice(true); return; }
                pick(clampYmd(today, min, max));
              }}
              style={{ border: "none", background: "transparent", color: outOfRange(today) ? "#c3ccd4" : "#2f6feb", fontSize: 13, fontWeight: 800, cursor: outOfRange(today) ? (outOfRangeNotice ? "not-allowed" : "default") : "pointer", padding: "6px 8px", fontFamily: "inherit" }}
            >
              Today
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const DateField = forwardRef(DateFieldImpl);

export default DateField;
