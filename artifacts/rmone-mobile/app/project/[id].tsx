import AsyncStorage from "@react-native-async-storage/async-storage";
import { compactUsd } from "@/lib/money";
import { AppTextInput } from "@/components/AppTextInput";
import { Feather, Ionicons, MaterialCommunityIcons } from "@/lib/icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  ActivityIndicator,
  AppState,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Stop, Rect, G, Text as SvgText, Path, Line } from "react-native-svg";
import { LinearGradient as LG } from "expo-linear-gradient";
import { Colors, themed } from "@/constants/colors";
import { setChatPrompt, onScheduleChanged, notifyScheduleChanged } from "@/lib/chatBridge";
import { empTypeColor, useEmpColorsVersion } from "@/lib/employmentColor";
import { useGuidanceTip, useSkippedStages } from "@/lib/stageRules";
import { RmOneProcessing } from "@/components/RmOneProcessing";
import { useAuth } from "@/lib/auth";
import { useScreenBeacon } from "@/lib/usageBeacon";
import { globalAlert as xAlert, globalConfirm as xConfirm } from "@/lib/inAppAlert";
import { fmtHours, fmtNumber, fmtPct } from "@/lib/numberFormat";
import DateInput from "@/components/DateInput";
import { canShowFinancialHistory, FIELD_HISTORY_LABELS, formatHistoryDate, formatHistoryValue, historyActor, historySourceBadge } from "@/lib/fieldHistory";
import { canOpenRecordEditModal, isFinancialRecordField } from "@/lib/recordPermissions";
import { EditAllocationModal as SharedEditAllocationModal } from "@/components/EditAllocationModal";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import { DisabledStaffControl } from "@/components/DisabledStaffControl";
import {
  computeHealth as sharedComputeHealth,
  durationMonths as sharedDurationMonths,
  durationLabel as sharedDurationLabel,
  type HealthIssue as SharedHealthIssue,
  type HealthCheck as SharedHealthCheck,
} from "@workspace/health";
import { getProjectDetails, getProjectAllocations, getResourceAllocations, getProjectTeam, getCompanyProjects, getCompanyContacts, getFullProjectAllocations, updateHoursAllocation, bustCache, bustCacheByPrefix, getTaskData, updateProjectSchedule, createSchedule, getBillingRates, getProjectDivisionRoles, getLifecycles, createLifecycle, updateLifecycle, getResourceDemands, updateFields, getFieldOptions, getRecordPermissions, getStageCfg as apiGetStageCfg, saveStageCfgRemote, getAuditHealth, getAuditTrail, getRecordFieldHistory, auditAction, auditClose, auditOpen, type AuditHealth, type AuditTrailItem, type FieldChangeItem, type LiveResource, type ProjectTeamMember, type DemandItem, type OpenRole, type ProjectTeamResponse, type RecordPermissions } from "@/lib/api";

const SCREEN_W = Dimensions.get("window").width;

interface Allocation {
  name: string;
  role: string;
  title: string;
  pct: number;
  startDate: string;
  endDate: string;
  eacHrs: number;
  etcHrs: number;
  costRate: number;
  eacCost: number;
  etcCost: number;
  ncHrs: number;
  ncCost: number;
  hasWeeklyHours: boolean;
  bu: string;
  email: string;
  resourceId?: string;
  enabled?: boolean;
  tenantId?: string;
  /** Container allocation row ID (RWI) — merge target for duplicate adds. */
  rwiId?: number | null;
  /** Raw Employee Type label (e.g. "Part-Time") — drives name color coding. */
  employeeType?: string;
  /** Allocation flags (mirrors web's team schedule grid FLAGS column). */
  softAllocation?: boolean;
  nonChargeable?: boolean;
  isLocked?: boolean;
}

interface ProjectData {
  id: string;
  name: string;
  status: string;
  phase: string;
  city: string;
  sector: string;
  /** ApproxContractValue — total contract revenue. May be 0 if not set. */
  value: number;
  /** LaborContractAmount — labor portion of the contract. Distinct from value. */
  laborValue: number;
  company: string;
  bu: string;
  groupId: string;
  targetStart: string;
  targetEnd: string;
  actualStart: string;
  actualEnd: string;
  /** First phase StartDate / last phase DueDate from the lifecycle schedule.
   * When set, these win over actualStart/actualEnd everywhere — the raw
   * record fields can lag behind schedule edits (mirrors the web app). */
  scheduleStart: string;
  scheduleEnd: string;
  closeDate: string;
  bidDate: string;
  probability: number;
  module: string;
  allocations: Allocation[];
  keyPersonnel: { name: string; role: string; guid: string }[];
  healthScore: number;
  healthIssues: HealthIssue[];
  healthChecks: HealthCheck[];
  rawFields: Record<string, unknown>;
}

const ACCENT_BLUE = "#38BDF8";
const ACCENT_PURPLE = "#A78BFA";

// ── Shared phase-palette accents (mirrors web TeamScheduleGrid COL_ACCENT) ──
// The ETC/EAC summary figures take their hues from the SAME palette as the
// phase cards (client request: one matching color family across web + mobile).
const COL_ACCENT = {
  flags:   "#38BDF8", // sky
  etcHrs:  "#818CF8", // indigo
  eacHrs:  "#34D399", // emerald
  etcCost: "#FB923C", // orange
  eacCost: "#A78BFA", // violet
} as const;

// Flag chip palette + copy — mirrors web's FLAG_META exactly (sky = Soft,
// violet = Non-chargeable, amber = Locked; all drawn from the phase palette).
const FLAG_META = {
  soft: {
    short: "S", name: "Soft",
    color: "#38BDF8", chipBg: "rgba(56,189,248,0.52)", chipBd: "rgba(56,189,248,1)",
  },
  nc: {
    short: "NC", name: "Non-chargeable",
    color: "#A78BFA", chipBg: "rgba(167,139,250,0.50)", chipBd: "rgba(167,139,250,1)",
  },
  locked: {
    short: "L", name: "Locked",
    color: "#FBBF24", chipBg: "rgba(251,191,36,0.52)", chipBd: "rgba(251,191,36,1)",
  },
} as const;

// Per-tenant show/hide for the ETC/EAC hour + cost figures — same storage key
// base as web's TeamScheduleGrid toggle ("tsg-costcols-visible"), tenant-scoped.
// Default = visible (matches web).
const COSTCOLS_KEY_BASE = "rmone:tsg-costcols-visible";
async function loadShowEtcEac(): Promise<boolean> {
  try {
    const tenant = ((await AsyncStorage.getItem("rmone_tenant")) ?? "").toLowerCase();
    return (await AsyncStorage.getItem(`${COSTCOLS_KEY_BASE}:${tenant}`)) !== "0";
  } catch { return true; }
}
async function saveShowEtcEac(next: boolean): Promise<void> {
  try {
    const tenant = ((await AsyncStorage.getItem("rmone_tenant")) ?? "").toLowerCase();
    await AsyncStorage.setItem(`${COSTCOLS_KEY_BASE}:${tenant}`, next ? "1" : "0");
  } catch { /* storage blocked — the choice still applies for this session */ }
}
const ACCENT_TEAL = "#2DD4BF";
const ACCENT_PINK = "#F472B6";
const ACCENT_AMBER = "#FBBF24";
const GRADIENT_GREEN = ["#84CC16", "#BEF264"];
const GRADIENT_ORANGE = ["#FB923C", "#FDBA74"];
const GRADIENT_BLUE = ["#38BDF8", "#7DD3FC"];
const GRADIENT_RED = ["#F87171", "#FCA5A5"];

const ALLOC_COLORS = ["#84CC16", "#38BDF8", "#FB923C", "#A78BFA", "#2DD4BF", "#F472B6", "#FBBF24", "#F87171"];

function fmtM(v: number) {
  if (v == null || isNaN(v)) return "—";
  if (v === 0) return "$0";
  if (v >= 1_000_000_000) return compactUsd(v);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateShort(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function getModule(id: string): string {
  if (id.startsWith("PMM")) return "PMM";
  if (id.startsWith("OPM")) return "OPM";
  if (id.startsWith("LEM")) return "LEM";
  if (id.startsWith("COM")) return "COM";
  if (id.startsWith("CON")) return "CON";
  return "PMM";
}

type HealthIssue = SharedHealthIssue;
type HealthCheck = SharedHealthCheck;
// Wrapper around the shared health scorer (lib/health/src/index.ts).
// Both this mobile screen and the API-server's AI-chat health gauge MUST go
// through this same shared function so the score, the failed-check bullets,
// and the wording stay identical everywhere the user sees them. Do NOT add
// scoring rules here — change them in lib/health/src/index.ts instead.
function computeHealth(
  d: ProjectData,
  ctx?: { lifecycleAssigned?: boolean; scheduleLastPhaseEnd?: string }
): { score: number; issues: HealthIssue[]; checks: HealthCheck[] } {
  return sharedComputeHealth(
    {
      status: d.status,
      value: d.value,
      targetStart: d.targetStart,
      targetEnd: d.targetEnd,
      actualEnd: d.actualEnd,
      probability: d.probability,
      module: d.module,
      allocations: d.allocations.map(a => ({ name: a.name, role: a.role, pct: a.pct })),
    },
    ctx,
  );
}
// (Legacy local PMM/OPM/LEM scoring removed; logic now lives in
// @workspace/health/src/index.ts. Edit it there.)

function healthColor(score: number): string {
  if (score < 0) return "#6B7280";
  if (score >= 80) return "#84CC16";
  if (score >= 60) return "#FB923C";
  return "#F87171";
}

function healthLabel(score: number): string {
  if (score < 0) return "N/A";
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}

function phaseColor(phase: string): string {
  const p = phase.toLowerCase();
  if (p.includes("construct") || p.includes("progress")) return "#84CC16";
  if (p.includes("precon") || p.includes("design") || p.includes("awarded")) return "#FB923C";
  if (p.includes("bid") || p.includes("await") || p.includes("rom")) return "#38BDF8";
  if (p.includes("close")) return "#2DD4BF";
  return Colors.textSecondary;
}

function moduleColor(m: string): string {
  switch (m) {
    case "PMM": return "#84CC16";
    case "OPM": return "#FB923C";
    case "LEM": return "#38BDF8";
    case "COM": return "#A78BFA";
    case "CON": return "#2DD4BF";
    default: return "#84CC16";
  }
}

/**
 * Admin-authored "Tip for your team" banner — shown when the signed-in
 * tenant's admin has written a tip for the record's current stage in
 * Settings → Stage Rules. Display-only; never gates any action.
 * Mirrors the web's OppLifecycleFooter guidanceTip banner styling.
 */
function GuidanceBanner({ tip }: { tip: string | null }) {
  if (!tip) return null;
  return (
    <View style={{
      flexDirection: "row", alignItems: "flex-start", gap: 8,
      marginHorizontal: 16, marginBottom: 10,
      backgroundColor: "rgba(139,92,246,0.10)",
      borderWidth: 0.5, borderColor: "rgba(139,92,246,0.30)",
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    }}>
      <Ionicons name="bulb-outline" size={14} color="#C4B5FD" style={{ marginTop: 2 }} />
      <Text style={{
        flex: 1, fontFamily: "Inter_500Medium", fontSize: 12.5,
        lineHeight: 18, color: "#DDD6FE",
      }}>
        {tip}
      </Text>
    </View>
  );
}

const STATUS_MAP: Record<string, string> = {
  "Under Construction": "Construction",
  "Awarded in PreCon": "PreCon",
  "Pre-Construction": "PreCon",
  "Awarded Final Pricing Approved": "PreCon",
  "In Design": "Design",
  "In Progress": "In Progress",
  "Close-Out": "Closeout",
  "Bidding Competitive": "Bidding",
  "Bidding Negotiated": "Bidding",
  "Budgeting Negotiated": "Budgeting",
  "Awaiting Drawings": "Awaiting",
  "Awaiting Client Response": "Awaiting",
  "ROM": "ROM",
};

/* ─── Stage config (Override Status) ────────────────────────────────────
 * Mirrors the web project-detail implementation: schedule phases become
 * the status choices when a lifecycle is assigned; sub-statuses appear
 * indented beneath their parent phase in the picker.
 * The config is stored locally in AsyncStorage (per device — web stores
 * an equivalent copy in localStorage, but the two stores are separate and
 * do not sync automatically). The key format intentionally matches web so
 * a future server-backed sync would be key-compatible from day one.
 * ──────────────────────────────────────────────────────────────────────── */
type StageCfg = {
  order: string[];
  custom: string[];
  removed: string[];
  /** Sub-statuses keyed by parent phase name (lowercase). */
  subStatuses?: Record<string, string[]>;
};
const EMPTY_STAGE_CFG: StageCfg = { order: [], custom: [], removed: [], subStatuses: {} };

function parseStageCfg(raw: string | null): StageCfg {
  try {
    const obj = JSON.parse(raw ?? "null");
    if (obj && Array.isArray(obj.order) && Array.isArray(obj.custom)) {
      const sub: Record<string, string[]> = {};
      if (obj.subStatuses && typeof obj.subStatuses === "object" && !Array.isArray(obj.subStatuses)) {
        for (const [k, v] of Object.entries(obj.subStatuses)) {
          if (Array.isArray(v)) sub[k] = (v as unknown[]).map(String);
        }
      }
      return {
        order: obj.order.map(String),
        custom: obj.custom.map(String),
        removed: Array.isArray(obj.removed) ? obj.removed.map(String) : [],
        subStatuses: sub,
      };
    }
  } catch {}
  return EMPTY_STAGE_CFG;
}

/** Flat set of all sub-status values (lowercase) for indent rendering. */
function getSubStatusKeys(cfg: StageCfg): Set<string> {
  const s = new Set<string>();
  for (const arr of Object.values(cfg.subStatuses ?? {})) {
    for (const v of arr) s.add(v.trim().toLowerCase());
  }
  return s;
}

function injectSubStatuses(phases: string[], cfg: StageCfg): string[] {
  const sub = cfg.subStatuses;
  if (!sub || Object.keys(sub).length === 0) return phases;
  const seen = new Set(phases.map((p) => p.trim().toLowerCase()));
  const out: string[] = [];
  for (const s of phases) {
    out.push(s);
    const children = sub[s.trim().toLowerCase()] ?? [];
    for (const c of children) {
      const k = c.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/** Merges saved customization onto the base option list. With `lockedBase:true`
 *  (schedule phases), phases cannot be removed or reordered — only custom
 *  additions and sub-statuses layer on top. Mirrors web applyStageCfgToOptions. */
function applyStageCfgToOptions(base: string[], cfg: StageCfg, opts?: { lockedBase?: boolean }): string[] {
  const lockedKeys = opts?.lockedBase ? new Set(base.map((s) => s.trim().toLowerCase())) : null;
  const removed = new Set(cfg.removed.map((s) => s.trim().toLowerCase()));
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...base, ...cfg.custom]) {
    const k = s ? s.trim().toLowerCase() : "";
    if (!k || seen.has(k)) continue;
    if (removed.has(k) && !(lockedKeys && lockedKeys.has(k))) continue;
    seen.add(k); merged.push(s);
  }
  const orderNames = lockedKeys
    ? cfg.order.filter((o) => !lockedKeys.has(o.trim().toLowerCase()))
    : cfg.order;
  if (!lockedKeys && orderNames.length === 0) return injectSubStatuses(merged, cfg);
  const out: string[] = [];
  if (lockedKeys) for (const s of merged) if (lockedKeys.has(s.trim().toLowerCase())) out.push(s);
  for (const o of orderNames) {
    const m = merged.find((s) => s.trim().toLowerCase() === o.trim().toLowerCase());
    if (m && !out.includes(m)) out.push(m);
  }
  for (const s of merged) if (!out.includes(s)) out.push(s);
  return injectSubStatuses(out, cfg);
}

/** Extract schedule phase titles from raw /task-data rows, sorted by StageStep. */
function extractSchedulePhaseTitles(rawTasks: unknown): string[] | null {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return null;
  return (rawTasks as Record<string, unknown>[])
    .map((t) => ({
      title: String((t as { Title?: unknown }).Title ?? (t as { Alias?: unknown }).Alias ?? "").trim(),
      step: Number((t as { StageStep?: unknown }).StageStep ?? (t as { ItemOrder?: unknown }).ItemOrder ?? 0) || 0,
    }))
    .filter((p) => p.title)
    .sort((a, b) => a.step - b.step)
    .map((p) => p.title);
}

function shadeColor(input: string, amount: number): string {
  // amount: -1 (black) to +1 (white)
  let r = 0, g = 0, b = 0;
  const m = input.trim();
  if (m.startsWith("#")) {
    const h = m.slice(1);
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else if (m.startsWith("rgb")) {
    const nums = m.replace(/[^\d,]/g, "").split(",").map(n => parseInt(n, 10));
    [r, g, b] = [nums[0] || 0, nums[1] || 0, nums[2] || 0];
  }
  const adj = (c: number) => {
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
}

function HealthGauge({ score, issues = [], size = 130 }: { score: number; issues?: HealthIssue[]; size?: number }) {
  const padding = 26;
  const totalSize = size + padding * 2;
  const strokeW = 14;
  const r = (size - strokeW) / 2;
  const cx = totalSize / 2;
  const cy = totalSize / 2;
  const startAngle = 135;
  const arcDegrees = 270;
  const hc = healthColor(score);

  // Use ONE muted deduction color (slate-grey) so multiple issues read as
  // "missing slice" rather than a rainbow of reds blending into the score arc.
  const deductionColor = "rgba(148, 163, 184, 0.55)";
  const segments: { value: number; color: string; label?: string }[] = [];
  const safeScore = Math.max(0, Math.min(100, score));
  // Score arc carries no label — the big number in the center already shows it.
  if (safeScore > 0) segments.push({ value: safeScore, color: hc });
  issues.forEach((iss) => {
    if (iss.deduction > 0) {
      segments.push({
        value: iss.deduction,
        color: deductionColor,
        label: `−${iss.deduction}`,
      });
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
        {/* Track */}
        <Path
          d={arcPath(startAngle, startAngle + arcDegrees, r, 1, 2)}
          stroke="rgba(0,0,0,0.45)"
          strokeWidth={strokeW + 2}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={arcPath(startAngle, startAngle + arcDegrees, r)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeW}
          fill="none"
          strokeLinecap="round"
        />

        {/* Segments — 3D layering: shadow → base → highlight */}
        {rendered.map((s, i) => (
          <Path
            key={`shadow-${i}`}
            d={arcPath(s.segStart, s.segEnd, r, 1.5, 2.5)}
            stroke={shadeColor(s.color, -0.55)}
            strokeWidth={strokeW + 1}
            fill="none"
            strokeLinecap="round"
            opacity={0.55}
          />
        ))}
        {rendered.map((s, i) => (
          <Path
            key={`base-${i}`}
            d={arcPath(s.segStart, s.segEnd, r)}
            stroke={s.color}
            strokeWidth={strokeW}
            fill="none"
            strokeLinecap="round"
          />
        ))}
        {rendered.map((s, i) => (
          <Path
            key={`hi-${i}`}
            d={arcPath(s.segStart, s.segEnd, r, -0.6, -1.2)}
            stroke={shadeColor(s.color, 0.55)}
            strokeWidth={strokeW * 0.45}
            fill="none"
            strokeLinecap="round"
            opacity={0.7}
          />
        ))}
        {rendered.map((s, i) => (
          <Path
            key={`gloss-${i}`}
            d={arcPath(s.segStart, s.segEnd, r, -0.3, -2)}
            stroke={shadeColor(s.color, 0.85)}
            strokeWidth={strokeW * 0.18}
            fill="none"
            strokeLinecap="round"
            opacity={0.6}
          />
        ))}

        {/* Outer labels: just the deduction value, no tag clutter */}
        {rendered.map((s, i) => {
          if (!s.label) return null;
          const midA = (s.segStart + s.segEnd) / 2;
          const labelPos = polar(midA, r + 16);
          return (
            <SvgText
              key={`lbl-${i}`}
              x={labelPos.x}
              y={labelPos.y + 3}
              fontSize="10"
              fontWeight="bold"
              fill="rgba(226, 232, 240, 0.85)"
              textAnchor="middle"
            >
              {s.label}
            </SvgText>
          );
        })}

        {/* Inner number with depth shadow — colored by health */}
        <SvgText x={cx + 1} y={cy - 2} fontSize="34" fontWeight="bold" fill="rgba(0,0,0,0.5)" textAnchor="middle">
          {score}
        </SvgText>
        <SvgText x={cx} y={cy - 4} fontSize="34" fontWeight="bold" fill={hc} textAnchor="middle">
          {score}
        </SvgText>
        <SvgText x={cx} y={cy + 16} fontSize="10" fontWeight="700" fill={hc} textAnchor="middle" opacity={0.85}>
          {healthLabel(score).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

/** Build a short disambiguator for a member whose name collides with another
 *  team member. Priority: job title (if different from role) → email username
 *  → last 4 chars of resource GUID. Returns "" when nothing useful is found. */
function buildDisambiguator(m: { role: string; title?: string; email?: string; resourceId?: string }): string {
  if (m.title && m.title.trim() && m.title.trim() !== m.role.trim()) return m.title.trim();
  if (m.email) {
    const username = m.email.split("@")[0];
    if (username) return username;
  }
  if (m.resourceId && m.resourceId.length >= 4) return `·${m.resourceId.slice(-4)}`;
  return "";
}

function TeamMemberCard({ member, color, onEdit, expanded, onToggle, canEdit = true, disambiguator, showEtcEac = true, onReactivated }: {
  member: Allocation; color: string; onEdit: () => void; expanded: boolean; onToggle: () => void; canEdit?: boolean;
  /** Secondary label shown only when this member shares a display name with
   *  another person on the same project team. */
  disambiguator?: string;
  /** Per-tenant "Hide ETC/EAC" toggle (mirrors web) — when false, the EAC/ETC
   *  hour + cost figures are hidden on this card. */
  showEtcEac?: boolean;
  onReactivated?: (userGuid: string) => void | Promise<void>;
}) {
  const memberFlags: (keyof typeof FLAG_META)[] = [
    ...(member.softAllocation ? (["soft"] as const) : []),
    ...(member.nonChargeable ? (["nc"] as const) : []),
    ...(member.isLocked ? (["locked"] as const) : []),
  ];
  // Re-renders once the admin-tunable employment-type name colors load.
  useEmpColorsVersion();
  const initials = member.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const fmtD = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
    return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const fmtCost = (v: number) => {
    if (!v) return "$0";
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 10_000) return `$${(v / 1000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString("en-US")}`;
  };

  return (
    <View style={st.tmCard}>
      <Pressable style={st.tmCardHeader} onPress={onToggle}>
        <View style={[st.tmAvatar, { backgroundColor: color + "20" }]}>
          <Text style={[st.tmAvatarText, { color }]}>{initials}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[st.tmName, empTypeColor(member.employeeType) ? { color: empTypeColor(member.employeeType)! } : null]} numberOfLines={1}>{member.name}</Text>
           <DisabledStaffControl enabled={member.enabled} userGuid={member.resourceId} tenantId={member.tenantId} onReactivated={onReactivated} />
          <Text style={st.tmRole} numberOfLines={1}>{member.role || "Team Member"}</Text>
          {disambiguator ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
              <Feather name="tag" size={9} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }} numberOfLines={1}>
                {disambiguator}
              </Text>
            </View>
          ) : null}
          {member.bu ? <Text style={st.tmBu}>BU: {member.bu}</Text> : null}
          {member.email ? (
            <View style={st.tmEmailRow}>
              <Feather name="mail" size={10} color={Colors.textMuted} />
              <Text style={st.tmEmail} numberOfLines={1}>{member.email}</Text>
            </View>
          ) : null}
          <View style={st.tmPctRow}>
            <View style={[st.tmPctDot, { backgroundColor: color }]} />
            <Text style={[st.tmPctText, { color }]}>{fmtPct(member.pct)} allocated</Text>
          </View>
          {memberFlags.length > 0 && (
            <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
              {memberFlags.map((f) => (
                <View key={f} style={{
                  paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5,
                  backgroundColor: FLAG_META[f].chipBg, borderWidth: 1, borderColor: FLAG_META[f].chipBd,
                }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: "#FFF", letterSpacing: 0.4 }}>
                    {FLAG_META[f].short}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {member.eacHrs === 0 && member.ncHrs > 0 ? (
            <>
              <Text style={[st.tmEacHrs, { color: Colors.orange }]}>{member.ncHrs}</Text>
              <Text style={[st.tmEacLabel, { color: Colors.orange }]}>NC HRS</Text>
            </>
          ) : showEtcEac ? (
            <>
              <Text style={[st.tmEacHrs, { color: COL_ACCENT.eacHrs }]}>{fmtHours(member.eacHrs)}</Text>
              <Text style={[st.tmEacLabel, { color: COL_ACCENT.eacHrs }]}>EAC HRS</Text>
            </>
          ) : null}
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={Colors.textMuted} style={{ marginLeft: 8 }} />
      </Pressable>

      {expanded && (
        <View style={st.tmDetails}>
          {member.email ? (
            <Pressable onPress={() => Linking.openURL(`mailto:${member.email}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignSelf: "flex-start" }}>
              <Feather name="mail" size={12} color={Colors.green} />
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.green }}>{member.email}</Text>
            </Pressable>
          ) : null}
          <View style={st.tmMetricsRow}>
            {showEtcEac && (
              <View style={st.tmMetricBox}>
                <Text style={[st.tmMetricLabel, { color: COL_ACCENT.eacHrs }]}>EAC Hrs</Text>
                <Text style={[st.tmMetricValue, { color: COL_ACCENT.eacHrs }]}>{fmtHours(member.eacHrs)}</Text>
              </View>
            )}
            {showEtcEac && (
              <View style={st.tmMetricBox}>
                <Text style={[st.tmMetricLabel, { color: COL_ACCENT.etcHrs }]}>ETC Hrs</Text>
                <Text style={[st.tmMetricValue, { color: COL_ACCENT.etcHrs }]}>{fmtHours(member.etcHrs)}</Text>
              </View>
            )}
            <View style={st.tmMetricBox}>
              <Text style={st.tmMetricLabel}>Cost Rate</Text>
              <Text style={st.tmMetricValue}>{fmtCost(member.costRate)}</Text>
            </View>
            {showEtcEac && (
              <View style={st.tmMetricBox}>
                <Text style={[st.tmMetricLabel, { color: COL_ACCENT.etcCost }]}>ETC Cost</Text>
                <Text style={[st.tmMetricValue, { color: COL_ACCENT.etcCost }]}>{fmtCost(member.etcCost)}</Text>
              </View>
            )}
          </View>
          <View style={st.tmMetricsRow}>
            <View style={st.tmMetricBox}>
              <Text style={[st.tmMetricLabel, { color: Colors.orange }]}>NC Hrs</Text>
              <Text style={[st.tmMetricValue, { color: Colors.orange }]}>{member.ncHrs}</Text>
            </View>
            <View style={st.tmMetricBox}>
              <Text style={[st.tmMetricLabel, { color: Colors.orange }]}>NC Cost</Text>
              <Text style={[st.tmMetricValue, { color: Colors.orange }]}>{fmtCost(member.ncCost)}</Text>
            </View>
            <View style={st.tmMetricBox}>
              <Text style={st.tmMetricLabel}>Allocation</Text>
              <Text style={[st.tmMetricValue, { color }]}>{fmtPct(member.pct)}</Text>
            </View>
          </View>

          {(member.startDate || member.endDate) && (
            <View style={st.tmDateRow}>
              <Feather name="calendar" size={12} color={Colors.textMuted} />
              <Text style={st.tmDateText}>{fmtD(member.startDate)} – {fmtD(member.endDate)}</Text>
            </View>
          )}

          <Text style={[st.tmWeeklyLabel, { color: member.hasWeeklyHours ? Colors.green : Colors.orange }]}>
            {member.hasWeeklyHours ? "Weekly hours allocated" : "No weekly hours allocated"}
          </Text>

          {/* Profile info: Role / Title / BU */}
          <View style={{
            marginTop: 12, padding: 10, borderRadius: 8,
            backgroundColor: "rgba(255,255,255,0.03)",
            borderWidth: 1, borderColor: Colors.border, gap: 6,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name="briefcase" size={11} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textMuted, width: 56 }}>Role</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textPrimary, flex: 1 }} numberOfLines={2}>
                {member.role || "—"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name="award" size={11} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textMuted, width: 56 }}>Title</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textPrimary, flex: 1 }} numberOfLines={2}>
                {member.title || "—"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name="grid" size={11} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textMuted, width: 56 }}>BU</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textPrimary, flex: 1 }} numberOfLines={2}>
                {member.bu || "—"}
              </Text>
            </View>
          </View>

          {canEdit && (
            <Pressable style={st.tmEditBtn} onPress={onEdit}>
              <Feather name="edit-2" size={12} color="#FFF" />
              <Text style={st.tmEditBtnText}>Edit Allocation</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function TeamMemberList({ allocations, onEdit, searchQuery, canEdit = true, showEtcEac = true, onReactivated }: {
  allocations: Allocation[];
  onEdit: (a: Allocation) => void;
  searchQuery: string;
  canEdit?: boolean;
  showEtcEac?: boolean;
  onReactivated?: (userGuid: string) => void | Promise<void>;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  if (allocations.length === 0) return null;

  // Detect duplicate display names within this project team so we can show a
  // disambiguator chip next to each colliding member's row.
  const nameCounts = new Map<string, number>();
  for (const a of allocations) nameCounts.set(a.name.toLowerCase(), (nameCounts.get(a.name.toLowerCase()) ?? 0) + 1);

  const filtered = searchQuery
    ? allocations.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()) || a.role.toLowerCase().includes(searchQuery.toLowerCase()))
    : allocations;

  return (
    <View>
      {filtered.map((a, i) => {
        const c = a.pct > 100 ? "#F08C22" : ALLOC_COLORS[i % ALLOC_COLORS.length];
        const isDup = (nameCounts.get(a.name.toLowerCase()) ?? 0) > 1;
        const disambiguator = isDup ? buildDisambiguator(a) : undefined;
        return (
          <TeamMemberCard
            key={a.resourceId || `${a.name}-${a.role}-${i}`}
            member={a}
            color={c}
            expanded={expandedIdx === i}
            onToggle={() => { setExpandedIdx(expandedIdx === i ? null : i); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            onEdit={() => { onEdit(a); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            canEdit={canEdit}
            disambiguator={disambiguator}
            showEtcEac={showEtcEac}
            onReactivated={onReactivated}
          />
        );
      })}
    </View>
  );
}

// duration helpers re-exported from @workspace/health so they cannot drift
// from the values the shared health scorer uses internally.
const durationMonths = sharedDurationMonths;
const durationLabel = sharedDurationLabel;

function fmtDateFull(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function GanttTimeline({ project }: { project: ProjectData }) {
  // Display rule: when Actual dates exist, the project has an assigned
  // schedule and Actual already represents its true range (phase 1 start →
  // last phase end for PMM; proposal start → last phase end for OPM).
  // Hide Target in that case to avoid showing two competing date bands.
  // Schedule-derived dates win over the raw record fields so this band
  // always matches the Project Schedule card (same rule as the web app).
  const effActualStart = project.scheduleStart || project.actualStart;
  const effActualEnd = project.scheduleEnd || project.actualEnd;
  const hasActual = !!(effActualStart || effActualEnd);
  const phases = [
    !hasActual ? { label: "Target", start: project.targetStart, end: project.targetEnd, color: "#6BA539", bg: "rgba(107,165,57,0.15)" } : null,
    { label: "Schedule", start: effActualStart, end: effActualEnd, color: "#E87722", bg: "rgba(232,119,34,0.15)" },
  ].filter((p): p is { label: string; start: string; end: string; color: string; bg: string } => !!p && (!!p.start || !!p.end));

  if (phases.length === 0) return <Text style={st.emptyChart}>No timeline data available</Text>;

  const hasDelay = project.targetEnd && project.actualEnd &&
    new Date(project.actualEnd).getTime() > new Date(project.targetEnd).getTime();
  const delayMonths = hasDelay ? durationMonths(project.targetEnd, project.actualEnd) : 0;

  return (
    <View style={{ gap: 10 }}>
      {phases.map((p, i) => (
        <View key={i} style={{
          backgroundColor: p.bg,
          borderRadius: 22,
          borderWidth: 1.5,
          borderColor: p.color + "50",
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
        }}>
          <View style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: p.color,
            marginRight: 10,
          }} />
          <Text style={{
            fontFamily: "Inter_700Bold",
            fontSize: 12,
            color: p.color,
            marginRight: 6,
          }}>
            {p.label}:
          </Text>
          <Text style={{
            fontFamily: "Inter_600SemiBold",
            fontSize: 12,
            color: Colors.cardText,
            flex: 1,
          }}>
            {fmtDateFull(p.start)} – {fmtDateFull(p.end)}
          </Text>
        </View>
      ))}

      {hasDelay && delayMonths > 0 && (
        <View style={{
          backgroundColor: "rgba(248,113,113,0.1)",
          borderRadius: 22,
          borderWidth: 1.5,
          borderColor: "rgba(248,113,113,0.3)",
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
        }}>
          <Feather name="alert-triangle" size={13} color="#F87171" style={{ marginRight: 8 }} />
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "#F87171" }}>
            +{durationLabel(delayMonths)} over target
          </Text>
        </View>
      )}
    </View>
  );
}

interface ScheduleTask {
  ID: number;
  Title: string;
  StartDate: string;
  DueDate: string;
  Status: string;
  PercentComplete: number;
  ItemOrder: number;
  TicketId: string;
  AssignedTo: string;
  isSelected: boolean;
  StageStep: number;
}

interface LifecycleStage { ID: number; Name: string; StageStep: number }
interface LifecycleInfo { ID: number; Name: string; Stages: LifecycleStage[] }

function LifecycleDropdown({ lifecycles, selectedId, onSelect }: { lifecycles: LifecycleInfo[]; selectedId: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = lifecycles.find(l => String(l.ID) === selectedId);
  const label = selected ? `${selected.Name} (${selected.Stages?.length ?? 0} phases)` : "Select a lifecycle template…";

  return (
    <View style={{ marginBottom: 10, zIndex: 10 }}>
      <Text style={{
        fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.6,
        textTransform: "uppercase", color: Colors.cardMuted, marginBottom: 6,
      }}>
        Lifecycle template
      </Text>
      <Pressable
        onPress={() => {
          if (open) auditClose({ screen: "project-detail" });
          else auditOpen({ screen: "project-detail" });
          setOpen(!open);
        }}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
          borderRadius: 10, borderWidth: 1.5, borderColor: open ? Colors.green : Colors.cardBorderStrong,
          backgroundColor: Colors.surfaceAlt, paddingLeft: 14, paddingRight: 10, paddingVertical: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <Feather name="layers" size={15} color={Colors.green} />
          <Text numberOfLines={1} style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: selected ? Colors.cardText : Colors.cardMuted, flex: 1 }}>{label}</Text>
        </View>
        <View style={{
          width: 24, height: 24, borderRadius: 7,
          backgroundColor: open ? Colors.green : "rgba(107,165,57,0.15)",
          alignItems: "center", justifyContent: "center",
        }}>
          <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={open ? "#FFFFFF" : Colors.green} />
        </View>
      </Pressable>
      {open && (
        <View style={{
          marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder,
          backgroundColor: Colors.cardBg, overflow: "hidden",
        }}>
          {lifecycles.map((lc, i) => {
            const isActive = String(lc.ID) === selectedId;
            return (
              <Pressable
                key={lc.ID}
                onPress={() => { auditAction({ screen: "project-detail" }); onSelect(String(lc.ID)); setOpen(false); }}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 14, paddingVertical: 12,
                  borderBottomWidth: i < lifecycles.length - 1 ? 1 : 0,
                  borderBottomColor: Colors.cardBorder,
                  backgroundColor: isActive ? "rgba(107,165,57,0.12)" : "transparent",
                }}
              >
                <Feather name={isActive ? "check-circle" : "circle"} size={16} color={isActive ? Colors.green : Colors.cardMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: isActive ? Colors.green : Colors.cardText }}>{lc.Name}</Text>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 1 }}>{lc.Stages?.length ?? 0} phases</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {!open && selected && (selected.Stages?.length ?? 0) > 0 && (
        <View style={{
          marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: "rgba(107,165,57,0.25)",
          backgroundColor: "rgba(107,165,57,0.06)", padding: 10, gap: 6,
        }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.green, letterSpacing: 0.5 }}>
            PHASES IN {selected.Name.toUpperCase()}
          </Text>
          {[...selected.Stages]
            .sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0))
            .map((stage, idx) => (
              <View key={stage.ID} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
                <View style={{
                  width: 18, height: 18, borderRadius: 9,
                  backgroundColor: "rgba(107,165,57,0.18)",
                  borderWidth: 1, borderColor: "rgba(107,165,57,0.4)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.green }}>{idx + 1}</Text>
                </View>
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.cardText, flex: 1 }} numberOfLines={1}>
                  {stage.Name}
                </Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

function ManageLifecyclesModal({ visible, lifecycles, canEdit, module, onClose, onSaved }: {
  visible: boolean; lifecycles: LifecycleInfo[]; canEdit: boolean; module: string; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phases, setPhases] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resetToList = () => { setView("list"); setEditingId(null); setName(""); setPhases([""]); setError(""); };
  const openNew = () => { auditOpen({ screen: "project-detail" }); setEditingId(null); setName(""); setPhases([""]); setError(""); setView("form"); };
  const openEdit = (lc: LifecycleInfo) => {
    auditOpen({ screen: "project-detail" });
    setEditingId(lc.ID); setName(lc.Name);
    const sorted = [...(lc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map(s => s.Name);
    setPhases(sorted.length > 0 ? sorted : [""]);
    setError(""); setView("form");
  };

  const setPhaseAt = (i: number, val: string) => setPhases(p => p.map((x, idx) => idx === i ? val : x));
  const addPhase = () => { auditAction({ screen: "project-detail" }); setPhases(p => [...p, ""]); };
  const removePhase = (i: number) => { auditAction({ screen: "project-detail" }); setPhases(p => p.length <= 1 ? [""] : p.filter((_, idx) => idx !== i)); };
  const movePhase = (i: number, dir: -1 | 1) => setPhases(p => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const next = [...p]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const handleSave = async () => {
    const cleanName = name.trim();
    const cleanPhases = phases.map(p => p.trim()).filter(Boolean);
    if (!cleanName) { setError("Please enter a lifecycle name."); return; }
    if (cleanPhases.length === 0) { setError("Add at least one phase."); return; }
    setSaving(true); setError("");
    try {
      if (editingId == null) await createLifecycle({ Name: cleanName, Stages: cleanPhases, Module: module });
      else await updateLifecycle(editingId, { Name: cleanName, Stages: cleanPhases });
      auditAction({ screen: "project-detail" });
      await onSaved();
      resetToList();
    } catch (e: any) {
      setError(e?.message || "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => { resetToList(); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "#16201A", borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "86%", paddingTop: 16, paddingHorizontal: 16, paddingBottom: 28 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText }}>
              {view === "list" ? "Manage Lifecycles" : editingId == null ? "New Lifecycle" : "Edit Lifecycle"}
            </Text>
            <Pressable onPress={handleClose} hitSlop={10} style={{ padding: 4 }}>
              <Feather name="x" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          {view === "list" ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              {lifecycles.length === 0 && (
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center", paddingVertical: 16 }}>
                  No lifecycles yet. Create your first one below.
                </Text>
              )}
              {lifecycles.map(lc => (
                <View key={lc.ID} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.panelStrong, backgroundColor: Colors.panelSoft, marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText }} numberOfLines={1}>{lc.Name}</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 1 }}>{lc.Stages?.length ?? 0} phases</Text>
                  </View>
                  <Pressable onPress={() => openEdit(lc)} disabled={!canEdit} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "rgba(107,165,57,0.4)", backgroundColor: "rgba(107,165,57,0.12)", opacity: canEdit ? 1 : 0.5 }}>
                    <Feather name="edit-2" size={13} color={Colors.green} />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.green }}>Edit</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={openNew} disabled={!canEdit} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(107,165,57,0.5)", backgroundColor: "rgba(107,165,57,0.08)", marginTop: 4, opacity: canEdit ? 1 : 0.5 }}>
                <Feather name="plus" size={15} color={Colors.green} />
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>New Lifecycle</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted, letterSpacing: 0.4, marginBottom: 6, textTransform: "uppercase" }}>Lifecycle name</Text>
              <AppTextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. 8 Phase AIA"
                placeholderTextColor={Colors.textMuted}
                style={{ backgroundColor: Colors.panel, borderRadius: 10, color: Colors.cardText, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_600SemiBold", borderWidth: 0.5, borderColor: Colors.border, marginBottom: 16 }}
              />

              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted, letterSpacing: 0.4, marginBottom: 6, textTransform: "uppercase" }}>Phases</Text>
              {phases.map((ph, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.green, width: 16, textAlign: "center" }}>{i + 1}</Text>
                  <AppTextInput
                    value={ph}
                    onChangeText={(t: string) => setPhaseAt(i, t)}
                    placeholder={`Phase ${i + 1} name`}
                    placeholderTextColor={Colors.textMuted}
                    style={{ flex: 1, backgroundColor: Colors.panel, borderRadius: 9, color: Colors.cardText, paddingHorizontal: 10, paddingVertical: 10, fontSize: 13, fontFamily: "Inter_500Medium", borderWidth: 0.5, borderColor: Colors.border }}
                  />
                  <Pressable onPress={() => movePhase(i, -1)} disabled={i === 0} style={{ width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.panel, opacity: i === 0 ? 0.35 : 1 }}>
                    <Feather name="chevron-up" size={16} color={Colors.cardText} />
                  </Pressable>
                  <Pressable onPress={() => movePhase(i, 1)} disabled={i === phases.length - 1} style={{ width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.panel, opacity: i === phases.length - 1 ? 0.35 : 1 }}>
                    <Feather name="chevron-down" size={16} color={Colors.cardText} />
                  </Pressable>
                  <Pressable onPress={() => removePhase(i)} style={{ width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(248,113,113,0.12)" }}>
                    <Feather name="minus" size={16} color="#F87171" />
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={addPhase} style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: Colors.borderStrong, marginTop: 4, marginBottom: 14 }}>
                <Feather name="plus" size={14} color={Colors.textSoft} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSoft }}>Add phase</Text>
              </Pressable>

              {!!error && <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#F87171", marginBottom: 10 }}>{error}</Text>}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable onPress={resetToList} disabled={saving} style={{ flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.borderStrong, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSave} disabled={saving || !canEdit} style={{ flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: "center", backgroundColor: saving || !canEdit ? "rgba(107,165,57,0.4)" : Colors.green }}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText }}>{editingId == null ? "Create" : "Save changes"}</Text>}
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SchedulePhases({ ticketId, module, project, onRefresh, parentLcAssigned, canEdit = true }: { ticketId: string; module: string; project: ProjectData; onRefresh?: () => void; parentLcAssigned?: boolean; canEdit?: boolean }) {
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editWeeks, setEditWeeks] = useState("");
  const [saving, setSaving] = useState(false);
  const [lifecycleId, setLifecycleId] = useState("");
  const [lifecycles, setLifecycles] = useState<LifecycleInfo[]>([]);
  const [selectedLcId, setSelectedLcId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [showChangeLc, setShowChangeLc] = useState(false);
  const [isLcAssigned, setIsLcAssigned] = useState(parentLcAssigned ?? false);
  const [showManageLc, setShowManageLc] = useState(false);

  const reloadLifecycles = useCallback(async () => {
    const lcRes = await getLifecycles().catch(() => [] as LifecycleInfo[]);
    const lcList: LifecycleInfo[] = Array.isArray(lcRes) ? lcRes : [];
    setLifecycles(lcList);
  }, []);

  const [editingDates, setEditingDates] = useState(false);
  const [dateTargetStart, setDateTargetStart] = useState("");
  const [dateTargetEnd, setDateTargetEnd] = useState("");
  const [dateActualStart, setDateActualStart] = useState("");
  const [dateActualEnd, setDateActualEnd] = useState("");
  const [dateBid, setDateBid] = useState("");
  const [savingDates, setSavingDates] = useState(false);

  const loadTasks = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const lcRes = await getLifecycles().catch(() => [] as LifecycleInfo[]);
      const lcList: LifecycleInfo[] = Array.isArray(lcRes) ? lcRes : [];
      if (lcList.length > 0) setLifecycles(lcList);

      // Show whatever the API returns — no filtering, no client-side trimming, no
      // defaulting to a hard-coded lifecycle ID. The schedule rows are the source of truth.
      // Always re-fetch the live project record so we pick up lifecycle changes made
      // elsewhere (chat picker, web app, etc.) — `project.rawFields` is the snapshot
      // from when the screen first mounted and goes stale after a chat re-assign.
      let liveRf: Record<string, any> = project.rawFields || {};
      try {
        const fresh = await getProjectDetails(ticketId);
        const freshData = (fresh as any)?.Data ?? fresh;
        if (freshData && typeof freshData === "object") {
          liveRf = { ...liveRf, ...freshData };
        }
      } catch {}
      const rf = liveRf;
      const scrumLc =
        rf.ProjectLifeCycleLookup ??
        rf.ScrumLifeCycle ??
        rf.scrumLifeCycle ??
        rf.ProjectLifecycleID ??
        rf.ProjectLifeCycleID ??
        rf.LifecycleID ??
        rf.LifeCycleID;
      const fieldHint = !!(scrumLc && String(scrumLc).trim() !== "" && String(scrumLc) !== "false" && String(scrumLc) !== "0");

      const taskRes = await getTaskData(ticketId, "0").catch(() => []);
      const raw = Array.isArray(taskRes) ? taskRes : (taskRes as any)?.Data ?? (taskRes as any)?.data ?? [];
      const hasTasks = Array.isArray(raw) && raw.length > 0;

      const lifecycleAssigned = fieldHint || hasTasks;
      setIsLcAssigned(lifecycleAssigned);

      const activeLcId = fieldHint ? String(scrumLc) : "";
      setSelectedLcId(activeLcId);
      if (activeLcId) setLifecycleId(activeLcId);

      if (!hasTasks) {
        setTasks([]);
        return;
      }

      // The /task-data proxy already returns rows in lifecycle-template order
      // (Pre-Schematic → Schematic Design → … → Closeout → Project Complete).
      // Don't re-sort by ItemOrder/StageStep — stale upstream rows can carry
      // ItemOrder=0 or StageStep=0 (e.g. an unsaved Closeout row), which would
      // bump them ahead of real phases. Trust the server order.
      console.log(
        `[SchedulePhases] ${ticketId} → ${raw.length} rows in server order:`,
        raw.map((r: any, i: number) => `${i + 1}. ${r.Title} [step=${r.StageStep ?? "?"} order=${r.ItemOrder ?? "?"}]`).join(" | "),
      );
      setTasks(raw as ScheduleTask[]);
    } catch (e: any) {
      setTasks([]);
      if (parentLcAssigned) setIsLcAssigned(true);
    } finally {
      setLoading(false);
    }
  }, [ticketId, module, project.rawFields, parentLcAssigned]);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => onScheduleChanged(() => { bustCache(); loadTasks(); }), [loadTasks]);

  // Auto-refresh phase names when Settings renames them — mirrors the web
  // visibilitychange + rmone:lifecyclesChanged pattern using mobile equivalents:
  //
  //   1. useFocusEffect — fires each time the screen regains focus after losing
  //      it (e.g. user navigates Settings → Back to this record). The initial
  //      focus on mount is skipped because the useEffect above already called
  //      loadTasks on mount.
  //   2. AppState "active" — fires when the app returns from the background
  //      (device home screen → app). Both paths run loadTasks silently so
  //      existing phase rows update in place with no spinner flash.
  const initialFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    if (initialFocusRef.current) { initialFocusRef.current = false; return; }
    void loadTasks(true);
  }, [loadTasks]));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadTasks(true);
    });
    return () => sub.remove();
  }, [loadTasks]);

  const formatDateOffset = (offset: number): string => {
    const d = new Date(Date.now() + offset * 86400000);
    return d.toISOString().slice(0, 10);
  };

  const handleAssignLifecycle = async () => {
    const activeLc = lifecycles.find(l => String(l.ID) === selectedLcId);
    if (!activeLc?.Stages?.length) {
      xAlert("No Lifecycle", "Please select a lifecycle first.");
      return;
    }

    if (isLcAssigned || parentLcAssigned) {
      xConfirm(
        "Schedule Already Exists",
        `This project already has a lifecycle assigned in RM ONE. Reassigning will OVERWRITE the existing schedule dates.\n\nAre you sure you want to replace the current schedule?`,
        () => doAssignLifecycle(activeLc),
        "Yes, Overwrite",
      );
      return;
    }

    xConfirm(
      "Assign Lifecycle",
      `You are about to assign "${activeLc.Name}" (${activeLc.Stages.length} phases) to ${ticketId}.\n\nThis action is permanent and cannot be changed later. Are you sure you want to proceed?`,
      () => doAssignLifecycle(activeLc),
      "Yes, Assign",
    );
  };

  const doAssignLifecycle = async (activeLc: LifecycleInfo) => {
    try {
      setAssigning(true);
      const stages = [...activeLc.Stages].sort((a, b) => a.StageStep - b.StageStep);
      let filtered = stages;
      if (module === "OPM") {
        filtered = stages.filter(s => s.Name !== "Project Complete");
      }

      const scheduleTasks: ScheduleTask[] = [];

      if (module === "OPM") {
        scheduleTasks.push({
          ID: 0, Title: "Proposal",
          StartDate: formatDateOffset(0), DueDate: formatDateOffset(14),
          Status: "Not Started", PercentComplete: 0, ItemOrder: 0,
          TicketId: ticketId, AssignedTo: "", isSelected: true, StageStep: 0,
        });
      }

      filtered.forEach((stage, i) => {
        const baseOffset = module === "OPM" ? 14 + i * 21 : i * 14;
        scheduleTasks.push({
          ID: -(i + 1),
          Title: module === "OPM"
            ? `Phase ${i + 1}${stage.Name.includes("Closeout") ? " - Closeout" : ""}`
            : stage.Name,
          StartDate: formatDateOffset(baseOffset),
          DueDate: formatDateOffset(baseOffset + (module === "OPM" ? 20 : 13)),
          Status: "Not Started", PercentComplete: 0,
          ItemOrder: module === "OPM" ? i + 1 : stage.StageStep,
          TicketId: ticketId, AssignedTo: "",
          isSelected: true,
          StageStep: module === "OPM" ? i + 1 : stage.StageStep,
        });
      });

      await createSchedule({
        TicketID: ticketId,
        ProjectLifecycleID: selectedLcId,
        ProjectScheduleExists: tasks.length > 0 || isLcAssigned || !!parentLcAssigned,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: scheduleTasks,
      });
      auditAction({ entityType: "project", entityId: ticketId });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      xAlert("Success", `${activeLc.Name} lifecycle assigned with ${scheduleTasks.length} phases.`);
      setShowChangeLc(false);
      setLifecycleId(selectedLcId);
      setIsLcAssigned(true);
      bustCache();
      notifyScheduleChanged(ticketId); // fires parent's onScheduleChanged listener → updates schedulePhases
      await loadTasks();
      onRefresh?.();
    } catch (e: any) {
      xAlert("Failed", e.message || "Could not assign lifecycle");
    } finally {
      setAssigning(false);
    }
  };

  const daysToWeeks = (days: number) => days > 0 ? Math.ceil(days / 7) : 0;
  const weeksToDays = (wks: number) => wks * 7;

  const startEdit = (idx: number) => {
    auditOpen({ screen: "project-detail" });
    const t = tasks[idx];
    setEditingIdx(idx);
    const s = t.StartDate ? t.StartDate.split("T")[0] : "";
    const e = t.DueDate ? t.DueDate.split("T")[0] : "";
    setEditStart(s);
    setEditEnd(e);
    const d = calcDays(s, e);
    setEditWeeks(String(daysToWeeks(d)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const cancelEdit = () => {
    auditClose({ screen: "project-detail" });
    setEditingIdx(null);
    setEditStart("");
    setEditEnd("");
    setEditWeeks("");
  };

  const addDaysStr = (d: string, n: number) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().slice(0, 10);
  };

  const handleEditStartChange = (newStart: string) => {
    setEditStart(newStart);
    if (/^\d{4}-\d{2}-\d{2}$/.test(newStart)) {
      const wks = parseInt(editWeeks) || 0;
      if (wks > 0) {
        setEditEnd(addDaysStr(newStart, weeksToDays(wks)));
      }
    }
  };

  const handleEditEndChange = (newEnd: string) => {
    setEditEnd(newEnd);
    if (/^\d{4}-\d{2}-\d{2}$/.test(newEnd) && /^\d{4}-\d{2}-\d{2}$/.test(editStart)) {
      const d = calcDays(editStart, newEnd);
      setEditWeeks(String(daysToWeeks(d)));
    }
  };

  const handleEditWeeksChange = (val: string) => {
    setEditWeeks(val);
    const wks = parseInt(val);
    if (!isNaN(wks) && wks > 0 && /^\d{4}-\d{2}-\d{2}$/.test(editStart)) {
      setEditEnd(addDaysStr(editStart, weeksToDays(wks)));
    }
  };

  const saveEdit = async () => {
    console.log("[saveEdit] click → editingIdx=", editingIdx, "editStart=", editStart, "editEnd=", editEnd, "editWeeks=", editWeeks, "lifecycleId=", lifecycleId);
    if (editingIdx === null || !lifecycleId) {
      console.log("[saveEdit] BAILED — editingIdx null or no lifecycleId");
      return;
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(editStart) || !dateRe.test(editEnd)) {
      xAlert("Invalid Date", "Dates must be in YYYY-MM-DD format");
      return;
    }
    if (new Date(editEnd) < new Date(editStart)) {
      xAlert("Invalid Range", "End date must be on or after start date");
      return;
    }

    // OPTION C — gap-preserving cascade.
    // The edited phase gets the user's exact dates. Every phase BELOW it
    // shifts by the same delta (newEnd - oldEnd of the edited phase), so any
    // existing gaps between phases are preserved. Phases ABOVE are untouched.
    const tgtOrigEnd = tasks[editingIdx]?.DueDate?.split("T")[0] ?? "";
    const shiftDays = tgtOrigEnd && editEnd
      ? Math.round((new Date(editEnd).getTime() - new Date(tgtOrigEnd).getTime()) / 86400000)
      : 0;
    const addDaysISO = (d: string, n: number) => {
      const dt = new Date(d);
      dt.setDate(dt.getDate() + n);
      return dt.toISOString().slice(0, 10);
    };

    const built: { ID: number; Title: string; StartDate: string; DueDate: string; Status: string; PercentComplete: number; ItemOrder: number; TicketId: string; AssignedTo: string; isSelected: boolean; StageStep: number }[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      // Skip rows without a real RM ONE ID — defensive guard so we don't
      // accidentally create duplicates by sending ID<=0.
      if (!(typeof t.ID === "number" && t.ID > 0)) continue;
      const origStart = t.StartDate?.split("T")[0] ?? "";
      const origEnd = t.DueDate?.split("T")[0] ?? "";

      let start: string;
      let end: string;
      if (i === editingIdx) {
        start = editStart;
        end = editEnd;
      } else if (i > editingIdx && origStart && origEnd && shiftDays !== 0) {
        start = addDaysISO(origStart, shiftDays);
        end = addDaysISO(origEnd, shiftDays);
      } else {
        start = origStart;
        end = origEnd;
      }

      built.push({
        ID: t.ID,
        Title: t.Title,
        StartDate: start,
        DueDate: end,
        Status: t.Status || "Not Started",
        PercentComplete: t.PercentComplete ?? 0,
        ItemOrder: t.ItemOrder,
        TicketId: ticketId,
        AssignedTo: t.AssignedTo || "",
        isSelected: true,
        StageStep: t.StageStep ?? t.ItemOrder,
      });
    }

    const cascadeCount = 0;
    const doCascadeSave = async () => {
      try {
        setSaving(true);
        // Re-read live lifecycle ID right before save (lifecycle may have changed via chat).
        let liveLcId = lifecycleId;
        try {
          const fresh = await getProjectDetails(ticketId);
          const fd: any = (fresh as any)?.Data ?? fresh;
          const live = fd?.ProjectLifeCycleLookup ?? fd?.ProjectLifecycleID ?? fd?.ProjectLifeCycleID ?? fd?.LifecycleID ?? fd?.LifeCycleID;
          if (live != null && String(live).trim() !== "" && String(live) !== "0" && String(live) !== "false") {
            liveLcId = String(live);
          }
        } catch {}
        await updateProjectSchedule({
          TicketID: ticketId,
          ProjectLifecycleID: liveLcId,
          ProjectScheduleExists: true,
          TargetStartDate: targetStart ? new Date(targetStart).toISOString().split(".")[0] : "0001-01-01T00:00:00",
          TargetCompletionDate: targetEnd ? new Date(targetEnd).toISOString().split(".")[0] : "0001-01-01T00:00:00",
          Tasks: built,
        });
        auditAction({ entityType: "project", entityId: ticketId });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        cancelEdit();
        bustCache();
        notifyScheduleChanged(ticketId); // fires parent's onScheduleChanged listener → updates schedulePhases
        await loadTasks();
        onRefresh?.();
      } catch (e: any) {
        xAlert("Save Failed", e.message || "Could not update schedule");
      } finally {
        setSaving(false);
      }
    };

    if (cascadeCount > 0) {
      xConfirm(
        "Cascade Dates",
        `This will shift ${cascadeCount} following phase${cascadeCount > 1 ? "s" : ""} to maintain continuity. Continue?`,
        () => { void doCascadeSave(); },
        "Save & Cascade",
        "Cancel",
      );
    } else {
      await doCascadeSave();
    }
  };

  const getStatusColor = (status: string) => {
    const s = (status || "").toLowerCase();
    if (s === "completed" || s === "complete") return "#6BA539";
    if (s === "in progress" || s === "active") return "#E87722";
    if (s === "not started") return Colors.textMuted;
    return Colors.textSecondary;
  };

  const getStatusIcon = (status: string): string => {
    const s = (status || "").toLowerCase();
    if (s === "completed" || s === "complete") return "check-circle";
    if (s === "in progress" || s === "active") return "play-circle";
    return "circle";
  };

  const fmtPhaseDate = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };

  const calcDays = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (isNaN(s) || isNaN(e)) return 0;
    return Math.max(0, Math.ceil((e - s) / (1000 * 60 * 60 * 24)));
  };

  if (loading) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 24 }}>
        <ActivityIndicator color={Colors.green} size="small" />
        <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 8 }}>Loading schedule...</Text>
      </View>
    );
  }

  const fmtD = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const daysBetween = (a: string, b: string): number => {
    if (!a || !b) return 0;
    const da = new Date(a).getTime(), db = new Date(b).getTime();
    if (isNaN(da) || isNaN(db)) return 0;
    return Math.max(0, Math.ceil((db - da) / 86400000));
  };
  const BORDER_COLOR = Colors.border;
  const cellBase = { paddingHorizontal: 8, paddingVertical: 10, borderRightWidth: 1, borderRightColor: BORDER_COLOR } as const;
  const cellLast = { paddingHorizontal: 8, paddingVertical: 10 } as const;
  const headerCellText = { fontFamily: "Inter_700Bold" as const, fontSize: 10, color: Colors.textMuted, textTransform: "uppercase" as const, letterSpacing: 0.8 };

  const tblHeader = (
    <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER_COLOR, backgroundColor: Colors.panel }}>
      <View style={[cellBase, { flex: 3 }]}><Text style={headerCellText}>Phase</Text></View>
      <View style={[cellBase, { flex: 2 }]}><Text style={headerCellText}>Start</Text></View>
      <View style={[cellBase, { flex: 2 }]}><Text style={headerCellText}>End</Text></View>
      <View style={[cellLast, { flex: 1 }]}><Text style={[headerCellText, { textAlign: "right" }]}>Wks</Text></View>
    </View>
  );

  const PHASE_COLORS = [Colors.green, ACCENT_BLUE, ACCENT_PURPLE, Colors.orange, ACCENT_TEAL, ACCENT_PINK, ACCENT_AMBER, "#F87171", "#818CF8", "#34D399", "#FB923C"];

  const rf = project.rawFields || {};
  const sv = (v: unknown): string => (v != null && String(v).trim() && String(v).trim() !== "0001-01-01T00:00:00" ? String(v).trim() : "");
  const targetStart = sv(project.targetStart) || sv(rf.TargetStartDate);
  const targetEnd = sv(project.targetEnd) || sv(rf.TargetCompletionDate);
  // Actual Start / Actual End must come from the schedule's first StartDate /
  // last DueDate. RM ONE's persisted ActualStartDate / ActualCompletionDate fields
  // can be auto-populated even when there's no lifecycle/tasks (e.g. when the
  // status is set to "Project Complete" manually) and the user has no way to
  // see or verify those values from the page. Without a real schedule we leave
  // them blank — the "behind target schedule" banner below depends on this so
  // it can't fire from invisible data.
  const hasScheduleRows = (tasks?.length ?? 0) > 0;
  let actualStart = "";
  let actualEnd = "";
  if (hasScheduleRows) {
    try {
      const dates = tasks
        .map(t => ({ s: sv((t as any).StartDate), d: sv((t as any).DueDate) }))
        .filter(x => x.s || x.d);
      if (dates.length) {
        const startMs = dates.map(x => x.s ? new Date(x.s).getTime() : Infinity).filter(n => isFinite(n));
        const endMs = dates.map(x => x.d ? new Date(x.d).getTime() : -Infinity).filter(n => isFinite(n));
        if (startMs.length) actualStart = new Date(Math.min(...startMs)).toISOString();
        if (endMs.length) actualEnd = new Date(Math.max(...endMs)).toISOString();
      }
    } catch {}
    // Fallback to API fields only when schedule rows somehow have no dates.
    if (!actualStart) actualStart = sv(project.actualStart) || sv(rf.ActualStartDate);
    if (!actualEnd) actualEnd = sv(project.actualEnd) || sv(rf.ActualCompletionDate);
  }
  const bidDate = sv(project.bidDate) || sv(rf.BidDueDate) || sv(rf.BidDate);
  const closeDate = sv(project.closeDate) || sv(rf.CloseDate);
  const currentStageStart = sv(rf.CurrentStageStartDate);
  const currentStage = sv(rf.ModuleStepLookup) || sv(rf.Status) || project.phase;
  const totalDays = daysBetween(targetStart, targetEnd);

  const startEditDates = () => {
    auditOpen({ screen: "project-detail" });
    setEditingDates(true);
    setDateTargetStart(targetStart ? new Date(targetStart).toISOString().slice(0, 10) : "");
    setDateTargetEnd(targetEnd ? new Date(targetEnd).toISOString().slice(0, 10) : "");
    setDateActualStart(actualStart ? new Date(actualStart).toISOString().slice(0, 10) : "");
    setDateActualEnd(actualEnd ? new Date(actualEnd).toISOString().slice(0, 10) : "");
    setDateBid(bidDate ? new Date(bidDate).toISOString().slice(0, 10) : "");
  };

  const cancelEditDates = () => {
    auditClose({ screen: "project-detail" });
    setEditingDates(false);
    setDateTargetStart("");
    setDateTargetEnd("");
    setDateActualStart("");
    setDateActualEnd("");
    setDateBid("");
  };

  const saveDates = async () => {
    if (dateTargetStart && dateTargetEnd && new Date(dateTargetEnd) < new Date(dateTargetStart)) {
      xAlert("Invalid Range", "Target End must be on or after Target Start");
      return;
    }
    if (dateActualStart && dateActualEnd && new Date(dateActualEnd) < new Date(dateActualStart)) {
      xAlert("Invalid Range", "Schedule End must be on or after Schedule Start");
      return;
    }
    try {
      setSavingDates(true);
      const currentTasks = tasks.map(t => ({
        ID: t.ID && t.ID > 0 ? t.ID : -1,
        Title: t.Title,
        StartDate: t.StartDate?.split("T")[0] ?? "",
        DueDate: t.DueDate?.split("T")[0] ?? "",
        Status: t.Status || "Not Started",
        PercentComplete: t.PercentComplete ?? 0,
        ItemOrder: t.ItemOrder,
        TicketId: ticketId,
        AssignedTo: t.AssignedTo || "",
        isSelected: true,
        StageStep: t.StageStep ?? t.ItemOrder,
      }));

      // Re-read the live lifecycle ID right before saving — protects against the
      // user reassigning the lifecycle (e.g. from chat) while this screen was open.
      let liveLcId = lifecycleId || selectedLcId;
      try {
        const fresh = await getProjectDetails(ticketId);
        const fd: any = (fresh as any)?.Data ?? fresh;
        const live = fd?.ProjectLifeCycleLookup ?? fd?.ProjectLifecycleID ?? fd?.ProjectLifeCycleID ?? fd?.LifecycleID ?? fd?.LifeCycleID;
        if (live != null && String(live).trim() !== "" && String(live) !== "0" && String(live) !== "false") {
          liveLcId = String(live);
        }
      } catch {}

      await updateProjectSchedule({
        TicketID: ticketId,
        ProjectLifecycleID: liveLcId,
        ProjectScheduleExists: tasks.length > 0,
        TargetStartDate: dateTargetStart ? `${dateTargetStart}T00:00:00` : "0001-01-01T00:00:00",
        TargetCompletionDate: dateTargetEnd ? `${dateTargetEnd}T00:00:00` : "0001-01-01T00:00:00",
        // Actual Start / Actual Completion are READ-ONLY in the UI — preserve
        // the current server values as-is so this save never overwrites them.
        ActualStartDate: actualStart ? (actualStart.includes("T") ? actualStart : `${actualStart.slice(0, 10)}T00:00:00`) : "0001-01-01T00:00:00",
        ActualCompletionDate: actualEnd ? (actualEnd.includes("T") ? actualEnd : `${actualEnd.slice(0, 10)}T00:00:00`) : "0001-01-01T00:00:00",
        BidDueDate: dateBid ? `${dateBid}T00:00:00` : "0001-01-01T00:00:00",
        Tasks: currentTasks,
      });
      auditAction({ entityType: "project", entityId: ticketId });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      cancelEditDates();
      bustCache();
      notifyScheduleChanged(ticketId); // fires parent's onScheduleChanged listener → updates schedulePhases
      await loadTasks();
      onRefresh?.();
    } catch (e: any) {
      xAlert("Save Failed", e.message || "Could not update dates");
    } finally {
      setSavingDates(false);
    }
  };

  // When a schedule has actually been built (lifecycle assigned AND phase
  // dates exist) the Actual Start / Actual End reflect the true range and
  // Target becomes redundant. In that case show ONLY Actual (read-only) and
  // hide the edit pencil — to change the dates, the user edits the phase
  // rows below the card.
  const scheduleBuilt = isLcAssigned && !!(actualStart || actualEnd);
  const DateSummaryCard = () => (
    <View style={{ backgroundColor: Colors.panelSoft, borderRadius: 10, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: editingDates ? 1 : 0.5, borderColor: editingDates ? "rgba(107,165,57,0.3)" : Colors.panelStrong }}>
      {scheduleBuilt ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Schedule Start</Text>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.orange, marginTop: 2 }}>{fmtD(actualStart) || "—"}</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Duration</Text>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green, marginTop: 2 }}>{totalDays > 0 ? `${daysToWeeks(totalDays)} wks` : "—"}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Schedule End</Text>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.orange, marginTop: 2 }}>{fmtD(actualEnd) || "—"}</Text>
          </View>
          <Feather name="lock" size={12} color={Colors.textMuted} style={{ marginLeft: 4, alignSelf: "center" }} />
        </View>
      ) : !editingDates ? (
        <>
          <Pressable onPress={canEdit ? startEditDates : undefined} disabled={!canEdit} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: bidDate ? 6 : 0 }}>
            <View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Target Start</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText, marginTop: 2 }}>{fmtD(targetStart)}</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Duration</Text>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green, marginTop: 2 }}>{totalDays > 0 ? `${daysToWeeks(totalDays)} wks` : "—"}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Target End</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText, marginTop: 2 }}>{fmtD(targetEnd)}</Text>
            </View>
            <Feather name="edit-2" size={12} color={Colors.textMuted} style={{ marginLeft: 4, alignSelf: "center" }} />
          </Pressable>
          {bidDate && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: Colors.panel }}>
              <View><Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>Bid Due</Text><Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: ACCENT_BLUE, marginTop: 1 }}>{fmtD(bidDate)}</Text></View>
            </View>
          )}
        </>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.cardText }}>Edit Project Dates</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <DateInput label="Target Start" value={dateTargetStart} onChange={setDateTargetStart} />
            <DateInput label="Target End" value={dateTargetEnd} onChange={setDateTargetEnd} />
          </View>
          {/* Actual Start / Actual End are READ-ONLY — they reflect the
              schedule's first phase start / last phase end and must not be
              edited directly here. Show as locked summary rows so the user
              still sees the values but cannot modify them. Only show when
              a lifecycle is assigned (without a schedule there's nothing
              to derive Actual from). */}
          {isLcAssigned && (actualStart || actualEnd) && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              {actualStart ? (
                <View style={{ flex: 1, backgroundColor: Colors.panelSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>Schedule Start</Text>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.orange, marginTop: 2 }}>{fmtD(actualStart)}</Text>
                  </View>
                  <Feather name="lock" size={11} color={Colors.textMuted} />
                </View>
              ) : <View style={{ flex: 1 }} />}
              {actualEnd ? (
                <View style={{ flex: 1, backgroundColor: Colors.panelSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>Schedule End</Text>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.orange, marginTop: 2 }}>{fmtD(actualEnd)}</Text>
                  </View>
                  <Feather name="lock" size={11} color={Colors.textMuted} />
                </View>
              ) : <View style={{ flex: 1 }} />}
            </View>
          )}
          {module === "OPM" && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <DateInput label="Bid Due Date" value={dateBid} onChange={setDateBid} />
              <View style={{ flex: 1 }} />
            </View>
          )}
          {dateTargetStart && dateTargetEnd && (
            <Text style={{ fontFamily: "Inter_500Medium", color: Colors.textMuted, fontSize: 11 }}>
              Target Duration: {daysToWeeks(daysBetween(dateTargetStart, dateTargetEnd))} weeks
            </Text>
          )}
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
            <Pressable onPress={cancelEditDates} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.panel }}>
              <Text style={{ fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, fontSize: 12 }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={saveDates}
              disabled={savingDates}
              style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: savingDates ? "rgba(107,165,57,0.3)" : Colors.green }}
            >
              {savingDates ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontFamily: "Inter_700Bold", color: Colors.cardText, fontSize: 12 }}>Save Dates</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );

  if (tasks.length === 0) {
    const activeLc = lifecycles.find(l => String(l.ID) === selectedLcId);
    const lcStages = activeLc ? [...activeLc.Stages].sort((a, b) => a.StageStep - b.StageStep) : [];

    return (
      <View style={{ marginTop: 4 }}>
        <DateSummaryCard />

        {(module === "PMM" || module === "OPM") && canEdit && (
          <Pressable
            onPress={() => { auditOpen({ screen: "project-detail" }); setShowManageLc(true); }}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.borderStrong, marginBottom: 10 }}
          >
            <Feather name="plus" size={14} color={Colors.textSoft} />
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSoft }}>
              {lifecycles.length > 0 ? "Manage lifecycles" : "Create a lifecycle"}
            </Text>
          </Pressable>
        )}
        <ManageLifecyclesModal visible={showManageLc} lifecycles={lifecycles} canEdit={canEdit} module={module} onClose={() => { auditClose({ screen: "project-detail" }); setShowManageLc(false); }} onSaved={reloadLifecycles} />

        {(module === "PMM" || module === "OPM") && lifecycles.length > 0 && isLcAssigned && canEdit && (() => {
          const activeLc = lifecycles.find(l => String(l.ID) === selectedLcId);
          return (
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(107,165,57,0.08)", borderWidth: 0.5, borderColor: "rgba(107,165,57,0.25)", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }}>
                <Feather name="check-circle" size={14} color={Colors.green} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText }}>Lifecycle: </Text>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.green }}>{activeLc ? `${activeLc.Name} (${activeLc.Stages?.length ?? 0} phases)` : "Assigned"}</Text>
              </View>
              {/* Lifecycle picked but no phase tasks generated yet — offer a
                  one-tap action to build the schedule. The user can also pick a
                  different lifecycle from the dropdown before building. */}
              <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(245,158,11,0.08)", borderWidth: 0.5, borderColor: "rgba(245,158,11,0.25)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}>
                <Feather name="alert-circle" size={13} color="#F59E0B" />
                <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSoft, flex: 1 }}>
                  No phase dates yet. Pick a lifecycle and build the schedule.
                </Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <LifecycleDropdown lifecycles={lifecycles} selectedId={selectedLcId} onSelect={setSelectedLcId} />
              </View>
              <Pressable
                onPress={handleAssignLifecycle}
                disabled={assigning || !selectedLcId}
                style={{
                  marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                  backgroundColor: assigning ? "rgba(107,165,57,0.1)" : Colors.green,
                  paddingVertical: 12, borderRadius: 10,
                  opacity: (!selectedLcId || assigning) ? 0.5 : 1,
                }}
              >
                {assigning ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Feather name="calendar" size={16} color={Colors.white} />
                )}
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText }}>
                  {assigning ? "Building…" : "Build Schedule from Lifecycle"}
                </Text>
              </Pressable>
            </View>
          );
        })()}

        {(module === "PMM" || module === "OPM") && lifecycles.length > 0 && !isLcAssigned && canEdit && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.cardText, marginBottom: 8 }}>Assign Lifecycle</Text>
            <LifecycleDropdown lifecycles={lifecycles} selectedId={selectedLcId} onSelect={setSelectedLcId} />
            <Pressable
              onPress={handleAssignLifecycle}
              disabled={assigning || !selectedLcId}
              style={{
                marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                backgroundColor: assigning ? "rgba(107,165,57,0.1)" : Colors.green,
                paddingVertical: 12, borderRadius: 10,
                opacity: (!selectedLcId || assigning) ? 0.5 : 1,
              }}
            >
              {assigning ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Feather name="check-circle" size={16} color={Colors.white} />
              )}
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText }}>
                {assigning ? "Assigning..." : `Assign ${activeLc?.Name ?? "Lifecycle"}`}
              </Text>
            </Pressable>
          </View>
        )}

        {/* "Behind target schedule" banner — only shows for OPEN projects.
            Closed projects never get a lateness verdict (target dates aren't
            re-baselined when projects slip in reality, so comparing schedule's
            actual end against the original target is misleading). */}
        {!/complete|closed|finish|cancel|archive|withdrawn|done|closeout/i.test(project.status || "") &&
          targetEnd && actualEnd && new Date(actualEnd).getTime() > new Date(targetEnd).getTime() && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, backgroundColor: "rgba(248,113,113,0.1)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 0.5, borderColor: "rgba(248,113,113,0.2)" }}>
            <Feather name="alert-triangle" size={13} color="#F87171" />
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#F87171" }}>
              {durationLabel(durationMonths(targetEnd, actualEnd))} behind target schedule
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ marginTop: 4 }}>
      <DateSummaryCard />
      {(module === "PMM" || module === "OPM") && canEdit && (
        <Pressable
          onPress={() => { auditOpen({ screen: "project-detail" }); setShowManageLc(true); }}
          style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: Colors.borderStrong, marginBottom: 10 }}
        >
          <Feather name="plus" size={14} color={Colors.textSoft} />
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSoft }}>Manage lifecycles</Text>
        </Pressable>
      )}
      <ManageLifecyclesModal visible={showManageLc} lifecycles={lifecycles} canEdit={canEdit} module={module} onClose={() => { auditClose({ screen: "project-detail" }); setShowManageLc(false); }} onSaved={reloadLifecycles} />
      <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: BORDER_COLOR }}>
        {tblHeader}
        {tasks.map((task, idx: number) => {
          const isEditing = editingIdx === idx;
          const days = calcDays(task.StartDate, task.DueDate);
          const color = PHASE_COLORS[idx % PHASE_COLORS.length];
          // "Project Complete" is a milestone, not an editable phase — its
          // dates are derived (closeout end + 1 day, 0 weeks).
          const isProjectComplete = String(task.Title ?? "").trim().toLowerCase().includes("complete");

          return (
            <View key={task.ID ?? idx}>
              <Pressable
                onPress={() => { if (isProjectComplete || !canEdit) return; isEditing ? cancelEdit() : startEdit(idx); }}
                disabled={isProjectComplete || !canEdit}
                style={{
                  flexDirection: "row", alignItems: "center",
                  borderBottomWidth: (idx < tasks.length - 1 || isEditing) ? 1 : 0,
                  borderBottomColor: BORDER_COLOR,
                  backgroundColor: isEditing ? "rgba(107,165,57,0.08)" : (idx % 2 === 0 ? "transparent" : Colors.panelSoft),
                  opacity: isProjectComplete ? 0.85 : 1,
                }}
              >
                <View style={[cellBase, { flex: 3, flexDirection: "row", alignItems: "center", gap: 6 }]}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color + "20", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color }}>{idx + 1}</Text>
                  </View>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.cardText, flexShrink: 1 }} numberOfLines={1}>{task.Title}</Text>
                </View>
                <View style={[cellBase, { flex: 2, justifyContent: "center" }]}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSoft }}>{fmtD(task.StartDate)}</Text>
                </View>
                <View style={[cellBase, { flex: 2, justifyContent: "center" }]}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSoft }}>{fmtD(task.DueDate)}</Text>
                </View>
                <View style={[cellLast, { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }]}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color }}>{days > 0 ? daysToWeeks(days) : "0"}</Text>
                  {!isProjectComplete && canEdit && (
                    <Feather name={isEditing ? "chevron-up" : "edit-2"} size={10} color={Colors.textMuted} />
                  )}
                </View>
              </Pressable>

              {isEditing && (
                <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 12, backgroundColor: "rgba(107,165,57,0.04)", borderBottomWidth: idx < tasks.length - 1 ? 1 : 0, borderBottomColor: BORDER_COLOR }}>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <DateInput label="Start Date" value={editStart} onChange={handleEditStartChange} />
                    <DateInput label="End Date" value={editEnd} onChange={handleEditEndChange} />
                  </View>
                  <View style={{ flexDirection: "column", gap: 14 }}>
                    <View style={{ flexDirection: "column", gap: 6 }}>
                      <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 }}>LENGTH (WEEKS)</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Pressable
                          onPress={() => { const w = Math.max(1, (parseInt(editWeeks) || 1) - 1); handleEditWeeksChange(String(w)); }}
                          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.panelStrong, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                        >
                          <Feather name="minus" size={20} color={Colors.textPrimary} />
                        </Pressable>
                        <AppTextInput
                          value={editWeeks}
                          onChangeText={handleEditWeeksChange}
                          keyboardType="number-pad"
                          placeholderTextColor={Colors.textMuted}
                          style={{ flex: 1, minWidth: 0, backgroundColor: Colors.panel, borderRadius: 10, color: Colors.cardText, paddingVertical: 10, fontSize: 18, fontWeight: "700", borderWidth: 0.5, borderColor: Colors.panelStrong, textAlign: "center" }}
                        />
                        <Pressable
                          onPress={() => { const w = (parseInt(editWeeks) || 0) + 1; handleEditWeeksChange(String(w)); }}
                          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.panelStrong, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                        >
                          <Feather name="plus" size={20} color={Colors.textPrimary} />
                        </Pressable>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
                      <Pressable onPress={cancelEdit} style={{ flex: 1, paddingVertical: 15, borderRadius: 12, backgroundColor: Colors.panelStrong, alignItems: "center" }}>
                        <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: "600" }}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={saveEdit}
                        disabled={saving || !editStart || !editEnd}
                        style={{ flex: 1, paddingVertical: 15, borderRadius: 12, backgroundColor: saving ? "rgba(107,165,57,0.3)" : Colors.green, opacity: (!editStart || !editEnd) ? 0.4 : 1, alignItems: "center" }}
                      >
                        {saving ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={{ color: Colors.cardText, fontSize: 16, fontWeight: "700" }}>Save</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {(module === "PMM" || module === "OPM") && lifecycles.length > 0 && tasks.length === 0 && !isLcAssigned && canEdit && (
        <View style={{ marginTop: 10 }}>
          {!showChangeLc ? (
            <Pressable
              onPress={() => { auditOpen({ screen: "project-detail" }); setShowChangeLc(true); }}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: "rgba(107,165,57,0.15)", borderWidth: 0.5, borderColor: "rgba(107,165,57,0.3)" }}
            >
              <Feather name="plus-circle" size={13} color={Colors.green} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.green }}>Assign Lifecycle</Text>
            </Pressable>
          ) : (
            <View style={{ backgroundColor: Colors.panelSoft, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "rgba(107,165,57,0.2)", gap: 10 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.green }}>Assign Lifecycle</Text>
              <LifecycleDropdown lifecycles={lifecycles} selectedId={selectedLcId} onSelect={setSelectedLcId} />
              <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                <Pressable onPress={() => { auditClose({ screen: "project-detail" }); setShowChangeLc(false); }} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.panel }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", color: Colors.textSecondary, fontSize: 12 }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleAssignLifecycle}
                  disabled={assigning || !selectedLcId}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: assigning ? "rgba(107,165,57,0.3)" : Colors.green, opacity: (!selectedLcId || assigning) ? 0.5 : 1 }}
                >
                  {assigning ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Feather name="check-circle" size={13} color="#fff" />
                  )}
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.cardText }}>
                    {assigning ? "Assigning..." : "Assign Schedule"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

interface BillingResource {
  name: string;
  role: string;
  bu: string;
  billingRate: number;
  costRate: number;
  hours: number;
  billingTotal: number;
  costTotal: number;
}

interface DivisionBudget {
  divisionName: string;
  type: string;
  contractValue: number;
  pmName: string;
  blName: string;
  preconLead: string;
}

function BusinessUnitsSection({ ticketId }: { ticketId: string }) {
  const [divisions, setDivisions] = useState<DivisionBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setDivisions([]);
    (async () => {
      try {
        const raw = await getProjectDivisionRoles(ticketId);
        const items = Array.isArray(raw) ? raw : raw?.Data ?? raw?.data ?? [];
        if (!cancelled && Array.isArray(items)) {
          const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const clean = (v: any) => {
            const s = String(v ?? "").trim();
            if (!s || GUID_RE.test(s)) return "";
            return s;
          };
          setDivisions(items.map((d: any) => ({
            divisionName: clean(d.DivisionShortName) || clean(d.DivisionName) || "—",
            type: clean(d.Type) || (d.IsPrimary ? "Primary" : "Supporting"),
            contractValue: Number(d.ContractValue || 0),
            pmName: clean(d.ProjectManagerUser) || clean(d.ProjectManager) || "",
            blName: clean(d.BusinessLeadUser) || clean(d.BusinessLead) || "",
            preconLead: clean(d.PreconLeadUser) || clean(d.PreconLead) || "",
          })));
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId]);

  if (loading) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 20 }}>
        <ActivityIndicator color={Colors.green} size="small" />
      </View>
    );
  }

  if (error && divisions.length === 0) {
    return (
      <Text style={{ color: "rgba(248,113,113,0.7)", fontSize: 12, textAlign: "center", paddingVertical: 16 }}>
        {error}
      </Text>
    );
  }

  if (divisions.length === 0) {
    return (
      <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, textAlign: "center", paddingVertical: 16 }}>
        No business units assigned
      </Text>
    );
  }

  return (
    <View>
      {divisions.map((d, i) => (
        <View key={i} style={{
          backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 14, marginBottom: 8,
          borderLeftWidth: 3, borderLeftColor: d.type === "Primary" ? Colors.green : Colors.orange,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: Colors.cardText, fontSize: 15, fontWeight: "700" }}>{d.divisionName}</Text>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
                backgroundColor: d.type === "Primary" ? "rgba(107,165,57,0.15)" : "rgba(232,119,34,0.15)",
              }}>
                <Text style={{ color: d.type === "Primary" ? Colors.green : Colors.orange, fontSize: 10, fontWeight: "700" }}>
                  {d.type || "Supporting"}
                </Text>
              </View>
            </View>
            {d.contractValue > 0 && (
              <Text style={{ color: Colors.green, fontSize: 14, fontWeight: "700" }}>
                ${d.contractValue >= 1_000_000 ? `${(d.contractValue / 1_000_000).toFixed(2)}M` : d.contractValue >= 1_000 ? `${(d.contractValue / 1_000).toFixed(1)}K` : d.contractValue.toFixed(0)}
              </Text>
            )}
          </View>
          <View style={{ gap: 6 }}>
            {d.blName ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(232,119,34,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Feather name="user" size={12} color={Colors.orange} />
                </View>
                <View>
                  <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: "600" }}>BUSINESS LEAD</Text>
                  <Text style={{ color: Colors.cardText, fontSize: 12, fontWeight: "600" }}>{d.blName}</Text>
                </View>
              </View>
            ) : null}
            {d.pmName ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(107,165,57,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Feather name="briefcase" size={12} color={Colors.green} />
                </View>
                <View>
                  <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: "600" }}>PROJECT MGMT LEAD</Text>
                  <Text style={{ color: Colors.cardText, fontSize: 12, fontWeight: "600" }}>{d.pmName}</Text>
                </View>
              </View>
            ) : null}
            {d.preconLead ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(56,189,248,0.15)", alignItems: "center", justifyContent: "center" }}>
                  <Feather name="compass" size={12} color={ACCENT_BLUE} />
                </View>
                <View>
                  <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: "600" }}>PRECON LEAD</Text>
                  <Text style={{ color: Colors.cardText, fontSize: 12, fontWeight: "600" }}>{d.preconLead}</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {error ? <Text style={{ color: "rgba(248,113,113,0.7)", fontSize: 11, textAlign: "center", marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

function BudgetSection({ ticketId, contractValue, allocations }: { ticketId: string; contractValue: number; allocations: Allocation[] }) {
  const [billingData, setBillingData] = useState<BillingResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [showAllResources, setShowAllResources] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const [ratesRes] = await Promise.allSettled([
          getBillingRates(ticketId),
        ]);

        if (!cancelled && ratesRes.status === "fulfilled") {
          const raw = ratesRes.value;
          const items = Array.isArray(raw) ? raw : raw?.Data ?? raw?.data ?? [];
          if (Array.isArray(items)) {
            const resources: BillingResource[] = items.map((r: any) => {
              const billingRate = Number(r.BillingRate || r.Rate || 0);
              const costRate = Number(r.CostRate || r.Cost || 0);
              const hours = Number(r.TotalHours || r.Hours || r.TotalHrs || 0);
              const billingAmt = Number(r.BillingAmount || r.TotalBilling || 0);
              const costAmt = Number(r.CostAmount || r.TotalCost || 0);
              return {
                name: r.AssignedToName || r.ResourceName || r.Name || "—",
                role: r.TypeName || r.RoleName || r.SubWorkItem || "",
                bu: r.DivisionName || r.Division || "",
                billingRate,
                costRate,
                hours,
                billingTotal: billingAmt > 0 ? billingAmt : billingRate * hours,
                costTotal: costAmt > 0 ? costAmt : costRate * hours,
              };
            });
            setBillingData(resources);
          }
        }

        if (!cancelled && ratesRes.status === "rejected") {
          setError("Could not load billing rates");
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load budget data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticketId]);

  const totalEacHrs = allocations.reduce((s, a) => s + (a.eacHrs || 0), 0);
  const totalEtcHrs = allocations.reduce((s, a) => s + (a.etcHrs || 0), 0);
  const totalEacCost = allocations.reduce((s, a) => s + (a.eacCost || 0), 0);
  const totalEtcCost = allocations.reduce((s, a) => s + (a.etcCost || 0), 0);
  const totalBillingFromRates = billingData.reduce((s, r) => s + r.billingTotal, 0);
  const totalCostFromRates = billingData.reduce((s, r) => s + r.costTotal, 0);
  const displayContract = contractValue;
  const margin = totalBillingFromRates > 0 && totalCostFromRates > 0
    ? ((totalBillingFromRates - totalCostFromRates) / totalBillingFromRates * 100)
    : 0;

  const fmtCurrency = (v: number) => {
    if (v === 0) return "$0";
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  };

  const fmtHrs = (v: number) => {
    if (v === 0) return "0h";
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K h`;
    return `${v.toFixed(0)}h`;
  };

  if (loading) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 24 }}>
        <ActivityIndicator color={Colors.green} size="small" />
        <Text style={{ color: Colors.cardMuted, fontSize: 12, marginTop: 8 }}>Loading budget...</Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <View style={{ flex: 1, minWidth: 100, backgroundColor: "rgba(107,165,57,0.1)", borderRadius: 12, padding: 12 }}>
          <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>CONTRACT VALUE</Text>
          <Text style={{ color: Colors.green, fontSize: 18, fontWeight: "800", marginTop: 4 }}>
            {displayContract > 0 ? fmtCurrency(displayContract) : "—"}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 100, backgroundColor: "rgba(251,146,60,0.1)", borderRadius: 12, padding: 12 }}>
          <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>TOTAL COST (ETC)</Text>
          <Text style={{ color: COL_ACCENT.etcCost, fontSize: 18, fontWeight: "800", marginTop: 4 }}>
            {totalEacCost > 0 ? fmtCurrency(totalEacCost) : totalCostFromRates > 0 ? fmtCurrency(totalCostFromRates) : "—"}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <View style={{ flex: 1, minWidth: 100, backgroundColor: "rgba(52,211,153,0.1)", borderRadius: 12, padding: 12 }}>
          <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>EAC HOURS</Text>
          <Text style={{ color: COL_ACCENT.eacHrs, fontSize: 16, fontWeight: "800", marginTop: 4 }}>{totalEacHrs > 0 ? fmtHrs(totalEacHrs) : "—"}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 100, backgroundColor: "rgba(129,140,248,0.1)", borderRadius: 12, padding: 12 }}>
          <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>ETC HOURS</Text>
          <Text style={{ color: COL_ACCENT.etcHrs, fontSize: 16, fontWeight: "800", marginTop: 4 }}>{totalEtcHrs > 0 ? fmtHrs(totalEtcHrs) : "—"}</Text>
        </View>
        {margin > 0 && (
          <View style={{ flex: 1, minWidth: 100, backgroundColor: "rgba(45,212,191,0.1)", borderRadius: 12, padding: 12 }}>
            <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>MARGIN</Text>
            <Text style={{ color: ACCENT_TEAL, fontSize: 16, fontWeight: "800", marginTop: 4 }}>{margin.toFixed(1)}%</Text>
          </View>
        )}
      </View>

      {displayContract > 0 && totalEacCost > 0 && (
        <View style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>BUDGET UTILIZATION</Text>
            <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700" }}>
              {((totalEacCost / displayContract) * 100).toFixed(0)}%
            </Text>
          </View>
          <View style={{ height: 8, backgroundColor: "rgba(15,25,35,0.06)", borderRadius: 4 }}>
            <View style={{
              height: 8,
              width: `${Math.min(100, (totalEacCost / displayContract) * 100)}%` as any,
              backgroundColor: (totalEacCost / displayContract) > 0.9 ? "#F87171" : (totalEacCost / displayContract) > 0.7 ? Colors.orange : Colors.green,
              borderRadius: 4,
            }} />
          </View>
        </View>
      )}

      {billingData.length > 0 && (
        <View>
          <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700", marginBottom: 8 }}>RESOURCE BILLING RATES</Text>
          {(showAllResources ? billingData : billingData.slice(0, 5)).map((r, i) => (
            <View key={i} style={{
              flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12,
              backgroundColor: "rgba(15,25,35,0.04)", borderRadius: 10, marginBottom: 4,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.cardText, fontSize: 15, fontWeight: "600" }}>{r.name}</Text>
                <Text style={{ color: Colors.cardMuted, fontSize: 12 }}>{r.role}{r.bu ? ` • ${r.bu}` : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {r.billingRate > 0 && <Text style={{ color: Colors.green, fontSize: 14, fontWeight: "700" }}>${fmtNumber(r.billingRate)}/hr</Text>}
                {r.costRate > 0 && <Text style={{ color: Colors.cardMuted, fontSize: 12 }}>Cost: ${fmtNumber(r.costRate)}/hr</Text>}
              </View>
            </View>
          ))}
          {billingData.length > 5 && (
            <Pressable
              onPress={() => setShowAllResources(!showAllResources)}
              style={{ alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 }}
            >
              <Text style={{ color: Colors.green, fontSize: 12, fontWeight: "600" }}>
                {showAllResources ? "Show Less" : `Show All ${billingData.length} Resources`}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {allocations.length > 0 && billingData.length === 0 && (
        <View>
          <Text style={{ color: Colors.cardMuted, fontSize: 11, fontWeight: "700", marginBottom: 8 }}>TEAM COST BREAKDOWN</Text>
          {(showAllResources ? allocations : allocations.slice(0, 5))
            .filter(a => a.eacCost > 0 || a.eacHrs > 0)
            .map((a, i) => (
              <View key={i} style={{
                flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12,
                backgroundColor: "rgba(15,25,35,0.04)", borderRadius: 10, marginBottom: 4,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colors.cardText, fontSize: 15, fontWeight: "600" }}>{a.name}</Text>
                  <Text style={{ color: Colors.cardMuted, fontSize: 12 }}>{a.role}{a.bu ? ` • ${a.bu}` : ""}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {a.eacCost > 0 && <Text style={{ color: COL_ACCENT.eacCost, fontSize: 14, fontWeight: "700" }}>{fmtCurrency(a.eacCost)}</Text>}
                  {a.eacHrs > 0 && <Text style={{ color: Colors.cardMuted, fontSize: 12 }}>{fmtHours(a.eacHrs)}h</Text>}
                </View>
              </View>
            ))}
          {allocations.filter(a => a.eacCost > 0 || a.eacHrs > 0).length > 5 && (
            <Pressable
              onPress={() => setShowAllResources(!showAllResources)}
              style={{ alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 }}
            >
              <Text style={{ color: Colors.green, fontSize: 12, fontWeight: "600" }}>
                {showAllResources ? "Show Less" : `Show All`}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {error && (
        <Text style={{ color: "rgba(248,113,113,0.7)", fontSize: 11, textAlign: "center", marginTop: 8 }}>{error}</Text>
      )}

      {!loading && billingData.length === 0 && allocations.filter(a => a.eacCost > 0 || a.eacHrs > 0).length === 0 && totalEacCost === 0 && !error && (
        <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, textAlign: "center", paddingVertical: 16 }}>
          No budget data available for this project
        </Text>
      )}
    </View>
  );
}

function HeroBg(_props: { accent?: string }) {
  // Plain black & white hero — no colored gradient or glow.
  return null;
}

function RecordReadOnlyBanner({ reason }: { reason?: string | null }) {
  return (
    <View style={st.recordReadOnlyBanner} accessibilityRole="alert">
      <View style={st.recordReadOnlyIcon}>
        <Feather name="lock" size={14} color="#F59E0B" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.recordReadOnlyTitle}>View only</Text>
        <Text style={st.recordReadOnlyText}>
          {reason || "You can view this record, but you cannot edit it at its current stage."}
        </Text>
      </View>
    </View>
  );
}

function SkeletonStatCard({ iconColor, delay = 0 }: { iconColor: string; delay?: number }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 900, delay, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={{ flex: 1, opacity: pulse }}>
      <View style={st.statCard}>
        <LG
          colors={[iconColor + "22", "transparent"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[st.statIconWrap, { backgroundColor: iconColor + "22", borderColor: iconColor + "55" }]}>
          <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: iconColor + "44" }} />
        </View>
        <View style={{ width: 40, height: 22, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.08)", marginBottom: 6 }} />
        <View style={{ width: 50, height: 12, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.05)" }} />
      </View>
    </Animated.View>
  );
}

function StatCard({ icon, iconColor, label, value, sub }: { icon: string; iconColor: string; label: string; value: string; sub?: string }) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const float = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(value);

  // Parse leading number for count-up animation; preserve prefix/suffix (e.g. "$2.5M", "80%")
  const parsed = useMemo(() => {
    const m = value.match(/^(\D*)(-?[\d,.]+)(.*)$/);
    if (!m) return null;
    const num = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(num)) return null;
    return { prefix: m[1], num, suffix: m[3] };
  }, [value]);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ])
    ).start();
    if (!parsed) { setDisplayValue(value); return; }
    const counter = new Animated.Value(0);
    const id = counter.addListener(({ value: v }) => {
      const cur = parsed.num * v;
      const formatted = Math.abs(parsed.num) >= 10 || parsed.num % 1 === 0
        ? Math.round(cur).toLocaleString()
        : cur.toFixed(1);
      setDisplayValue(`${parsed.prefix}${formatted}${parsed.suffix}`);
    });
    Animated.timing(counter, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => counter.removeListener(id);
  }, [value]);

  const onPressIn = () => Animated.spring(press, { toValue: 0.96, friction: 7, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(press, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();

  const iconTranslate = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ scale: Animated.multiply(scale, press) }] }}>
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut} style={st.statCard}>
        <LG
          colors={[iconColor + "22", "transparent"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LG
          colors={["rgba(255,255,255,0.06)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.6 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
        />
        <View style={[st.statIconGlow, { backgroundColor: iconColor, shadowColor: iconColor }]} />
        <Animated.View style={{ transform: [{ translateY: iconTranslate }] }}>
          <View style={[st.statIconWrap, { backgroundColor: iconColor + "22", borderColor: iconColor + "55" }]}>
            <Feather name={icon as any} size={18} color={iconColor} />
          </View>
        </Animated.View>
        <Text style={st.statValue}>{displayValue}</Text>
        <Text style={st.statLabel}>{label}</Text>
        <Text style={st.statSub}>{sub || " "}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuth();
  useScreenBeacon("ProjectDetail", id ?? "");
  // Record permissions are server-evaluated from the current stage and the
  // signed-in user. Keep this screen fail-closed until that verdict arrives;
  // mobile must not recreate the stage/group rules locally.
  const [recordPermissions, setRecordPermissions] = useState<RecordPermissions | null>(null);
  const recordCanEditData = recordPermissions?.degraded !== true && recordPermissions?.canEditData === true;
  const recordCanAdvanceStages = recordPermissions?.degraded !== true && recordPermissions?.canAdvanceStage === true;
  const recordCanEditFinancials = recordPermissions?.degraded !== true && recordPermissions?.canEditFinancials === true;
  const canEditData = recordCanEditData;
  const canAdvanceStages = canEditData && recordCanAdvanceStages;
  const canEditFinancials = recordCanEditFinancials;
  const canManageStaff = canEditData && authUser?.capabilities.manageStaff === true;
  const canManageSettings = canEditData && authUser?.capabilities.manageSettings === true;
  const recordIsReadOnly = recordPermissions !== null && !recordCanEditData;
  const [project, setProject] = useState<ProjectData>(() => ({
    id: id!,
    name: id!,
    status: "—",
    phase: "—",
    city: "",
    sector: "—",
    value: 0,
    laborValue: 0,
    company: "",
    bu: "",
    groupId: "",
    targetStart: "",
    targetEnd: "",
    actualStart: "",
    actualEnd: "",
    scheduleStart: "",
    scheduleEnd: "",
    closeDate: "",
    bidDate: "",
    probability: 0,
    module: getModule(id!),
    allocations: [],
    keyPersonnel: [],
    healthScore: -1,
    healthIssues: [],
    healthChecks: [],
    rawFields: {},
  }));
  // Gate on project.module (server-corrected from ModuleName/entityType after
  // the detail fetch) — a prefix guess would wrongly grant financial history
  // on custom-id leads (LD-#### falls to the "PMM" default).
  const canViewFinancialHistory = canShowFinancialHistory(project.module, canEditFinancials);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["overview", "additional"]));
  const [showHealthMath, setShowHealthMath] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const [companyProjects, setCompanyProjects] = useState<{ id: string; name: string; module: string; status: string; value: number; city: string; sector: string }[]>([]);
  const [companyContacts, setCompanyContacts] = useState<{ id: string; name: string; title: string; email: string; phone: string }[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [editAlloc, setEditAlloc] = useState<Allocation | null>(null);
  const [showValueHistory, setShowValueHistory] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");
  // Per-tenant "Hide ETC/EAC" toggle (mirrors web's team schedule grid).
  // Default visible; persisted per tenant in AsyncStorage.
  const [showEtcEac, setShowEtcEac] = useState(true);
  useEffect(() => { loadShowEtcEac().then(setShowEtcEac); }, []);
  const toggleEtcEac = () => setShowEtcEac(prev => {
    const next = !prev;
    void saveShowEtcEac(next);
    return next;
  });
  const [showAddMember, setShowAddMember] = useState(false);
  const [pendingWeeklyAlloc, setPendingWeeklyAlloc] = useState<{ name: string; resourceId?: string } | null>(null);
  // Keep legacy alias so the render block below uses a single name.
  const pendingWeeklyAllocName = pendingWeeklyAlloc;
  const setPendingWeeklyAllocName = setPendingWeeklyAlloc;
  useEffect(() => {
    if (!pendingWeeklyAlloc) return;
    const t = setTimeout(() => setPendingWeeklyAlloc(null), 15000);
    return () => clearTimeout(t);
  }, [pendingWeeklyAlloc]);
  const [openSlots, setOpenSlots] = useState<OpenRole[]>([]);
  const [assignSlot, setAssignSlot] = useState<OpenRole | null>(null);

  // ── Editable Project Details fields ──
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [sectorOptions, setSectorOptions] = useState<string[]>([]);
  const [customStatusInput, setCustomStatusInput] = useState("");
  const [editField, setEditField] = useState<
    { label: string; fieldName: string; type: "select" | "number"; options: string[] } | null
  >(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getFieldOptions("status").then((o) => { if (alive) setStatusOptions(o); }).catch(() => {});
    getFieldOptions("sector").then((o) => { if (alive) setSectorOptions(o); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // ── Schedule-aware status picker + sub-status support ──
  // null = still loading (show full tenant list); [] = confirmed no lifecycle
  // assigned; string[] = schedule phases from the assigned lifecycle.
  const [schedulePhases, setSchedulePhases] = useState<string[] | null>(null);
  // Per-record stage customization (Override Status): AsyncStorage is the
  // instant-render write-through cache; the canonical copy lives server-side
  // (per tenant + record + status field) and is shared with the web app.
  const [stageCfg, setStageCfg] = useState<StageCfg>(EMPTY_STAGE_CFG);
  // Local-edit generation counter: bumped on every local save so an in-flight
  // background GET (initial seed or foreground refetch) that started BEFORE
  // the edit can never clobber the newer local state with its older response.
  const stageCfgGenRef = useRef(0);
  const [stageCfgTenant, setStageCfgTenant] = useState<string>("");
  // Mirrors the rendered stageCfg so the foreground refetch can tell whether
  // the server copy actually CHANGED vs what's on screen (see notice below).
  const stageCfgLiveRef = useRef<StageCfg>(EMPTY_STAGE_CFG);
  stageCfgLiveRef.current = stageCfg;
  // Brief non-blocking note shown when a foreground refetch swaps in a status
  // list a teammate changed while this record was open (task: explain the
  // visible change instead of it feeling like a glitch). Auto-dismisses.
  const [stageCfgNotice, setStageCfgNotice] = useState(false);
  const stageCfgNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStageCfgNotice = useCallback(() => {
    if (stageCfgNoticeTimer.current) clearTimeout(stageCfgNoticeTimer.current);
    setStageCfgNotice(true);
    stageCfgNoticeTimer.current = setTimeout(() => setStageCfgNotice(false), 4000);
  }, []);
  useEffect(() => () => { if (stageCfgNoticeTimer.current) clearTimeout(stageCfgNoticeTimer.current); }, []);
  // Sub-status manager modal state
  const [showSubStatusMgr, setShowSubStatusMgr] = useState(false);
  const [subMgrTab, setSubMgrTab] = useState<"sub" | "custom">("sub");
  const [subMgrPhaseIdx, setSubMgrPhaseIdx] = useState(0);
  const [subMgrInput, setSubMgrInput] = useState("");
  const [subMgrCustomInput, setSubMgrCustomInput] = useState("");
  const [subMgrSaving, setSubMgrSaving] = useState(false);
  // One-shot autofocus for the manager's add input — set when the editor was
  // opened from a direct affordance ("+ Sub" pill / "+ Add statuses…") so the
  // user lands straight in the right input (mirrors web's overrideFocus).
  const [subMgrAutoFocus, setSubMgrAutoFocus] = useState(false);

  // Load the current tenant label once so we can build the tenant-scoped stageCfg key.
  useEffect(() => {
    AsyncStorage.getItem("rmone_tenant").then((t) => setStageCfgTenant(t ?? "")).catch(() => {});
  }, []);

  // Load stageCfg: AsyncStorage first (instant render), then the server's
  // canonical copy in the background. The server store is shared across web
  // and mobile, so a sub-status added on any device shows up here. When the
  // server has no config yet but this device has a non-empty local one
  // (pre-sync installs), push the local copy up once so it migrates.
  useEffect(() => {
    if (!project?.id || !project?.module) return;
    let alive = true;
    const field = project.module === "OPM" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
    const tenant = stageCfgTenant;
    const key = `rmone:stageCfg:${field}:${project.id}${tenant ? `_${tenant.toLowerCase()}` : ""}`;
    const recordId = project.id;
    /** Fetch the server's canonical copy and seed state + AsyncStorage.
     *  `migrateLocal` gates the one-time local→server migration (initial
     *  seed only — a foreground refetch must never re-push local state). */
    const refreshFromServer = (migrateLocal: boolean, local?: StageCfg) => {
      const genAtLaunch = stageCfgGenRef.current;
      void apiGetStageCfg(recordId, field).then((serverCfg) => {
        if (!alive) return;
        // A local edit landed while this GET was in flight — its response is
        // older than the user's state; drop it (the edit's PUT is canonical).
        if (stageCfgGenRef.current !== genAtLaunch) return;
        if (serverCfg) {
          const next = parseStageCfg(JSON.stringify(serverCfg));
          // Foreground refetch that actually CHANGES the rendered list means a
          // teammate saved edits while this record was open — show a brief
          // non-blocking note so the change doesn't feel like a glitch.
          // (Initial seed stays silent: that's a normal load, not a change.)
          if (!migrateLocal &&
              JSON.stringify(stageCfgLiveRef.current) !== JSON.stringify(next)) {
            showStageCfgNotice();
          }
          setStageCfg(next);
          // Write-through: keep AsyncStorage in sync with the canonical value.
          AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
        } else if (
          migrateLocal && local &&
          (local.order.length || local.custom.length || local.removed.length ||
           Object.values(local.subStatuses ?? {}).some((a) => a.length > 0))
        ) {
          // One-time migration: server has nothing, this device does.
          void saveStageCfgRemote(recordId, field, local);
        }
      });
    };
    AsyncStorage.getItem(key)
      .then((raw) => {
        const local = parseStageCfg(raw);
        if (alive) setStageCfg(local);
        // Background server seed — never blocks the initial render.
        refreshFromServer(true, local);
      })
      .catch(() => { if (alive) setStageCfg(EMPTY_STAGE_CFG); });
    // App foreground refetch while this record stays open: another user's
    // newly added status/sub-status converges without a reopen. One small
    // GET per foreground, throttled to at most once per 15s.
    let lastFetch = Date.now();
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (Date.now() - lastFetch < 15_000) return;
      lastFetch = Date.now();
      refreshFromServer(false);
    });
    return () => { alive = false; sub.remove(); };
  }, [project?.id, project?.module, stageCfgTenant]);

  /** Flat set of all sub-status strings for indent rendering in the picker. */
  const subStatusKeys = useMemo(() => getSubStatusKeys(stageCfg), [stageCfg]);

  // Admin-skipped stages (#284): hide stages the admin configured as skipped
  // for this record's field values. Must be declared before computedStatusOptions
  // (which references it) and called unconditionally (hook rule). Mirrors the
  // web's applyStageDisplayRules — the current status always remains selectable.
  // Pass project.id so the hook fetches effective rules for THIS record —
  // the server returns the record's own override doc when one exists, or the
  // company doc otherwise (mirrors the web's fetchStageRulesFor(undefined, id)).
  const skippedStages = useSkippedStages(project?.module, project?.rawFields, project?.id);

  /**
   * Live status-picker options for the current record, always in schedule step
   * order when a lifecycle is assigned. Mirrors the web's three-state contract:
   *   null  → still loading (schedulePhases not yet known) → full tenant list
   *   []    → confirmed no lifecycle → record-owned custom statuses only
   *   [...] → schedule phases in StageStep order + sub-statuses/customs on top
   *
   * Using a useMemo (rather than computing inside the render IIFE) ensures the
   * modal always reflects the latest schedulePhases and stageCfg — even if
   * either arrived AFTER the modal was opened. Without this, the stale snapshot
   * baked into editField.options at openEdit()-time could show tenant workflow
   * order instead of schedule step order while the async loads settled.
   */
  const computedStatusOptions = useMemo(() => {
    // Filter out admin-skipped stages (#284), mirroring the web's
    // applyStageDisplayRules. The record's own current status always stays
    // selectable even when the admin has marked it as skipped — this prevents
    // the picker from hiding the value the record is already in.
    const applySkips = (opts: string[]): string[] => {
      if (skippedStages.size === 0) return opts;
      const curKey = (project?.status ?? "").trim().toLowerCase();
      return opts.filter((s) => {
        const k = s.trim().toLowerCase();
        return !skippedStages.has(k) || k === curKey;
      });
    };

    if (schedulePhases !== null && schedulePhases.length > 0) {
      // Lifecycle assigned: schedule phases ARE the status choices, in StageStep
      // order (extractSchedulePhaseTitles already sorted them). lockedBase:true
      // preserves that order — cfg.order entries naming schedule phases are
      // filtered out so they cannot displace phases to a different position.
      return applySkips(applyStageCfgToOptions(schedulePhases, stageCfg, { lockedBase: true }));
    }
    if (schedulePhases !== null) {
      // Confirmed no lifecycle (schedulePhases === []): show only the record's
      // own custom additions from the Override Status editor.
      return applySkips(applyStageCfgToOptions([], stageCfg));
    }
    // null → task data still loading; fall back to the full tenant status list
    // so the picker is not empty during the brief network round-trip.
    return applySkips(statusOptions);
  }, [schedulePhases, stageCfg, statusOptions, skippedStages, project?.status]);

  /** Save an updated stageCfg: apply to state, write-through AsyncStorage,
   *  and sync to the server (fire-and-forget) so all devices converge. */
  const saveStageCfg = useCallback(async (updater: (prev: StageCfg) => StageCfg) => {
    if (!project?.id || !project?.module) return;
    const field = project.module === "OPM" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
    const tenant = stageCfgTenant;
    const key = `rmone:stageCfg:${field}:${project.id}${tenant ? `_${tenant.toLowerCase()}` : ""}`;
    const recordId = project.id;
    stageCfgGenRef.current++;
    setStageCfg((prev) => {
      const next = updater(prev);
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
      void saveStageCfgRemote(recordId, field, next);
      return next;
    });
  }, [project?.id, project?.module, stageCfgTenant]);

  /** Open the Override Status editor pre-seeded (mirrors the web's
   *  overrideFocus/overrideSignal pair): `subFor` lands straight in that
   *  phase's sub-status input; `addStage` lands in the custom "add statuses"
   *  input; {} = plain open (tab picked from lifecycle state). */
  const openOverrideEditor = useCallback((focus: { subFor?: string; addStage?: boolean } = {}) => {
    const phases = schedulePhases ?? [];
    if (focus.subFor && phases.length > 0) {
      const k = focus.subFor.trim().toLowerCase();
      const idx = phases.findIndex((p) => p.trim().toLowerCase() === k);
      setSubMgrTab("sub");
      setSubMgrPhaseIdx(idx >= 0 ? idx : 0);
    } else if (focus.addStage) {
      setSubMgrTab("custom");
    } else {
      setSubMgrTab(phases.length > 0 ? "sub" : "custom");
      setSubMgrPhaseIdx(0);
    }
    setSubMgrInput("");
    setSubMgrCustomInput("");
    setSubMgrAutoFocus(!!(focus.subFor || focus.addStage));
    setEditField(null);
    setShowSubStatusMgr(true);
  }, [schedulePhases]);

  const openEdit = useCallback((f: { label: string; fieldName: string; type: "select" | "number"; options: string[]; current: string }) => {
    Haptics.selectionAsync().catch(() => {});
    setEditField({ label: f.label, fieldName: f.fieldName, type: f.type, options: f.options });
    setEditDraft(f.current);
    setCustomStatusInput(""); // reset free-text input each time the modal opens
  }, []);

  const saveEdit = useCallback(async (rawValue: string) => {
    if (!editField || !id) return;
    const financial = isFinancialRecordField(editField.fieldName);
    const stage = editField.fieldName === "CRMOpportunityStatusChoice" || editField.fieldName === "CRMProjectStatusChoice";
    if ((financial && !canEditFinancials) || (stage && !canAdvanceStages) || (!financial && !stage && !canEditData)) {
      xAlert("View only", "Your permissions no longer allow this change.");
      setEditField(null);
      return;
    }
    setEditSaving(true);
    try {
      const r = await updateFields(id, [{ FieldName: editField.fieldName, Value: rawValue.trim() }]);
      if (!r.ok) throw new Error(r.error || "Could not save change");
      bustCache();
      setEditField(null);
      await loadProject(true);
    } catch (e) {
      // updateFields re-throws non-2xx errors with the server's human-readable
      // message (e.g. "Fill in Department before moving to Prospecting" from
      // the stage-rules gate). Surface that directly — never a raw JSON blob.
      xAlert("Could not save", e instanceof Error ? e.message : "Could not save change");
    } finally {
      setEditSaving(false);
    }
  }, [editField, id, canEditData, canAdvanceStages, canEditFinancials]);

  const loadProject = useCallback(async (silent = false) => {
    if (!id) { if (!silent) { setError("No project ID provided"); setLoading(false); } return; }
    // A record can reuse this component instance when navigating between IDs.
    // Do not carry the previous record's edit verdict into the next record.
    setRecordPermissions(null);
    // Reset schedule phases to null (loading state) so the STATUS picker falls
    // back to the full tenant list rather than showing stale phases from a
    // previously viewed project.
    if (!silent) setSchedulePhases(null);
    try {
      if (!silent) { setLoading(true); setError(null); }

      const recordP = getProjectDetails(id);
      const permissionsP = getRecordPermissions(id).catch(() => null);
      const allocP = getProjectAllocations(id).catch(() => null);
      const resP = getResourceAllocations().catch(() => null);
      const teamP = getProjectTeam(id).catch(() => ({ team: [], openRoles: [] } as ProjectTeamResponse));
      // null sentinel = fetch failed; [] = successful but empty; array = tasks
      const taskP = getTaskData(id, "0").catch(() => null as unknown);

      const [record, permissions] = await Promise.all([recordP, permissionsP]);
      setRecordPermissions(permissions);

      const dataField = (record as any)?.Data;
      const flat = Array.isArray(dataField) ? dataField[0] : (dataField ?? record);
      const d: Record<string, unknown> = {};
      if (flat && Array.isArray(flat.Fields)) {
        for (const key of ["RecordName", "RecordType", "RecordId", "ModuleId", "GroupID"]) {
          if (flat[key] !== undefined) d[key] = flat[key];
        }
        for (const f of flat.Fields as { FieldName: string; Value: unknown }[]) {
          // Preserve null from the server (do NOT coerce to "") so callers can
          // distinguish "field present but explicitly empty" from "field absent".
          // sv0/sv/nv0/nv all handle null gracefully (returning "" or 0).
          if (f.FieldName) d[f.FieldName] = f.Value ?? null;
        }
      } else if (flat) {
        Object.assign(d, flat);
      }
      // Prefer the server-reported module: a custom TicketId ("LD-0003") has
      // no PMM/OPM/LEM prefix, and getModule's "PMM" default would render a
      // lead as a project (wrong cards, wrong status field, wrong audit type).
      const svMod = String(d.ModuleName ?? "").trim();
      const module = ["PMM", "OPM", "LEM"].includes(svMod)
        ? svMod
        : d.entityType === "lead" ? "LEM"
        : d.entityType === "opportunity" ? "OPM"
        : d.entityType === "project" ? "PMM"
        : getModule(id);

      const sv0 = (v: unknown): string => (v != null ? String(v) : "");
      const nv0 = (v: unknown): number => (v != null ? Number(v) : 0);
      const statusRaw0 = sv0(d.CRMProjectStatusChoice) || sv0(d.CRMOpportunityStatusChoice) || sv0(d.LeadStatus) || sv0(d.Status);
      setProject(prev => ({
        ...prev,
        id,
        name: sv0(d.Title) || sv0(d.RecordName) || sv0(d.ProjectName) || sv0(d.Name) || prev.name,
        status: statusRaw0 || prev.status,
        phase: (STATUS_MAP[statusRaw0] ?? statusRaw0) || prev.phase,
        city: sv0(d.City) || prev.city,
        sector: sv0(d.SectorChoice) || sv0(d.Sector) || prev.sector,
        value: nv0(d.ApproxContractValue),
        laborValue: nv0((d as any).LaborContractAmount),
        company: sv0(d.CRMCompanyLookup) || sv0(d.CompanyName) || sv0(d.Company),
        // If CRMBusinessUnitChoice is present (even as "") the user explicitly set/cleared it.
        // Fall back to BusinessUnit/BU only when it is genuinely null (column absent/unset).
        bu: (d.CRMBusinessUnitChoice != null ? sv0(d.CRMBusinessUnitChoice) : sv0(d.BusinessUnit) || sv0(d.BU)),
        groupId: sv0(d.GroupID),
        targetStart: sv0(d.TargetStartDate),
        targetEnd: sv0(d.TargetCompletionDate),
        actualStart: sv0(d.ActualStartDate),
        actualEnd: sv0(d.ActualCompletionDate),
        // Reset schedule-derived dates until this record's task list resolves —
        // a stale value from a previously viewed project must never flash in.
        scheduleStart: "",
        scheduleEnd: "",
        closeDate: sv0(d.CloseDate),
        bidDate: sv0(d.BidDate) || sv0(d.BidDueDate),
        probability: nv0(d.Probability) || nv0(d.WinProbability) || nv0(d.ChanceofSuccessChoice),
        module,
        rawFields: d,
      }));

      const [allocRaw, resData, teamData, taskRes] = await Promise.all([
        allocP, resP, teamP, taskP,
      ]);

      const allocations: Allocation[] = [];
      const allocArr = (() => {
        if (!allocRaw) return [];
        const arr = (allocRaw as any)?.Allocations ?? (Array.isArray(allocRaw) ? allocRaw : []);
        return Array.isArray(arr) ? arr : [];
      })();

      const resMap = new Map<string, LiveResource>();
      const resById = new Map<string, LiveResource>();
      if (resData?.resources) {
        resData.resources.forEach((r: LiveResource) => {
          if (r.username) resMap.set(r.username.toLowerCase(), r);
          if (r.name) resMap.set(r.name.toLowerCase(), r);
          if (r.id) resById.set(r.id.toLowerCase(), r);
        });
      }

      const allocByName = new Map<string, Record<string, unknown>>();
      for (const a of allocArr) {
        let name = String(a.AssignedToName ?? a.ResourceUser ?? a.Name ?? "");
        if (/^[0-9a-f]{8}-/.test(name) || !name) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const res = resById.get(userId) ?? resMap.get(userId);
          if (res) name = res.name;
        }
        if (name && !allocByName.has(name.toLowerCase())) {
          allocByName.set(name.toLowerCase(), a);
        }
      }

      const seen = new Set<string>();

      const teamMembers = teamData?.team ?? [];
      const serverOpenRoles = teamData?.openRoles ?? [];
      if (teamMembers.length > 0) {
        for (const tm of teamMembers) {
          if (!tm.name) continue;
          // Resource GUID is the identity. Names collide in real rosters, so
          // never collapse two distinct staff records merely by display name.
          const tmKey = tm.resourceId
            ? `guid:${tm.resourceId.toLowerCase()}::${(tm.role || "").toLowerCase()}::${(tm.bu || "").toLowerCase()}`
            : `name:${tm.name.toLowerCase()}::${(tm.role || "").toLowerCase()}::${(tm.bu || "").toLowerCase()}`;
          if (seen.has(tmKey)) continue;
          seen.add(tmKey);
          const resTm = resMap.get(tm.name.toLowerCase());
          const allocEntry = allocByName.get(tm.name.toLowerCase());
          let role = tm.role || "";
          if (!role && allocEntry) role = String(allocEntry.TypeName ?? allocEntry.RoleName ?? "");
          allocations.push({
            name: tm.name,
            role,
            title: tm.title || "",
            pct: tm.pctAllocation ?? Number(allocEntry?.PctAllocation ?? 0),
            startDate: tm.startDate ?? String(allocEntry?.AllocationStartDate ?? "").slice(0, 10),
            endDate: tm.endDate ?? String(allocEntry?.AllocationEndDate ?? "").slice(0, 10),
            eacHrs: tm.eacHrs ?? 0,
            etcHrs: tm.etcHrs ?? 0,
            costRate: tm.costRate ?? 0,
            eacCost: tm.eacCost ?? 0,
            etcCost: tm.etcCost ?? 0,
            ncHrs: tm.ncHrs ?? 0,
            ncCost: tm.ncCost ?? 0,
            hasWeeklyHours: (tm.weeklyHours?.length ?? 0) > 0 || (tm.eacHrs ?? 0) > 0 || (tm.etcHrs ?? 0) > 0,
            bu: tm.bu ?? "",
            email: resTm?.username ?? "",
            resourceId: tm.resourceId ?? String(allocEntry?.ResourceId ?? allocEntry?.ResourceID ?? ""),
            enabled: tm.enabled ?? resTm?.enabled,
            tenantId: tm.tenantId ?? resTm?.tenantId,
            rwiId: tm.rwiId ?? undefined,
            employeeType: tm.employeeType ?? resTm?.employeeType ?? "",
            softAllocation: tm.softAllocation === true,
            nonChargeable: tm.nonChargeable === true,
            isLocked: tm.isLocked === true,
          });
        }
      }

      const seenMembers = new Set(allocations.map(a => (a.resourceId || `name:${a.name}`).toLowerCase()));

      const useAllocFallback = teamMembers.length === 0;

      for (const a of (useAllocFallback ? allocArr : [])) {
        let name = String(a.AssignedToName ?? a.ResourceUser ?? a.Name ?? "");
        if (/^[0-9a-f]{8}-/.test(name) || !name) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const res = resById.get(userId) ?? resMap.get(userId);
          if (res) name = res.name;
        }
        const allocationGuid = String(a.ResourceId ?? a.ResourceID ?? a.AssignedTo ?? "").toLowerCase();
        const allocationKey = allocationGuid || `name:${name}`.toLowerCase();
        if (!name || seenMembers.has(allocationKey)) continue;
        seenMembers.add(allocationKey);
        let role = String(a.TypeName ?? a.RoleName ?? "");
        if (!role) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const resPerson = resById.get(userId) ?? resMap.get(name.toLowerCase());
          if (resPerson) role = resPerson.role || "";
        }
        const userId = String(a.AssignedTo ?? "").toLowerCase();
        const resMember = resById.get(userId) ?? resMap.get(name.toLowerCase());
        const titleFromAlloc = String(a.Title ?? a.JobTitle ?? a.Position ?? "").trim();
        const buFromAlloc = String(a.DivisionName ?? a.Division ?? a.Department ?? "").trim();
        allocations.push({
          name,
          role,
          title: titleFromAlloc || resMember?.role || "",
          pct: Number(a.PctAllocation ?? 0),
          startDate: String(a.AllocationStartDate ?? "").slice(0, 10),
          endDate: String(a.AllocationEndDate ?? "").slice(0, 10),
          eacHrs: 0,
          etcHrs: 0,
          costRate: 0,
          eacCost: 0,
          etcCost: 0,
          ncHrs: 0,
          ncCost: 0,
          hasWeeklyHours: false,
          bu: buFromAlloc,
          email: resMember?.username ?? "",
          resourceId: allocationGuid,
          enabled: resMember?.enabled,
          tenantId: resMember?.tenantId,
          employeeType: resMember?.employeeType ?? "",
        });
      }

      // Build Key Personnel list — matches the web's fixed 8-role layout
      const guidToName: Record<string, string> = (resData as any)?.userGuidToName ?? {};
      const KEY_PERSONNEL_FIELDS: { field: string; role: string }[] = [
        { field: "ProjectManagerUser",        role: "Project Manager" },
        { field: "SeniorProjectManagerUser",  role: "Senior Project Manager" },
        { field: "ProgramManagerUser",        role: "Program Manager" },
        { field: "EstimatorUser",             role: "Estimator" },
        { field: "SeniorEstimatorUser",       role: "Senior Estimator" },
        { field: "SeniorMEPManagerUser",      role: "Senior MEP Manager" },
        { field: "SuperintendentUser",        role: "Superintendent" },
        { field: "SeniorSuperintendentUser",  role: "Senior Superintendent" },
      ];
      const keyPersonnel: { name: string; role: string; guid: string }[] = [];
      for (const { field, role: roleName } of KEY_PERSONNEL_FIELDS) {
        const val = (d as Record<string, unknown>)[field];
        // A *User column can hold MULTIPLE people as a comma/semicolon list
        // (the web Add Lead flow appends display names; legacy imports stored
        // GUID lists). Show every resolvable person, matching the web card.
        const seenTok = new Set<string>();
        for (const rawTok of (typeof val === "string" ? val : "").split(/[,;]+/)) {
          const tok = rawTok.replace(/^#/, "").trim();
          if (!tok) continue;
          const tokKey = tok.toLowerCase();
          if (seenTok.has(tokKey)) continue;
          seenTok.add(tokKey);
          if (/^[0-9a-f]{8}-/.test(tokKey)) {
            const isMe = !!authUser?.userId && tokKey === String(authUser.userId).toLowerCase();
            const meName = authUser?.username ? String(authUser.username).split("_")[0] : "";
            const name = guidToName[tokKey] || resById.get(tokKey)?.name || (isMe ? (meName || "Me") : "");
            if (name) keyPersonnel.push({ name, role: roleName, guid: tokKey });
          } else {
            // Display name / email stored directly (web-added leads)
            keyPersonnel.push({ name: tok, role: roleName, guid: tok });
          }
        }
      }

      // Key Personnel are named-role users (PM, Superintendent, etc.) stored as GUIDs
      // on the PMM record. The pipeline synthesis ALSO creates RWI rows for them so they
      // appear in Project Team too — filter them out here to avoid showing the same person
      // in both sections.
      if (keyPersonnel.length > 0) {
        const kpNames = new Set(keyPersonnel.map(kp => kp.name.toLowerCase()));
        const kpGuids = new Set(keyPersonnel.map(kp => kp.guid.toLowerCase()));
        const filtered = allocations.filter(a => {
          const nameLow = a.name.toLowerCase();
          if (kpNames.has(nameLow)) return false;
          // Also match by resourceId (GUID) in case display names differ slightly
          if (a.resourceId && kpGuids.has(a.resourceId.toLowerCase())) return false;
          return true;
        });
        allocations.length = 0;
        allocations.push(...filtered);
      }

      const allHrsZero = allocations.length > 0 && allocations.every(a => a.eacHrs === 0);
      if (allHrsZero && (module === "PMM" || module === "OPM")) {
        try {
          const billingRaw = await getBillingRates(id);
          const candidates = [
            ...(Array.isArray(billingRaw) ? billingRaw : []),
            ...(Array.isArray(billingRaw?.Data) ? billingRaw.Data : []),
            ...(Array.isArray(billingRaw?.Allocations?.Table) ? billingRaw.Allocations.Table : []),
          ];
          if (candidates.length > 0) {
            const hrsMap = new Map<string, { hrs: number; cost: number; costRate: number }>();
            for (const r of candidates) {
              const rname = String(r.AssignedToName || r.ResourceName || r.Name || "").trim().toLowerCase();
              if (!rname) continue;
              const hrs = Number(r.EACHrs ?? r.TotalHours ?? r.Hours ?? r.AllocationHour ?? 0);
              const cost = Number(r.EACCost ?? r.CostAmount ?? r.TotalCost ?? 0);
              const cr = Number(r.CostRate ?? r.Cost ?? 0);
              const prev = hrsMap.get(rname);
              if (prev) { prev.hrs += hrs; prev.cost += cost; if (!prev.costRate && cr) prev.costRate = cr; }
              else hrsMap.set(rname, { hrs, cost, costRate: cr });
            }
            for (const alloc of allocations) {
              const match = hrsMap.get(alloc.name.toLowerCase());
              if (match) {
                if (alloc.eacHrs === 0 && match.hrs > 0) alloc.eacHrs = match.hrs;
                if (alloc.eacCost === 0 && match.cost > 0) alloc.eacCost = match.cost;
                if (alloc.costRate === 0 && match.costRate > 0) alloc.costRate = match.costRate;
              }
            }
          }
        } catch {}
      }

      const sv = (v: unknown): string => (v != null ? String(v) : "");
      const nv = (v: unknown): number => (v != null ? Number(v) : 0);

      const statusRaw = sv(d.CRMProjectStatusChoice) || sv(d.CRMOpportunityStatusChoice) || sv(d.LeadStatus) || sv(d.Status);
      const proj: ProjectData = {
        id,
        name: sv(d.Title) || sv(d.RecordName) || sv(d.ProjectName) || sv(d.Name),
        status: statusRaw,
        phase: STATUS_MAP[statusRaw] ?? statusRaw,
        city: sv(d.City),
        sector: sv(d.SectorChoice) || sv(d.Sector),
        // ApproxContractValue ONLY — no fallback. Per client direction
        // (Apr 2026), ApproxContractValue and LaborContractAmount are
        // distinct fields and must not be silently substituted.
        value: nv(d.ApproxContractValue),
        laborValue: nv((d as any).LaborContractAmount),
        company: sv(d.CRMCompanyLookup) || sv(d.CompanyName) || sv(d.Company),
        bu: (d.CRMBusinessUnitChoice != null ? sv(d.CRMBusinessUnitChoice) : sv(d.BusinessUnit) || sv(d.BU)),
        groupId: sv(d.GroupID),
        targetStart: sv(d.TargetStartDate),
        targetEnd: sv(d.TargetCompletionDate),
        actualStart: sv(d.ActualStartDate),
        actualEnd: sv(d.ActualCompletionDate),
        scheduleStart: "",
        scheduleEnd: "",
        closeDate: sv(d.CloseDate),
        bidDate: sv(d.BidDate) || sv(d.BidDueDate),
        probability: nv(d.Probability) || nv(d.WinProbability) || nv(d.ChanceofSuccessChoice),
        module,
        allocations,
        keyPersonnel,
        healthScore: 0,
        healthIssues: [],
        healthChecks: [],
        rawFields: d,
      };

      // Determine schedule context for accurate health gauge.
      // Use the SAME strict lifecycle detection the SchedulePhases card uses
      // (line ~893): meaningful field value OR the project actually has tasks.
      // Plain truthy checks misfire because RM ONE sometimes returns "0" /
      // "false" / empty placeholders for ProjectLifeCycleLookup on records
      // with no real lifecycle assigned.
      const scrumLc =
        d.ProjectLifeCycleLookup ??
        (d as any).ScrumLifeCycle ??
        (d as any).scrumLifeCycle ??
        (d as any).ProjectLifecycleID ??
        (d as any).ProjectLifeCycleID ??
        (d as any).LifecycleID ??
        (d as any).LifeCycleID;
      const fieldHint = !!(scrumLc && String(scrumLc).trim() !== "" && String(scrumLc) !== "false" && String(scrumLc) !== "0");
      let scheduleLastPhaseEnd = "";
      let scheduleFirstPhaseStart = "";
      let hasTasks = false;
      try {
        const rawTasks = Array.isArray(taskRes) ? taskRes : ((taskRes as any)?.Data ?? (taskRes as any)?.data ?? []);
        if (Array.isArray(rawTasks) && rawTasks.length > 0) {
          hasTasks = true;
          const lastMs = rawTasks
            .map((t: any) => (typeof t?.DueDate === "string" ? new Date(t.DueDate).getTime() : 0))
            .filter((n: number) => n > 0)
            .sort((a: number, b: number) => b - a)[0] ?? 0;
          if (lastMs > 0) scheduleLastPhaseEnd = new Date(lastMs).toISOString();
          // First phase StartDate = the schedule's actual start. Ignore the
          // "0001-…" sentinel some rows carry by requiring a year past 2000.
          const firstMs = rawTasks
            .map((t: any) => (typeof t?.StartDate === "string" ? new Date(t.StartDate).getTime() : 0))
            .filter((n: number) => n > 0 && new Date(n).getFullYear() > 2000)
            .sort((a: number, b: number) => a - b)[0] ?? 0;
          if (firstMs > 0) scheduleFirstPhaseStart = new Date(firstMs).toISOString();
        }
        // Extract phase titles for the schedule-aware STATUS picker.
        // Three-state semantics matching the web app:
        //   null  = unknown (fetch failed or still loading) → show full tenant list
        //   []    = confirmed no lifecycle assigned → show tenant list + assign hint
        //   [...] = schedule phases → those ARE the status choices
        if (taskRes === null) {
          // taskP failed (network error, timeout, etc.) — keep schedulePhases
          // as null so the picker falls back to the full tenant list rather
          // than misrepresenting lifecycle state as "confirmed none".
        } else if (hasTasks) {
          setSchedulePhases(extractSchedulePhaseTitles(rawTasks) ?? []);
        } else if (!fieldHint) {
          // Successful empty task list AND no lifecycle field on the record:
          // confirmed no schedule assigned.
          setSchedulePhases([]);
        }
        // hasTasks=false + fieldHint=true → lifecycle field says assigned but
        // tasks haven't materialized yet; leave as null so the picker shows
        // the full list rather than forcing a premature "assign lifecycle" prompt.
      } catch {
        // Parsing error — leave schedulePhases as null (unknown state).
      }
      proj.scheduleEnd = scheduleLastPhaseEnd;
      proj.scheduleStart = scheduleFirstPhaseStart;
      const lifecycleAssigned = fieldHint || hasTasks;

      const health = computeHealth(proj, { lifecycleAssigned, scheduleLastPhaseEnd });
      proj.healthScore = health.score;
      proj.healthIssues = health.issues;
      proj.healthChecks = health.checks;

      setProject(proj);
      setOpenSlots(serverOpenRoles);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    } catch (e: any) {
      setError(e.message || "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // Subscribe to schedule-change notifications so `schedulePhases` stays in
  // sync for ALL mutation paths: phase date edits, lifecycle assignment from
  // the child card, and any future callers of notifyScheduleChanged.
  // `bustCache()` runs synchronously in each mutation handler BEFORE
  // notifyScheduleChanged fires, so `loadProject(true)` picks up fresh
  // task data from the server rather than a stale cached value.
  // Using loadProject(true) (rather than a bare getTaskData fetch) ensures
  // the full tri-state logic — including confirmed-empty [] — is applied
  // correctly via the fieldHint + hasTasks reconciliation in loadProject.
  useEffect(() => {
    if (!id) return;
    return onScheduleChanged(() => {
      void loadProject(true);
    });
  }, [id, loadProject]);

  useEffect(() => {
    if (!project || project.module !== "COM") return;
    setCompanyLoading(true);
    Promise.all([
      getCompanyProjects(project.name, id!).catch(() => ({ data: [] })),
      getCompanyContacts(id!).catch(() => ({ data: [] })),
    ]).then(([projRes, conRes]) => {
      setCompanyProjects((projRes as any)?.data || []);
      setCompanyContacts((conRes as any)?.data || []);
    }).finally(() => setCompanyLoading(false));
  }, [project?.module, project?.name, id]);

  const toggleSection = (s: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const askAI = (prompt: string) => {
    auditAction({ screen: "project-detail" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setChatPrompt(prompt, undefined, true);
    router.dismiss();
    setTimeout(() => {
      router.navigate("/(tabs)/chat");
    }, 100);
  };

  // ── Stage guidance tip (#137) ────────────────────────────────────────────
  // Derive the record's current stage exactly like the web's stageRuleInfo
  // memo does: module-aware COALESCE over rawFields, same column priority.
  // This runs at the top level (not inside a render branch) so the hook call
  // count is stable across renders — hooks must never be conditional.
  const rf0 = project.rawFields as Record<string, unknown>;
  const sv0tip = (v: unknown): string =>
    v != null && String(v).trim() ? String(v).trim() : "";
  const tipStage =
    project.module === "OPM"
      ? sv0tip(rf0.CRMOpportunityStatusChoice) ||
        sv0tip(rf0.CRMOpportunityStageChoice) ||
        sv0tip(rf0.Status)
      : project.module === "LEM"
      ? sv0tip(rf0.LeadStatus) || sv0tip(rf0.Status)
      : /* PMM default */
        sv0tip(rf0.CRMProjectStatusChoice) || sv0tip(rf0.Status);
  const guidanceTip = useGuidanceTip(project.module, tipStage || project.status);

  if (error && !loading) {
    return (
      <View style={[st.container, { paddingTop: Math.max(insets.top, 50) }]}>
        <Pressable style={st.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.cardText} />
        </Pressable>
        <View style={st.loadingCenter}>
          <Feather name="alert-circle" size={40} color="#E03C3C" />
          <Text style={[st.loadingText, { color: "#E03C3C", marginTop: 12 }]}>{error || "Project not found"}</Text>
          <Pressable style={st.retryBtn} onPress={() => loadProject()}>
            <Text style={st.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const hc = healthColor(project.healthScore);
  const pc = phaseColor(project.status);
  const mc = moduleColor(project.module);
  const isExpanded = (s: string) => expandedSections.has(s);

  const headerOpacity = scrollY.interpolate({ inputRange: [0, 120], outputRange: [0, 1], extrapolate: "clamp" });

  const avgAlloc = project.allocations.length > 0
    ? Math.round(project.allocations.reduce((s, a) => s + a.pct, 0) / project.allocations.length)
    : 0;

  if (project.module === "COM") {
    const rawD = project.rawFields;
    const sv = (v: unknown): string => (v != null && String(v) !== "null" ? String(v) : "");
    const companyType = sv(rawD.CRMCompanyTypeChoice) || sv(rawD.CompanyType) || sv(rawD.AccountType);
    const companyPhone = sv(rawD.PhoneNumber) || sv(rawD.Phone) || sv(rawD.OfficePhone);
    const companyEmail = sv(rawD.Email) || sv(rawD.EmailAddress);
    const companyAddr = [sv(rawD.Address), sv(rawD.City), sv(rawD.State), sv(rawD.ZipCode)].filter(Boolean).join(", ");
    const companyWebsite = sv(rawD.Website) || sv(rawD.WebAddress);
    const totalValue = companyProjects.reduce((s, p) => s + (p.value || 0), 0);

    const comStatusColor = (s: string) => {
      const sl = s.toLowerCase();
      if (sl.includes("progress") || sl.includes("construction") || sl.includes("active") || sl.includes("awarded")) return Colors.green;
      if (sl.includes("close")) return Colors.orange;
      if (sl.includes("precon") || sl.includes("design")) return "#FB923C";
      if (sl.includes("bid") || sl.includes("rom")) return ACCENT_BLUE;
      return Colors.textMuted;
    };

    return (
      <View style={[st.container, { paddingTop: Math.max(insets.top, 50) }]}>
        <Animated.View style={[st.headerBar, { opacity: headerOpacity }]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.darkDeep }]} />
        </Animated.View>
        <View style={st.headerNav}>
          <Pressable style={st.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={Colors.cardText} />
          </Pressable>
          <Text style={st.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Pressable
            style={st.aiHeaderBtn}
            onPress={() => askAI(`Give me a comprehensive AI profile of company "${project.name}" (${project.id}). Search for all projects by this company name. Include total business volume, project breakdown by status, key contacts, and strategic recommendations.`)}
          >
            <Ionicons name="sparkles" size={14} color="#FFF" />
          </Pressable>
        </View>

        <Animated.ScrollView
          style={[st.scroll, { opacity: fadeAnim }]}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          {recordIsReadOnly && <RecordReadOnlyBanner reason={recordPermissions?.reason} />}
          <View style={st.heroCard}>
            <HeroBg accent={ACCENT_PURPLE} />
            <View style={st.heroTop}>
              <View style={[st.moduleBadge, { backgroundColor: ACCENT_PURPLE + "20", borderColor: ACCENT_PURPLE + "30", borderWidth: 1 }]}>
                <Text style={[st.moduleText, { color: ACCENT_PURPLE }]}>COM</Text>
              </View>
              {companyType ? (
                <View style={[st.phasePill, { backgroundColor: Colors.green + "18", borderColor: Colors.green + "40" }]}>
                  <View style={[st.phaseDot, { backgroundColor: Colors.green }]} />
                  <Text style={[st.phaseText, { color: Colors.green }]}>{companyType}</Text>
                </View>
              ) : null}
            </View>

            <Text style={st.heroName}>{project.name}</Text>
            <Text style={st.heroId}>{project.id}</Text>

            <View style={st.heroMeta}>
              {project.city ? (
                <View style={st.metaChip}>
                  <Feather name="map-pin" size={10} color={Colors.textSecondary} />
                  <Text style={st.metaText}>{project.city}</Text>
                </View>
              ) : null}
              {companyPhone ? (
                <Pressable style={st.metaChip} onPress={() => Linking.openURL(`tel:${companyPhone}`)}>
                  <Feather name="phone" size={10} color={Colors.green} />
                  <Text style={[st.metaText, { color: Colors.green }]}>{companyPhone}</Text>
                </Pressable>
              ) : null}
              {companyEmail ? (
                <Pressable style={st.metaChip} onPress={() => Linking.openURL(`mailto:${companyEmail}`)}>
                  <Feather name="mail" size={10} color={Colors.green} />
                  <Text style={[st.metaText, { color: Colors.green }]}>{companyEmail}</Text>
                </Pressable>
              ) : null}
            </View>
            {companyAddr ? (
              <View style={{ marginTop: 8 }}>
                <View style={st.metaChip}>
                  <Feather name="home" size={10} color={Colors.textSecondary} />
                  <Text style={st.metaText}>{companyAddr}</Text>
                </View>
              </View>
            ) : null}
            {companyWebsite ? (
              <Pressable style={[st.metaChip, { marginTop: 4 }]} onPress={() => Linking.openURL(companyWebsite.startsWith("http") ? companyWebsite : `https://${companyWebsite}`)}>
                <Feather name="globe" size={10} color={Colors.green} />
                <Text style={[st.metaText, { color: Colors.green }]}>{companyWebsite}</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={st.statsRow}>
            <StatCard icon="folder" iconColor={Colors.green} label="Total Projects" value={`${companyProjects.length}`} />
            <StatCard icon="dollar-sign" iconColor={ACCENT_BLUE} label="Total Value" value={fmtM(totalValue)} />
            <StatCard icon="users" iconColor={ACCENT_PURPLE} label="Contacts" value={`${companyContacts.length}`} />
          </View>

          <SectionCard
            icon="folder" iconColor={Colors.green} title="Linked Projects"
            badge={<View style={st.countBadge}><Text style={st.countText}>{companyProjects.length}</Text></View>}
            expanded={isExpanded("overview")}
            onToggle={() => toggleSection("overview")}
          >
            {companyLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator color={Colors.green} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 8 }}>Loading projects…</Text>
              </View>
            ) : companyProjects.length === 0 ? (
              <View style={st.emptyState}>
                <Feather name="folder" size={28} color={Colors.textMuted} />
                <Text style={st.emptyTitle}>No Projects Found</Text>
                <Text style={st.emptyDesc}>No projects linked to this company</Text>
              </View>
            ) : (
              <>
                <View style={{ backgroundColor: Colors.green + "10", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: Colors.green + "20" }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.green }}>
                    {companyProjects.length} projects · {fmtM(totalValue)} total value
                  </Text>
                </View>
                {companyProjects.map(p => {
                  const sc = comStatusColor(p.status);
                  return (
                    <Pressable
                      key={p.id}
                      style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.green + "25" }}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/project/${p.id}`); }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }} numberOfLines={2}>{p.name}</Text>
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>{p.id} · {p.module}</Text>
                        </View>
                        {p.value > 0 && <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>{fmtM(p.value)}</Text>}
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <View style={{ backgroundColor: sc + "20", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 10, color: sc }}>{p.status || "—"}</Text>
                        </View>
                        {p.city ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>📍 {p.city}</Text> : null}
                        {p.sector && p.sector !== "—" ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>{p.sector}</Text> : null}
                        <View style={{ flex: 1 }} />
                        <Feather name="chevron-right" size={12} color={Colors.textMuted} />
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}
          </SectionCard>

          <SectionCard
            icon="users" iconColor={ACCENT_PURPLE} title="Contacts"
            badge={<View style={st.countBadge}><Text style={st.countText}>{companyContacts.length}</Text></View>}
            expanded={isExpanded("team")}
            onToggle={() => toggleSection("team")}
          >
            {companyLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator color={Colors.green} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 8 }}>Loading contacts…</Text>
              </View>
            ) : companyContacts.length === 0 ? (
              <View style={st.emptyState}>
                <Feather name="users" size={28} color={Colors.textMuted} />
                <Text style={st.emptyTitle}>No Contacts Found</Text>
                <Text style={st.emptyDesc}>No contacts linked to this company</Text>
              </View>
            ) : (
              companyContacts.map(ct => (
                <View key={ct.id} style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: ACCENT_PURPLE + "25" }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }}>{ct.name}</Text>
                  {ct.title && ct.title !== "—" ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>{ct.title}</Text> : null}
                  <View style={{ marginTop: 6, gap: 4 }}>
                    {ct.email ? (
                      <Pressable onPress={() => Linking.openURL(`mailto:${ct.email}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Feather name="mail" size={11} color={Colors.green} />
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.green }}>{ct.email}</Text>
                      </Pressable>
                    ) : null}
                    {ct.phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${ct.phone}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Feather name="phone" size={11} color={Colors.green} />
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.green }}>{ct.phone}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </SectionCard>

          <SectionCard
            icon="layers" iconColor={ACCENT_TEAL} title="Company Details"
            expanded={isExpanded("details")}
            onToggle={() => toggleSection("details")}
          >
            <View style={st.detailsGrid}>
              <DetailCell label="Module" value="COM" color={ACCENT_PURPLE} />
              {companyType ? <DetailCell label="Type" value={companyType} /> : null}
              {project.city ? <DetailCell label="City" value={project.city} /> : null}
              {companyPhone ? <DetailCell label="Phone" value={companyPhone} /> : null}
              {companyEmail ? <DetailCell label="Email" value={companyEmail} /> : null}
              {companyWebsite ? <DetailCell label="Website" value={companyWebsite} /> : null}
              {totalValue > 0 ? <DetailCell label="Total Project Value" value={fmtM(totalValue)} color={Colors.green} /> : null}
            </View>
          </SectionCard>

          {/* AI Quick Actions — hidden for companies (CMM) per client request */}
          {false && (
          <View style={st.aiSection}>
            <View style={st.aiSectionHeader}>
              <View style={st.aiIconWrap}>
                <Ionicons name="sparkles" size={14} color="#FFF" />
              </View>
              <Text style={st.aiSectionTitle}>AI Quick Actions</Text>
            </View>
            <Text style={st.aiSectionSub}>Tap to get instant AI-powered insights</Text>

            <View style={st.aiGrid}>
              {[
                {
                  icon: "briefcase",
                  label: "Company\nProfile",
                  gradient: GRADIENT_GREEN,
                  prompt: `Give me a comprehensive profile of company "${project.name}" (${project.id}). Search for all projects by this company. Include total business volume, project breakdown by module and status, timeline of engagement, and strategic value assessment.`,
                },
                {
                  icon: "users",
                  label: "Key\nContacts",
                  gradient: GRADIENT_BLUE,
                  prompt: `Find and analyze all contacts for company "${project.name}" (${project.id}). List every contact with name, title, email, and phone. Identify decision-makers and primary points of contact.`,
                },
                {
                  icon: "alert-triangle",
                  label: "Risk\nReview",
                  gradient: GRADIENT_RED,
                  prompt: `Perform a risk review for company "${project.name}" (${project.id}). Analyze all their projects — which ones are at risk, delayed, or understaffed? Identify any patterns or concerns.`,
                },
                {
                  icon: "trending-up",
                  label: "Pipeline\nAnalysis",
                  gradient: GRADIENT_ORANGE,
                  prompt: `Analyze the full pipeline for company "${project.name}" (${project.id}). What's their active pipeline value? How many projects are in precon vs construction? What's the revenue trajectory? Give strategic recommendations.`,
                },
              ].map((action, i) => (
                <AiActionCard
                  key={i}
                  index={i}
                  icon={action.icon}
                  label={action.label}
                  gradient={action.gradient as [string, string]}
                  onPress={() => askAI(action.prompt)}
                />
              ))}
            </View>
          </View>
          )}
        </Animated.ScrollView>
        {loading && (
          <RmOneProcessing label="Loading project…" sublabel="FETCHING PROJECT DATA" />
        )}
      </View>
    );
  }

  if (project.module === "CON") {
    const rawD = project.rawFields;
    const sv = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v).trim();
      if (!s || s === "null" || s === "false" || s === "undefined") return "";
      return s;
    };
    const projName = (project.name || "").trim();
    const contactName = sv(rawD.FullName) || sv(rawD.ContactName) || sv(rawD.DisplayName) || sv(rawD.Title) || (projName && projName !== project.id ? projName : "") || `Contact ${project.id}`;
    const firstName = sv(rawD.FirstName).trim();
    const lastName = sv(rawD.LastName).trim();
    const email = sv(rawD.EmailAddress) || sv(rawD.Email);
    const secondaryEmail = sv(rawD.SecondaryEmail);
    const phone = sv(rawD.Telephone) || sv(rawD.Phone) || sv(rawD.PhoneNumber);
    const mobilePhone = sv(rawD.MobilePhone) || sv(rawD.Mobile);
    const jobTitle = sv(rawD.NameTitle) || sv(rawD.JobTitle) || sv(rawD.Title2) || sv(rawD.Position);
    const companyName = sv(rawD.CRMCompanyLookup) || sv(rawD.CompanyName) || sv(rawD.AccountName) || sv(rawD.Company) || project.company;
    const contactType = sv(rawD.CRMContactType) || sv(rawD.CRMContactTypeChoice);
    const city = sv(rawD.City);
    const stateName = sv(rawD.StateLookup) || sv(rawD.State);
    const zip = sv(rawD.Zip) || sv(rawD.ZipCode);
    const address1 = sv(rawD.StreetAddress1);
    const address2 = sv(rawD.StreetAddress2);
    const decisionMaker = sv(rawD.DecisionMaker);
    const contactStatus = sv(rawD.Status);
    const opmCounts = Number(rawD.OPMCounts ?? 0);
    const lemCounts = Number(rawD.LEMCounts ?? 0);
    const projectCounts = Number(rawD.ProjectCounts ?? 0);
    const createdBy = sv(rawD.CreatedByUser);
    const createdDate = sv(rawD.CreationDate) || sv(rawD.Created);
    const initials = (firstName && lastName) ? `${firstName[0]}${lastName[0]}`.toUpperCase() : contactName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

    const infoRows: { icon: string; label: string; value: string; action?: () => void }[] = [];
    if (email) infoRows.push({ icon: "mail", label: "Email", value: email, action: () => askAI(`Draft and send an email via AgentMail to ${contactName}${jobTitle ? ` (${jobTitle})` : ""}${companyName ? ` at ${companyName}` : ""} at ${email}. Ask me what the email should be about before sending.`) });
    if (secondaryEmail) infoRows.push({ icon: "mail", label: "Secondary Email", value: secondaryEmail, action: () => askAI(`Draft and send an email via AgentMail to ${contactName}${jobTitle ? ` (${jobTitle})` : ""}${companyName ? ` at ${companyName}` : ""} at ${secondaryEmail}. Ask me what the email should be about before sending.`) });
    if (phone) infoRows.push({ icon: "phone", label: "Phone", value: phone, action: () => Linking.openURL(`tel:${phone}`) });
    if (mobilePhone && mobilePhone !== phone) infoRows.push({ icon: "smartphone", label: "Mobile", value: mobilePhone, action: () => Linking.openURL(`tel:${mobilePhone}`) });
    if (jobTitle) infoRows.push({ icon: "award", label: "Title / Role", value: jobTitle });
    if (contactType) infoRows.push({ icon: "tag", label: "Type", value: contactType });
    if (contactStatus) infoRows.push({ icon: "activity", label: "Status", value: contactStatus });
    if (decisionMaker && decisionMaker.toLowerCase() === "true") infoRows.push({ icon: "star", label: "Decision Maker", value: "Yes" });
    if (createdBy) infoRows.push({ icon: "user-plus", label: "Added By", value: `${createdBy}${createdDate ? ` · ${createdDate.slice(0, 10)}` : ""}` });

    const fullAddress = [address1, address2, [city, stateName, zip].filter(Boolean).join(", ")].filter(Boolean).join("\n");
    const totalRelated = projectCounts + opmCounts + lemCounts;

    return (
      <View style={[st.container, { paddingTop: Math.max(insets.top, 50) }]}>
        <Animated.View style={[st.headerBar, { opacity: headerOpacity }]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.darkDeep }]} />
        </Animated.View>
        <View style={st.headerNav}>
          <Pressable style={st.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={Colors.cardText} />
          </Pressable>
          <Text style={st.headerTitle} numberOfLines={1}>{contactName}</Text>
          <Pressable
            style={st.aiHeaderBtn}
            onPress={() => askAI(`Give me a comprehensive AI profile of contact "${contactName}"${companyName ? ` at "${companyName}"` : ""}. Find all related projects, opportunities, and leads involving this contact or their company. Provide strategic insights about the relationship.`)}
          >
            <Ionicons name="sparkles" size={14} color="#FFF" />
          </Pressable>
        </View>

        <Animated.ScrollView
          style={[st.scroll, { opacity: fadeAnim }]}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <View style={st.heroCard}>
            <HeroBg accent={ACCENT_TEAL} />
            <View style={st.heroTop}>
              <View style={[st.moduleBadge, { backgroundColor: "#2DD4BF20", borderColor: "#2DD4BF30", borderWidth: 1 }]}>
                <Text style={[st.moduleText, { color: "#2DD4BF" }]}>CON</Text>
              </View>
              {contactType ? (
                <View style={[st.phasePill, { backgroundColor: Colors.green + "18", borderColor: Colors.green + "40" }]}>
                  <View style={[st.phaseDot, { backgroundColor: Colors.green }]} />
                  <Text style={[st.phaseText, { color: Colors.green }]}>{contactType}</Text>
                </View>
              ) : null}
            </View>

            <View style={{ alignItems: "center", marginVertical: 16 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#2DD4BF20", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#2DD4BF40" }}>
                {initials ? (
                  <Text style={{ fontSize: 26, fontWeight: "700", color: "#2DD4BF" }}>{initials}</Text>
                ) : (
                  <Feather name="user" size={28} color="#2DD4BF" />
                )}
              </View>
              <Text style={[st.heroName, { marginTop: 12, textAlign: "center" }]}>
                {contactName && contactName !== project.id ? contactName : "Unnamed Contact"}
              </Text>
              {jobTitle ? <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4, textAlign: "center" }}>{jobTitle}</Text> : null}
              {companyName ? <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, marginTop: 2, textAlign: "center" }}>{companyName}</Text> : null}
              <Text style={st.heroId}>{project.id}</Text>
              {infoRows.length === 0 ? (
                <View style={{ marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.15)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" }}>
                  <Text style={{ color: "#F59E0B", fontSize: 11, fontWeight: "600" }}>Record needs enrichment</Text>
                </View>
              ) : null}
            </View>

            {(email || phone) ? (
              <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 4 }}>
                {email ? (
                  <Pressable
                    style={{ flexDirection: "row", alignItems: "center", backgroundColor: Colors.green + "18", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, gap: 6, borderWidth: 1, borderColor: Colors.green + "30" }}
                    onPress={() => askAI(`Draft and send an email to ${contactName}${jobTitle ? ` (${jobTitle})` : ""}${companyName ? ` at ${companyName}` : ""} at ${email}. Ask me what the email should be about before sending.`)}
                  >
                    <Feather name="mail" size={14} color={Colors.green} />
                    <Text style={{ color: Colors.green, fontSize: 13, fontWeight: "600" }}>Email</Text>
                  </Pressable>
                ) : null}
                {phone ? (
                  <Pressable
                    style={{ flexDirection: "row", alignItems: "center", backgroundColor: ACCENT_BLUE + "18", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, gap: 6, borderWidth: 1, borderColor: ACCENT_BLUE + "30" }}
                    onPress={() => Linking.openURL(`tel:${phone}`)}
                  >
                    <Feather name="phone" size={14} color={ACCENT_BLUE} />
                    <Text style={{ color: ACCENT_BLUE, fontSize: 13, fontWeight: "600" }}>Call</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          <SectionCard
            icon="user"
            iconColor="#2DD4BF"
            title="Contact Details"
            expanded={isExpanded("contact-info")}
            onToggle={() => toggleSection("contact-info")}
          >
            {infoRows.length === 0 ? (
              <View style={{ paddingVertical: 18, alignItems: "center" }}>
                <Feather name="info" size={22} color="rgba(255,255,255,0.25)" />
                <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 8, textAlign: "center" }}>
                  No contact details on file
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 4, textAlign: "center", paddingHorizontal: 12 }}>
                  This CON record has only an ID upstream. Use AI Quick Actions below to enrich or research this contact.
                </Text>
              </View>
            ) : null}
            {infoRows.map((row, idx) => (
              <Pressable
                key={idx}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: idx < infoRows.length - 1 ? 1 : 0, borderBottomColor: "rgba(255,255,255,0.05)" }}
                onPress={row.action}
                disabled={!row.action}
              >
                <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                  <Feather name={row.icon as any} size={14} color="#2DD4BF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{row.label}</Text>
                  <Text style={{ color: Colors.cardText, fontSize: 14, marginTop: 2 }}>{row.value}</Text>
                </View>
                {row.action ? <Feather name="external-link" size={14} color="rgba(255,255,255,0.2)" /> : null}
              </Pressable>
            ))}
          </SectionCard>

          {(companyName || fullAddress) ? (
            <SectionCard
              icon="briefcase"
              iconColor={Colors.orange}
              title="Company Details"
              expanded={isExpanded("company-info")}
              onToggle={() => toggleSection("company-info")}
            >
              {companyName ? (
                <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" }}>
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.orange + "15", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                    <Feather name="home" size={16} color={Colors.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Company</Text>
                    <Text style={{ color: Colors.cardText, fontSize: 16, fontWeight: "600", marginTop: 2 }}>{companyName}</Text>
                  </View>
                </View>
              ) : null}

              {fullAddress ? (
                <View style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, borderBottomWidth: totalRelated > 0 ? 1 : 0, borderBottomColor: "rgba(255,255,255,0.05)" }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                    <Feather name="map-pin" size={14} color={Colors.orange} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Address</Text>
                    <Text style={{ color: Colors.cardText, fontSize: 14, marginTop: 2 }}>{fullAddress}</Text>
                  </View>
                </View>
              ) : null}

              {totalRelated > 0 ? (
                <View style={{ paddingVertical: 12 }}>
                  <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Related Records</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {projectCounts > 0 ? (
                      <View style={{ flex: 1, backgroundColor: Colors.green + "12", borderRadius: 10, padding: 12, alignItems: "center", borderWidth: 1, borderColor: Colors.green + "20" }}>
                        <Text style={{ color: Colors.green, fontSize: 20, fontWeight: "700" }}>{projectCounts}</Text>
                        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>Projects</Text>
                      </View>
                    ) : null}
                    {opmCounts > 0 ? (
                      <View style={{ flex: 1, backgroundColor: Colors.orange + "12", borderRadius: 10, padding: 12, alignItems: "center", borderWidth: 1, borderColor: Colors.orange + "20" }}>
                        <Text style={{ color: Colors.orange, fontSize: 20, fontWeight: "700" }}>{opmCounts}</Text>
                        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>Opps</Text>
                      </View>
                    ) : null}
                    {lemCounts > 0 ? (
                      <View style={{ flex: 1, backgroundColor: ACCENT_BLUE + "12", borderRadius: 10, padding: 12, alignItems: "center", borderWidth: 1, borderColor: ACCENT_BLUE + "20" }}>
                        <Text style={{ color: ACCENT_BLUE, fontSize: 20, fontWeight: "700" }}>{lemCounts}</Text>
                        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>Leads</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}

            </SectionCard>
          ) : null}

          <View style={st.aiSection}>
            <View style={st.aiSectionHeader}>
              <View style={st.aiIconWrap}>
                <Ionicons name="sparkles" size={14} color="#FFF" />
              </View>
              <Text style={st.aiSectionTitle}>AI Quick Actions</Text>
            </View>
            <Text style={st.aiSectionSub}>Tap to get instant AI-powered insights</Text>

            <View style={st.aiGrid}>
              {[
                {
                  icon: "layers",
                  label: "Related\nProjects",
                  gradient: GRADIENT_BLUE,
                  prompt: `Use the RM ONE portfolio data to find every project (PMM), opportunity (OPM), and lead (LEM) where the CRMContactLookup, ContactID, or any contact reference equals "${project.id}"${companyName ? ` or where the company is "${companyName}"` : ""}. List each match with its ID, name, status, and value. If none are found, say so explicitly. Do not ask me for the contact's name — use the contact ID "${project.id}" directly.`,
                },
                {
                  icon: "mail",
                  label: "Draft\nEmail",
                  gradient: GRADIENT_GREEN,
                  prompt: `Draft and send an email via AgentMail to ${contactName}${jobTitle ? ` (${jobTitle})` : ""}${companyName ? ` at ${companyName}` : ""} at ${email || "their email"}. Ask me what the email should be about before sending.`,
                },
                {
                  icon: "briefcase",
                  label: "Company\nAnalysis",
                  gradient: GRADIENT_ORANGE,
                  prompt: `Analyze our relationship with ${companyName || `the company linked to contact ID "${project.id}"`}. Search RM ONE data for all PMM/OPM/LEM records tied to this company or contact ID. Report total project count, total value, active vs closed status, and growth opportunities. If no data exists, state that clearly.`,
                },
                {
                  icon: "search",
                  label: "Enrich\nContact",
                  gradient: GRADIENT_RED,
                  prompt: `Research the contact record ${project.id} (${contactName}) and propose enriched details: likely full name, job title, company affiliation, and any public contact info. Cite sources.`,
                },
              ].map((action, i) => (
                <AiActionCard
                  key={i}
                  index={i}
                  icon={action.icon}
                  label={action.label}
                  gradient={action.gradient as [string, string]}
                  onPress={() => askAI(action.prompt)}
                />
              ))}
            </View>
          </View>
        </Animated.ScrollView>
        {loading && (
          <RmOneProcessing label="Loading project…" sublabel="FETCHING PROJECT DATA" />
        )}
      </View>
    );
  }

  return (
    <View style={[st.container, { paddingTop: Math.max(insets.top, 50) }]}>
      <Animated.View style={[st.headerBar, { opacity: headerOpacity }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.darkDeep }]} />
      </Animated.View>
      <View style={st.headerNav}>
        <Pressable style={st.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.cardText} />
        </Pressable>
        <Text style={st.headerTitle} numberOfLines={1}>{project.name}</Text>
        <Pressable
          style={st.aiHeaderBtn}
          onPress={() => askAI(`Give me a comprehensive AI analysis of project "${project.name}" (${project.id}). Include current status, team analysis, timeline health, risks, and recommendations.`)}
        >
          <Ionicons name="sparkles" size={14} color="#FFF" />
        </Pressable>
      </View>

      {/* Brief non-blocking note: the status list was refreshed on app
          foreground and it CHANGED vs what was on screen — a teammate saved
          edits mid-session. Auto-dismisses after ~4s (see showStageCfgNotice). */}
      {stageCfgNotice && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: Math.max(insets.top, 50) + 52,
            left: 24, right: 24, zIndex: 60,
            flexDirection: "row", alignItems: "center", gap: 8,
            backgroundColor: "rgba(15,25,35,0.92)",
            borderWidth: 0.5, borderColor: "rgba(255,255,255,0.18)",
            borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
            shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Ionicons name="sync-outline" size={14} color="#7DD3FC" />
          <Text style={{ flex: 1, fontFamily: "Inter_500Medium", fontSize: 12.5, lineHeight: 17, color: "#E2E8F0" }}>
            Status list updated by a teammate
          </Text>
        </View>
      )}

      <Animated.ScrollView
        style={[st.scroll, { opacity: fadeAnim }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {recordIsReadOnly && <RecordReadOnlyBanner reason={recordPermissions?.reason} />}
        {/* Hero */}
        <View style={st.heroCard}>
          <HeroBg accent={pc} />
          <View style={st.heroTop}>
            <View style={[st.phasePill, { backgroundColor: "rgba(15,25,35,0.08)", borderColor: Colors.cardBorderStrong }]}>
              <View style={[st.phaseDot, { backgroundColor: Colors.cardText }]} />
              <Text style={[st.phaseText, { color: Colors.textPrimary }]}>{project.phase || project.status}</Text>
            </View>
            <View style={[st.moduleBadge, { backgroundColor: mc + "20", borderColor: mc + "30", borderWidth: 1 }]}>
              <Text style={[st.moduleText, { color: mc }]}>{project.module}</Text>
            </View>
          </View>

          <Text style={st.heroName}>{project.name}</Text>
          <Text style={st.heroId}>{project.id}</Text>

          {project.company ? (
            <View style={st.companyRow}>
              <View style={st.companyIconWrap}>
                <Feather name="home" size={14} color={Colors.cardText} />
              </View>
              <Text style={st.companyText} numberOfLines={2}>{project.company}</Text>
            </View>
          ) : null}

          {(project.city || project.sector || project.bu) && (
            <View style={st.heroMeta}>
              {project.city ? (
                <View style={st.metaChip}>
                  <Feather name="map-pin" size={10} color={Colors.textSecondary} />
                  <Text style={st.metaText}>{project.city}</Text>
                </View>
              ) : null}
              {project.sector ? (
                <View style={st.metaChip}>
                  <Feather name="tag" size={10} color={Colors.textSecondary} />
                  <Text style={st.metaText}>{project.sector}</Text>
                </View>
              ) : null}
              {project.bu ? (
                <View style={st.metaChip}>
                  <Feather name="briefcase" size={10} color={Colors.textSecondary} />
                  <Text style={st.metaText}>{project.bu}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* ── Stage guidance tip (#137) ── admin-authored banner for the
            record's current stage; display-only, no gating. PMM/OPM/LEM only;
            null until the rules fetch resolves (renders nothing while loading,
            never flashes empty). */}
        <GuidanceBanner tip={guidanceTip} />

        {/* Stats Row */}
        {loading && project.allocations.length === 0 && project.healthScore < 0 ? (
          <View style={st.statsRow}>
            <SkeletonStatCard iconColor={Colors.green} />
            <SkeletonStatCard iconColor={ACCENT_BLUE} />
            <SkeletonStatCard iconColor={Colors.green} delay={200} />
          </View>
        ) : (
        <View style={st.statsRow}>
          {project.value > 0 && (
            <StatCard icon="dollar-sign" iconColor={Colors.green} label="Contract" value={fmtM(project.value)} />
          )}
          {project.module !== "LEM" && (
            <StatCard icon="users" iconColor={ACCENT_BLUE} label="Team" value={`${project.allocations.length}`} sub={avgAlloc > 0 ? `${avgAlloc}% avg` : undefined} />
          )}
          {project.healthScore >= 0 && (
            <StatCard icon="activity" iconColor={hc} label="Health" value={`${project.healthScore}%`} sub={healthLabel(project.healthScore)} />
          )}
          {project.probability > 0 && (
            <StatCard icon="target" iconColor={ACCENT_PURPLE} label="Win Prob" value={`${project.probability}%`} />
          )}
        </View>
        )}

        {loading && (
          <View style={{ height: 3, marginHorizontal: 16, marginBottom: 8, borderRadius: 2, backgroundColor: Colors.green + "20", overflow: "hidden" }}>
            <Animated.View style={{ height: "100%", width: "40%", backgroundColor: Colors.green, borderRadius: 2 }} />
          </View>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 10 }}>

        {project.healthScore >= 0 && (
          <SectionCard gridMode
            icon="activity" iconColor={hc} title={project.module === "OPM" ? "Opportunity Health" : project.module === "LEM" ? "Lead Health" : "Project Health"}
            badge={<View style={[st.healthPill, { backgroundColor: hc + "20" }]}><Text style={[st.healthPillText, { color: hc }]}>{healthLabel(project.healthScore)}</Text></View>}
            expanded={isExpanded("overview")}
            onToggle={() => toggleSection("overview")}
          >
            {/* Stack the issues UNDER the gauge instead of beside it. The
                detail-card is only ~330px wide on a typical phone; placing the
                130px gauge + issues in a row left only ~170px for the text,
                forcing each bullet to wrap onto multiple lines. Stacking gives
                every issue line the full card width to read on one or two
                lines. Mirrors the layout used in the AI chat health gauge. */}
            <View style={{ alignItems: "center", marginBottom: 4 }}>
              <HealthGauge score={project.healthScore} issues={project.healthIssues} size={140} />
            </View>
            <View style={{ marginTop: 4 }}>
              {project.healthIssues.length > 0 ? (
                project.healthIssues.map((issue, i) => {
                  const issueColors = ["#E03C3C", "#F87171", Colors.orange, "#F59E0B", "#FBBF24"];
                  const c = issueColors[i % issueColors.length];
                  return (
                    <View key={i} style={st.issueRow}>
                      <View style={[st.issueDot, { backgroundColor: c }]} />
                      <Text style={st.issueText}>{issue.text}</Text>
                      {issue.deduction > 0 && (
                        <View style={{
                          marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2,
                          borderRadius: 6, backgroundColor: c + "22",
                        }}>
                          <Text style={{
                            color: c, fontFamily: "Inter_700Bold", fontSize: 11,
                            letterSpacing: 0.3,
                          }}>
                            −{issue.deduction}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })
              ) : (
                <View style={st.issueRow}>
                  <View style={[st.issueDot, { backgroundColor: Colors.green }]} />
                  <Text style={[st.issueText, { color: Colors.green }]}>All checks passed</Text>
                </View>
              )}
            </View>

            <Pressable
              onPress={() => { setShowHealthMath(v => !v); Haptics.selectionAsync(); }}
              style={{
                marginTop: 12, flexDirection: "row", alignItems: "center", gap: 6,
                paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8,
                backgroundColor: "rgba(255,255,255,0.04)",
                borderWidth: 1, borderColor: Colors.border,
                alignSelf: "flex-start",
              }}
            >
              <Feather name="info" size={11} color={Colors.textMuted} />
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSecondary }}>
                How is {project.healthScore} calculated?
              </Text>
              <Feather name={showHealthMath ? "chevron-up" : "chevron-down"} size={12} color={Colors.textMuted} />
            </Pressable>

            {showHealthMath && (() => {
              const passed = project.healthChecks.filter(c => c.passed);
              const failed = project.healthChecks.filter(c => !c.passed);
              return (
                <View style={{
                  marginTop: 8, padding: 12, borderRadius: 10,
                  backgroundColor: Colors.cardBg,
                  borderWidth: 1, borderColor: Colors.cardBorder, gap: 6,
                }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.green, letterSpacing: 0.5, marginBottom: 2 }}>
                    WHAT'S WORKING ({passed.length})
                  </Text>
                  {passed.map((c, i) => {
                    const pts = c.displayPts ?? 0;
                    return (
                      <View key={`p${i}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                          <Feather name="check-circle" size={11} color={Colors.green} />
                          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11.5, color: Colors.cardText, flex: 1 }} numberOfLines={2}>
                            {c.label}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.green }}>+{pts}</Text>
                      </View>
                    );
                  })}
                  {passed.length === 0 && (
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, fontStyle: "italic" }}>
                      No checks have passed yet.
                    </Text>
                  )}

                  {failed.length > 0 && (
                    <>
                      <View style={{ height: 1, backgroundColor: Colors.cardBorder, marginVertical: 6 }} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: "#DC2626", letterSpacing: 0.5, marginBottom: 2 }}>
                        WHAT'S MISSING ({failed.length})
                      </Text>
                      {failed.map((c, i) => {
                        const pts = c.displayPts ?? 0;
                        return (
                          <View key={`f${i}`} style={{ gap: 6, marginBottom: 6, padding: 8, borderRadius: 8, backgroundColor: "rgba(248,113,113,0.08)", borderWidth: 1, borderColor: "rgba(248,113,113,0.35)" }}>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                                <Feather name="x-circle" size={12} color="#DC2626" />
                                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.cardText, flex: 1 }} numberOfLines={2}>
                                  {c.failText || c.label}
                                </Text>
                              </View>
                              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "#DC2626" }}>−{pts} lost</Text>
                            </View>
                            {c.hint && (
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11.5, color: "rgba(15,25,35,0.72)", lineHeight: 16, paddingLeft: 18 }}>
                                {c.hint}
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </>
                  )}

                  <View style={{ height: 1, backgroundColor: Colors.cardBorder, marginVertical: 4 }} />
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: hc }}>Total score</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: hc }}>= {project.healthScore} / 100</Text>
                  </View>
                </View>
              );
            })()}
          </SectionCard>
        )}

        {/* ── Project Details + Key Personnel (combined) ──────────────── */}
        {project && (
          <SectionCard gridMode
            icon="layers" iconColor={ACCENT_PURPLE}
            title={project.module === "LEM" ? "Lead Details" : project.module === "OPM" ? "Opportunity Details" : "Project Details"}
            badge={project.keyPersonnel.length > 0 ? (
              <View style={st.countBadge}><Text style={st.countText}>{project.keyPersonnel.length}</Text></View>
            ) : undefined}
            expanded={isExpanded("details")}
            onToggle={() => toggleSection("details")}
          >
            <View style={st.detailsGrid}>
              {/* STATUS — schedule-aware: shows only the record's own lifecycle
                  phases when a lifecycle is assigned (same tri-state as web:
                  null=loading→full list, []=confirmed none, string[]=phases).
                  computedStatusOptions (useMemo above) always reflect the
                  latest schedulePhases in StageStep order — skipping any
                  tenant-workflow re-sort when schedule phases are the source. */}
              <DetailCell
                label="Status"
                value={project.status}
                onEdit={canAdvanceStages ? () => openEdit({
                  label: "Status",
                  fieldName: project.module === "OPM" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice",
                  type: "select",
                  // Pass the live options at open-time so the initial list is
                  // correct; the modal also reads computedStatusOptions directly
                  // for live updates while it's open (see modal render below).
                  options: computedStatusOptions,
                  current: project.status === "—" ? "" : project.status,
                }) : undefined}
              />
              <DetailCell label="Module" value={project.module} />
              {project.bu ? <DetailCell label="Business Unit" value={project.bu} /> : null}
              {project.company ? <DetailCell label="Company" value={project.company} /> : null}
              {project.city ? <DetailCell label="Location" value={project.city} /> : null}
              {(canEditData || (project.sector && project.sector !== "—")) ? (
                <DetailCell label="Sector" value={project.sector === "—" ? "" : project.sector}
                  onEdit={canEditData ? () => openEdit({ label: "Sector", fieldName: "SectorChoice", type: "select", options: sectorOptions, current: project.sector === "—" ? "" : project.sector }) : undefined} />
              ) : null}
              {/* Workflow Type — read-only on mobile: assigning it can be
                  limited to specific user groups (#121), and that picker
                  (with group filtering) lives on the web record page. The
                  server rejects restricted writes from any client anyway. */}
              {(() => {
                const wf = String((project.rawFields as Record<string, unknown> | undefined)?.WorkflowTypeName ?? "").trim();
                return wf ? <DetailCell label="Workflow Type" value={wf} /> : null;
              })()}
              {/* Show Contract Value whenever the user can edit financials (even
                  when the current value is zero/blank) — mirrors the web gate:
                  (canEditFinancialFields || project.value > 0). */}
              {(canEditFinancials || project.value > 0) && (
              <DetailCell
                label="Contract Value"
                value={project.value > 0 ? fmtM(project.value) : "—"}
                color={project.value > 0 ? Colors.green : Colors.textMuted}
                onEdit={canEditFinancials ? () => openEdit({ label: "Contract Value", fieldName: "ContractValue", type: "number", options: [], current: project.value > 0 ? String(project.value) : "" }) : undefined}
                onHistory={canViewFinancialHistory ? () => setShowValueHistory(true) : undefined}
              />
              )}
              <DetailCell
                label="Labor Contract"
                value={project.laborValue > 0 ? fmtM(project.laborValue) : "—"}
                color={project.laborValue > 0 ? Colors.green : Colors.textMuted}
                onEdit={canEditFinancials ? () => openEdit({ label: "Labor Contract", fieldName: "LaborContractAmount", type: "number", options: [], current: project.laborValue > 0 ? String(project.laborValue) : "" }) : undefined}
                onHistory={canViewFinancialHistory ? () => setShowValueHistory(true) : undefined}
              />
              {project.probability > 0 ? <DetailCell label="Win Probability" value={`${project.probability}%`} color={ACCENT_PURPLE} /> : null}
              {(() => {
                const raw = project.rawFields;
                const sv = (v: unknown): string => (v != null && String(v).trim() ? String(v).trim() : "");
                if (project.module === "LEM") {
                  const urgency = sv(raw.Urgency) || sv(raw.UrgencyChoice);
                  const priority = sv(raw.LeadPriority) || sv(raw.Priority) || sv(raw.LeadPriorityChoice);
                  const score = sv(raw.Score) || sv(raw.LeadScore);
                  const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
                  const netRentable = sv(raw.NetRentableSqFt) || sv(raw.NetRentableSF) || sv(raw.SquareFeet) || sv(raw.SQFT);
                  const contactLookup = sv(raw.ContactLookup) || sv(raw.CRMContactLookup) || sv(raw.Contact);
                  const estStartDate = sv(raw.EstimatedStartDate) || sv(raw.EstStartDate);
                  const createdOn = sv(raw.Created) || sv(raw.CreationDate);
                  return (<>
                    {urgency ? <DetailCell label="Urgency" value={urgency} color={urgency.toLowerCase().includes("hot") ? "#F87171" : urgency.toLowerCase().includes("warm") ? Colors.orange : ACCENT_BLUE} /> : null}
                    {priority ? <DetailCell label="Lead Priority" value={priority} color={priority.toLowerCase() === "high" ? "#F87171" : priority.toLowerCase() === "medium" ? Colors.orange : undefined} /> : null}
                    {score ? <DetailCell label="Score" value={score} color={Colors.green} /> : null}
                    {projectType ? <DetailCell label="Project Type" value={projectType} /> : null}
                    {netRentable ? <DetailCell label="Net Rentable Sq Ft" value={Number(netRentable).toLocaleString()} /> : null}
                    {contactLookup ? <DetailCell label="Contact" value={contactLookup} /> : null}
                    {estStartDate ? <DetailCell label="Est. Start Date" value={fmtDate(estStartDate) || estStartDate.slice(0, 10)} /> : null}
                    {createdOn ? <DetailCell label="Created" value={fmtDate(createdOn) || createdOn.slice(0, 10)} /> : null}
                  </>);
                }
                if (project.module === "OPM") {
                  const bidDate = sv(raw.BidDate) || sv(raw.BidDueDate);
                  const stage = sv(raw.CRMOpportunityStatusChoice) || sv(raw.Stage) || sv(raw.StageChoice);
                  const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
                  const successChance = sv(raw.SuccessChance) || sv(raw.ChanceofSuccessChoice);
                  const cmicNumber = sv(raw.CMICProjectNumber) || sv(raw.CMICNumber) || sv(raw.CMIC);
                  const targetStart = sv(raw.TargetStartDate);
                  const targetEnd = sv(raw.TargetCompletionDate);
                  // Schedule-derived dates win over the raw record fields —
                  // keeps these cells consistent with the Project Schedule card.
                  const actualStart = sv(project.scheduleStart) || sv(raw.ActualStartDate);
                  const actualEnd = sv(project.scheduleEnd) || sv(raw.ActualCompletionDate);
                  const createdOn = sv(raw.Created) || sv(raw.CreationDate);
                  return (<>
                    {stage ? <DetailCell label="Stage" value={stage} /> : null}
                    {projectType ? <DetailCell label="Project Type" value={projectType} /> : null}
                    {successChance ? <DetailCell label="Success Chance" value={`${successChance}%`} color={ACCENT_PURPLE} /> : null}
                    {bidDate ? <DetailCell label="Bid Date" value={fmtDate(bidDate) || bidDate.slice(0, 10)} /> : null}
                    {cmicNumber ? <DetailCell label="CMIC #" value={cmicNumber} /> : null}
                    {targetStart ? <DetailCell label="Target Start" value={fmtDate(targetStart) || targetStart.slice(0, 10)} /> : null}
                    {targetEnd ? <DetailCell label="Target Completion" value={fmtDate(targetEnd) || targetEnd.slice(0, 10)} /> : null}
                    {actualStart ? <DetailCell label="Schedule Start" value={fmtDate(actualStart) || actualStart.slice(0, 10)} color="#E87722" /> : null}
                    {actualEnd ? <DetailCell label="Schedule End" value={fmtDate(actualEnd) || actualEnd.slice(0, 10)} color="#E87722" /> : null}
                    {createdOn ? <DetailCell label="Created" value={fmtDate(createdOn) || createdOn.slice(0, 10)} /> : null}
                  </>);
                }
                const cmicEs = sv(raw.CMIC_ES_Number) || sv(raw.CMICESNumber);
                const cmicNumber = sv(raw.CMICProjectNumber) || sv(raw.CMICNumber) || sv(raw.CMIC);
                const projExec = sv(raw.ProjectExec) || sv(raw.ProjectExecutive);
                const createdOn = sv(raw.Created) || sv(raw.CreationDate);
                return (<>
                  {cmicEs ? <DetailCell label="CMIC ES #" value={cmicEs} /> : null}
                  {cmicNumber ? <DetailCell label="CMIC #" value={cmicNumber} /> : null}
                  {projExec ? <DetailCell label="Project Exec" value={projExec} /> : null}
                  {createdOn ? <DetailCell label="Created" value={fmtDate(createdOn) || createdOn.slice(0, 10)} /> : null}
                </>);
              })()}
            </View>

            {project.keyPersonnel.length > 0 && (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 8 }}>
                  <Feather name="award" size={13} color={ACCENT_AMBER} />
                  <Text style={{ color: ACCENT_AMBER, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 }}>KEY PERSONNEL</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {project.keyPersonnel.map((kp, idx) => {
                    const initials = kp.name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map(p => p[0]?.toUpperCase() ?? "")
                      .join("");
                    const color = ALLOC_COLORS[idx % ALLOC_COLORS.length];
                    return (
                      <View
                        key={`${kp.role}-${kp.guid}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                          padding: 10,
                          backgroundColor: "rgba(255,255,255,0.03)",
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: Colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 36, height: 36, borderRadius: 18,
                            backgroundColor: color + "33",
                            alignItems: "center", justifyContent: "center",
                            borderWidth: 1, borderColor: color,
                          }}
                        >
                          <Text style={{ color, fontWeight: "700", fontSize: 12 }}>{initials || "?"}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                            {kp.name}
                          </Text>
                          <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                            {kp.role}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </SectionCard>
        )}

        {/* ── Additional Information (onboarding extra columns) ── */}
        {(() => {
          const rawExtra = (project.rawFields?.ExtraFields ?? []) as Array<{ label?: unknown; value?: unknown }>;
          const items = Array.isArray(rawExtra)
            ? rawExtra
                .map((e) => ({ label: String(e?.label ?? "").trim(), value: String(e?.value ?? "").trim() }))
                .filter((e) => e.label && e.value)
            : [];
          if (items.length === 0) return null;
          return (
            <SectionCard gridMode
              icon="layers" iconColor={ACCENT_AMBER} title="Additional Information"
              expanded={isExpanded("additional")}
              onToggle={() => toggleSection("additional")}
            >
              <View style={st.detailsGrid}>
                {items.map((e, i) => (
                  <DetailCell key={`extra-${i}-${e.label}`} label={e.label} value={e.value} />
                ))}
              </View>
            </SectionCard>
          );
        })()}

        {/* ── Project Schedule ──────────────────────── */}
        {project.module !== "LEM" && (
          <SectionCard gridMode
            icon="calendar" iconColor={Colors.orange} title="Project Schedule"
            expanded={isExpanded("timeline")}
            onToggle={() => toggleSection("timeline")}
          >
            {project.bidDate && (
              <View style={st.bidDateRow}>
                <Feather name="flag" size={12} color={ACCENT_BLUE} />
                <Text style={st.bidDateLabel}>Bid Due</Text>
                <Text style={st.bidDateValue}>{fmtDate(project.bidDate)}</Text>
              </View>
            )}

            {(project.module === "PMM" || project.module === "OPM") && (
              <SchedulePhases ticketId={id!} module={project.module} project={project} onRefresh={loadProject} canEdit={canEditData} parentLcAssigned={!!(project.rawFields?.ProjectLifeCycleLookup && String(project.rawFields.ProjectLifeCycleLookup).trim() !== "" && String(project.rawFields.ProjectLifeCycleLookup) !== "0" && String(project.rawFields.ProjectLifeCycleLookup) !== "false")} />
            )}
          </SectionCard>
        )}

        {/* ── Business Units ──────────────────────── */}
        {(project.module === "PMM" || project.module === "OPM") && (
          <SectionCard gridMode
            icon="grid" iconColor={Colors.orange} title="Business Units"
            expanded={isExpanded("businessUnits")}
            onToggle={() => toggleSection("businessUnits")}
          >
            <BusinessUnitsSection ticketId={id!} />
          </SectionCard>
        )}

        {/* ── Budget & Costs ──────────────────────── */}
        {/* Only PMM has real cost tracking. LEM/OPM only have an estimated ContractValue
            (already shown at the top), no actual budget or cost-to-date. */}
        {project.module === "PMM" && (
          <SectionCard gridMode
            icon="dollar-sign" iconColor={ACCENT_AMBER} title="Budget & Costs"
            expanded={isExpanded("budget")}
            onToggle={() => toggleSection("budget")}
          >
            <BudgetSection ticketId={id!} contractValue={project.value} allocations={project.allocations} />
          </SectionCard>
        )}

        {/* ── Project Team ──────────────────────── */}
        {/* Leads (LEM) don't carry a project team in RM ONE. Opportunities (OPM)
            DO carry a team in the web portal — shown with NC Cost / NC Hrs / EAC
            Hrs columns — so we render the same section for OPM too. */}
        {project && project.module !== "LEM" && (
          <SectionCard gridMode
            icon="users" iconColor={Colors.green} title="Project Team"
            badge={<View style={st.countBadge}><Text style={st.countText}>{project.allocations.length + openSlots.length}</Text></View>}
            expanded={isExpanded("team")}
            onToggle={() => toggleSection("team")}
          >
            {loading && project.allocations.length === 0 && openSlots.length === 0 ? (
              <View style={st.emptyState}>
                <ActivityIndicator size="small" color={Colors.green} />
                <Text style={[st.emptyDesc, { marginTop: 8 }]}>Loading team…</Text>
              </View>
            ) : project.allocations.length === 0 && openSlots.length === 0 ? (
              project.module === "LEM" ? (
                <View style={st.emptyState}>
                  <Feather name="users" size={28} color={Colors.textMuted} />
                  <Text style={st.emptyTitle}>No Project Team</Text>
                  <Text style={st.emptyDesc}>
                    Leads don't have a project team assigned. A team is built once the lead converts to an opportunity and is awarded.
                  </Text>
                </View>
              ) : (
                <View style={st.emptyState}>
                  <Feather name="user-x" size={28} color={Colors.textMuted} />
                  <Text style={st.emptyTitle}>No Team Assigned</Text>
                  <Text style={st.emptyDesc}>Tap below to find available staff</Text>
                  <Pressable
                    style={st.emptyActionBtn}
                    onPress={() => askAI(`Find available staff for project "${project.name}" (${project.id}). Show the best candidates.`)}
                  >
                    <Feather name="user-plus" size={13} color="#FFF" />
                    <Text style={st.emptyActionText}>Find Staff with AI</Text>
                  </Pressable>
                </View>
              )
            ) : (
              <>
                <View style={st.tmResourceCount}>
                  <Feather name="users" size={13} color={Colors.green} />
                  <Text style={st.tmResourceCountText}>
                    {project.allocations.length} working
                    {openSlots.length > 0 ? ` · ${openSlots.length} open` : ""}.
                  </Text>
                </View>

                <View style={st.tmActionRow}>
                  {canManageStaff && (
                    <Pressable style={[st.tmNotifyBtn, { backgroundColor: Colors.green }]} onPress={() => { auditOpen({ entityType: "project", entityId: project.id }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowAddMember(true); }}>
                      <Feather name="user-plus" size={12} color="#FFF" />
                      <Text style={st.tmNotifyText}>Add Member</Text>
                    </Pressable>
                  )}
                  <Pressable style={st.tmManageBtn} onPress={() => askAI(`Analyze team allocation for project "${project.name}" (${project.id}). Who is under or over-allocated? Recommend changes.`)}>
                    <Ionicons name="sparkles" size={12} color="#FFF" />
                    <Text style={st.tmManageText}>Manage with AI</Text>
                  </Pressable>
                  {/* Show / hide the ETC/EAC hour + cost figures — persisted
                      per tenant, same behavior as the web grid's toggle. */}
                  <Pressable
                    onPress={() => { toggleEtcEac(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 5,
                      paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
                      backgroundColor: Colors.panel, borderWidth: 1, borderColor: Colors.border,
                    }}
                  >
                    <Feather name={showEtcEac ? "eye-off" : "eye"} size={12} color={Colors.textSoft} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSoft }}>
                      {showEtcEac ? "Hide ETC/EAC" : "Show ETC/EAC"}
                    </Text>
                  </Pressable>
                </View>
                {!canManageStaff && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignSelf: "flex-start" }}>
                    <Feather name="lock" size={11} color={Colors.textMuted} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textMuted }}>View only</Text>
                  </View>
                )}

                {project.allocations.length > 0 && (
                  <>
                    <View style={st.tmSearchWrap}>
                      <Feather name="search" size={14} color={Colors.textMuted} />
                      <AppTextInput
                        style={st.tmSearchInput}
                        placeholder="Search team member..."
                        placeholderTextColor={Colors.textMuted}
                        value={teamSearch}
                        onChangeText={setTeamSearch}
                      />
                      {teamSearch.length > 0 && (
                        <Pressable onPress={() => setTeamSearch("")}><Feather name="x" size={14} color={Colors.textMuted} /></Pressable>
                      )}
                    </View>

                    <TeamMemberList
                      allocations={project.allocations}
                      onEdit={(a) => { auditOpen({ entityType: "project", entityId: project.id }); setEditAlloc(a); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      searchQuery={teamSearch}
                      canEdit={canManageStaff}
                      showEtcEac={showEtcEac}
                      onReactivated={async (userGuid) => {
                        setProject(prev => ({
                          ...prev,
                          allocations: prev.allocations.map(a => a.resourceId?.toLowerCase() === userGuid.toLowerCase() ? { ...a, enabled: true } : a),
                        }));
                        await loadProject(true);
                      }}
                    />
                  </>
                )}

                {/* Open Roles — unfilled allocation slots from RM ONE demand
                    rows for this ticket. Tapping Assign opens the picker
                    pre-filled with the slot's BU / role / dates / pct so
                    the user just picks a person and saves. */}
                {openSlots.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                      <Feather name="user-x" size={13} color={Colors.orange} />
                      <Text style={{ marginLeft: 6, fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.textPrimary, letterSpacing: 0.3 }}>
                        OPEN ROLES ({openSlots.length})
                      </Text>
                    </View>
                    {openSlots.map((slot, idx) => {
                      const roleLabel = slot.role || "Open Role";
                      const buShort = slot.bu || "";
                      const titleLabel = slot.title && slot.title !== slot.role ? slot.title : "";
                      const start = slot.startDate ? slot.startDate.slice(0, 10) : "";
                      const end = slot.endDate ? slot.endDate.slice(0, 10) : "";
                      const dateRange = start && end ? `${fmtDateShort(start)} – ${fmtDateShort(end)}` : (start || end || "");
                      return (
                        <View key={`open-${idx}`} style={{ flexDirection: "row", alignItems: "center", padding: 12, marginBottom: 8, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.orange + "40" }}>
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.textPrimary }}>{roleLabel}</Text>
                            {titleLabel ? <Text style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 1, fontFamily: "Inter_500Medium" }}>{titleLabel}</Text> : null}
                            <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 3, fontFamily: "Inter_500Medium" }}>
                              {buShort ? `${buShort} · ` : ""}{slot.pct > 0 ? fmtPct(slot.pct) : "—"}{slot.eacHrs > 0 ? ` · ${fmtHours(slot.eacHrs)}h` : ""}{dateRange ? ` · ${dateRange}` : ""}
                            </Text>
                          </View>
                          {canManageStaff && (
                            <Pressable
                              onPress={() => { auditOpen({ entityType: "project", entityId: project.id }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAssignSlot(slot); }}
                              style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.green, borderRadius: 8 }}
                            >
                              <Feather name="user-plus" size={12} color="#FFF" />
                              <Text style={{ marginLeft: 6, color: "#FFF", fontFamily: "Inter_700Bold", fontSize: 12 }}>Assign</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </SectionCard>
        )}

        </View>{/* end section cards grid */}

        {/* Details (legacy - hidden, merged into top section) */}
        {false && (
        <SectionCard
          icon="layers" iconColor={ACCENT_PURPLE} title={project.module === "LEM" ? "Lead Details" : project.module === "OPM" ? "Opportunity Details" : "Project Details"}
          expanded={isExpanded("details")}
          onToggle={() => toggleSection("details")}
        >
          <View style={st.detailsGrid}>
            <DetailCell label="Status" value={project.status} color={pc} />
            <DetailCell label="Module" value={project.module} color={mc} />
            {project.bu ? <DetailCell label="Business Unit" value={project.bu} /> : null}
            {project.company ? <DetailCell label="Company" value={project.company} /> : null}
            {project.city ? <DetailCell label="Location" value={project.city} /> : null}
            {project.sector ? <DetailCell label="Sector" value={project.sector} /> : null}
            <DetailCell
              label="Contract Value"
              value={project.value > 0 ? fmtM(project.value) : "—"}
              color={project.value > 0 ? Colors.green : Colors.textMuted}
            />
            <DetailCell
              label="Labor Contract"
              value={project.laborValue > 0 ? fmtM(project.laborValue) : "—"}
              color={project.laborValue > 0 ? Colors.green : Colors.textMuted}
            />
            {project.probability > 0 ? <DetailCell label="Win Probability" value={`${project.probability}%`} color={ACCENT_PURPLE} /> : null}
            {(() => {
              const raw = project.rawFields;
              const sv = (v: unknown): string => (v != null && String(v).trim() ? String(v).trim() : "");
              if (project.module === "LEM") {
                const urgency = sv(raw.Urgency) || sv(raw.UrgencyChoice);
                const priority = sv(raw.LeadPriority) || sv(raw.Priority) || sv(raw.LeadPriorityChoice);
                const score = sv(raw.Score) || sv(raw.LeadScore);
                const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
                const netRentable = sv(raw.NetRentableSqFt) || sv(raw.NetRentableSF) || sv(raw.SquareFeet) || sv(raw.SQFT);
                const contactLookup = sv(raw.ContactLookup) || sv(raw.CRMContactLookup) || sv(raw.Contact);
                const estStartDate = sv(raw.EstimatedStartDate) || sv(raw.EstStartDate);
                const createdOn = sv(raw.Created) || sv(raw.CreationDate);
                return (<>
                  {urgency ? <DetailCell label="Urgency" value={urgency} color={urgency.toLowerCase().includes("hot") ? "#F87171" : urgency.toLowerCase().includes("warm") ? Colors.orange : ACCENT_BLUE} /> : null}
                  {priority ? <DetailCell label="Lead Priority" value={priority} color={priority.toLowerCase() === "high" ? "#F87171" : priority.toLowerCase() === "medium" ? Colors.orange : undefined} /> : null}
                  {score ? <DetailCell label="Score" value={score} color={Colors.green} /> : null}
                  {projectType ? <DetailCell label="Project Type" value={projectType} /> : null}
                  {netRentable ? <DetailCell label="Net Rentable Sq Ft" value={Number(netRentable).toLocaleString()} /> : null}
                  {contactLookup ? <DetailCell label="Contact" value={contactLookup} /> : null}
                  {estStartDate ? <DetailCell label="Est. Start Date" value={estStartDate.slice(0, 10)} /> : null}
                  {createdOn ? <DetailCell label="Created" value={createdOn.slice(0, 10)} /> : null}
                </>);
              }
              if (project.module === "OPM") {
                const bidDate = sv(raw.BidDate) || sv(raw.BidDueDate);
                const stage = sv(raw.CRMOpportunityStatusChoice) || sv(raw.Stage) || sv(raw.StageChoice);
                const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
                const successChance = sv(raw.SuccessChance) || sv(raw.ChanceofSuccessChoice);
                const cmicNumber = sv(raw.CMICProjectNumber) || sv(raw.CMICNumber) || sv(raw.CMIC);
                const targetStart = sv(raw.TargetStartDate);
                const targetEnd = sv(raw.TargetCompletionDate);
                // Schedule-derived dates win over the raw record fields —
                // keeps these cells consistent with the Project Schedule card.
                const actualStart = sv(project.scheduleStart) || sv(raw.ActualStartDate);
                const actualEnd = sv(project.scheduleEnd) || sv(raw.ActualCompletionDate);
                const createdOn = sv(raw.Created) || sv(raw.CreationDate);
                return (<>
                  {stage ? <DetailCell label="Stage" value={stage} /> : null}
                  {projectType ? <DetailCell label="Project Type" value={projectType} /> : null}
                  {successChance ? <DetailCell label="Success Chance" value={`${successChance}%`} color={ACCENT_PURPLE} /> : null}
                  {bidDate ? <DetailCell label="Bid Date" value={bidDate.slice(0, 10)} /> : null}
                  {cmicNumber ? <DetailCell label="CMIC #" value={cmicNumber} /> : null}
                  {targetStart ? <DetailCell label="Target Start" value={targetStart.slice(0, 10)} /> : null}
                  {targetEnd ? <DetailCell label="Target Completion" value={targetEnd.slice(0, 10)} /> : null}
                  {actualStart ? <DetailCell label="Schedule Start" value={fmtDate(actualStart) || actualStart.slice(0, 10)} color="#E87722" /> : null}
                  {actualEnd ? <DetailCell label="Schedule End" value={fmtDate(actualEnd) || actualEnd.slice(0, 10)} color="#E87722" /> : null}
                  {createdOn ? <DetailCell label="Created" value={createdOn.slice(0, 10)} /> : null}
                </>);
              }
              const cmicEs = sv(raw.CMIC_ES_Number) || sv(raw.CMICESNumber);
              const cmicNumber = sv(raw.CMICProjectNumber) || sv(raw.CMICNumber) || sv(raw.CMIC);
              const projExec = sv(raw.ProjectExec) || sv(raw.ProjectExecutive);
              const createdOn = sv(raw.Created) || sv(raw.CreationDate);
              return (<>
                {cmicEs ? <DetailCell label="CMIC ES #" value={cmicEs} /> : null}
                {cmicNumber ? <DetailCell label="CMIC #" value={cmicNumber} /> : null}
                {projExec ? <DetailCell label="Project Exec" value={projExec} /> : null}
                {createdOn ? <DetailCell label="Created" value={createdOn.slice(0, 10)} /> : null}
              </>);
            })()}
          </View>
        </SectionCard>
        )}

        {/* AI Quick Actions — hidden for leads (LEM) per client request */}
        {project.module !== "LEM" && (
        <View style={st.aiSection}>
          <View style={st.aiSectionHeader}>
            <View style={st.aiIconWrap}>
              <Ionicons name="sparkles" size={14} color="#FFF" />
            </View>
            <Text style={st.aiSectionTitle}>AI Quick Actions</Text>
          </View>
          <Text style={st.aiSectionSub}>Tap to get instant AI-powered insights</Text>

          <View style={st.aiGrid}>
            {(project.module === "LEM" ? [
              {
                icon: "file-text",
                label: "Lead\nSummary",
                gradient: GRADIENT_GREEN,
                prompt: `Give me a comprehensive summary of lead "${project.name}" (${project.id}). Include status, company, urgency, priority, estimated value, project type, and any related contacts or projects.`,
              },
              {
                icon: "briefcase",
                label: "Company\nProfile",
                gradient: GRADIENT_BLUE,
                prompt: `Tell me about the company associated with lead "${project.name}" (${project.id}). What's our history with them? How many projects, opportunities, and leads do we have? What's the total relationship value?`,
              },
              {
                icon: "target",
                label: "Conversion\nStrategy",
                gradient: GRADIENT_RED,
                prompt: `Analyze lead "${project.name}" (${project.id}) and suggest a conversion strategy. What's the urgency, priority, and value? Who should be the point of contact? What similar leads have we won before?`,
              },
              {
                icon: "mail",
                label: "Draft\nOutreach",
                gradient: GRADIENT_ORANGE,
                prompt: `Draft an outreach email for lead "${project.name}" (${project.id}) via AgentMail. Look up the contact and company details, then ask me what angle to take before drafting.`,
              },
            ] : project.module === "OPM" ? [
              {
                icon: "file-text",
                label: "Opp.\nSummary",
                gradient: GRADIENT_GREEN,
                prompt: `Give me a comprehensive summary of opportunity "${project.name}" (${project.id}). Include stage, bid date, estimated value, win probability, company, and team assigned.`,
              },
              {
                icon: "user-plus",
                label: "Find\nStaff",
                gradient: GRADIENT_BLUE,
                prompt: `Find available staff for opportunity "${project.name}" (${project.id}). Show best candidates from the bench with name, title, current allocation %, and why they're a good fit.`,
              },
              {
                icon: "target",
                label: "Win\nStrategy",
                gradient: GRADIENT_RED,
                prompt: `Analyze opportunity "${project.name}" (${project.id}) and provide a win strategy. What's the competition like? What similar projects have we won? What's our win rate for this client and sector?`,
              },
              {
                icon: "alert-triangle",
                label: "Risk\nAnalysis",
                gradient: GRADIENT_ORANGE,
                prompt: `Perform a risk analysis for opportunity "${project.name}" (${project.id}). Identify bid risks, staffing gaps, and competitive threats. Rate each risk as High/Medium/Low with mitigations.`,
              },
            ] : [
              {
                icon: "file-text",
                label: "Status\nReport",
                gradient: GRADIENT_GREEN,
                prompt: `Give me a comprehensive status report for project "${project.name}" (${project.id}). Include phase, timeline progress, budget, team composition, and key metrics. Format with clear sections.`,
              },
              {
                icon: "user-plus",
                label: "Find\nStaff",
                gradient: GRADIENT_BLUE,
                prompt: `Find available staff for project "${project.name}" (${project.id}). Show best candidates from the bench with name, title, current allocation %, and why they're a good fit. Prioritize by relevance.`,
              },
              {
                icon: "alert-triangle",
                label: "Risk\nReview",
                gradient: GRADIENT_RED,
                prompt: `Perform a risk analysis for project "${project.name}" (${project.id}). Identify staffing gaps, schedule risks, budget concerns, and missing data. Rate each risk as High/Medium/Low and suggest mitigations.`,
              },
              {
                icon: "clock",
                label: "Timeline\nImpact",
                gradient: GRADIENT_ORANGE,
                prompt: `Analyze what happens if project "${project.name}" (${project.id}) is delayed by 2 months. Which team members are affected? What downstream impacts on other projects? Quantify the impact.`,
              },
            ]).map((action, i) => (
              <AiActionCard
                key={i}
                index={i}
                icon={action.icon}
                label={action.label}
                gradient={action.gradient as [string, string]}
                onPress={() => askAI(action.prompt)}
              />
            ))}
          </View>
        </View>
        )}
        <MobileAuditTrail entityId={project.id} entityType={project.module === "PMM" ? "project" : project.module === "OPM" ? "opportunity" : "lead"} />
      </Animated.ScrollView>

      {editAlloc && project && (() => {
        const dupNames = new Map<string, number>();
        for (const a of project.allocations) dupNames.set(a.name.toLowerCase(), (dupNames.get(a.name.toLowerCase()) ?? 0) + 1);
        const isEditAllocDup = (dupNames.get(editAlloc.name.toLowerCase()) ?? 0) > 1;
        return (
          <SharedEditAllocationModal
            person={{ name: editAlloc.name, role: editAlloc.role, pct: editAlloc.pct, resourceId: editAlloc.resourceId, disambiguator: isEditAllocDup ? buildDisambiguator(editAlloc) : undefined }}
            projectId={project.id}
            canManageStaff={canManageStaff}
            onClose={() => { auditClose({ entityType: "project", entityId: project.id }); setEditAlloc(null); }}
            onSaved={() => { auditAction({ entityType: "project", entityId: project.id }); setEditAlloc(null); loadProject(true); }}
          />
        );
      })()}
      {project && (() => {
        // The same modal serves two flows:
        //  1. "Add Member" button — blank form
        //  2. "Assign…" on an open demand slot — prefilled with the
        //     slot's BU / role / dates / pct (slot.Role looks like
        //     "MEP - Senior MEP Manager" so we peel the BU short
        //     from the prefix).
        const slot = assignSlot;
        return (
          <AddTeamMemberModal
            visible={showAddMember || !!slot}
            onClose={() => { auditClose({ entityType: "project", entityId: project.id }); setShowAddMember(false); setAssignSlot(null); }}
            projectId={project.id}
            projectName={project.name}
            module={project.module}
            projectStartDate={(project.targetStart || new Date().toISOString()).slice(0, 10)}
            projectEndDate={(project.targetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
            existingAllocations={project.allocations
              .filter(a => a.resourceId)
              .map(a => ({
                personId: a.resourceId!, bu: a.bu || "", role: a.role || "", title: a.title || "", hours: a.eacHrs || 0,
                // Merge refs (duplicate add → edit of the existing assignment).
                allocationId: a.rwiId ?? undefined, startDate: a.startDate || undefined, endDate: a.endDate || undefined,
              }))}
            onAssigned={async (name, resourceId) => {
              auditAction({ entityType: "project", entityId: project.id });
              setShowAddMember(false);
              setAssignSlot(null);
              await loadProject(true);
              setPendingWeeklyAllocName({ name, resourceId });
            }}
            prefillBuShort={slot?.bu}
            prefillRole={slot?.role}
            prefillTitle={slot?.title || slot?.role}
            prefillStartDate={slot?.startDate ? slot.startDate.slice(0, 10) : undefined}
            prefillEndDate={slot?.endDate ? slot.endDate.slice(0, 10) : undefined}
            prefillPct={slot?.pct}
            prefillAllocationId={slot?.allocationId}
            prefillTypeGuid={slot?.typeGuid}
            prefillGroupId={slot?.groupId}
            canManageStaff={canManageStaff}
          />
        );
      })()}
      {pendingWeeklyAlloc && project && (() => {
        // Prefer GUID-first lookup to avoid opening the wrong editor when two
        // team members share the same display name. Fall back to name-only
        // (with a console warning) when the Add Member flow didn't return a
        // resourceId — e.g. the server response was ambiguous.
        const rid = pendingWeeklyAlloc.resourceId;
        const pname = pendingWeeklyAlloc.name;
        let match: Allocation | undefined;
        if (rid) {
          match = project.allocations.find(a => a.resourceId && a.resourceId.toLowerCase() === rid.toLowerCase());
          if (!match) {
            // GUID not in allocations yet (e.g. cache lag) — fall back to name
            console.warn("[EditAlloc] resourceId", rid, "not found in allocations; falling back to name lookup for", pname);
            match = project.allocations.find(a => a.name === pname);
          }
        } else {
          console.warn("[EditAlloc] No resourceId provided by AddTeamMemberModal; using name-only lookup for", pname, "— duplicate names may open the wrong editor");
          match = project.allocations.find(a => a.name === pname);
        }
        if (!match) return null;
        const dupNames2 = new Map<string, number>();
        for (const a of project.allocations) dupNames2.set(a.name.toLowerCase(), (dupNames2.get(a.name.toLowerCase()) ?? 0) + 1);
        const isPendingDup = (dupNames2.get(match.name.toLowerCase()) ?? 0) > 1;
        return (
          <SharedEditAllocationModal
            person={{ name: match.name, role: match.role, pct: match.pct, resourceId: match.resourceId, disambiguator: isPendingDup ? buildDisambiguator(match) : undefined }}
            projectId={project.id}
            canManageStaff={canManageStaff}
            onClose={() => { auditClose({ entityType: "project", entityId: project.id }); setPendingWeeklyAllocName(null); }}
            onSaved={() => { auditAction({ entityType: "project", entityId: project.id }); setPendingWeeklyAllocName(null); loadProject(true); }}
          />
        );
      })()}
      {showValueHistory && project && (
        <ValueHistoryModal
          recordId={project.id}
          onClose={() => setShowValueHistory(false)}
        />
      )}
      {editField && canOpenRecordEditModal(editField.fieldName, { canEditData, canEditFinancials }) && (
        <Modal visible transparent animationType="fade" onRequestClose={() => !editSaving && setEditField(null)}>
          <Pressable style={st.editModalBackdrop} onPress={() => !editSaving && setEditField(null)}>
            <Pressable style={st.editModalCard} onPress={(e) => e.stopPropagation()}>
              <View style={st.editModalHeader}>
                <Text style={st.editModalTitle}>Edit {editField.label}</Text>
                <Pressable onPress={() => !editSaving && setEditField(null)} hitSlop={10}>
                  <Feather name="x" size={20} color={Colors.textMuted} />
                </Pressable>
              </View>

              {editField.type === "select" ? (
                <>
                  {/* "No lifecycle assigned" hint — shown when schedule phases
                      are confirmed empty and options fell back to status list. */}
                  {schedulePhases !== null && schedulePhases.length === 0 && editField.fieldName !== "SectorChoice" && (
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(107,165,57,0.1)", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: Colors.green + "44" }}
                      onPress={() => { setEditField(null); toggleSection("timeline"); }}
                    >
                      <Feather name="calendar" size={14} color={Colors.green} />
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.green, flex: 1 }}>
                        Assign a lifecycle schedule to show phase-based statuses
                      </Text>
                      <Feather name="chevron-right" size={14} color={Colors.green} />
                    </Pressable>
                  )}
                  {/* No schedule = free-form statuses: adding statuses is a
                      first-class entry that lands straight in the add input
                      (mirrors the web's "+ Add statuses…" action row). */}
                  {canManageSettings && schedulePhases !== null && schedulePhases.length === 0 && editField.fieldName !== "SectorChoice" && (
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(107,165,57,0.06)", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: Colors.cardBorder }}
                      onPress={() => openOverrideEditor({ addStage: true })}
                    >
                      <Feather name="plus" size={14} color={Colors.green} />
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.green, flex: 1 }}>
                        Add statuses…
                      </Text>
                      <Feather name="chevron-right" size={14} color={Colors.green} />
                    </Pressable>
                  )}
                  <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                    {/* For the status field use the live computedStatusOptions so
                        the picker always shows schedule phases in StageStep order,
                        even if schedulePhases or stageCfg arrived after the modal
                        opened.  Sector and other pickers use the stored snapshot. */}
                    {(() => {
                      const liveOpts = editField.fieldName !== "SectorChoice"
                        ? computedStatusOptions
                        : editField.options;
                      if (liveOpts.length === 0) {
                        return <Text style={st.editModalEmpty}>No options available</Text>;
                      }
                      return liveOpts.map((opt) => {
                        const selected = editDraft === opt;
                        const isSubStatus = subStatusKeys.has(opt.trim().toLowerCase());
                        // Schedule phase rows carry their own "+ Sub" pill —
                        // one tap opens the Override editor with that phase's
                        // sub-status input already active (mirrors the web's
                        // DetailCell optionAction "+ Sub" pill).
                        const isPhaseRow =
                          !isSubStatus &&
                          canManageSettings && !editSaving &&
                          editField.fieldName !== "SectorChoice" &&
                          (schedulePhases?.some((p) => p.trim().toLowerCase() === opt.trim().toLowerCase()) ?? false);
                        return (
                          <Pressable
                            key={opt}
                            style={[
                              st.editOption,
                              selected && st.editOptionSelected,
                              isSubStatus && { marginLeft: 18, paddingVertical: 10 },
                            ]}
                            disabled={editSaving}
                            onPress={() => saveEdit(opt)}
                          >
                            {isSubStatus && (
                              <Feather name="corner-down-right" size={11} color={Colors.textMuted} style={{ marginRight: 4 }} />
                            )}
                            <Text style={[
                              st.editOptionText,
                              isSubStatus && { fontSize: 13, color: Colors.textSecondary },
                              selected && { color: Colors.green },
                            ]}>
                              {opt}
                            </Text>
                            {isPhaseRow && (
                              <Pressable
                                hitSlop={8}
                                disabled={editSaving}
                                onPress={(e) => { e.stopPropagation(); openOverrideEditor({ subFor: opt }); }}
                                style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: Colors.green + "66", backgroundColor: Colors.green + "14", marginLeft: 8 }}
                              >
                                <Feather name="plus" size={10} color={Colors.green} />
                                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.green }}>Sub</Text>
                              </Pressable>
                            )}
                            {selected && <Feather name="check" size={16} color={Colors.green} />}
                          </Pressable>
                        );
                      });
                    })()}
                  </ScrollView>
                  {/* Custom status free-text — available for all status fields
                      regardless of lifecycle state. Lets users save a value
                      that isn't in the picker list (equivalent to the web's
                      searchable input doubling as free-text entry). */}
                  {editField.fieldName !== "SectorChoice" && (
                    <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.cardBorder }}>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Custom status
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <AppTextInput
                          value={customStatusInput}
                          onChangeText={setCustomStatusInput}
                          placeholder="Type a status…"
                          placeholderTextColor={Colors.textMuted}
                          editable={!editSaving}
                          style={[st.editInput, { flex: 1, marginBottom: 0 }]}
                        />
                        <Pressable
                          disabled={editSaving || !customStatusInput.trim()}
                          onPress={() => saveEdit(customStatusInput.trim())}
                          style={{ paddingHorizontal: 14, justifyContent: "center", borderRadius: 10, backgroundColor: customStatusInput.trim() ? Colors.green : "rgba(107,165,57,0.3)" }}
                        >
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" }}>
                            {editSaving ? "…" : "Save"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                  {/* "Override Status" — available for all status fields
                      regardless of lifecycle state. Opens the full editor
                      for sub-statuses AND free-standing custom entries. */}
                  {canManageSettings && editField.fieldName !== "SectorChoice" && (
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.cardBorder }}
                      onPress={() => openOverrideEditor({})}
                    >
                      <Feather name="sliders" size={14} color={Colors.textMuted} />
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary, flex: 1 }}>
                        Override Status…
                      </Text>
                      <Feather name="chevron-right" size={14} color={Colors.textMuted} />
                    </Pressable>
                  )}
                </>
              ) : (
                <View>
                  <AppTextInput
                    value={editDraft}
                    onChangeText={setEditDraft}
                    keyboardType="numeric"
                    placeholder="Enter amount"
                    placeholderTextColor={Colors.textMuted}
                    editable={!editSaving}
                    style={st.editInput}
                  />
                  <Pressable style={[st.editSaveBtn, editSaving && { opacity: 0.6 }]} disabled={editSaving} onPress={() => saveEdit(editDraft)}>
                    <Text style={st.editSaveText}>{editSaving ? "Saving…" : "Save"}</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {/* ── Override Status editor ───────────────────────────────────────────
          Two-tab modal for per-record status customization (device-local).
          "Sub-statuses" tab: add indented entries under each schedule phase.
          "Custom statuses" tab: add/remove/reorder free-standing custom entries.
          Mirrors the web's StageCfg contract (order/custom/removed/subStatuses).
      ─────────────────────────────────────────────────────────────────────── */}
      {showSubStatusMgr && (
        <Modal visible transparent animationType="fade" onRequestClose={() => !subMgrSaving && setShowSubStatusMgr(false)}>
          <Pressable style={st.editModalBackdrop} onPress={() => !subMgrSaving && setShowSubStatusMgr(false)}>
            <Pressable style={[st.editModalCard, { maxHeight: "90%" }]} onPress={(e) => e.stopPropagation()}>
              {/* Header */}
              <View style={st.editModalHeader}>
                <Text style={st.editModalTitle}>Override Status</Text>
                <Pressable onPress={() => !subMgrSaving && setShowSubStatusMgr(false)} hitSlop={10}>
                  <Feather name="x" size={20} color={Colors.textMuted} />
                </Pressable>
              </View>
              {/* Tab bar */}
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
                {([["sub", "Sub-statuses"], ["custom", "Custom"]] as const).map(([tab, label]) => {
                  const active = subMgrTab === tab;
                  // "Sub-statuses" tab only makes sense when phases are available.
                  if (tab === "sub" && !(schedulePhases && schedulePhases.length > 0)) return null;
                  return (
                    <Pressable
                      key={tab}
                      onPress={() => { setSubMgrAutoFocus(false); setSubMgrTab(tab); }}
                      style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: active ? Colors.green : Colors.cardBorder, backgroundColor: active ? Colors.green + "18" : "transparent" }}
                    >
                      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: active ? Colors.green : Colors.textSecondary }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                {/* ── Sub-statuses tab ────────────────────────────────────── */}
                {subMgrTab === "sub" && schedulePhases && schedulePhases.length > 0 && (
                  <>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 }}>
                      Add indented entries beneath each schedule phase. Phases themselves are locked and cannot be removed.
                    </Text>
                    {/* Phase chip selector */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
                      {schedulePhases.map((phase, idx) => {
                        const isActive = idx === subMgrPhaseIdx;
                        return (
                          <Pressable
                            key={phase}
                            onPress={() => { setSubMgrAutoFocus(false); setSubMgrPhaseIdx(idx); setSubMgrInput(""); }}
                            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: isActive ? Colors.green : Colors.cardBorder, backgroundColor: isActive ? Colors.green + "18" : "transparent" }}
                          >
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: isActive ? Colors.green : Colors.textSecondary }}>{phase}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    {(() => {
                      const phase = schedulePhases[subMgrPhaseIdx];
                      const children = stageCfg.subStatuses?.[phase.trim().toLowerCase()] ?? [];
                      return (
                        <>
                          {children.length === 0 && (
                            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, fontStyle: "italic", marginBottom: 10 }}>
                              No sub-statuses yet for "{phase}".
                            </Text>
                          )}
                          {children.map((child) => (
                            <View key={child} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)", marginBottom: 4, borderWidth: 1, borderColor: Colors.cardBorder }}>
                              <Feather name="corner-down-right" size={11} color={Colors.textMuted} />
                              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.cardText, flex: 1 }}>{child}</Text>
                              <Pressable hitSlop={10} disabled={subMgrSaving} onPress={() => {
                                saveStageCfg((prev) => {
                                  const k = phase.trim().toLowerCase();
                                  return { ...prev, subStatuses: { ...prev.subStatuses, [k]: (prev.subStatuses?.[k] ?? []).filter((c) => c !== child) } };
                                });
                              }}>
                                <Feather name="trash-2" size={14} color="#E03C3C" />
                              </Pressable>
                            </View>
                          ))}
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.cardMuted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10, marginBottom: 6 }}>
                            Add under "{phase}"
                          </Text>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <AppTextInput
                              value={subMgrInput}
                              onChangeText={setSubMgrInput}
                              placeholder="e.g. 30%, Punch list…"
                              placeholderTextColor={Colors.textMuted}
                              editable={!subMgrSaving}
                              autoFocus={subMgrAutoFocus && subMgrTab === "sub"}
                              style={[st.editInput, { flex: 1, marginBottom: 0 }]}
                              autoCapitalize="none"
                            />
                            <Pressable
                              disabled={!subMgrInput.trim() || subMgrSaving}
                              style={{ paddingHorizontal: 14, justifyContent: "center", borderRadius: 10, backgroundColor: subMgrInput.trim() ? Colors.green : "rgba(107,165,57,0.3)" }}
                              onPress={() => {
                                const val = subMgrInput.trim();
                                if (!val) return;
                                saveStageCfg((prev) => {
                                  const k = phase.trim().toLowerCase();
                                  const existing = prev.subStatuses?.[k] ?? [];
                                  if (existing.some((c) => c.trim().toLowerCase() === val.toLowerCase())) return prev;
                                  return { ...prev, subStatuses: { ...prev.subStatuses, [k]: [...existing, val] } };
                                });
                                setSubMgrInput("");
                              }}
                            >
                              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" }}>Add</Text>
                            </Pressable>
                          </View>
                        </>
                      );
                    })()}
                  </>
                )}

                {/* ── Custom statuses tab ──────────────────────────────────── */}
                {subMgrTab === "custom" && (
                  <>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 }}>
                      Free-standing entries appended after schedule phases. Use ↑ ↓ to reorder; tap the trash icon to remove.
                    </Text>
                    {stageCfg.custom.length === 0 && (
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, fontStyle: "italic", marginBottom: 10 }}>
                        No custom statuses yet.
                      </Text>
                    )}
                    {stageCfg.custom.map((entry, idx) => (
                      <View key={entry} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)", marginBottom: 4, borderWidth: 1, borderColor: Colors.cardBorder }}>
                        <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.cardText, flex: 1 }}>{entry}</Text>
                        {/* Reorder up */}
                        <Pressable hitSlop={8} disabled={idx === 0 || subMgrSaving} onPress={() => {
                          saveStageCfg((prev) => {
                            const arr = [...prev.custom];
                            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                            return { ...prev, custom: arr };
                          });
                        }}>
                          <Feather name="chevron-up" size={16} color={idx === 0 ? Colors.textMuted + "44" : Colors.textMuted} />
                        </Pressable>
                        {/* Reorder down */}
                        <Pressable hitSlop={8} disabled={idx === stageCfg.custom.length - 1 || subMgrSaving} onPress={() => {
                          saveStageCfg((prev) => {
                            const arr = [...prev.custom];
                            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                            return { ...prev, custom: arr };
                          });
                        }}>
                          <Feather name="chevron-down" size={16} color={idx === stageCfg.custom.length - 1 ? Colors.textMuted + "44" : Colors.textMuted} />
                        </Pressable>
                        {/* Delete */}
                        <Pressable hitSlop={10} disabled={subMgrSaving} onPress={() => {
                          saveStageCfg((prev) => ({ ...prev, custom: prev.custom.filter((_, i) => i !== idx) }));
                        }}>
                          <Feather name="trash-2" size={14} color="#E03C3C" />
                        </Pressable>
                      </View>
                    ))}
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.cardMuted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10, marginBottom: 6 }}>
                      Add custom status
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <AppTextInput
                        value={subMgrCustomInput}
                        onChangeText={setSubMgrCustomInput}
                        placeholder="e.g. On Hold, Pending Review…"
                        placeholderTextColor={Colors.textMuted}
                        editable={!subMgrSaving}
                        autoFocus={subMgrAutoFocus && subMgrTab === "custom"}
                        style={[st.editInput, { flex: 1, marginBottom: 0 }]}
                      />
                      <Pressable
                        disabled={!subMgrCustomInput.trim() || subMgrSaving}
                        style={{ paddingHorizontal: 14, justifyContent: "center", borderRadius: 10, backgroundColor: subMgrCustomInput.trim() ? Colors.green : "rgba(107,165,57,0.3)" }}
                        onPress={() => {
                          const val = subMgrCustomInput.trim();
                          if (!val) return;
                          saveStageCfg((prev) => {
                            if (prev.custom.some((c) => c.trim().toLowerCase() === val.toLowerCase())) return prev;
                            return { ...prev, custom: [...prev.custom, val] };
                          });
                          setSubMgrCustomInput("");
                        }}
                      >
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" }}>Add</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      {loading && (
        <RmOneProcessing label="Loading project…" sublabel="FETCHING PROJECT DATA" />
      )}
    </View>
  );
}

function MobileAuditTrail({ entityId, entityType }: { entityId: string; entityType: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditTrailItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [auditHealth, setAuditHealth] = useState<AuditHealth | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async (before?: string) => {
    const generation = requestGeneration.current;
    before ? setLoading(false) : setLoading(true);
    setError("");
    try {
      const result = await getAuditTrail({ entityId, entityType, limit: 30, before });
      if (generation !== requestGeneration.current) return;
      setRows((current) => before ? [...current, ...result.rows] : result.rows);
      setNextCursor(result.nextCursor);
      if (!before) {
        try { setAuditHealth(await getAuditHealth()); } catch { setAuditHealth(null); }
      }
    } catch {
      setError("Could not load the audit trail.");
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    requestGeneration.current += 1;
    setRows([]);
    setNextCursor(null);
    setError("");
  }, [entityId, entityType]);

  useEffect(() => {
    if (!open || rows.length > 0) return;
    void load();
  }, [open, rows.length, load]);

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.cardBg, overflow: "hidden" }}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ minHeight: 60, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 11 }}
      >
        <Feather name="activity" size={19} color={Colors.green} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.cardText, fontFamily: "Inter_700Bold", fontSize: 15 }}>Audit Trail</Text>
          <Text style={{ color: Colors.cardMuted, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 }}>Who did what, when, and whether it worked</Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={Colors.cardMuted} />
      </Pressable>
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: Colors.cardBorder, paddingHorizontal: 16, paddingBottom: 14 }}>
          {auditHealth && auditHealth.writeFailures > 0 ? (
            <View accessibilityRole="alert" style={{ marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: "rgba(245,158,11,0.14)" }}>
              <Text style={{ color: "#F59E0B", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
                Audit storage needs attention. {auditHealth.writeFailures} event{auditHealth.writeFailures === 1 ? "" : "s"} could not be saved. Business changes may still have completed.
              </Text>
            </View>
          ) : null}
          {loading ? <ActivityIndicator color={Colors.green} style={{ marginVertical: 22 }} /> : error ? (
            <Pressable onPress={() => { setRows([]); setOpen(false); setTimeout(() => setOpen(true), 0); }} style={{ paddingVertical: 18 }}>
              <Text style={{ color: "#F87171", fontSize: 12 }}>{error} Tap to try again.</Text>
            </Pressable>
          ) : rows.length === 0 ? (
            <Text style={{ color: Colors.cardMuted, fontSize: 12, paddingVertical: 18 }}>No audit activity has been recorded yet.</Text>
          ) : rows.map((item) => {
            const bad = item.outcome === "failed" || item.outcome === "denied";
            return (
              <View key={item.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name={bad ? "alert-triangle" : "check-circle"} size={14} color={bad ? "#F87171" : Colors.green} />
                  <Text style={{ flex: 1, color: Colors.cardText, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                    {item.action.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())}
                  </Text>
                  <Text style={{ color: bad ? "#F87171" : Colors.green, fontFamily: "Inter_700Bold", fontSize: 10 }}>{item.outcome.toUpperCase()}</Text>
                </View>
                <Text style={{ marginTop: 5, color: Colors.cardMuted, fontSize: 11 }}>
                  {item.actorName || item.actorEmail || "RM ONE"} · {new Date(item.createdAt).toLocaleString()}
                </Text>
                {item.actorName && item.actorEmail ? <Text style={{ marginTop: 2, color: Colors.cardMuted, fontSize: 10 }}>{item.actorEmail}</Text> : null}
                <Text style={{ marginTop: 2, color: Colors.cardMuted, fontSize: 10 }}>UTC {item.createdAt} · {item.source || "system"}</Text>
                {Array.isArray(item.changes) && item.changes.length > 0 ? (
                  <View style={{ marginTop: 6, padding: 7, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.12)" }}>
                    {item.changes.slice(0, 8).map((change: any, index: number) => (
                      <Text key={`${item.id}-${index}`} style={{ color: Colors.cardMuted, fontSize: 10, marginTop: index ? 3 : 0 }}>
                        {String(change.FieldName ?? change.fieldName ?? change.name ?? "Changed field")}: {String(change.OldValue ?? change.oldValue ?? "—")} → {String(change.NewValue ?? change.newValue ?? change.Value ?? change.value ?? "—")}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {item.failureReason ? <Text style={{ marginTop: 4, color: "#F87171", fontSize: 11 }}>{item.failureReason}</Text> : null}
              </View>
            );
          })}
          {!loading && nextCursor ? (
            <Pressable accessibilityRole="button" onPress={() => void load(nextCursor)} style={{ alignSelf: "flex-start", paddingVertical: 12 }}>
              <Text style={{ color: Colors.green, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>Load earlier activity</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function SectionCard({ icon, iconColor, title, badge, expanded, onToggle, children, gridMode }: {
  icon: string; iconColor: string; title: string; badge?: React.ReactNode;
  expanded: boolean; onToggle: () => void; children: React.ReactNode; gridMode?: boolean;
}) {
  const { width: winW } = useWindowDimensions();
  const press = useRef(new Animated.Value(1)).current;
  const chevAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(chevAnim, { toValue: expanded ? 1 : 0, friction: 6, useNativeDriver: true }).start();
  }, [expanded]);
  const rotate = chevAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const containerW = winW - 32;
  // Older clients prefer comfortable, full-width cards over cramped 2-up grids
  // — so gridMode now renders each section card at the full container width
  // regardless of expanded state. Titles no longer truncate.
  const gridStyle = gridMode ? {
    width: containerW,
    marginHorizontal: 0,
    marginBottom: 0,
  } : {};
  return (
    <Animated.View style={[st.section, gridStyle, { transform: [{ scale: press }], borderColor: expanded ? iconColor + "55" : iconColor + "33" }]}>
      <LG
        colors={[iconColor + "10", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LG
        colors={["rgba(255,255,255,0.05)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.6 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Pressable
        style={st.sectionHeader}
        onPress={onToggle}
        onPressIn={() => Animated.spring(press, { toValue: 0.985, friction: 7, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start()}
      >
        <View style={st.sectionLeft}>
          <View style={[st.sectionIconGlow, { backgroundColor: iconColor, shadowColor: iconColor }]} />
          <View style={[st.sectionIcon, { backgroundColor: iconColor + "22", borderColor: iconColor + "55", borderWidth: 1 }]}>
            <Feather name={icon as any} size={14} color={iconColor} />
          </View>
          <Text style={st.sectionTitle} numberOfLines={2}>{title}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {badge}
          <Animated.View style={[st.chevronWrap, { transform: [{ rotate }] }]}>
            <Feather name="chevron-down" size={14} color={Colors.textMuted} />
          </Animated.View>
        </View>
      </Pressable>
      {expanded && <View style={st.sectionBody}>{children}</View>}
    </Animated.View>
  );
}

function AiActionCard({ icon, label, gradient, onPress, index }: {
  icon: string; label: string; gradient: [string, string]; onPress: () => void; index: number;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 380, delay: index * 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return (
    <Animated.View style={{ width: "48.5%", opacity: enter, transform: [{ translateY }, { scale: press }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(press, { toValue: 0.96, friction: 7, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start()}
        style={[st.aiCard, { width: "100%", borderColor: gradient[0] + "33" }]}
      >
        <View style={{ width: "100%" }}>
          <LG colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.aiCardIcon}>
            <Feather name={icon as any} size={18} color="#FFF" />
          </LG>
          <Text style={st.aiCardLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: 10 }}>
          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 10, color: gradient[0], textTransform: "uppercase", letterSpacing: 0.6 }}>Run AI</Text>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: gradient[0] + "22", alignItems: "center", justifyContent: "center" }}>
            <Feather name="arrow-right" size={11} color={gradient[0]} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function ValueHistoryModal({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const [rows, setRows] = useState<FieldChangeItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void getRecordFieldHistory(recordId).then((response) => {
      if (!alive) return;
      if (!response) {
        setError(true);
        return;
      }
      setRows(Array.isArray(response.rows) ? response.rows : []);
      setTruncated(response.truncated === true);
    });
    return () => { alive = false; };
  }, [recordId]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={st.valueHistorySheet}>
          <View style={st.valueHistoryHeader}>
            <View style={st.valueHistoryTitleRow}>
              <View style={st.valueHistoryIcon}>
                <Feather name="clock" size={15} color={Colors.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.valueHistoryTitle}>Contract value history</Text>
                <Text style={st.valueHistorySubtitle}>{recordId} · who changed each value, and when</Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close contract value history"
                style={st.valueHistoryClose}
              >
                <Feather name="x" size={20} color={Colors.textMuted} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={st.valueHistoryScroll}
            contentContainerStyle={st.valueHistoryContent}
            showsVerticalScrollIndicator={false}
          >
            {error ? (
              <View style={st.valueHistoryEmpty}>
                <Feather name="alert-circle" size={22} color={Colors.orange} />
                <Text style={st.valueHistoryEmptyTitle}>Couldn’t load the change history</Text>
                <Text style={st.valueHistoryEmptyText}>Please try again when the connection is available.</Text>
              </View>
            ) : rows == null ? (
              <View style={st.valueHistoryEmpty}>
                <ActivityIndicator size="small" color={Colors.green} />
                <Text style={st.valueHistoryEmptyText}>Loading history…</Text>
              </View>
            ) : rows.length === 0 ? (
              <View style={st.valueHistoryEmpty}>
                <Feather name="clock" size={22} color={Colors.textMuted} />
                <Text style={st.valueHistoryEmptyTitle}>No value changes recorded yet</Text>
                <Text style={st.valueHistoryEmptyText}>
                  Edits to contract values are tracked here, including who made them and when.
                </Text>
              </View>
            ) : (
              rows.map((row, index) => {
                const who = historyActor(row.changedBy, row.source);
                const when = formatHistoryDate(row.changedAt);
                const sourceBadge = historySourceBadge(row.source);
                return (
                  <View key={`${row.changedAt}-${row.fieldName}-${index}`} style={st.valueHistoryRow}>
                    <View style={st.valueHistoryRowTop}>
                      <Text style={st.valueHistoryField}>
                        {FIELD_HISTORY_LABELS[row.fieldName] ?? row.fieldName}
                      </Text>
                      {sourceBadge && (
                        <View style={st.valueHistorySourceBadge}>
                          <Text style={st.valueHistorySourceText}>
                            {sourceBadge}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={st.valueHistoryChange}>
                      <Text style={[
                        st.valueHistoryOldValue,
                        row.oldValue == null && st.valueHistoryBlank,
                      ]}>
                        {formatHistoryValue(row.oldValue)}
                      </Text>
                      <Feather name="arrow-right" size={13} color={Colors.textMuted} />
                      <Text style={[
                        st.valueHistoryNewValue,
                        row.newValue == null && st.valueHistoryBlank,
                      ]}>
                        {formatHistoryValue(row.newValue)}
                      </Text>
                    </View>
                    <Text style={st.valueHistoryMeta}>{who} · {when}</Text>
                  </View>
                );
              })
            )}
            {truncated && rows != null && rows.length > 0 && (
              <Text style={st.valueHistoryTruncated}>Showing the most recent {rows.length} changes.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailCell({
  label,
  value,
  color,
  onEdit,
  onHistory,
}: {
  label: string;
  value: string;
  color?: string;
  onEdit?: () => void;
  onHistory?: () => void;
}) {
  const actions = (onEdit || onHistory) ? (
    <View style={st.detailCellActions}>
      {onHistory && (
        <Pressable
          onPress={onHistory}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label} change history`}
          style={st.detailCellAction}
        >
          <Feather name="clock" size={11} color={Colors.textMuted} />
        </Pressable>
      )}
      {onEdit && (
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label}`}
          style={st.detailCellAction}
        >
          <Feather name="edit-2" size={11} color={Colors.textMuted} />
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={st.detailCell}>
      <View style={st.detailCellHeader}>
        <Text style={st.detailCellLabel}>{label}</Text>
        {actions}
      </View>
      {onEdit ? (
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}>
          <Text style={[st.detailCellValue, color ? { color } : undefined]}>{value || "—"}</Text>
        </Pressable>
      ) : (
        <Text style={[st.detailCellValue, color ? { color } : undefined]}>{value || "—"}</Text>
      )}
    </View>
  );
}

const st = themed(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingPulse: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.green + "10", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  loadingText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.cardText },
  loadingSubtext: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: Colors.green, borderRadius: 8 },
  retryText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText },

  headerBar: { position: "absolute", top: 0, left: 0, right: 0, height: 100, zIndex: 10 },
  headerNav: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, zIndex: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.cardBg, borderWidth: 2, borderColor: Colors.cardBorderStrong, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  headerTitle: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary, marginHorizontal: 10 },
  aiHeaderBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.green, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  recordReadOnlyBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginHorizontal: 16, marginTop: 4, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "rgba(245,158,11,0.10)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
  recordReadOnlyIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(245,158,11,0.15)" },
  recordReadOnlyTitle: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#F59E0B", marginBottom: 2 },
  recordReadOnlyText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, color: Colors.textSecondary },

  heroCard: { margin: 16, marginTop: 4, padding: 20, backgroundColor: Colors.cardBg, borderRadius: 20, borderWidth: 2, borderColor: Colors.cardBorderStrong, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  heroGlow: { position: "absolute", top: -40, right: -40, width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.green, opacity: 0.04 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  phasePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, gap: 6 },
  phaseDot: { width: 6, height: 6, borderRadius: 3 },
  phaseText: { fontFamily: "Inter_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  moduleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  moduleText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.8 },
  heroName: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.cardText, marginBottom: 4, lineHeight: 28 },
  heroId: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText, marginBottom: 14, letterSpacing: 0.4 },
  heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  companyRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", marginTop: 14 },
  companyIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(15,25,35,0.06)", alignItems: "center", justifyContent: "center" },
  companyText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText },
  metaText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },

  statsRow: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, gap: 8 },
  statCard: { backgroundColor: Colors.cardBg, borderRadius: 18, borderWidth: 2, borderColor: Colors.cardBorderStrong, paddingVertical: 20, paddingHorizontal: 14, alignItems: "center", minHeight: 130, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 4 },
  statIconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10, borderWidth: 1 },
  statIconGlow: { position: "absolute", top: 14, alignSelf: "center", width: 60, height: 60, borderRadius: 30, opacity: 0.25, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 22, elevation: 0 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 26, color: Colors.cardText, lineHeight: 30 },
  statLabel: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.textMuted, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.8 },
  statSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, marginTop: 3 },

  section: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.darkCard, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.cardBorderStrong, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  sectionIconGlow: { position: "absolute", left: 3, top: 3, width: 16, height: 16, borderRadius: 8, opacity: 0.3, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, paddingHorizontal: 16 },
  sectionLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  sectionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.cardText, flexShrink: 1, lineHeight: 20 },
  sectionBody: { paddingHorizontal: 16, paddingBottom: 16 },
  chevronWrap: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },

  healthPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  healthPillText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  issueRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  issueDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  issueText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1 },
  issueDeductionPill: { backgroundColor: "rgba(224,60,60,0.15)", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, marginLeft: 4 },
  issueDeductionText: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#E03C3C" },
  healthFooter: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.06)" },
  healthFooterText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, flex: 1, lineHeight: 15 },

  countBadge: { backgroundColor: "rgba(255,255,255,0.10)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSecondary },

  barAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  barAvatarText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  barName: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.cardText, maxWidth: "70%" },
  barPct: { fontFamily: "Inter_700Bold", fontSize: 12 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },

  chartActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  chartActionText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.green },

  emptyState: { alignItems: "center", paddingVertical: 24, gap: 6 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  emptyDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  emptyActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.green, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, marginTop: 12 },
  emptyActionText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FFF" },
  emptyChart: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted, textAlign: "center", paddingVertical: 20 },

  bidDateRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  bidDateLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1 },
  bidDateValue: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText },


  detailsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 1 },
  detailCell: { width: "48%", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 12, marginBottom: 8 },
  detailCellHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 },
  detailCellLabel: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.cardMuted, textTransform: "uppercase", letterSpacing: 0.6, flexShrink: 1 },
  detailCellActions: { flexDirection: "row", alignItems: "center", gap: 3 },
  detailCellAction: { padding: 2 },
  detailCellValue: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.cardText, lineHeight: 20 },
  editModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  editModalCard: { width: "100%", maxWidth: 380, backgroundColor: Colors.cardBg, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorderStrong, padding: 18 },
  editModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  editModalTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText },
  editModalEmpty: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted, paddingVertical: 12, textAlign: "center" },
  editOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 14, borderRadius: 10, marginBottom: 6, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "transparent" },
  editOptionSelected: { backgroundColor: Colors.green + "14", borderColor: Colors.green + "55" },
  editOptionText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText },
  editInput: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorderStrong, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.cardText, marginBottom: 14 },
  editSaveBtn: { backgroundColor: Colors.green, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  editSaveText: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#FFF" },

  aiSection: { marginHorizontal: 12, marginVertical: 16, paddingVertical: 16, paddingHorizontal: 0, backgroundColor: "transparent" },
  aiSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4, paddingHorizontal: 4 },
  aiIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.green, alignItems: "center", justifyContent: "center" },
  aiSectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText },
  aiSectionSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginBottom: 14 },

  aiGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  // Force 2-per-row regardless of viewport width (was 4-per-row on wider screens
  // because the pixel calc didn't fence in items). Bigger size = comfortable
  // tap targets for older clients.
  aiCard: { width: "48.5%", backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 18, paddingVertical: 20, paddingHorizontal: 16, alignItems: "flex-start", borderWidth: 1.5, borderColor: Colors.cardBorderStrong, minHeight: 180, justifyContent: "space-between" },
  aiCardIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  aiCardLabel: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText, textAlign: "left", lineHeight: 20, flexShrink: 1 },
  aiCardArrowRow: { alignItems: "center", justifyContent: "center", marginTop: 8 },
  aiCardArrow: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", alignSelf: "flex-end" },

  tmResourceCount: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.green + "10", borderRadius: 10, padding: 10, marginBottom: 12, marginHorizontal: -4 },
  tmResourceCountText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.green, flex: 1 },
  tmActionRow: { flexDirection: "row", gap: 10, marginBottom: 14, marginHorizontal: -4 },
  tmNotifyBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.green, borderRadius: 10, paddingVertical: 12 },
  tmNotifyText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FFF" },
  tmManageBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.orange, borderRadius: 10, paddingVertical: 12 },
  tmManageText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FFF" },
  tmSearchWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14, marginHorizontal: -4, borderWidth: 1, borderColor: Colors.border },
  tmSearchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.cardText, padding: 0 },
  tmCard: { marginBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 8, marginHorizontal: -4 },
  tmCardHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  tmAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tmAvatarText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  tmName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textPrimary },
  tmRole: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  tmBu: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.green, marginTop: 1 },
  tmEmailRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  tmEmail: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },
  tmPctRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  tmPctDot: { width: 6, height: 6, borderRadius: 3 },
  tmPctText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  tmEacHrs: { fontFamily: "Inter_700Bold", fontSize: 18 },
  tmEacLabel: { fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  tmDetails: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  tmMetricsRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  tmMetricBox: { flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: Colors.border },
  tmMetricLabel: { fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.3 },
  tmMetricValue: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.cardText, marginTop: 2 },
  tmDateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  tmDateText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  tmWeeklyLabel: { fontFamily: "Inter_400Regular", fontSize: 11, fontStyle: "italic", marginTop: 6 },
  tmEditBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.green, borderRadius: 8, paddingVertical: 8, marginTop: 10 },
  tmEditBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#FFF" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  valueHistorySheet: { maxHeight: "86%", backgroundColor: Colors.darkDeep, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  valueHistoryHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  valueHistoryTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  valueHistoryIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.green + "18", alignItems: "center", justifyContent: "center" },
  valueHistoryTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.cardText },
  valueHistorySubtitle: { fontFamily: "Inter_400Regular", fontSize: 10.5, color: Colors.textMuted, marginTop: 2 },
  valueHistoryClose: { padding: 4 },
  valueHistoryScroll: { flexGrow: 0 },
  valueHistoryContent: { paddingHorizontal: 16, paddingBottom: 24 },
  valueHistoryRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  valueHistoryRowTop: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  valueHistoryField: { fontFamily: "Inter_700Bold", fontSize: 10.5, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  valueHistorySourceBadge: { borderWidth: 1, borderColor: Colors.orange + "66", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  valueHistorySourceText: { fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.orange, letterSpacing: 0.2 },
  valueHistoryChange: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  valueHistoryOldValue: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.cardText },
  valueHistoryNewValue: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.greenLight },
  valueHistoryBlank: { color: Colors.textMuted, fontStyle: "italic" },
  valueHistoryMeta: { fontFamily: "Inter_400Regular", fontSize: 10.5, color: Colors.textMuted, marginTop: 4 },
  valueHistoryTruncated: { fontFamily: "Inter_400Regular", fontSize: 10.5, color: Colors.textMuted, paddingTop: 9 },
  valueHistoryEmpty: { alignItems: "center", paddingHorizontal: 18, paddingVertical: 28, gap: 8 },
  valueHistoryEmptyTitle: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText, textAlign: "center" },
  valueHistoryEmptyText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: Colors.textMuted, textAlign: "center" },
}));
