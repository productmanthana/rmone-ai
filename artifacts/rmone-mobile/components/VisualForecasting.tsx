import { Feather } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { setChatPrompt } from "@/lib/chatBridge";
import {
  getModuleRecords,
  getResourceAllocations,
  getResourceDemands,
  getResourceMaster,
  type DemandItem,
  type LiveResource,
  type ModuleRecord,
  type ResourceMasterRow,
} from "@/lib/api";
import {
  computeForecast,
  type CollisionData,
  type CurveData,
  type ForecastIntelligence,
  type HeatmapData,
  type PivotKey,
} from "@/lib/forecastIntelligence";

/* ── Local color tokens (Colors.red is mapped to orange in the brand palette,
 *    so we define an honest red + amber here for the heatmap tiers) ──────── */
const TIER = {
  ok: "#3B7E2B",
  okText: "#A9C23F",
  warn: "#B27518",
  warnText: "#FF9425",
  over: "#C8341B",
  overText: "#FF6B5B",
  cellBorder: "rgba(0,0,0,0.25)",
};
const RED = "#FF5747";
const AMBER = "#FFB23F";
const CRITICAL_RED = "#E03C3C";
const SCREEN_W = Math.min(Dimensions.get("window").width, 480);

/* ── Drill-down mock data ────────────────────────────────────────────── */
type DrillPerson = { name: string; role: string; pct: number };
type DrillProject = { id: string; name: string; pct: number };
type DrillSet = { staff: DrillPerson[]; projects: DrillProject[] };

/** Drivers behind each heatmap row. Used to populate the cell drill-down sheet.
 *  Same drivers across weeks; the sheet annotates with the tapped week & util. */
const CELL_DRIVERS: Record<PivotKey, Record<string, DrillSet>> = {
  Office: {
    "NY Metro": {
      staff: [
        { name: "Tom Reyes", role: "Sr PM", pct: 148 },
        { name: "Maya Choi", role: "Estimator", pct: 132 },
        { name: "Jordan Pace", role: "Super.", pct: 118 },
      ],
      projects: [
        { id: "PMM-167", name: "NYCHA Medical", pct: 60 },
        { id: "PMM-089", name: "Mercy ICU East", pct: 52 },
        { id: "PMM-204", name: "JFK T1 Refresh", pct: 45 },
      ],
    },
    "Phoenix": {
      staff: [
        { name: "Sara Patel", role: "Sr PM", pct: 138 },
        { name: "Marcus Vance", role: "Engineer", pct: 124 },
        { name: "Lena Ortiz", role: "Designer", pct: 110 },
      ],
      projects: [
        { id: "PMM-312", name: "Banner Heart Tower", pct: 58 },
        { id: "PMM-245", name: "ASU Bio Lab", pct: 44 },
        { id: "PMM-301", name: "Sky Harbor C-Gates", pct: 38 },
      ],
    },
    "Houston": {
      staff: [
        { name: "Devon Hayes", role: "PM", pct: 112 },
        { name: "Priya Anand", role: "MEP Lead", pct: 105 },
      ],
      projects: [
        { id: "PMM-402", name: "Texas Med Center", pct: 55 },
        { id: "PMM-388", name: "Houston Civic Hub", pct: 40 },
      ],
    },
    "Atlanta": {
      staff: [
        { name: "Rachel Kim", role: "Sr PM", pct: 122 },
        { name: "Andre Cole", role: "Estimator", pct: 108 },
      ],
      projects: [
        { id: "PMM-451", name: "Emory Cardio Wing", pct: 52 },
        { id: "PMM-447", name: "Hartsfield C-East", pct: 41 },
      ],
    },
    "Boston": {
      staff: [
        { name: "Owen McGrath", role: "Engineer", pct: 128 },
        { name: "Ines Park", role: "PM", pct: 115 },
      ],
      projects: [
        { id: "PMM-510", name: "MGH Cancer Pavilion", pct: 56 },
        { id: "PMM-498", name: "Logan Modernization", pct: 43 },
      ],
    },
    "Chicago": {
      staff: [
        { name: "Jamal Brooks", role: "Super.", pct: 110 },
        { name: "Hana Liu", role: "Designer", pct: 102 },
      ],
      projects: [
        { id: "PMM-540", name: "Rush Med Expansion", pct: 50 },
        { id: "PMM-555", name: "Loop Civic Center", pct: 38 },
      ],
    },
    "LA": {
      staff: [
        { name: "Carla Diaz", role: "PM", pct: 105 },
        { name: "Noah Becker", role: "Estimator", pct: 98 },
      ],
      projects: [
        { id: "PMM-612", name: "UCLA Med West", pct: 48 },
        { id: "PMM-619", name: "LAX Terminal 9", pct: 36 },
      ],
    },
  },
  Role: {
    "Sr PM": {
      staff: [
        { name: "Tom Reyes", role: "NY Metro", pct: 148 },
        { name: "Sara Patel", role: "Phoenix", pct: 138 },
        { name: "Rachel Kim", role: "Atlanta", pct: 122 },
        { name: "Linda Boyd", role: "Boston", pct: 118 },
      ],
      projects: [
        { id: "PMM-167", name: "NYCHA Medical", pct: 55 },
        { id: "PMM-312", name: "Banner Heart Tower", pct: 50 },
        { id: "PMM-510", name: "MGH Cancer Pavilion", pct: 42 },
      ],
    },
    "PM": {
      staff: [
        { name: "Devon Hayes", role: "Houston", pct: 122 },
        { name: "Carla Diaz", role: "LA", pct: 110 },
        { name: "Ines Park", role: "Boston", pct: 108 },
      ],
      projects: [
        { id: "PMM-402", name: "Texas Med Center", pct: 48 },
        { id: "PMM-555", name: "Loop Civic Center", pct: 40 },
      ],
    },
    "Estimator": {
      staff: [
        { name: "Maya Choi", role: "NY Metro", pct: 132 },
        { name: "Andre Cole", role: "Atlanta", pct: 118 },
        { name: "Noah Becker", role: "LA", pct: 102 },
      ],
      projects: [
        { id: "PMM-167", name: "NYCHA Medical", pct: 45 },
        { id: "PMM-451", name: "Emory Cardio Wing", pct: 38 },
      ],
    },
    "Designer": {
      staff: [
        { name: "Lena Ortiz", role: "Phoenix", pct: 116 },
        { name: "Hana Liu", role: "Chicago", pct: 105 },
      ],
      projects: [
        { id: "PMM-245", name: "ASU Bio Lab", pct: 40 },
        { id: "PMM-540", name: "Rush Med Expansion", pct: 35 },
      ],
    },
    "Engineer": {
      staff: [
        { name: "Owen McGrath", role: "Boston", pct: 128 },
        { name: "Marcus Vance", role: "Phoenix", pct: 124 },
      ],
      projects: [
        { id: "PMM-510", name: "MGH Cancer Pavilion", pct: 50 },
        { id: "PMM-312", name: "Banner Heart Tower", pct: 45 },
      ],
    },
    "Super.": {
      staff: [
        { name: "Jordan Pace", role: "NY Metro", pct: 124 },
        { name: "Jamal Brooks", role: "Chicago", pct: 116 },
      ],
      projects: [
        { id: "PMM-089", name: "Mercy ICU East", pct: 50 },
        { id: "PMM-540", name: "Rush Med Expansion", pct: 40 },
      ],
    },
    "MEP Lead": {
      staff: [
        { name: "Priya Anand", role: "Houston", pct: 118 },
        { name: "Eric Walsh", role: "Atlanta", pct: 102 },
      ],
      projects: [
        { id: "PMM-402", name: "Texas Med Center", pct: 48 },
        { id: "PMM-451", name: "Emory Cardio Wing", pct: 38 },
      ],
    },
  },
  Discipline: {
    "Healthcare": {
      staff: [
        { name: "Sara Patel", role: "Sr PM · Phoenix", pct: 138 },
        { name: "Owen McGrath", role: "Engineer · Boston", pct: 128 },
        { name: "Tom Reyes", role: "Sr PM · NY Metro", pct: 122 },
      ],
      projects: [
        { id: "PMM-089", name: "Mercy ICU East", pct: 52 },
        { id: "PMM-510", name: "MGH Cancer Pavilion", pct: 48 },
        { id: "PMM-167", name: "NYCHA Medical", pct: 45 },
        { id: "PMM-451", name: "Emory Cardio Wing", pct: 40 },
      ],
    },
    "Aviation": {
      staff: [
        { name: "Jordan Pace", role: "Super. · NY Metro", pct: 118 },
        { name: "Lena Ortiz", role: "Designer · Phoenix", pct: 105 },
      ],
      projects: [
        { id: "PMM-204", name: "JFK T1 Refresh", pct: 50 },
        { id: "PMM-301", name: "Sky Harbor C-Gates", pct: 42 },
        { id: "PMM-619", name: "LAX Terminal 9", pct: 36 },
      ],
    },
    "Education": {
      staff: [
        { name: "Marcus Vance", role: "Engineer · Phoenix", pct: 112 },
        { name: "Hana Liu", role: "Designer · Chicago", pct: 102 },
      ],
      projects: [
        { id: "PMM-245", name: "ASU Bio Lab", pct: 48 },
        { id: "PMM-612", name: "UCLA Med West", pct: 38 },
      ],
    },
    "Commercial": {
      staff: [
        { name: "Carla Diaz", role: "PM · LA", pct: 110 },
        { name: "Ines Park", role: "PM · Boston", pct: 108 },
      ],
      projects: [
        { id: "PMM-498", name: "Logan Modernization", pct: 45 },
        { id: "PMM-540", name: "Rush Med Expansion", pct: 38 },
      ],
    },
    "Civic": {
      staff: [
        { name: "Devon Hayes", role: "PM · Houston", pct: 112 },
        { name: "Andre Cole", role: "Estimator · Atlanta", pct: 102 },
      ],
      projects: [
        { id: "PMM-388", name: "Houston Civic Hub", pct: 44 },
        { id: "PMM-555", name: "Loop Civic Center", pct: 38 },
      ],
    },
    "Industrial": {
      staff: [
        { name: "Eric Walsh", role: "MEP Lead · Atlanta", pct: 102 },
        { name: "Noah Becker", role: "Estimator · LA", pct: 98 },
      ],
      projects: [
        { id: "PMM-447", name: "Hartsfield C-East", pct: 40 },
      ],
    },
    "Residential": {
      staff: [
        { name: "Rachel Kim", role: "Sr PM · Atlanta", pct: 105 },
      ],
      projects: [
        { id: "PMM-612", name: "UCLA Med West", pct: 30 },
      ],
    },
  },
};

/** People conflicting on each project bar in the Resource collision zone. */
const BAR_PEOPLE: Record<PivotKey, Record<string, DrillPerson[]>> = {
  Office: {
    "PMM-167": [
      { name: "Tom Reyes", role: "Sr PM", pct: 60 },
      { name: "Maya Choi", role: "Estimator", pct: 45 },
      { name: "Jordan Pace", role: "Super.", pct: 40 },
    ],
    "PMM-089": [
      { name: "Tom Reyes", role: "Sr PM", pct: 50 },
      { name: "Sara Patel", role: "Sr PM", pct: 38 },
      { name: "Priya Anand", role: "MEP Lead", pct: 32 },
    ],
    "Healthcare": [
      { name: "Tom Reyes", role: "Sr PM", pct: 40 },
      { name: "Owen McGrath", role: "Engineer", pct: 36 },
      { name: "Lena Ortiz", role: "Designer", pct: 30 },
    ],
  },
  Role: {
    "PMM-167": [
      { name: "Tom Reyes", role: "Sr PM · NY Metro", pct: 60 },
      { name: "Sara Patel", role: "Sr PM · Phoenix", pct: 48 },
    ],
    "PMM-089": [
      { name: "Tom Reyes", role: "Sr PM · NY Metro", pct: 50 },
      { name: "Rachel Kim", role: "Sr PM · Atlanta", pct: 40 },
    ],
    "Aviation": [
      { name: "Sara Patel", role: "Sr PM · Phoenix", pct: 40 },
      { name: "Linda Boyd", role: "Sr PM · Boston", pct: 32 },
    ],
  },
  Discipline: {
    "Mercy ICU": [
      { name: "Sara Patel", role: "Sr PM · Phoenix", pct: 55 },
      { name: "Owen McGrath", role: "Engineer · Boston", pct: 42 },
    ],
    "St. Vincent": [
      { name: "Tom Reyes", role: "Sr PM · NY Metro", pct: 48 },
      { name: "Maya Choi", role: "Estimator · NY Metro", pct: 38 },
    ],
    "NYCHA Med": [
      { name: "Tom Reyes", role: "Sr PM · NY Metro", pct: 60 },
      { name: "Jordan Pace", role: "Super. · NY Metro", pct: 45 },
      { name: "Owen McGrath", role: "Engineer · Boston", pct: 30 },
    ],
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────── */
function tierFor(v: number): "ok" | "warn" | "over" {
  if (v >= 100) return "over";
  if (v >= 85) return "warn";
  return "ok";
}

function pivotNoun(p: PivotKey): string {
  return p === "Office" ? "office" : p === "Role" ? "role" : "discipline";
}

/** Bar labels that match this pattern are treated as real project IDs and
 *  can be opened via the /project/[id] route. Others (e.g. "Healthcare",
 *  "Mercy ICU") are program/discipline groupings — they only show the
 *  conflicting-people sheet, no "Open project" CTA. */
const PROJECT_ID_RE = /^PMM-\d+$/i;
function isProjectId(label: string): boolean {
  return PROJECT_ID_RE.test(label);
}

/* ── Sub-components ──────────────────────────────────────────────────── */
function HeadlineRow({
  title,
  answer,
  answerColor,
  rightTag,
  rightTagColor,
}: {
  title: string;
  answer: string;
  answerColor: string;
  rightTag?: string;
  rightTagColor?: string;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.eyebrow}>HEADLINE</Text>
        {rightTag ? (
          <Text style={[styles.rightTag, { color: rightTagColor ?? Colors.cardMuted }]}>{rightTag}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", marginTop: 4 }}>
        <Text style={styles.headlineTitle}>{title} · </Text>
        <Text style={[styles.headlineAnswer, { color: answerColor }]}>{answer}</Text>
      </View>
    </View>
  );
}

function HeatmapZone({
  data,
  weeks,
  onCellPress,
}: {
  data: HeatmapData;
  weeks: string[];
  onCellPress: (rowLabel: string, weekIdx: number, value: number) => void;
}) {
  if (data.rows.length === 0) {
    return (
      <View style={styles.card}>
        <HeadlineRow title={data.title} answer={data.answer} answerColor={Colors.cardMuted} />
        <Text style={styles.emptyZoneText}>
          No allocation data available for this pivot in the next 8 weeks.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <HeadlineRow
        title={data.title}
        answer={data.answer}
        answerColor={RED}
      />
      {/* Week header */}
      <View style={styles.gridRow}>
        <View style={styles.gridLabelCell} />
        {weeks.map((w, i) => (
          <View key={w} style={[styles.gridHeaderCell, i === data.peakWeekIdx && styles.gridHeaderCellHot]}>
            <Text style={[styles.gridHeaderText, i === data.peakWeekIdx && { color: RED }]}>{w}</Text>
          </View>
        ))}
      </View>
      {/* Body rows */}
      {data.rows.map((row) => (
        <View key={row.label} style={styles.gridRow}>
          <View style={styles.gridLabelCell}>
            <Text style={styles.gridLabelText} numberOfLines={1}>{row.label}</Text>
          </View>
          {row.values.map((v, i) => {
            const tier = tierFor(v);
            const bg = tier === "over" ? TIER.over : tier === "warn" ? TIER.warn : TIER.ok;
            return (
              <Pressable
                key={i}
                onPress={() => {
                  try { Haptics.selectionAsync(); } catch {}
                  onCellPress(row.label, i, v);
                }}
                style={({ pressed }) => [
                  styles.gridCell,
                  { backgroundColor: bg },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${row.label} ${weeks[i]} ${Math.round(v)} percent — tap to drill in`}
              >
                {tier === "over" ? (
                  <Text style={styles.gridCellOverText}>{Math.round(v)}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      {/* Legend + 8 WKS tag */}
      <View style={[styles.legendRow, { justifyContent: "space-between" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: TIER.okText }]} /><Text style={styles.legendText}>OK</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: TIER.warnText }]} /><Text style={styles.legendText}>Warn</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: RED }]} /><Text style={styles.legendText}>Overload</Text></View>
        </View>
        <Text style={[styles.rightTag, { color: Colors.cardMuted }]}>8 WKS</Text>
      </View>
    </View>
  );
}

function CurveZone({ data, weeks, width }: { data: CurveData; weeks: string[]; width: number }) {
  if (data.cohort === "" || (data.demand.every((d) => d === 0) && data.capacity.every((c) => c === 0))) {
    return (
      <View style={styles.card}>
        <HeadlineRow title={data.title} answer={data.answer} answerColor={Colors.cardMuted} />
        <Text style={styles.emptyZoneText}>
          No demand records found in the next 8 weeks for this pivot.
        </Text>
      </View>
    );
  }
  // Plot config
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 14;
  const chartW = width - padL - padR;
  const chartH = 120;
  const yMin = data.yMin;
  const yMax = data.yMax > yMin ? data.yMax : yMin + 1;

  const xFor = (i: number) => padL + (chartW * i) / (weeks.length - 1);
  const yFor = (v: number) => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  const buildPath = (vals: number[]) => {
    if (vals.length === 0) return "";
    const pts = vals.map((v, i) => [xFor(i), yFor(v)] as const);
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    return d;
  };

  const demandPath = buildPath(data.demand);
  const capacityPath = buildPath(data.capacity);
  const hireX = xFor(data.hireIndex);
  const hireY = yFor(data.demand[data.hireIndex] ?? 0);
  const hireMarkerColor = data.hasCrossover ? RED : AMBER;
  const hireLabel = data.hasCrossover ? "HIRE" : "PEAK";

  return (
    <View style={styles.card}>
      <HeadlineRow
        title={data.title}
        answer={data.answer}
        answerColor={data.hasCrossover ? AMBER : Colors.green}
        rightTag={data.cohort ? `COHORT · ${data.cohort.toUpperCase()}` : undefined}
        rightTagColor={data.hasCrossover ? AMBER : Colors.green}
      />
      <Svg width={width} height={padT + chartH + padB}>
        {/* Capacity (flat-ish, dashed feel) */}
        <Path d={capacityPath} stroke={Colors.green} strokeWidth={2} fill="none" strokeDasharray="4 4" />
        {/* Demand */}
        <Path d={demandPath} stroke={AMBER} strokeWidth={2.5} fill="none" />

        {/* HIRE / PEAK marker — vertical line + label + dot */}
        <Line x1={hireX} y1={padT} x2={hireX} y2={padT + chartH} stroke={hireMarkerColor} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
        <Circle cx={hireX} cy={hireY} r={4} fill={hireMarkerColor} stroke="#fff" strokeWidth={1.5} />
        <Rect
          x={hireX - 22}
          y={padT - 2}
          width={44}
          height={14}
          rx={3}
          fill={hireMarkerColor}
        />
        <SvgText
          x={hireX}
          y={padT + 8}
          fontFamily={Platform.OS === "web" ? "Inter, sans-serif" : "Inter_700Bold"}
          fontSize="9"
          fontWeight="700"
          fill="#fff"
          textAnchor="middle"
        >{hireLabel}</SvgText>
      </Svg>

      {/* X-axis week labels */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: padL, marginTop: -6 }}>
        {weeks.map((w, i) => (
          <Text
            key={w}
            style={[styles.curveAxisLabel, i === data.hireIndex && { color: hireMarkerColor, fontFamily: "Inter_700Bold" }]}
          >{w}</Text>
        ))}
      </View>

      {/* Mini legend */}
      <View style={[styles.legendRow, { marginTop: 8 }]}>
        <View style={styles.legendItem}><View style={[styles.legendBar, { backgroundColor: AMBER }]} /><Text style={styles.legendText}>Demand (FTE)</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendBar, { backgroundColor: Colors.green }]} /><Text style={styles.legendText}>Capacity (FTE)</Text></View>
      </View>
    </View>
  );
}

function CollisionZone({
  data,
  weeks,
  width,
  onBarPress,
}: {
  data: CollisionData;
  weeks: string[];
  width: number;
  onBarPress: (bar: CollisionData["bars"][number]) => void;
}) {
  const labelW = 96;
  const trackW = width - labelW - 4;
  const cellW = trackW / weeks.length;

  if (data.bars.length === 0) {
    return (
      <View style={styles.card}>
        <HeadlineRow title={data.title} answer={data.answer} answerColor={Colors.cardMuted} rightTag={data.rightTag} rightTagColor={Colors.cardMuted} />
        <Text style={styles.emptyZoneText}>
          No active resource allocations to model collision risk.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <HeadlineRow
        title={data.title}
        answer={data.answer}
        answerColor={RED}
        rightTag={data.rightTag}
        rightTagColor={RED}
      />
      {/* Week header */}
      <View style={{ flexDirection: "row", marginBottom: 6 }}>
        <View style={{ width: labelW }} />
        {weeks.map((w, i) => (
          <View key={w} style={{ width: cellW, alignItems: "center" }}>
            <Text style={[styles.gridHeaderText, data.overlapIdx.includes(i) && { color: RED, fontFamily: "Inter_700Bold" }]}>{w}</Text>
          </View>
        ))}
      </View>

      {/* Project bars */}
      {data.bars.map((b) => {
        const x = b.startIdx * cellW;
        const w = (b.endIdx - b.startIdx + 1) * cellW - 3;
        return (
          <Pressable
            key={b.label}
            onPress={() => {
              try { Haptics.selectionAsync(); } catch {}
              onBarPress(b);
            }}
            style={({ pressed }) => [
              { flexDirection: "row", alignItems: "center", marginBottom: 6 },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${b.label} project — tap to see conflicting people`}
          >
            <View style={{ width: labelW, paddingRight: 6 }}>
              <Text style={styles.collisionBarLabel} numberOfLines={1}>{b.label}</Text>
            </View>
            <View style={{ width: trackW, height: 14, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
              <View style={{ position: "absolute", left: x, top: 0, height: 14, width: w, backgroundColor: b.color, borderRadius: 4 }} />
            </View>
          </Pressable>
        );
      })}

      {/* OVERLAP band */}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
        <View style={{ width: labelW, paddingRight: 6 }}>
          <Text style={[styles.collisionBarLabel, { color: Colors.cardMuted, letterSpacing: 0.6 }]}>OVERLAP</Text>
        </View>
        <View style={{ width: trackW, flexDirection: "row", height: 10, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
          {weeks.map((_, i) => (
            <View
              key={i}
              style={{
                width: cellW - 1,
                marginRight: 1,
                height: 10,
                backgroundColor: data.overlapIdx.includes(i) ? RED : "rgba(255,255,255,0.06)",
              }}
            />
          ))}
        </View>
      </View>

      {data.overlapIdx.length === 0 ? (
        <Text style={[styles.emptyZoneText, { marginTop: 8, fontSize: 10 }]}>
          Top resource never crosses 100% in this window — peak shown is their busiest week.
        </Text>
      ) : null}
    </View>
  );
}

function ScenarioPanel({
  scenario,
  mode,
  onSelect,
}: {
  scenario: ForecastIntelligence["scenario"];
  mode: "base" | "win";
  onSelect: (s: "base" | "win") => void;
}) {
  const headlineText = scenario.hasPursuit
    ? scenario.promptHeadline
    : "No open pursuits to model";
  const valueText = scenario.hasPursuit ? scenario.valueLabel : "+$0";
  const detail = scenario.hasPursuit
    ? scenario.promptDetail
    : "Add an opportunity to OPM to model a win-pursuit scenario.";
  return (
    <View style={[styles.card, { backgroundColor: Colors.cardBg, borderColor: "rgba(107,165,57,0.55)" }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={[styles.eyebrow, { color: Colors.green }]}>● SCENARIO</Text>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>{valueText}</Text>
      </View>
      <Text style={[styles.headlineTitle, { fontSize: 16, marginTop: 4, color: Colors.cardText }]}>{headlineText}</Text>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 4 }}>
        {detail}
      </Text>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
        <Pressable
          onPress={() => {
            onSelect("base");
            try { Haptics.selectionAsync(); } catch { /* haptics not available on web */ }
          }}
          style={[styles.scenarioBtn, mode === "base" && styles.scenarioBtnActive]}
        >
          <Text style={[styles.scenarioBtnText, mode === "base" && styles.scenarioBtnTextActive]}>Base case</Text>
        </Pressable>
        <Pressable
          disabled={!scenario.hasPursuit}
          onPress={() => {
            if (!scenario.hasPursuit) return;
            onSelect("win");
            try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch { /* haptics not available on web */ }
          }}
          style={[
            styles.scenarioBtn,
            mode === "win" && styles.scenarioBtnActiveWin,
            !scenario.hasPursuit && { opacity: 0.5 },
          ]}
        >
          <Text style={[styles.scenarioBtnText, mode === "win" && styles.scenarioBtnTextActive]}>Win pursuit</Text>
        </Pressable>
      </View>

      {scenario.hasPursuit ? (
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 10 }}>
          Tap <Text style={{ fontFamily: "Inter_700Bold", color: Colors.cardText }}>Win pursuit</Text> to model FTE, peak utilization &amp; hire impact.
        </Text>
      ) : null}
    </View>
  );
}

function LoadingState({ insets }: { insets: { top: number } }) {
  return (
    <View style={[styles.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>RM ONE · FORECAST</Text>
          <Text style={styles.headerTitle}>Visual Forecasting</Text>
        </View>
      </View>
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.green} />
        <Text style={styles.loadingText}>Aggregating allocations &amp; pursuits…</Text>
        <Text style={styles.loadingSubtext}>Rolling up the next 8 weeks across roles, offices, and disciplines.</Text>
      </View>
    </View>
  );
}

function ErrorState({
  insets,
  message,
  onRetry,
}: {
  insets: { top: number };
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={[styles.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>RM ONE · FORECAST</Text>
          <Text style={styles.headerTitle}>Visual Forecasting</Text>
        </View>
      </View>
      <View style={styles.errorCard}>
        <Feather name="wifi-off" size={28} color={CRITICAL_RED} />
        <Text style={styles.errorTitle}>Forecast unavailable</Text>
        <Text style={styles.errorBody}>{message}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.85 : 1 }]}
          onPress={onRetry}
        >
          <Text style={styles.retryBtnText}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── Drill-down bottom sheet ─────────────────────────────────────────── */
type CellSheet = {
  kind: "cell";
  pivot: PivotKey;
  rowLabel: string;
  week: string;
  value: number;
};
type BarSheet = {
  kind: "bar";
  pivot: PivotKey;
  bar: CollisionData["bars"][number];
  weeks: string[];
  overlapWeeks: string[];
  rightTag: string;
};
type SheetState = CellSheet | BarSheet | null;

function tierColor(v: number): string {
  if (v >= 100) return RED;
  if (v >= 85) return AMBER;
  return TIER.okText;
}

function DrillSheet({
  sheet,
  onClose,
  onAskAI,
  onOpenProject,
}: {
  sheet: SheetState;
  onClose: () => void;
  onAskAI: () => void;
  onOpenProject?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = sheet != null;

  let title = "";
  let subtitle = "";
  let accent = RED;
  let staff: DrillPerson[] = [];
  let projects: DrillProject[] = [];
  let staffHeader = "";
  let projectsHeader = "";

  if (sheet?.kind === "cell") {
    const drivers = CELL_DRIVERS[sheet.pivot]?.[sheet.rowLabel] ?? { staff: [], projects: [] };
    title = `${sheet.rowLabel} · ${sheet.week}`;
    subtitle = `${Math.round(sheet.value)}% utilization · ${pivotNoun(sheet.pivot)} drilldown`;
    accent = tierColor(sheet.value);
    staff = drivers.staff;
    projects = drivers.projects;
    staffHeader = "Staff driving the load";
    projectsHeader = "Projects driving the load";
  } else if (sheet?.kind === "bar") {
    const people = BAR_PEOPLE[sheet.pivot]?.[sheet.bar.label] ?? [];
    title = sheet.bar.label;
    subtitle = `${sheet.weeks[sheet.bar.startIdx]}–${sheet.weeks[sheet.bar.endIdx]} · overlap ${sheet.overlapWeeks.join(", ") || "—"}`;
    accent = RED;
    staff = people;
    projects = [];
    staffHeader = "Conflicting people";
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={drillStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[drillStyles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* Grabber */}
          <View style={drillStyles.grabber} />

          {/* Header */}
          <View style={drillStyles.header}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Text style={drillStyles.eyebrow}>
                  {sheet?.kind === "bar" ? "PROJECT COLLISION" : "OVERLOAD DETAIL"}
                </Text>
                {/* The staff/projects shown below come from a curated demo set
                    (CELL_DRIVERS / BAR_PEOPLE) since RM ONE does not yet expose
                    per-cell utilization contributors. The badge tells the user
                    these specific people/projects are illustrative, not live. */}
                <View style={drillStyles.sampleBadge}>
                  <Text style={drillStyles.sampleBadgeText}>SAMPLE</Text>
                </View>
              </View>
              <Text style={drillStyles.title} numberOfLines={2}>{title}</Text>
              <Text style={[drillStyles.subtitle, { color: accent }]}>{subtitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={drillStyles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Feather name="x" size={18} color={Colors.white} />
            </Pressable>
          </View>

          {/* Body */}
          <ScrollView
            style={{ maxHeight: 360 }}
            contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {staff.length > 0 ? (
              <>
                <Text style={drillStyles.sectionHeader}>{staffHeader}</Text>
                {staff.map((p) => (
                  <View key={p.name} style={drillStyles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={drillStyles.rowName}>{p.name}</Text>
                      <Text style={drillStyles.rowSub}>{p.role}</Text>
                    </View>
                    <View style={[drillStyles.pctPill, { borderColor: tierColor(p.pct) }]}>
                      <Text style={[drillStyles.pctText, { color: tierColor(p.pct) }]}>
                        {Math.round(p.pct)}%
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            {projects.length > 0 ? (
              <>
                <Text style={[drillStyles.sectionHeader, { marginTop: 14 }]}>{projectsHeader}</Text>
                {projects.map((pr) => (
                  <View key={pr.id} style={drillStyles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={drillStyles.rowName}>{pr.name}</Text>
                      <Text style={drillStyles.rowSub}>{pr.id}</Text>
                    </View>
                    <View style={drillStyles.sharePill}>
                      <Text style={drillStyles.shareText}>{Math.round(pr.pct)}% share</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            {staff.length === 0 && projects.length === 0 ? (
              <Text style={drillStyles.empty}>No driver detail available.</Text>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={drillStyles.footer}>
            {onOpenProject ? (
              <Pressable
                onPress={onOpenProject}
                style={({ pressed }) => [drillStyles.btnGhost, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <Feather name="external-link" size={14} color={Colors.white} />
                <Text style={drillStyles.btnGhostText}>Open project</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onAskAI}
              style={({ pressed }) => [drillStyles.btnPrimary, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="Discuss with AI"
            >
              <Feather name="message-circle" size={14} color={Colors.white} />
              <Text style={drillStyles.btnPrimaryText}>Discuss with AI</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ── Main screen ─────────────────────────────────────────────────────── */
export default function VisualForecasting() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pivot, setPivot] = useState<PivotKey>("Office");
  const [scenario, setScenario] = useState<"base" | "win">("base");
  const [sheet, setSheet] = useState<SheetState>(null);

  const [resources, setResources] = useState<LiveResource[] | null>(null);
  const [demands, setDemands] = useState<DemandItem[] | null>(null);
  const [pmm, setPmm] = useState<ModuleRecord[] | null>(null);
  const [opm, setOpm] = useState<ModuleRecord[] | null>(null);
  const [lem, setLem] = useState<ModuleRecord[] | null>(null);
  const [resourceMaster, setResourceMaster] = useState<ResourceMasterRow[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const results = await Promise.allSettled([
        getResourceAllocations(),
        getResourceDemands(),
        getModuleRecords("PMM"),
        getModuleRecords("OPM"),
        getModuleRecords("LEM"),
        getResourceMaster(),
      ]);
      const [allocRes, demandRes, pmmRes, opmRes, lemRes, rmRes] = results;

      // We need at least allocations OR demands to show a meaningful forecast.
      const allocOk = allocRes.status === "fulfilled";
      const demandOk = demandRes.status === "fulfilled";
      if (!allocOk && !demandOk) {
        const reason = allocOk ? String((demandRes as PromiseRejectedResult).reason) : String((allocRes as PromiseRejectedResult).reason);
        if (reason.includes("401") || reason.includes("Unauthorized")) {
          setError("Your session has expired. Please log in again.");
        } else if (reason.includes("Network") || reason.includes("fetch") || reason.includes("timeout") || reason.includes("aborted")) {
          setError("Unable to connect. Please check your network and try again.");
        } else {
          setError("We couldn't pull forecast data just now. Please try again.");
        }
        setLoading(false);
        return;
      }

      if (allocOk) {
        setResources(allocRes.value.resources || []);
        if (allocRes.value.projectNameMap) {
          setProjectNames((prev) => ({ ...prev, ...allocRes.value.projectNameMap }));
        }
      } else {
        setResources([]);
      }
      setDemands(demandOk ? demandRes.value.data || [] : []);
      setPmm(pmmRes.status === "fulfilled" ? pmmRes.value.data || [] : []);
      setOpm(opmRes.status === "fulfilled" ? opmRes.value.data || [] : []);
      setLem(lemRes.status === "fulfilled" ? lemRes.value.data || [] : []);
      setResourceMaster(rmRes.status === "fulfilled" ? rmRes.value || [] : []);
      setLoading(false);
    } catch (e) {
      console.warn("[VisualForecasting] load failed:", String(e));
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const forecast = useMemo<ForecastIntelligence | null>(() => {
    if (!resources || !demands || !pmm || !opm || !lem) return null;
    return computeForecast(resources, demands, pmm, opm, lem, projectNames, resourceMaster);
  }, [resources, demands, pmm, opm, lem, projectNames, resourceMaster]);

  if (loading && !forecast) {
    return <LoadingState insets={insets} />;
  }

  if (error && !forecast) {
    return (
      <ErrorState
        insets={insets}
        message={error}
        onRetry={() => { setLoading(true); load(); }}
      />
    );
  }

  if (!forecast) {
    return <LoadingState insets={insets} />;
  }

  const cardWidth = SCREEN_W - 32 - 28; // screen padding + card padding
  const heatmap = scenario === "win" ? forecast.win.heatmap[pivot] : forecast.base.heatmap[pivot];
  const curve = scenario === "win" ? forecast.win.curve[pivot] : forecast.base.curve[pivot];
  const collision = scenario === "win" ? forecast.win.collision[pivot] : forecast.base.collision[pivot];

  const handleCellPress = (rowLabel: string, weekIdx: number, value: number) => {
    setSheet({
      kind: "cell",
      pivot,
      rowLabel,
      week: forecast.weekLabels[weekIdx],
      value,
    });
  };

  const handleBarPress = (bar: CollisionData["bars"][number]) => {
    setSheet({
      kind: "bar",
      pivot,
      bar,
      weeks: forecast.weekLabels,
      overlapWeeks: collision.overlapIdx.map((i) => forecast.weekLabels[i]),
      rightTag: collision.rightTag,
    });
  };

  const dispatchAI = () => {
    if (!sheet) return;
    let prompt = "";
    if (sheet.kind === "cell") {
      prompt =
        `Drill into the ${sheet.rowLabel} ${pivotNoun(sheet.pivot)} for week ${sheet.week} ` +
        `(${Math.round(sheet.value)}% utilization). Who are the top staff and projects driving ` +
        `this overload, what risk does it create over the 8-week forecast, and what 3 specific ` +
        `actions (reallocate, hire, defer) should we take this week to bring it under 100%? ` +
        `Be decisive and quantify each action's impact on peak utilization.`;
    } else {
      const overlap = sheet.overlapWeeks.length
        ? sheet.overlapWeeks.join(", ")
        : `${sheet.weeks[sheet.bar.startIdx]}–${sheet.weeks[sheet.bar.endIdx]}`;
      prompt =
        `Project ${sheet.bar.label} is in a resource collision (overlap ${overlap}, ` +
        `${sheet.rightTag}). Identify the conflicting people, which other projects are pulling ` +
        `them, and recommend 3 specific reassignments or schedule shifts that resolve the ` +
        `conflict without slipping the contract. Quantify the relief on each affected person.`;
    }
    setChatPrompt(prompt, undefined, true);
    setSheet(null);
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    setTimeout(() => {
      try { router.navigate("/(tabs)/chat"); } catch {}
    }, 100);
  };

  const dispatchOpenProject = () => {
    if (sheet?.kind !== "bar") return;
    const id = sheet.bar.label;
    setSheet(null);
    setTimeout(() => {
      try { router.navigate(`/project/${encodeURIComponent(id)}`); } catch {}
    }, 100);
  };

  return (
    <View style={[styles.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>RM ONE · FORECAST</Text>
          <Text style={styles.headerTitle}>Visual Forecasting</Text>
        </View>
        <View style={styles.windowPill}>
          <View style={styles.windowPillDot} />
          <Text style={styles.windowPillText}>8-WK FORECAST</Text>
        </View>
      </View>

      {/* Pivot tabs */}
      <View style={styles.pivotRow}>
        {(["Office", "Role", "Discipline"] as PivotKey[]).map((p) => {
          const active = p === pivot;
          return (
            <Pressable
              key={p}
              onPress={() => {
                setPivot(p);
                try { Haptics.selectionAsync(); } catch { /* haptics not available on web */ }
              }}
              style={styles.pivotTab}
            >
              <Text style={[styles.pivotText, active && styles.pivotTextActive]}>{p}</Text>
              {active ? <View style={styles.pivotUnderline} /> : null}
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <HeatmapZone
          data={heatmap}
          weeks={forecast.weekLabels}
          onCellPress={handleCellPress}
        />
        <CurveZone data={curve} weeks={forecast.weekLabels} width={cardWidth} />
        <CollisionZone
          data={collision}
          weeks={forecast.weekLabels}
          width={cardWidth}
          onBarPress={handleBarPress}
        />
        <ScenarioPanel
          scenario={forecast.scenario}
          mode={scenario}
          onSelect={setScenario}
        />
      </ScrollView>

      <DrillSheet
        sheet={sheet}
        onClose={() => setSheet(null)}
        onAskAI={dispatchAI}
        onOpenProject={
          sheet?.kind === "bar" && isProjectId(sheet.bar.label)
            ? dispatchOpenProject
            : undefined
        }
      />
    </View>
  );
}

/* ── Styles ──────────────────────────────────────────────────────────── */
const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headerEyebrow: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
    letterSpacing: 1.6,
    color: Colors.textMuted,
    marginBottom: 3,
  },
  headerTitle: {
    // Renders on the page background (Colors.dark) — theme-aware. Use
    // `textPrimary` so it's white in dark mode and dark in light mode.
    // `cardText` is dark in both themes and disappeared on the dark bg.
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.textPrimary,
  },
  windowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(107,165,57,0.18)",
    borderWidth: 1,
    borderColor: "rgba(107,165,57,0.45)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  windowPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.green,
  },
  windowPillText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.8,
    color: Colors.green,
  },

  pivotRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pivotTab: {
    paddingVertical: 10,
    marginRight: 22,
  },
  pivotText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.textSecondary,
  },
  pivotTextActive: {
    // Sits on the page background (Colors.dark) which is dark in dark mode
    // and light in light mode. textPrimary inverts with the theme so the
    // active tab stays readable in both. `cardText` is dark in both modes
    // and disappeared against the dark-mode background.
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
  },
  pivotUnderline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    backgroundColor: Colors.green,
    borderRadius: 1,
  },

  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: Colors.cardBorderStrong,
  },

  eyebrow: {
    // Cards always render on Colors.cardBg (white in both themes), so muted
    // text inside cards uses the theme-stable `cardMuted` token instead of
    // `textMuted`/`textSecondary` — those become white-translucent in dark
    // mode and would disappear on the white card.
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 1.4,
    color: Colors.cardMuted,
  },
  rightTag: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 1.0,
  },
  headlineTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: Colors.cardText,
  },
  headlineAnswer: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },

  emptyZoneText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.cardMuted,
    paddingVertical: 16,
    textAlign: "center",
  },

  gridRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  gridLabelCell: {
    width: 64,
    paddingRight: 6,
    paddingVertical: 3,
  },
  gridLabelText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: Colors.cardMuted,
  },
  gridHeaderCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
  },
  gridHeaderCellHot: {},
  gridHeaderText: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: Colors.cardMuted,
    letterSpacing: 0.4,
  },
  gridCell: {
    flex: 1,
    height: 22,
    marginHorizontal: 1.5,
    marginVertical: 1.5,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  gridCellOverText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: "#fff",
  },

  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendBar: {
    width: 12,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    color: Colors.cardMuted,
  },

  curveAxisLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: Colors.cardMuted,
  },

  collisionBarLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: Colors.cardMuted,
  },

  scenarioBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  scenarioBtnActive: {
    backgroundColor: Colors.surfaceAlt,
    borderColor: Colors.cardBorderStrong,
  },
  scenarioBtnActiveWin: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  scenarioBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.cardMuted,
  },
  scenarioBtnTextActive: {
    fontFamily: "Inter_700Bold",
    color: Colors.cardText,
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: Colors.textPrimary,
    marginTop: 12,
    textAlign: "center",
  },
  loadingSubtext: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
  },

  errorCard: {
    margin: 16,
    padding: 24,
    borderRadius: 14,
    backgroundColor: "rgba(224,60,60,0.08)",
    borderWidth: 1,
    borderColor: "rgba(224,60,60,0.30)",
    alignItems: "center",
    gap: 8,
  },
  errorTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.textPrimary,
    marginTop: 8,
  },
  errorBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: Colors.green,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: "#fff",
  },
}));

const drillStyles = themed(() => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.darkDeep,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    paddingTop: 8,
    overflow: "hidden",
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  eyebrow: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 1.4,
    color: Colors.textMuted,
  },
  sampleBadge: {
    backgroundColor: "rgba(255,178,63,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,178,63,0.45)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  sampleBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    color: "#FFB23F",
  },
  title: {
    // Drill sheet bg is Colors.darkDeep (dark in dark mode, white in light).
    // textPrimary tracks the theme (white on dark, dark on white), unlike
    // `cardText` which is dark in both modes and vanished in dark mode.
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  subtitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.darkCard,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1.2,
    color: Colors.textMuted,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: Colors.darkCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 6,
    gap: 10,
  },
  rowName: {
    // Rows render on Colors.darkCard inside the drill sheet — theme-aware.
    // See `title` above for the same reasoning.
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: Colors.textPrimary,
  },
  rowSub: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  pctPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  pctText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  sharePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  shareText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: Colors.textSecondary,
    fontVariant: ["tabular-nums"],
  },
  empty: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
    paddingVertical: 20,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: "rgba(0,0,0,0.2)",
    gap: 8,
  },
  btnGhost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnGhostText: {
    // Ghost button sits in the drill modal footer on a translucent overlay
    // above Colors.darkDeep (dark in dark mode, white in light). Use the
    // theme-aware token so the label inverts with the surface.
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: Colors.textPrimary,
  },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.green,
  },
  btnPrimaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: Colors.cardText,
  },
}));
