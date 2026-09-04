import { compactUsd } from "@/lib/money";
import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Dimensions } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Rect,
  Circle,
  Path,
  G,
  Text as SvgText,
} from "react-native-svg";
import { Feather } from "@/lib/icons";
import { Colors } from "@/constants/colors";

const SCREEN_W = Math.min(Dimensions.get("window").width, 420);

function fmtM(v: number) {
  if (v >= 1e9) return compactUsd(v);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export interface DashboardData {
  totalActiveVal: number;
  totalOpmVal: number;
  totalLemVal: number;
  activeCount: number;
  opmCount: number;
  lemCount: number;
  topSectors: [string, { won: number; lost: number; activeCount: number; activeVal: number }][];
  topCities: [string, { count: number; val: number }][];
  maxCityVal: number;
  topOpmStatuses: [string, number][];
  maxOpmCount: number;
  valueRanges: { label: string; min: number; max: number; count: number }[];
  maxValCount: number;
  sectorVal: [string, { won: number; lost: number; activeCount: number; activeVal: number }][];
  totalSectorVal: number;
  pivotLabel: string;
  pivotVal: [string, { count: number; val: number }][];
  totalPivotVal: number;
}

const GLOW_COLORS = {
  green: { from: "#6BA539", to: "#A9C23F", dim: "#6BA53920", glow: "#6BA53960" },
  orange: { from: "#E87722", to: "#FF9425", dim: "#E8772220", glow: "#E8772260" },
  blue: { from: "#6B7FF0", to: "#8BA4FF", dim: "#6B7FF020", glow: "#6B7FF060" },
  red: { from: "#E03C3C", to: "#FF6B6B", dim: "#E03C3C20", glow: "#E03C3C60" },
  purple: { from: "#9B6BF0", to: "#B68AFF", dim: "#9B6BF020", glow: "#9B6BF060" },
  yellow: { from: "#F5B731", to: "#FFD666", dim: "#F5B73120", glow: "#F5B73160" },
};

function Tooltip({ text, color, visible }: { text: string; color: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: -36,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 100,
      }}
    >
      <View
        style={{
          backgroundColor: "rgba(15,25,35,0.95)",
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: color + "50",
          shadowColor: color,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 8,
        }}
      >
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.cardText, textAlign: "center" }}>
          {text}
        </Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 5,
          borderRightWidth: 5,
          borderTopWidth: 5,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color + "50",
        }}
      />
    </View>
  );
}

function GlassCard({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View
      style={[
        {
          backgroundColor: "rgba(30,42,58,0.85)",
          borderRadius: 20,
          padding: 18,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
          elevation: 8,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function CardHeader({ icon, color, title }: { icon: string; color: string; title: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: color + "18",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: color + "30",
        }}
      >
        <Feather name={icon as any} size={15} color={color} />
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.cardText }}>{title}</Text>
    </View>
  );
}

function KPICard({ label, value, count, gradient }: { label: string; value: string; count: string; gradient: { from: string; to: string } }) {
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: gradient.from + "25",
        }}
      >
        <Svg width="100%" height="100" style={{ position: "absolute" }}>
          <Defs>
            <LinearGradient id={`kpi-${label}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={gradient.from} stopOpacity="0.15" />
              <Stop offset="1" stopColor={gradient.to} stopOpacity="0.03" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100" fill={`url(#kpi-${label})`} />
        </Svg>
        <View style={{ padding: 12, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 8,
              color: gradient.from,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {label}
          </Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.cardText }}>
            {value}
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 3 }}>
            {count}
          </Text>
        </View>
      </View>
    </View>
  );
}

function DonutChart3D({
  segments,
  size = 160,
  strokeWidth = 18,
  centerLabel,
  centerValue,
  selectedIndex,
  onSelect,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  strokeWidth?: number;
  centerLabel: string;
  centerValue: string;
  selectedIndex?: number | null;
  onSelect?: (i: number | null) => void;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let accumulated = 0;

  const segRanges: { startPct: number; endPct: number }[] = [];
  let acc2 = 0;
  for (const seg of segments) {
    const pct = seg.value / total;
    segRanges.push({ startPct: acc2, endPct: acc2 + pct });
    acc2 += pct;
  }

  const handleTouch = (evt: any) => {
    if (!onSelect) return;
    const { locationX, locationY } = evt.nativeEvent;
    const cx = size / 2;
    const cy = size / 2;
    const dx = locationX - cx;
    const dy = locationY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const innerR = radius - strokeWidth / 2 - 4;
    const outerR = radius + strokeWidth / 2 + 4;
    if (dist < innerR) {
      onSelect(null);
      return;
    }
    if (dist > outerR) {
      onSelect(null);
      return;
    }
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = (angle + 90 + 360) % 360;
    const tapPct = angle / 360;
    for (let i = 0; i < segRanges.length; i++) {
      if (tapPct >= segRanges[i].startPct && tapPct < segRanges[i].endPct) {
        onSelect(selectedIndex === i ? null : i);
        return;
      }
    }
    onSelect(null);
  };

  return (
    <View style={{ alignItems: "center" }}>
      <Pressable onPressIn={handleTouch}>
        <Svg width={size} height={size}>
          <Defs>
            {segments.map((seg, i) => (
              <LinearGradient key={i} id={`donut-g-${i}`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={seg.color} stopOpacity="1" />
                <Stop offset="1" stopColor={seg.color} stopOpacity="0.6" />
              </LinearGradient>
            ))}
          </Defs>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg, i) => {
            const pct = seg.value / total;
            const dash = pct * circumference;
            const gap = circumference - dash;
            const offset = -accumulated * circumference + circumference * 0.25;
            accumulated += pct;
            const isSelected = selectedIndex === i;
            return (
              <G key={i}>
                {isSelected && (
                  <Circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={strokeWidth + 8}
                    strokeDasharray={`${dash} ${gap}`}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    opacity={0.25}
                  />
                )}
                <Circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={`url(#donut-g-${i})`}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  opacity={selectedIndex != null && !isSelected ? 0.3 : 1}
                />
              </G>
            );
          })}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius - strokeWidth / 2 - 2}
            fill="none"
            stroke="rgba(255,255,255,0.03)"
            strokeWidth={1}
          />
        </Svg>
      </Pressable>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        {selectedIndex != null && selectedIndex < segments.length ? (
          <>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: segments[selectedIndex].color }}>
              {Math.round((segments[selectedIndex].value / total) * 100)}%
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: "Inter_600SemiBold", fontSize: 8, color: "rgba(255,255,255,0.7)", marginTop: 1, maxWidth: size * 0.5, textAlign: "center" }}>
              {segments[selectedIndex].label}
            </Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
              {fmtM(segments[selectedIndex].value)}
            </Text>
          </>
        ) : (
          <>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.cardText }}>{centerValue}</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{centerLabel}</Text>
          </>
        )}
      </View>
    </View>
  );
}

function Bar3D({
  height,
  maxHeight,
  width,
  colorFrom,
  colorTo,
  label,
  value,
  index,
  selected,
  onPress,
  tooltipText,
}: {
  height: number;
  maxHeight: number;
  width: number;
  colorFrom: string;
  colorTo: string;
  label: string;
  value: string;
  index: number;
  selected?: boolean;
  onPress?: () => void;
  tooltipText?: string;
}) {
  const barH = Math.max(height, 6);
  const depth = 8;
  const svgH = maxHeight + depth + 24;

  const x0 = 2;
  const y0 = svgH - barH - 2;
  const bw = width - depth - 4;

  const frontPath = `M${x0},${y0} L${x0},${svgH - 2} L${x0 + bw},${svgH - 2} L${x0 + bw},${y0} Z`;
  const topPath = `M${x0},${y0} L${x0 + depth},${y0 - depth} L${x0 + bw + depth},${y0 - depth} L${x0 + bw},${y0} Z`;
  const sidePath = `M${x0 + bw},${y0} L${x0 + bw + depth},${y0 - depth} L${x0 + bw + depth},${svgH - 2 - depth} L${x0 + bw},${svgH - 2} Z`;

  return (
    <Pressable onPress={onPress} style={{ alignItems: "center", flex: 1 }}>
      <View style={{ position: "relative" }}>
        {selected && tooltipText && (
          <View
            style={{
              position: "absolute",
              top: -28,
              left: -20,
              right: -20,
              alignItems: "center",
              zIndex: 100,
            }}
          >
            <View
              style={{
                backgroundColor: "rgba(15,25,35,0.95)",
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colorFrom + "50",
              }}
            >
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 9, color: Colors.cardText, textAlign: "center" }}>
                {tooltipText}
              </Text>
            </View>
          </View>
        )}
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: selected ? Colors.white : colorFrom, marginBottom: 4, textAlign: "center" }}>
          {value}
        </Text>
        <Svg width={width} height={svgH}>
          <Defs>
            <LinearGradient id={`bar3d-f-${index}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colorFrom} stopOpacity={selected ? "1" : "1"} />
              <Stop offset="1" stopColor={colorTo} stopOpacity={selected ? "0.9" : "0.7"} />
            </LinearGradient>
            <LinearGradient id={`bar3d-t-${index}`} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={colorFrom} stopOpacity="0.9" />
              <Stop offset="1" stopColor={colorTo} stopOpacity="1" />
            </LinearGradient>
            <LinearGradient id={`bar3d-s-${index}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colorFrom} stopOpacity="0.5" />
              <Stop offset="1" stopColor={colorTo} stopOpacity="0.3" />
            </LinearGradient>
          </Defs>
          <Path d={frontPath} fill={`url(#bar3d-f-${index})`} opacity={selected ? 1 : 0.85} />
          <Path d={topPath} fill={`url(#bar3d-t-${index})`} opacity={selected ? 1 : 0.85} />
          <Path d={sidePath} fill={`url(#bar3d-s-${index})`} opacity={selected ? 1 : 0.85} />
          {selected && (
            <Rect x={x0 - 1} y={y0 - 1} width={bw + 2} height={barH + 3} rx={2} fill="none" stroke={colorFrom} strokeWidth={1.5} opacity={0.6} />
          )}
        </Svg>
      </View>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 8, color: selected ? Colors.white : "rgba(255,255,255,0.45)", marginTop: 3, textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function GlowBar({
  pct,
  color,
  height = 10,
}: {
  pct: number;
  color: string;
  height?: number;
}) {
  return (
    <View
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: "rgba(255,255,255,0.04)",
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${Math.max(pct, 2)}%` as any,
          height: "100%",
          borderRadius: height / 2,
          backgroundColor: color,
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 6,
          elevation: 4,
        }}
      />
    </View>
  );
}

function WinLossBar3D({
  wonPct,
  width,
  index,
}: {
  wonPct: number;
  width: number;
  index: number;
}) {
  const h = 14;
  const d = 4;
  const svgW = width;
  const svgH = h + d + 2;
  const wonW = (wonPct / 100) * (svgW - d);
  const lostW = svgW - d - wonW;

  return (
    <Svg width={svgW} height={svgH}>
      <Defs>
        <LinearGradient id={`wl-won-${index}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={GLOW_COLORS.green.from} stopOpacity="1" />
          <Stop offset="1" stopColor={GLOW_COLORS.green.to} stopOpacity="0.9" />
        </LinearGradient>
        <LinearGradient id={`wl-lost-${index}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={GLOW_COLORS.red.from} stopOpacity="0.4" />
          <Stop offset="1" stopColor={GLOW_COLORS.red.to} stopOpacity="0.25" />
        </LinearGradient>
      </Defs>
      {wonW > 0 && (
        <>
          <Rect x="0" y={d} width={wonW} height={h} rx={4} fill={`url(#wl-won-${index})`} />
          <Path
            d={`M0,${d} L${d},0 L${Math.min(wonW + d, svgW)},0 L${wonW},${d} Z`}
            fill={GLOW_COLORS.green.to}
            opacity={0.7}
          />
        </>
      )}
      {lostW > 0 && (
        <Rect x={wonW} y={d} width={lostW} height={h} rx={wonW > 0 ? 0 : 4} fill={`url(#wl-lost-${index})`} />
      )}
    </Svg>
  );
}

function MarketBar3D({
  pct,
  color,
  index,
  width,
}: {
  pct: number;
  color: string;
  index: number;
  width: number;
}) {
  const h = 10;
  const d = 4;
  const svgH = h + d + 2;
  const barW = Math.max((pct / 100) * (width - d), 4);

  return (
    <Svg width={width} height={svgH}>
      <Defs>
        <LinearGradient id={`mkt-${index}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="0.5" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y={d} width={barW} height={h} rx={3} fill={`url(#mkt-${index})`} />
      <Path
        d={`M0,${d} L${d},0 L${barW + d},0 L${barW},${d} Z`}
        fill={color}
        opacity={0.5}
      />
      <Path
        d={`M${barW},${d} L${barW + d},0 L${barW + d},${h} L${barW},${h + d} Z`}
        fill={color}
        opacity={0.3}
      />
    </Svg>
  );
}

export default function AnalyticsDashboard({
  data,
  onClose,
  insets,
}: {
  data: DashboardData;
  onClose: () => void;
  insets: { top: number; bottom: number };
}) {
  const {
    totalActiveVal, totalOpmVal, totalLemVal,
    activeCount: dActiveCount, opmCount, lemCount,
    topSectors, topCities, maxCityVal,
    topOpmStatuses, maxOpmCount,
    valueRanges, maxValCount,
    sectorVal, totalSectorVal,
    pivotLabel, pivotVal, totalPivotVal,
  } = data;

  const [selectedDonutSector, setSelectedDonutSector] = useState<number | null>(null);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const [selectedWinSector, setSelectedWinSector] = useState<number | null>(null);
  const hasRealWinLossSectors = topSectors.some(s => {
    const d = s[1];
    return (d.won + d.lost) > 0 && s[0].toLowerCase() !== "other";
  });
  const [selectedCity, setSelectedCity] = useState<number | null>(null);
  const [selectedOpmDonut, setSelectedOpmDonut] = useState<number | null>(null);
  const [selectedOpmStatus, setSelectedOpmStatus] = useState<number | null>(null);

  const barColors = [
    GLOW_COLORS.green.from,
    GLOW_COLORS.orange.from,
    GLOW_COLORS.blue.from,
    GLOW_COLORS.yellow.from,
    GLOW_COLORS.purple.from,
    GLOW_COLORS.red.from,
    "#C97040",
    "#8899AA",
  ];

  const chartW = Math.min(SCREEN_W - 72, 320);

  return (
    <View style={{ flex: 1, backgroundColor: "#0F1923" }}>
      <Svg width="100%" height="100%" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="bg-grad" x1="0" y1="0" x2="0.3" y2="1">
            <Stop offset="0" stopColor="#1A2B3D" stopOpacity="1" />
            <Stop offset="0.5" stopColor="#0F1923" stopOpacity="1" />
            <Stop offset="1" stopColor="#0A1219" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bg-grad)" />
        <Circle cx="15%" cy="20%" r="150" fill={GLOW_COLORS.green.from} opacity={0.03} />
        <Circle cx="85%" cy="60%" r="200" fill={GLOW_COLORS.blue.from} opacity={0.02} />
        <Circle cx="50%" cy="90%" r="120" fill={GLOW_COLORS.orange.from} opacity={0.02} />
      </Svg>

      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 18,
          paddingBottom: 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.06)",
        }}
      >
        <Pressable onPress={onClose} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
          <Feather name="arrow-left" size={20} color={Colors.white} />
          <Text style={{ color: Colors.cardText, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Back</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather name="bar-chart-2" size={16} color={GLOW_COLORS.green.from} />
          <Text style={{ color: Colors.cardText, fontFamily: "Inter_700Bold", fontSize: 17 }}>Analytics</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          <KPICard label="Open PMM" value={fmtM(totalActiveVal)} count={`${dActiveCount} projects`} gradient={GLOW_COLORS.green} />
          <KPICard label="OPM Pipeline" value={fmtM(totalOpmVal)} count={`${opmCount} opps`} gradient={GLOW_COLORS.orange} />
          <KPICard label="LEM Leads" value={fmtM(totalLemVal)} count={`${lemCount} leads`} gradient={GLOW_COLORS.blue} />
        </View>


        {/* Concentration — auto-pivots to whichever grouping field has the most data
             in this tenant: Sector → Client → Division → Contract Type → Project Type → City. */}
        <GlassCard>
          <CardHeader icon="pie-chart" color={GLOW_COLORS.green.from} title={`${pivotLabel} Concentration`} />
          {pivotVal.length === 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
              <Feather name="info" size={12} color="rgba(255,255,255,0.5)" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.6)", flex: 1 }}>
                No grouping fields (sector, client, division, contract type) are filled on active projects yet. Fill any one in RM ONE to see the breakdown.
              </Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <DonutChart3D
                  size={140}
                  strokeWidth={20}
                  centerValue={fmtM(totalActiveVal)}
                  centerLabel="Open Value"
                  selectedIndex={selectedDonutSector}
                  onSelect={setSelectedDonutSector}
                  segments={pivotVal.slice(0, 6).map(([label, d], i) => ({
                    value: d.val,
                    color: barColors[i % barColors.length],
                    label,
                  }))}
                />
                <View style={{ flex: 1, marginLeft: 14, gap: 5 }}>
                  {pivotVal.slice(0, 6).map(([name, d], i) => {
                    const pct = Math.round((d.val / totalPivotVal) * 100);
                    const isSelected = selectedDonutSector === i;
                    return (
                      <Pressable
                        key={name}
                        onPress={() => setSelectedDonutSector(isSelected ? null : i)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingVertical: 2,
                          paddingHorizontal: 4,
                          borderRadius: 6,
                          backgroundColor: isSelected ? barColors[i % barColors.length] + "20" : "transparent",
                        }}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: barColors[i % barColors.length] }} />
                        <Text numberOfLines={2} ellipsizeMode="tail" style={{ fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 10, lineHeight: 13, color: isSelected ? Colors.white : "rgba(255,255,255,0.55)", flex: 1 }}>
                          {name}
                        </Text>
                        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: isSelected ? barColors[i % barColors.length] : Colors.white }}>{pct}%</Text>
                        {isSelected && (
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                            {fmtM(d.val)} · {d.count}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              {pivotVal.length > 1 && Math.round((pivotVal[0][1].val / totalPivotVal) * 100) >= 40 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, padding: 8, backgroundColor: GLOW_COLORS.orange.dim, borderRadius: 10, borderWidth: 1, borderColor: GLOW_COLORS.orange.from + "25" }}>
                  <Feather name="alert-triangle" size={12} color={GLOW_COLORS.orange.from} />
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: GLOW_COLORS.orange.from, flex: 1 }}>
                    Concentration risk: {pivotVal[0][0]} is {Math.round((pivotVal[0][1].val / totalPivotVal) * 100)}% of open value
                  </Text>
                </View>
              )}
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 8, textAlign: "center" }}>
                Grouped by {pivotLabel.toLowerCase()} · {pivotVal.length} bucket{pivotVal.length === 1 ? "" : "s"}
              </Text>
            </>
          )}
        </GlassCard>

        {/* Value Distribution - Bars with tap */}
        <GlassCard>
          <CardHeader icon="bar-chart-2" color={GLOW_COLORS.orange.from} title="Value Distribution (PMM)" />
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, paddingHorizontal: 4 }}>
            {valueRanges.map((r, i) => {
              const barH = Math.max((r.count / maxValCount) * 80, 6);
              const colors = [GLOW_COLORS.orange, GLOW_COLORS.yellow, GLOW_COLORS.green, GLOW_COLORS.blue, GLOW_COLORS.purple];
              const c = colors[i % colors.length];
              return (
                <Bar3D
                  key={r.label}
                  height={barH}
                  maxHeight={80}
                  width={Math.floor((chartW - 20) / valueRanges.length)}
                  colorFrom={c.from}
                  colorTo={c.to}
                  label={r.label}
                  value={String(r.count)}
                  index={i}
                  selected={selectedBar === i}
                  onPress={() => setSelectedBar(selectedBar === i ? null : i)}
                  tooltipText={`${r.label}: ${r.count} projects`}
                />
              );
            })}
          </View>
        </GlassCard>

        {/* Win Rate by Sector — only render if we have real won/lost decisions tagged
             with non-"Other" sectors. Otherwise the card is meaningless and we hide it. */}
        {hasRealWinLossSectors && (
        <GlassCard>
          <CardHeader icon="target" color={GLOW_COLORS.green.from} title="Win Rate by Sector" />
          {topSectors.map(([sector, d], i) => {
            const total = d.won + d.lost;
            const rate = total > 0 ? Math.round((d.won / total) * 100) : 0;
            const isSelected = selectedWinSector === i;
            return (
              <Pressable
                key={sector}
                onPress={() => setSelectedWinSector(isSelected ? null : i)}
                style={{
                  marginBottom: 12,
                  paddingVertical: 4,
                  paddingHorizontal: 6,
                  borderRadius: 8,
                  backgroundColor: isSelected ? "rgba(107,165,57,0.12)" : "transparent",
                  borderWidth: isSelected ? 1 : 0,
                  borderColor: GLOW_COLORS.green.from + "30",
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text numberOfLines={1} style={{ fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 11, color: isSelected ? Colors.white : "rgba(255,255,255,0.55)", flex: 1, marginRight: 8 }}>
                    {sector.length > 24 ? sector.slice(0, 24) + "…" : sector}
                  </Text>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.cardText }}>
                    {total > 0 ? `${rate}% (${d.won}W/${d.lost}L)` : `${d.activeCount} active`}
                  </Text>
                </View>
                {total > 0 ? (
                  <WinLossBar3D wonPct={rate} width={chartW} index={i} />
                ) : (
                  <GlowBar pct={Math.min((d.activeCount / 20) * 100, 100)} color={GLOW_COLORS.green.from + "60"} />
                )}
                {isSelected && total > 0 && (
                  <View style={{ flexDirection: "row", gap: 12, marginTop: 6, paddingLeft: 4 }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: GLOW_COLORS.green.from }}>
                      Won: {d.won}
                    </Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: GLOW_COLORS.red.from }}>
                      Lost: {d.lost}
                    </Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
                      Total: {total} decisions
                    </Text>
                    {d.activeVal > 0 && (
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: GLOW_COLORS.orange.from }}>
                        Active: {fmtM(d.activeVal)}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
          <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: GLOW_COLORS.green.from }} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Won</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: GLOW_COLORS.red.from + "40" }} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Lost</Text>
            </View>
          </View>
        </GlassCard>
        )}

        {/* Top Markets — only render if we have at least one real city. PMM rows in
             tenants without a populated City field would otherwise show a single
             "Unknown" bar covering 100% of pipeline value, which adds no info. */}
        {topCities.some(([c]) => c && c !== "Unknown" && c.toLowerCase() !== "unknown") && (
        <GlassCard>
          <CardHeader icon="map-pin" color={GLOW_COLORS.blue.from} title="Top Markets (Active Value)" />
          {topCities.filter(([c]) => c && c !== "Unknown" && c.toLowerCase() !== "unknown").map(([city, d], i) => {
            const pct = (d.val / maxCityVal) * 100;
            const isSelected = selectedCity === i;
            return (
              <Pressable
                key={city}
                onPress={() => setSelectedCity(isSelected ? null : i)}
                style={{
                  marginBottom: 10,
                  paddingVertical: 4,
                  paddingHorizontal: 6,
                  borderRadius: 8,
                  backgroundColor: isSelected ? "rgba(107,127,240,0.12)" : "transparent",
                  borderWidth: isSelected ? 1 : 0,
                  borderColor: GLOW_COLORS.blue.from + "30",
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text numberOfLines={1} style={{ fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 11, color: isSelected ? Colors.white : "rgba(255,255,255,0.55)", flex: 1, marginRight: 8 }}>
                    {city.length > 22 ? city.slice(0, 22) + "…" : city}
                  </Text>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.cardText }}>
                    {fmtM(d.val)} · {d.count} proj
                  </Text>
                </View>
                <MarketBar3D pct={pct} color={GLOW_COLORS.blue.from} index={i} width={chartW} />
                {isSelected && (
                  <View style={{ flexDirection: "row", gap: 12, marginTop: 6, paddingLeft: 4 }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: GLOW_COLORS.blue.from }}>
                      Value: {fmtM(d.val)}
                    </Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
                      {d.count} active projects
                    </Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: GLOW_COLORS.orange.from }}>
                      Avg: {fmtM(d.count > 0 ? d.val / d.count : 0)}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </GlassCard>
        )}

        {/* OPM Pipeline by Status - Donut + row tap */}
        <GlassCard>
          <CardHeader icon="trending-up" color={GLOW_COLORS.orange.from} title="OPM Pipeline by Status" />
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <DonutChart3D
              size={120}
              strokeWidth={16}
              centerValue={String(topOpmStatuses.reduce((s, [, c]) => s + c, 0))}
              centerLabel="Total Opps"
              selectedIndex={selectedOpmDonut}
              onSelect={setSelectedOpmDonut}
              segments={topOpmStatuses.map(([status, count], i) => {
                const statusColor =
                  status === "Awarded" ? GLOW_COLORS.green.from :
                  status === "Lost" ? GLOW_COLORS.red.from :
                  status === "In Progress" ? GLOW_COLORS.orange.from :
                  status === "Cancelled" ? "#8899AA" :
                  status === "Declined" ? "#C97040" :
                  GLOW_COLORS.blue.from;
                return { value: count, color: statusColor, label: status };
              })}
            />
            <View style={{ flex: 1, marginLeft: 14, gap: 6 }}>
              {topOpmStatuses.map(([status, count], i) => {
                const statusColor =
                  status === "Awarded" ? GLOW_COLORS.green.from :
                  status === "Lost" ? GLOW_COLORS.red.from :
                  status === "In Progress" ? GLOW_COLORS.orange.from :
                  status === "Cancelled" ? "#8899AA" :
                  status === "Declined" ? "#C97040" :
                  GLOW_COLORS.blue.from;
                const pct = Math.round((count / maxOpmCount) * 100);
                const isSelected = selectedOpmDonut === i || selectedOpmStatus === i;
                return (
                  <Pressable
                    key={status}
                    onPress={() => {
                      setSelectedOpmDonut(isSelected ? null : i);
                      setSelectedOpmStatus(isSelected ? null : i);
                    }}
                    style={{
                      paddingVertical: 2,
                      paddingHorizontal: 4,
                      borderRadius: 6,
                      backgroundColor: isSelected ? statusColor + "20" : "transparent",
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                        <Text style={{ fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 10, color: isSelected ? Colors.white : "rgba(255,255,255,0.55)" }}>{status || "Other"}</Text>
                      </View>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: isSelected ? statusColor : Colors.white }}>
                        {count}
                        {isSelected && ` (${Math.round((count / topOpmStatuses.reduce((s, [, c]) => s + c, 0)) * 100)}%)`}
                      </Text>
                    </View>
                    <GlowBar pct={pct} color={statusColor} height={6} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </GlassCard>
      </ScrollView>
    </View>
  );
}
