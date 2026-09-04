import React from "react";
import { View } from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";

export type HealthIssue = { text: string; deduction: number };

export function healthColor(score: number): string {
  if (score < 0) return "#6B7280";
  if (score >= 80) return "#84CC16";
  if (score >= 60) return "#FB923C";
  return "#F87171";
}

export function healthLabel(score: number): string {
  if (score < 0) return "N/A";
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}

function shadeColor(input: string, amount: number): string {
  let r = 0, g = 0, b = 0;
  const m = input.trim();
  if (m.startsWith("#")) {
    const h = m.slice(1);
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    const mm = m.match(/rgba?\(([^)]+)\)/);
    if (mm) {
      const parts = mm[1].split(",").map(s => parseFloat(s.trim()));
      r = parts[0] || 0; g = parts[1] || 0; b = parts[2] || 0;
    }
  }
  const adj = (c: number) => {
    if (amount >= 0) return Math.round(c + (255 - c) * amount);
    return Math.round(c * (1 + amount));
  };
  return `rgb(${adj(r)}, ${adj(g)}, ${adj(b)})`;
}

export function HealthGauge({ score, issues = [], size = 130, closed = false }: { score: number; issues?: HealthIssue[]; size?: number; closed?: boolean }) {
  const padding = 26;
  const totalSize = size + padding * 2;
  const strokeW = 14;
  const r = (size - strokeW) / 2;
  const cx = totalSize / 2;
  const cy = totalSize / 2;
  const startAngle = 135;
  const arcDegrees = 270;
  // Closed/terminal projects render in neutral gray, not red — closed isn't critical, it's just closed.
  const hc = closed ? "#9CA3AF" : healthColor(score);
  const closedLabel = "CLOSED";
  const deductionColor = "rgba(148, 163, 184, 0.55)";
  const segments: { value: number; color: string; label?: string }[] = [];
  const safeScore = Math.max(0, Math.min(100, score));
  if (safeScore > 0) segments.push({ value: safeScore, color: hc });
  issues.forEach((iss) => {
    if (iss.deduction > 0) {
      segments.push({ value: iss.deduction, color: deductionColor, label: `−${iss.deduction}` });
    }
  });
  const total = 100;
  const gapDeg = segments.length > 1 ? 3 : 0;
  const totalGap = gapDeg * Math.max(0, segments.length - 1);
  const usableDeg = arcDegrees - totalGap;
  function polar(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  function arcPath(startA: number, endA: number, radius: number, dx = 0, dy = 0) {
    const s = polar(startA, radius);
    const e = polar(endA, radius);
    const largeArc = endA - startA > 180 ? 1 : 0;
    return `M ${s.x + dx} ${s.y + dy} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x + dx} ${e.y + dy}`;
  }
  let cursor = startAngle;
  const rendered = segments.map((seg) => {
    const segDeg = (seg.value / total) * usableDeg;
    const segStart = cursor;
    const segEnd = cursor + segDeg;
    cursor = segEnd + gapDeg;
    return { ...seg, segStart, segEnd };
  });
  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={totalSize} height={totalSize} viewBox={`0 0 ${totalSize} ${totalSize}`}>
        <Path d={arcPath(startAngle, startAngle + arcDegrees, r, 1, 2)} stroke="rgba(27,43,56,0.10)" strokeWidth={strokeW + 2} fill="none" strokeLinecap="round" />
        <Path d={arcPath(startAngle, startAngle + arcDegrees, r)} stroke="rgba(27,43,56,0.08)" strokeWidth={strokeW} fill="none" strokeLinecap="round" />
        {rendered.map((s, i) => (
          <Path key={`shadow-${i}`} d={arcPath(s.segStart, s.segEnd, r, 1.5, 2.5)} stroke={shadeColor(s.color, -0.55)} strokeWidth={strokeW + 1} fill="none" strokeLinecap="round" opacity={0.55} />
        ))}
        {rendered.map((s, i) => (
          <Path key={`base-${i}`} d={arcPath(s.segStart, s.segEnd, r)} stroke={s.color} strokeWidth={strokeW} fill="none" strokeLinecap="round" />
        ))}
        {rendered.map((s, i) => (
          <Path key={`hi-${i}`} d={arcPath(s.segStart, s.segEnd, r, -0.6, -1.2)} stroke={shadeColor(s.color, 0.55)} strokeWidth={strokeW * 0.45} fill="none" strokeLinecap="round" opacity={0.7} />
        ))}
        {rendered.map((s, i) => (
          <Path key={`gloss-${i}`} d={arcPath(s.segStart, s.segEnd, r, -0.3, -2)} stroke={shadeColor(s.color, 0.85)} strokeWidth={strokeW * 0.18} fill="none" strokeLinecap="round" opacity={0.6} />
        ))}
        {rendered.map((s, i) => {
          if (!s.label) return null;
          const midA = (s.segStart + s.segEnd) / 2;
          const labelPos = polar(midA, r + 16);
          return (
            <SvgText key={`lbl-${i}`} x={labelPos.x} y={labelPos.y + 3} fontSize="10" fontWeight="bold" fill="rgba(226, 232, 240, 0.85)" textAnchor="middle">
              {s.label}
            </SvgText>
          );
        })}
        <SvgText x={cx + 1} y={cy - 2} fontSize="34" fontWeight="bold" fill="rgba(27,43,56,0.18)" textAnchor="middle">{closed ? "—" : score}</SvgText>
        <SvgText x={cx} y={cy - 4} fontSize="34" fontWeight="bold" fill={hc} textAnchor="middle">{closed ? "—" : score}</SvgText>
        <SvgText x={cx} y={cy + 16} fontSize="10" fontWeight="700" fill={hc} textAnchor="middle" opacity={0.85}>{closed ? closedLabel : healthLabel(score).toUpperCase()}</SvgText>
      </Svg>
    </View>
  );
}
