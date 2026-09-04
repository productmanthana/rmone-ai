// ── MemberActionMenu ─────────────────────────────────────────────────────────
// The "⋯" menu shown right after a team member's name on every team surface
// (SimpleTeamTable, TeamScheduleGrid, TeamGantt's member popup). Hosts the
// member-level actions that used to live as standalone icon buttons:
//   • Change resource… — hands the remaining (future) weeks to another person
//   • Remove from team… — the existing confirm-and-soft-delete flow
// Both actions are manage-staff gated by the HOSTS (they simply don't pass the
// callbacks when the viewer lacks the capability), so this component stays a
// dumb presenter.
//
// Rendered as span[role=button] — NEVER a real <button> — because some host
// rows/cells are themselves clickable (memory/nested-interactive-buttons).
// The dropdown portals to <body> at a fixed position (z 9500: above the team
// grids and the TeamGantt member popup, below RemoveMemberConfirm's 10000+),
// and closes on outside click, Esc, scroll, or resize.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, UserCog, Trash2 } from "lucide-react";
import { Z } from "@/lib/zLayers";

const C = {
  border: "#D5DEE5",
  text: "#253746",
  muted: "#6B7E8A",
  red: "#E85D4A",
  orange: "#E87722",
};

export function MemberActionMenu({
  name, onChangeResource, onRemove, disabledNote, size = 15,
}: {
  /** Member display name — used for aria labels only. */
  name: string;
  /** Omit to hide the "Change resource…" item. */
  onChangeResource?: () => void;
  /** Omit to hide the "Remove from team…" item. */
  onRemove?: () => void;
  /** When set, the trigger renders dimmed and shows this note as its tooltip
   *  instead of opening the menu (e.g. record locked for edits). */
  disabledNote?: string | null;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = [
    onChangeResource ? { key: "change", label: "Change resource…", icon: <UserCog size={13} color={C.orange} />, run: onChangeResource, color: C.text } : null,
    onRemove ? { key: "remove", label: "Remove from team…", icon: <Trash2 size={13} color={C.red} />, run: onRemove, color: C.red } : null,
  ].filter((i): i is NonNullable<typeof i> => i != null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node | null;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
    };
    const onScroll = (e: Event) => {
      // Scrolling inside the menu itself is fine; any outer scroll closes it
      // (cheaper + less glitchy than repositioning a portal mid-scroll).
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  if (items.length === 0) return null;
  const disabled = !!disabledNote;

  const toggle = () => {
    if (disabled) return;
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = items.length * 34 + 12;
    const up = r.bottom + menuH + 8 > window.innerHeight;
    setPos({
      top: up ? r.top - menuH - 4 : r.bottom + 4,
      left: Math.min(r.left, window.innerWidth - 190),
      up,
    });
    setOpen(true);
  };

  return (
    <>
      <span
        ref={btnRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? disabledNote ?? undefined : `Actions for ${name}`}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(); }
        }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: size + 7, height: size + 5, borderRadius: 5, flexShrink: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          color: open ? C.text : C.muted,
          backgroundColor: open ? "rgba(37,55,70,0.10)" : "transparent",
          opacity: disabled ? 0.35 : 1,
          transition: "background 0.15s, color 0.15s",
        }}
        onMouseEnter={(e) => { if (!disabled && !open) (e.currentTarget as HTMLSpanElement).style.backgroundColor = "rgba(37,55,70,0.08)"; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLSpanElement).style.backgroundColor = "transparent"; }}
      >
        <MoreHorizontal size={size} />
      </span>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${name}`}
          style={{
            position: "fixed", top: pos.top, left: pos.left, zIndex: Z.DRAWER_TIP,
            minWidth: 178, padding: 6, borderRadius: 10,
            backgroundColor: "#FFFFFF", border: `1px solid ${C.border}`,
            boxShadow: "0 10px 32px rgba(16,32,44,0.22)",
          }}
        >
          {items.map((it) => (
            <span
              key={it.key}
              role="menuitem"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.run(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(false); it.run(); }
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                fontSize: 12, fontWeight: 600, color: it.color,
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLSpanElement).style.backgroundColor = "#F1F5F8"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLSpanElement).style.backgroundColor = "transparent"; }}
            >
              {it.icon}
              {it.label}
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
