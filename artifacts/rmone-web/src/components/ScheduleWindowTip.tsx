// ── ScheduleWindowTip ────────────────────────────────────────────────────────
// Small hover/click popup for schedule-clamped date inputs. The browser's
// native date picker greys out days outside min/max but never explains WHY —
// this wrapper shows a short plain-words hint (on hover and on click, i.e.
// right when the native calendar opens) telling the user the dates are limited
// to the project's phase schedule and that the schedule itself must be changed
// first to go beyond it.
//
// Rendered through a document.body portal with fixed positioning (same pattern
// as the InlineAddMemberRow picker panel) so it is never clipped by grid or
// modal overflow containers. Inactive (`active={false}`) it renders a plain
// pass-through wrapper — callers keep it mounted unconditionally and let the
// flag decide, so the display-mode gating stays in ONE place upstream
// (hasScheduleWindow is already zeroed outside "full" display mode).
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z } from "@/lib/zLayers";

const TIP_W = 262;
const TIP_EST_H = 74; // rough height used only for the flip-above decision

export function ScheduleWindowTip({ active, windowLabel, style, children }: {
  active: boolean;
  windowLabel: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  if (!active) return <div style={style}>{children}</div>;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - TIP_W - 8));
    const below = r.bottom + 6 + TIP_EST_H <= window.innerHeight;
    setPos({ x, y: below ? r.bottom + 6 : Math.max(8, r.top - 6 - TIP_EST_H) });
  };
  const hide = () => setPos(null);

  return (
    <div
      ref={ref}
      style={style}
      onMouseEnter={show}
      onMouseLeave={hide}
      onClickCapture={show}
      // Touch devices never fire mouseleave — hide when focus leaves the
      // input (tap elsewhere) so the tip can't get stuck on screen.
      onBlurCapture={hide}
    >
      {children}
      {pos && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed", left: pos.x, top: pos.y, width: TIP_W,
            // Must clear the highest modal layers: AllocationTemplateModal's
            // overlay sits at zIndex 9000 and its apply sub-modal at 9100 —
            // both are fixed-position siblings of this portal on body.
            zIndex: Z.DRAWER_TIP, pointerEvents: "none",
            background: "#243239", color: "#EAF2F6",
            borderRadius: 8, padding: "8px 11px",
            fontSize: 11, lineHeight: 1.45, fontWeight: 500,
            boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
          }}
        >
          Dates here are limited to the project schedule ({windowLabel}).
          To pick a date outside this range, please change the project
          schedule dates first.
        </div>,
        document.body,
      )}
    </div>
  );
}
