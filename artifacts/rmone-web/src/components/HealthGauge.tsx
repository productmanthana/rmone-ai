import React, { useId } from "react";

export function healthColor(score: number): string {
  if (score < 0) return "#6B7280";
  if (score >= 80) return "#A9C23F";
  if (score >= 60) return "#FB923C";
  return "#F87171";
}
export function healthLabel(score: number): string {
  if (score < 0) return "N/A";
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}

export function HealthGauge({
  score,
  size = 160,
  caption = "/ 100 · forecast",
}: {
  score: number;
  size?: number;
  caption?: string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const safe = Math.max(0, Math.min(100, score));
  const stroke = Math.round(size * 0.085);
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const dash = (safe / 100) * c;
  const hc = healthColor(score);
  const trackBg = "var(--rm-panel-border)";
  const trackInner = "var(--rm-panel-soft)";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id={`hg-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={hc} stopOpacity={0.85} />
            <stop offset="100%" stopColor={hc} stopOpacity={1} />
          </linearGradient>
          <filter id={`hgGlow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
        </defs>
        {/* inner shadow */}
        <circle cx={cx} cy={cy} r={r - stroke / 2 + 1} fill="none" stroke={trackInner} strokeWidth={1} />
        {/* background track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackBg} strokeWidth={stroke} strokeLinecap="round" />
        {/* glow under fill */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={hc}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          opacity={0.35}
          filter={`url(#hgGlow-${uid})`}
        />
        {/* main fill */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#hg-${uid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <div
          style={{
            fontSize: size * 0.26,
            fontWeight: 800,
            color: hc,
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          {Math.max(0, Math.round(score))}
        </div>
        <div
          style={{
            fontSize: Math.max(8, size * 0.065),
            color: "rgba(255,255,255,0.55)",
            marginTop: 3,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {caption}
        </div>
        <div
          style={{
            fontSize: Math.max(8, size * 0.06),
            color: hc,
            marginTop: 3,
            fontWeight: 800,
            letterSpacing: "0.12em",
          }}
        >
          {healthLabel(score).toUpperCase()}
        </div>
      </div>
    </div>
  );
}
