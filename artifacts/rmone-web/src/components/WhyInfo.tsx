import React, { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

type WhyInfoProps = {
  /** Short title shown at the top of the popover. */
  title: string;
  /** 1-3 short sentences explaining the underlying threshold or query. */
  body: string;
  /** Optional list of bullet points for additional context. */
  bullets?: string[];
  /** Visual size of the info icon. */
  size?: number;
  /** Tone — light for dark backgrounds, dark for white cards. */
  tone?: "light" | "dark";
  /** Which edge the popover anchors to. "right" (default) grows leftward;
   *  use "left" when the trigger sits near the left edge so the panel grows
   *  rightward and doesn't get clipped off-screen. */
  align?: "left" | "right";
  /** Optional className for the wrapper button. */
  className?: string;
};

/**
 * Tiny "why am I seeing this?" affordance. Renders an inline info
 * icon button; on click, pops a small panel explaining the threshold,
 * query, or rule that surfaced the data. Builds trust in the AI by
 * exposing the reasoning behind every card.
 */
export function WhyInfo({
  title,
  body,
  bullets,
  size = 12,
  tone = "dark",
  align = "right",
  className,
}: WhyInfoProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const iconColor =
    tone === "light" ? "rgba(255,255,255,0.55)" : "rgba(27,43,56,0.45)";
  const iconHover =
    tone === "light" ? "rgba(255,255,255,0.85)" : "rgba(27,43,56,0.80)";

  return (
    <div ref={ref} className={`relative inline-flex ${className ?? ""}`}>
      {/* span+role, not <button>: this affordance often sits inside clickable
          cards that are themselves <button>s — nested <button>s are invalid
          HTML and React logs a hydration error for them. */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }
        }}
        className="inline-flex items-center justify-center rounded-full transition-colors"
        style={{
          width: size + 4,
          height: size + 4,
          color: open ? iconHover : iconColor,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = iconHover)}
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = open ? iconHover : iconColor)
        }
        aria-label={`Why am I seeing this — ${title}`}
        aria-expanded={open}
        data-testid="why-info-trigger"
      >
        <Info size={size} strokeWidth={2.2} />
      </span>
      {open && (
        <div
          className="absolute z-50 rounded-lg p-3"
          style={{
            top: "100%",
            ...(align === "left" ? { left: 0 } : { right: 0 }),
            marginTop: 6,
            minWidth: 240,
            maxWidth: 300,
            backgroundColor: "#FFFFFF",
            color: "#1B2B38",
            border: "1px solid rgba(27,43,56,0.18)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`Why am I seeing this — ${title}`}
          data-testid="why-info-popover"
        >
          <div
            className="text-[10px] font-extrabold uppercase tracking-wider mb-1"
            style={{ color: "#15803D" }}
          >
            Why am I seeing this
          </div>
          <div className="text-[12px] font-bold mb-1.5">{title}</div>
          <div
            className="text-[11.5px] leading-snug"
            style={{ color: "rgba(27,43,56,0.78)" }}
          >
            {body}
          </div>
          {bullets && bullets.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {bullets.map((b, i) => (
                <li
                  key={i}
                  className="text-[11px] leading-snug flex gap-1.5"
                  style={{ color: "rgba(27,43,56,0.72)" }}
                >
                  <span style={{ color: "#15803D", fontWeight: 700 }}>•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
