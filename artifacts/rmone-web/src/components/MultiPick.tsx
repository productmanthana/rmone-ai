/** Checkbox-dropdown multi-pick storing string[] values with display labels.
 *  Shared by the Stage Rules form view and the vertical flow view. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, ChevronDown, Search } from "lucide-react";
import { friendlyFieldLabel } from "@/lib/stageRules";

export default function MultiPick({ options, selected, onChange, placeholder, customPlaceholder, onCustomAdd, hoverWrap, defaultOpen, popupSide }: {
  /** Optional color renders a small dot beside the label (e.g. group colors). */
  options: { value: string; label: string; color?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  /** When set, a free-text "add custom" row is shown with this placeholder. */
  customPlaceholder?: string;
  /** Optional registrar for custom entries — returns the canonical value to
   *  add (e.g. registers a new stage into the shared draft workflow so every
   *  other stage picker sees it too). */
  onCustomAdd?: (v: string) => string;
  /** Optional per-value hover wrapper (e.g. GroupMembersHover showing a
   *  group's members). Applied to selected chips AND dropdown option labels;
   *  return the node unchanged for values with nothing to show. */
  hoverWrap?: (value: string, node: ReactNode) => ReactNode;
  /** Open the dropdown immediately on mount (e.g. right after the user chose
   *  "Everyone except selected groups" — the list should be one glance away). */
  defaultOpen?: boolean;
  /** "right" opens the popup to the right of the trigger instead of below.
   *  Useful when the trigger is in a narrow column and space exists to the right. */
  popupSide?: "right";
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [openUp, setOpenUp] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const labelOf = (v: string) => options.find(o => o.value === v)?.label ?? friendlyFieldLabel(v);
  const colorOf = (v: string) => options.find(o => o.value === v)?.color;
  const allOptions = [
    ...options,
    ...selected.filter(v => !options.some(o => o.value === v)).map(v => ({ value: v, label: labelOf(v), color: colorOf(v) })),
  ];

  // Show search when list is long enough to be painful to scroll.
  const SEARCH_THRESHOLD = 8;
  const showSearch = allOptions.length >= SEARCH_THRESHOLD;
  const q = search.trim().toLowerCase();
  const visibleOptions = q
    ? allOptions.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : allOptions;

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const addCustom = () => {
    const raw = customInput.trim();
    if (!raw) { setCustomInput(""); return; }
    const v = onCustomAdd ? onCustomAdd(raw) : raw;
    if (!v || selected.includes(v)) { setCustomInput(""); return; }
    onChange([...selected, v]);
    setCustomInput("");
  };

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Flip up when there isn't enough room below the trigger.
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropHeight = 300; // maxHeight of the dropdown
    setOpenUp(spaceBelow < dropHeight && spaceAbove > spaceBelow);
  }, [open]);

  // Auto-focus search when dropdown opens.
  useEffect(() => {
    if (open && showSearch) setTimeout(() => searchRef.current?.focus(), 30);
    if (!open) setSearch("");
  }, [open, showSearch]);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 200, flex: 1 }}>
      {/* ── Trigger pill ─────────────────────────────────────────────── */}
      <div onClick={() => setOpen(o => !o)}
        style={{
          minHeight: 32, border: "1px solid hsl(var(--border))", borderRadius: 6,
          padding: "3px 8px", cursor: "pointer", display: "flex",
          flexWrap: "wrap", gap: 4, alignItems: "center", background: "hsl(var(--background))",
        }}>
        {selected.length === 0 && (
          <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 13 }}>{placeholder}</span>
        )}
        {selected.map(v => {
          // Colors are plain "#rrggbb" hex, so hex+alpha suffixes are safe here.
          const c = colorOf(v);
          const chip = (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: c ? `${c}1f` : "hsl(var(--muted))",
              border: c ? `1px solid ${c}66` : "1px solid transparent",
              borderRadius: 4, padding: "2px 6px",
              fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))",
            }}>
              {c && <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }} />}
              {labelOf(v)}
              <button type="button" onClick={e => { e.stopPropagation(); toggle(v); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 1px", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center" }}>
                <X style={{ width: 10, height: 10 }} />
              </button>
            </span>
          );
          return <span key={v} style={{ display: "inline-flex", minWidth: 0 }}>{hoverWrap ? hoverWrap(v, chip) : chip}</span>;
        })}
        <ChevronDown style={{ marginLeft: "auto", width: 13, height: 13, color: "hsl(var(--muted-foreground))", flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      </div>

      {/* ── Dropdown ─────────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: "absolute",
          ...(popupSide === "right"
            ? { left: "calc(100% + 8px)", top: 0, bottom: "auto", right: "auto", width: 280 }
            : openUp
              ? { bottom: "calc(100% + 4px)", top: "auto", left: 0, right: 0 }
              : { top: "calc(100% + 4px)", bottom: "auto", left: 0, right: 0 }),
          zIndex: 50,
          background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
          borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column", maxHeight: 300,
        }}>
          {/* Search bar — only when list is long */}
          {showSearch && (
            <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(var(--border))", flexShrink: 0 }}
              onClick={e => e.stopPropagation()}>
              <div style={{ position: "relative" }}>
                <Search style={{
                  position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                  width: 13, height: 13, color: "hsl(var(--muted-foreground))", pointerEvents: "none",
                }} />
                <input ref={searchRef} type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && visibleOptions.length === 1) {
                      e.preventDefault(); toggle(visibleOptions[0].value); setSearch("");
                    }
                    if (e.key === "Escape") { setOpen(false); setSearch(""); }
                  }}
                  placeholder="Search…"
                  style={{
                    width: "100%", padding: "5px 8px 5px 28px", fontSize: 12.5,
                    borderRadius: 5, border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--background))", color: "hsl(var(--foreground))",
                    outline: "none", boxSizing: "border-box",
                  }} />
              </div>
            </div>
          )}

          {/* Option list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {visibleOptions.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
                {q ? `No matches for "${search}"` : "Nothing to pick yet"}
              </div>
            )}
            {visibleOptions.map(opt => (
              <label key={opt.value} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                cursor: "pointer", fontSize: 13, color: "hsl(var(--popover-foreground))",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--muted))")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)}
                  style={{ accentColor: "hsl(var(--primary))", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                {opt.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: opt.color, flexShrink: 0 }} />}
                {hoverWrap ? hoverWrap(opt.value, <span>{opt.label}</span>) : opt.label}
              </label>
            ))}
          </div>

          {/* Custom free-text entry row (for stage pickers) */}
          {customPlaceholder !== undefined && (
            <div style={{ padding: "8px 10px", borderTop: "1px solid hsl(var(--border))", display: "flex", gap: 6, flexShrink: 0 }}>
              <input type="text" value={customInput} onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
                placeholder={customPlaceholder}
                style={{
                  flex: 1, padding: "4px 8px", fontSize: 12, borderRadius: 4,
                  border: "1px solid hsl(var(--border))", background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))", outline: "none",
                }} />
              <button type="button" onClick={addCustom} style={{
                padding: "4px 10px", fontSize: 12, borderRadius: 4, fontWeight: 600,
                background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))",
                border: "none", cursor: "pointer",
              }}>Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
