import React, { useEffect, useRef, useState } from "react";

type AnimatedNumberProps = {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Tween a numeric value when it changes. Uses requestAnimationFrame so
 * there's no library cost and it respects prefers-reduced-motion. Falls
 * back to the final value instantly when the user has reduced motion on,
 * when the delta is zero, or in non-browser environments.
 */
export function AnimatedNumber({
  value,
  duration = 700,
  format = (n: number) => Math.round(n).toLocaleString(),
  className,
  style,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState<number>(value);
  const fromRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    const to = value;
    if (from === to || reduce || typeof window === "undefined") {
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast at first, settles smoothly.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return (
    <span className={className} style={style} data-testid="animated-number">
      {format(display)}
    </span>
  );
}
