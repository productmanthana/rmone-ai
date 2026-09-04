import { compactUsd } from "@/lib/money";
import { AppTextInput } from "@/components/AppTextInput";
import { Feather } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProfileMenu from "@/components/ProfileMenu";
import { DisabledStaffControl } from "@/components/DisabledStaffControl";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useRouter, useFocusEffect } from "expo-router";

import { Colors, themed } from "@/constants/colors";
import { setChatPrompt } from "@/lib/chatBridge";
import { nameMatches } from "@/lib/normalize";
import { roleQueryMatcher } from "@workspace/role-match";
import { getResourceAllocations, peekResourceAllocations, peekModuleRecords, isResourceCacheFresh, peekUtilization, getModuleRecords, getAllocationUtilization, getResourceDemands, bustCache, bustCacheByPrefix, onCacheBust, chatStream, getMobileBusinessRules, auditAction, auditClose, auditFilter, auditOpen, auditSearch, type LiveResource, type ModuleRecord, type AllocationUtilizationResponse, type DemandItem, type UtilFilterOptions, type UtilizationPerson } from "@/lib/api";
import { empTypeColor, useEmpColorsVersion } from "@/lib/employmentColor";
import { useAuth } from "@/lib/auth";
import { useScreenBeacon } from "@/lib/usageBeacon";
import { getSSParam } from "@/lib/ssParam";
import { fmtHours, fmtPct } from "@/lib/numberFormat";

type FilterTab = "All" | "Overloaded" | "Under" | "Available";
type ModalType = "total" | "active" | "alloc" | "profile" | null;
type ResView = "Staff" | "Contacts" | "Timeline" | "Demand";

interface Contact {
  id: string;
  name: string;
  title: string;
  company: string;
  companyId: string;
  phone: string;
  email: string;
  city: string;
}

function mapCON(r: ModuleRecord): Contact {
  const a = r as any;
  // Build name from multiple possible fields
  const firstName: string = a.FirstName || a.First_Name || "";
  const lastName: string = a.LastName || a.Last_Name || a.Surname || "";
  const firstLast = firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName);
  const fullName: string =
    a.FullName || a.ContactName || a.ContactDisplayName || a.DisplayName || a.Name ||
    firstLast || r.ShortName || "";

  const companyName = a.CompanyName ?? a.AccountName ?? a.Company ?? a.Organization ?? "";
  return {
    id: r.TicketId ?? "",
    name: fullName,
    title: a.JobTitle ?? a.Title2 ?? a.ContactTitle ?? a.Position ?? a.Title ?? "",
    company: companyName,
    companyId: a.CompanyId ?? a.CompanyTicketId ?? a.AccountId ?? "",
    phone: a.PhoneNumber ?? a.Phone ?? a.MobilePhone ?? a.CellPhone ?? a.DirectPhone ?? "—",
    email: a.Email ?? a.EmailAddress ?? a.WorkEmail ?? "—",
    city: a.City ?? r.City ?? "",
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Platform-wide utilization color convention (matches the web Timeline Grid):
// RED = under-utilized, GREEN = healthy/optimal, ORANGE = over-utilized.
// Thresholds match the tenant-configured business rules (underAllocatedPct /
// overCapacityPct) rather than being hard-coded to 40 / 120.
function statusInfo(
  pct: number,
  underAllocatedPct = 60,
  overCapacityPct = 110,
): { label: string; color: string } {
  if (pct > overCapacityPct)   return { label: "Overloaded", color: Colors.orange };
  if (pct >= underAllocatedPct) return { label: "Optimal",   color: Colors.green };
  if (pct >= Math.round(underAllocatedPct * 0.6)) return { label: "Active", color: Colors.greenLight };
  if (pct > 0)                  return { label: "Under-used", color: Colors.red };
  return                         { label: "Bench",            color: Colors.red };
}

const SLIDER_MIN = 0;
const SLIDER_MAX = 150;
const SLIDER_STEP = 0.01;
const THUMB_SIZE = 28;

function ThresholdSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackWidthRef = useRef(0);
  const startXRef = useRef(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const pctToX = (v: number) => {
    const usable = trackWidthRef.current - THUMB_SIZE;
    if (usable <= 0) return 0;
    return ((v - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * usable;
  };

  const xToPct = (x: number) => {
    const usable = trackWidthRef.current - THUMB_SIZE;
    if (usable <= 0) return SLIDER_MIN;
    const clamped = Math.max(0, Math.min(usable, x));
    const raw = SLIDER_MIN + (clamped / usable) * (SLIDER_MAX - SLIDER_MIN);
    return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(raw)));
  };

  const lastSnapped = useRef(value);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startXRef.current = pctToX(valueRef.current);
        lastSnapped.current = valueRef.current;
      },
      onPanResponderMove: (_e, gs) => {
        const newX = startXRef.current + gs.dx;
        const clamped = Math.max(0, Math.min(trackWidthRef.current - THUMB_SIZE, newX));
        thumbX.setValue(clamped);
        const snapped = xToPct(clamped);
        if (snapped !== lastSnapped.current) {
          lastSnapped.current = snapped;
          onChangeRef.current(snapped);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      },
      onPanResponderRelease: () => {
        const final = lastSnapped.current;
        Animated.spring(thumbX, { toValue: pctToX(final), useNativeDriver: false, friction: 7 }).start();
      },
    })
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
    thumbX.setValue(pctToX(value));
  };

  useEffect(() => {
    if (trackWidthRef.current > 0) {
      Animated.spring(thumbX, { toValue: pctToX(value), useNativeDriver: false, friction: 7 }).start();
    }
  }, [value]);

  const usable = Math.max(trackWidthRef.current - THUMB_SIZE, 1);
  const fillPct = thumbX.interpolate({
    inputRange: [0, usable],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSecondary }}>
          Threshold
        </Text>
        <View style={{ backgroundColor: Colors.orange, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: "#fff" }}>{Math.round(value)}%</Text>
        </View>
      </View>
      <View
        onLayout={onTrackLayout}
        style={{ height: THUMB_SIZE + 12, justifyContent: "center" }}
        {...panResponder.panHandlers}
      >
        <View style={{ height: 4, backgroundColor: Colors.border, borderRadius: 2, marginHorizontal: THUMB_SIZE / 2 }}>
          <Animated.View style={{ height: 4, backgroundColor: Colors.orange, borderRadius: 2, width: Animated.multiply(fillPct, trackWidthRef.current - THUMB_SIZE) }} />
        </View>
        <Animated.View
          style={{
            position: "absolute",
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: THUMB_SIZE / 2,
            backgroundColor: "#fff",
            borderWidth: 2.5,
            borderColor: Colors.orange,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 4,
            elevation: 4,
            left: 0,
            transform: [{ translateX: thumbX as any }],
          }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingHorizontal: THUMB_SIZE / 2 }}>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted }}>{SLIDER_MIN}%</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted }}>{Math.round((SLIDER_MIN + SLIDER_MAX) / 2)}%</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textMuted }}>{SLIDER_MAX}%</Text>
      </View>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, marginTop: 4, textAlign: "center" }}>
        Showing staff under {value % 1 === 0 ? value : value.toFixed(2)}% allocation
      </Text>
    </View>
  );
}

export default function ResourcesScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const router = useRouter();
  const ss = getSSParam();
  const { user } = useAuth();
  useScreenBeacon("Resources");
  const [aiName, setAiName]       = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText]       = useState("");
  const [aiError, setAiError]     = useState<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [weekColModal, setWeekColModal] = useState<{ period: string } | null>(null);
  const [cellModal, setCellModal] = useState<{
    name: string; resourceId?: string; period: string; pct: number; hours: number;
    weeklyData: { period: string; pct: number; hours: number }[];
    projectAllocs: { projectId: string; projectName: string; pct: number; startDate: string; endDate: string }[];
  } | null>(null);
  const [aiGantt, setAiGantt] = useState<{ projectId: string; name: string; startDate: string; endDate: string; pct: number }[]>([]);
  const [workWeekHours, setWorkWeekHours]       = useState(40);
  const [underAllocatedPct, setUnderAllocatedPct] = useState(60);
  const [overCapacityPct, setOverCapacityPct]     = useState(110);
  useEffect(() => {
    function applyRules() {
      getMobileBusinessRules().then(br => {
        setWorkWeekHours(br.workWeekHours);
        setUnderAllocatedPct(br.underAllocatedPct);
        setOverCapacityPct(br.overCapacityPct);
      }).catch(() => {});
    }
    applyRules();
    // Re-fetch whenever the cache is busted (e.g. pull-to-refresh, or an admin
    // changes underAllocatedPct / overCapacityPct mid-session). bustCache()
    // clears the mobile-business-rules entry, so the next getMobileBusinessRules()
    // call goes to the network and picks up the new thresholds.
    return onCacheBust(applyRules);
  }, []);
  useEffect(() => {
    return () => {
      try { aiAbortRef.current?.abort(); } catch {}
      aiAbortRef.current = null;
    };
  }, []);

  function openAnalysis(name: string, clickedPeriod?: string) {
    auditOpen({ screen: "resources" });
    try { aiAbortRef.current?.abort(); } catch {}
    const utilResource = utilData?.resources.find(r => r.name === name);
    const staffRow = resources.find(r => r.name.toLowerCase().trim() === name.toLowerCase().trim());
    setAiName(name);
    setAiText("");
    setAiError(null);
    setAiLoading(true);

    const weeks = utilResource?.weeks ?? [];
    const allWeeks = weeks.filter(w => w.hours > 0);
    const totalHrs = allWeeks.reduce((s, w) => s + w.hours, 0);
    const avgPct = allWeeks.length > 0 ? Math.round(allWeeks.reduce((s, w) => s + w.pct, 0) / allWeeks.length) : 0;
    const overWeeks = allWeeks.filter(w => w.pct >= 100).length;
    const underWeeks = allWeeks.filter(w => w.pct > 0 && w.pct < 40).length;
    const peakWeek = allWeeks.reduce<typeof allWeeks[0] | null>((m, w) => (!m || w.pct > m.pct ? w : m), null);
    const idleWeeks = weeks.length - allWeeks.length;
    const gapVs80 = 80 - avgPct;
    const fmtP = (p: string) => { const m = p.match(/^([A-Z][a-z]{2})-(\d{1,2})-/); return m ? `${m[1]} ${parseInt(m[2], 10)}` : p; };
    const recent = allWeeks.slice(-8).map(w => `${fmtP(w.period)}: ${w.pct}%, ${w.hours}h`).join(" | ");

    // Build active project context from quarter allocations
    const qStartMs = new Date(utilFrom).getTime();
    const qEndMs   = new Date(utilTo).getTime();
    const qAllocs  = (staffRow?.activeAllocations ?? []).filter(a => {
      const s = new Date(a.startDate).getTime();
      const e = new Date(a.endDate).getTime();
      return !isNaN(s) && !isNaN(e) && s <= qEndMs && e >= qStartMs;
    });
    const projMap = new Map<string, { pct: number; name: string }>();
    for (const a of qAllocs) {
      const rName = pName(a.projectId);
      const cur = projMap.get(a.projectId);
      if (!cur) projMap.set(a.projectId, { pct: a.pct, name: rName });
      else projMap.set(a.projectId, { pct: cur.pct + a.pct, name: cur.name !== a.projectId ? cur.name : rName });
    }
    const activeAllocs = Array.from(projMap.entries())
      .map(([projectId, v]) => ({ projectId, pct: v.pct, name: v.name }))
      .sort((a, b) => b.pct - a.pct);
    const projectsLine = activeAllocs.length > 0
      ? `Active projects for ${name} in ${selectedQ}: ` +
        activeAllocs.map(a => {
          const hrs = Math.round((a.pct / 100) * workWeekHours);
          return a.name !== a.projectId ? `${a.name} (${a.projectId}) — ~${hrs}h/wk at ${a.pct}%` : `${a.projectId} — ~${hrs}h/wk at ${a.pct}%`;
        }).join("; ") + "."
      : `No project allocations on record for ${name} during ${selectedQ}.`;

    // Build Gantt chart data
    const ganttMap = new Map<string, { startMs: number; endMs: number; pct: number; bestName: string }>();
    for (const a of qAllocs) {
      const s = new Date(a.startDate).getTime(); const e = new Date(a.endDate).getTime();
      if (isNaN(s) || isNaN(e)) continue;
      const rName = pName(a.projectId);
      const cur = ganttMap.get(a.projectId);
      if (!cur) ganttMap.set(a.projectId, { startMs: s, endMs: e, pct: a.pct, bestName: rName });
      else ganttMap.set(a.projectId, { startMs: Math.min(cur.startMs, s), endMs: Math.max(cur.endMs, e), pct: Math.max(cur.pct, a.pct), bestName: cur.bestName !== a.projectId ? cur.bestName : rName });
    }
    const ganttProjects = Array.from(ganttMap.entries())
      .map(([projectId, v]) => ({ projectId, name: v.bestName, startDate: new Date(v.startMs).toISOString().split("T")[0], endDate: new Date(v.endMs).toISOString().split("T")[0], pct: v.pct }))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    setAiGantt(ganttProjects);

    // Clicked-week context
    const clickedWeekData = clickedPeriod ? allWeeks.find(w => w.period === clickedPeriod) : null;
    const MO: Record<string,string> = { Jan:"1",Feb:"2",Mar:"3",Apr:"4",May:"5",Jun:"6",Jul:"7",Aug:"8",Sep:"9",Oct:"10",Nov:"11",Dec:"12" };
    const clickedLabel = clickedPeriod ? (() => { const m = clickedPeriod.match(/^([A-Z][a-z]{2})-(\d{1,2})-/); return m ? `${MO[m[1]] ?? m[1]}/${m[2]}` : clickedPeriod; })() : null;
    const clickedContext = clickedWeekData
      ? `The user clicked week ${clickedLabel} (${clickedWeekData.pct}%, ${clickedWeekData.hours}h). Lead with what happened THAT week, then give broader context.\n`
      : clickedPeriod
        ? `The user clicked week ${clickedLabel} which shows 0h (idle). Lead by noting this week is idle, then explain the broader pattern.\n`
        : "";
    const peakLabel = peakWeek ? fmtP(peakWeek.period) : "TBD";
    const driverInstruction = clickedWeekData
      ? `DRIVER: <one sentence: say which project caused the ${clickedWeekData.hours}h (${clickedWeekData.pct}%) on ${clickedLabel} — use the project's real name, not its ID>`
      : clickedPeriod && !clickedWeekData
        ? `DRIVER: <one sentence: explain why ${clickedLabel} is 0h — is this person not scheduled during this period?>`
        : `DRIVER: <one sentence: name which project drove the peak of ${peakWeek?.pct ?? 0}% (${peakWeek?.hours ?? 0}h) on ${peakLabel} — use the project's real name, not its ID>`;

    const prompt =
      `Analyze ${name}'s workload in ${selectedQ} and return EXACTLY 6 labeled lines — no extra text, no markdown, no blank lines between them.\n\n` +
      `${clickedContext}` +
      `DATA for ${name}:\n` +
      `- Active weeks: ${allWeeks.length} of ${weeks.length} (${idleWeeks} idle at 0h)\n` +
      `- Avg utilization: ${avgPct}% | Total hours: ${totalHrs}h\n` +
      `- Over-allocated weeks (≥100%): ${overWeeks} | Under-utilized weeks (<40%): ${underWeeks}\n` +
      (peakWeek ? `- Peak: ${peakWeek.pct}% (${peakWeek.hours}h) on ${peakLabel}\n` : "") +
      (recent ? `- Recent week data: ${recent}\n` : "") +
      `- ${projectsLine}\n\n` +
      `RULES:\n` +
      `• Write every line as a natural, complete English sentence.\n` +
      `• Always use the project's real name, never the raw project ID.\n` +
      `• Format dates as "Month Day" (e.g. "Apr 20"), never "Apr-20-26" or "4/20".\n` +
      `• Every line below STATUS must include at least one specific number (%, hours, or week count).\n` +
      `• Do not call any tools. Analyze only from the data above.\n\n` +
      `OUTPUT FORMAT (copy labels exactly, one line each):\n` +
      `STATUS: over | under | healthy\n` +
      `HEADLINE: <one sentence ≤22 words — state avg %, total hours, and active week count naturally>\n` +
      `${driverInstruction}\n` +
      `TREND: <one sentence describing direction with 2–3 specific data points from recent weeks>\n` +
      `INSIGHT: <one sentence with a number — e.g. "${idleWeeks} of ${weeks.length} weeks have no hours at all">\n` +
      `REC: <one sentence with a specific hour figure — e.g. "Assigning roughly ${Math.max(0, Math.round(totalHrs * gapVs80 / Math.max(1, avgPct)))} more hours this quarter would bring them to an 80% load">`;

    const controller = new AbortController();
    aiAbortRef.current = controller;

    const timeoutId = setTimeout(() => {
      try { controller.abort(); } catch {}
      setAiError("Analysis timed out — please try again.");
      setAiLoading(false);
    }, 45_000);

    let buf = "";
    chatStream(
      [{ role: "user", content: prompt }],
      (e) => {
        if (controller.signal.aborted) return;
        if (e.type === "content" || e.type === "token") {
          buf += e.text;
          const cleaned = buf
            .replace(/\[(PERSON_PROFILE|WEEKLY_ALLOC|ROSTER|OPP_TABLE|PMM_TABLE|CACHE_BUST)[^\]]*\]/g, "")
            .replace(/^\s*\[[^\]]+\]\s*$/gm, "")
            .trim();
          setAiText(cleaned);
        } else if (e.type === "error") {
          setAiError(e.message);
        } else if (e.type === "done") {
          setAiLoading(false);
        }
      },
      controller.signal,
      { username: user?.username ?? "", displayName: user?.username ?? "" },
    ).catch((err: any) => {
      if (err?.name !== "AbortError") setAiError(String(err?.message ?? err));
      setAiLoading(false);
    }).finally(() => clearTimeout(timeoutId));
  }
  function closeAnalysis() {
    auditClose({ screen: "resources" });
    try { aiAbortRef.current?.abort(); } catch {}
    aiAbortRef.current = null;
    setAiName(null);
    setAiText("");
    setAiError(null);
    setAiLoading(false);
    setAiGantt([]);
  }

  function openCellModal(name: string, period: string, w: { pct: number; hours: number }, resourceId?: string) {
    auditOpen({ screen: "resources" });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const utilResource = utilData?.resources.find(r => r.name === name);
    const weeklyData = (utilResource?.weeks ?? []).map(wk => ({ period: wk.period, pct: wk.pct, hours: wk.hours }));
    const staffRow = resourceId
      ? resources.find(r => r.id.toLowerCase() === resourceId.toLowerCase())
      : resources.find(r => r.name.toLowerCase().trim() === name.toLowerCase().trim());
    const MONTHS: Record<string, number> = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const pm = period.match(/^([A-Z][a-z]{2})-(\d{1,2})-(\d{2,4})$/);
    const yr = pm ? (parseInt(pm[3]) < 100 ? 2000 + parseInt(pm[3]) : parseInt(pm[3])) : 0;
    const weekStart = pm ? new Date(yr, MONTHS[pm[1]] ?? 0, parseInt(pm[2])) : null;
    const weekStartMs = weekStart?.getTime() ?? Date.now();
    const weekEndMs   = weekStartMs + 6 * 24 * 3600 * 1000;
    const weekAllocs  = (staffRow?.activeAllocations ?? []).filter(a => {
      const s = new Date(a.startDate).getTime();
      const e = new Date(a.endDate).getTime();
      return !isNaN(s) && !isNaN(e) && s <= weekEndMs && e >= weekStartMs;
    });
    const weekProjMap = new Map<string, typeof weekAllocs[0]>();
    for (const a of weekAllocs) {
      if (!weekProjMap.has(a.projectId) || a.pct > weekProjMap.get(a.projectId)!.pct)
        weekProjMap.set(a.projectId, a);
    }
    const projectAllocs = Array.from(weekProjMap.values())
      .sort((a, b) => b.pct - a.pct)
      .map(a => ({ projectId: a.projectId, projectName: pName(a.projectId), pct: a.pct, startDate: a.startDate ?? "", endDate: a.endDate ?? "" }));
    setCellModal({ name, resourceId, period, pct: w.pct, hours: w.hours, weeklyData, projectAllocs });
  }

  function pushChat(prompt: string) {
    auditAction({ screen: "resources" });
    setChatPrompt(prompt);
    setTimeout(() => {
      try { router.navigate("/(tabs)/chat"); } catch (_) {}
    }, 100);
  }
  function modalToChat(prompt: string) {
    auditAction({ screen: "resources" });
    setChatPrompt(prompt);
    setTimeout(() => {
      try { router.navigate("/(tabs)/chat"); } catch (_) {}
    }, 800);
  }

  const initTab = (): FilterTab => {
    if (ss.includes("overload")) return "Overloaded";
    if (ss.includes("under"))    return "Under";
    if (ss.includes("avail"))    return "Available";
    return "All";
  };

  const [resView, setResView]   = useState<ResView>("Timeline");
  const [tab, setTab]           = useState<FilterTab>(initTab());
  const [threshold, setThreshold] = useState(SLIDER_MAX);
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading]   = useState(!peekResourceAllocations());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [modalType, setModalType]       = useState<ModalType>(null);
  const [modalResource, setModalResource] = useState<LiveResource | null>(null);
  const [modalProjectSearch, setModalProjectSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsSearch, setContactsSearch] = useState("");
  const [contactsSearchDebounced, setContactsSearchDebounced] = useState("");
  const contactsSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [demandItems, setDemandItems] = useState<DemandItem[]>([]);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandSearch, setDemandSearch] = useState("");
  const [utilData, setUtilData]       = useState<AllocationUtilizationResponse | null>(null);
  const [utilLoading, setUtilLoading] = useState(false);
  const [utilError, setUtilError]     = useState<string | null>(null);
  const [utilSearch, setUtilSearch]   = useState("");
  const hHeaderRef = useRef<ScrollView>(null);
  const nameColRef = useRef<ScrollView>(null);
  const hBodyRef   = useRef<ScrollView>(null);
  const hScrollX   = useRef(0);
  const [tableBodyH, setTableBodyH] = useState(0); // measured body height for scroll constraints

  type UtilMode = "Weekly" | "Monthly";
  const [utilMode, setUtilMode] = useState<UtilMode>("Weekly");
  const [showQDropdown, setShowQDropdown] = useState(false);
  const [showUtilFilters, setShowUtilFilters] = useState(false);
  const [utilFilters, setUtilFilters] = useState<UtilFilterOptions>({
    includeClosedProject: true,
    includeSoftAllocations: false,
    onlyNCO: false,
    showActuals: false,
  });
  const activeFilterCount = [utilFilters.includeClosedProject, utilFilters.includeSoftAllocations, utilFilters.onlyNCO, utilFilters.showActuals].filter(Boolean).length;

  const buildQuarters = () => {
    const now = new Date();
    const curQ = Math.floor(now.getMonth() / 3);
    const curY = now.getFullYear();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const quarters: { label: string; sd: string; ed: string }[] = [];
    for (let offset = -12; offset <= 4; offset++) {
      const q = ((curQ + offset) % 4 + 4) % 4;
      const y = curY + Math.floor((curQ + offset) / 4);
      const startMonth = q * 3 + 1;
      const endMonth = q * 3 + 3;
      const lastDay = new Date(y, endMonth, 0).getDate();
      const sd = `${y}-${pad2(startMonth)}-01`;
      const ed = `${y}-${pad2(endMonth)}-${pad2(lastDay)}`;
      quarters.push({ label: `Q${q + 1} ${y}`, sd, ed });
    }
    return quarters;
  };
  const allQuarters = buildQuarters();
  const currentQLabel = (() => {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3);
    return `Q${q + 1} ${now.getFullYear()}`;
  })();

  const [selectedQ, setSelectedQ] = useState(currentQLabel);
  const selectedQuarter = allQuarters.find(q => q.label === selectedQ) || allQuarters[3];
  const utilFrom = selectedQuarter.sd;
  const utilTo = selectedQuarter.ed;

  // forceRefresh=true: busts only the specific date-range cache key (user explicitly searched)
  // forceRefresh=false: returns cached result if available (initial tab open)
  const runUtilization = useCallback(async (from: string, to: string, mode: UtilMode = "Weekly", forceRefresh = true, filt?: UtilFilterOptions) => {
    const f = filt ?? utilFilters;
    const peeked = !forceRefresh ? peekUtilization(from, to, mode) : undefined;
    if (peeked) { setUtilData(peeked); return; }
    setUtilError(null);
    let resolved = false;
    const showSpinnerTimer = forceRefresh
      ? (setUtilLoading(true), undefined)
      : setTimeout(() => { if (!resolved) setUtilLoading(true); }, 400);
    try {
      const data = await getAllocationUtilization(from, to, mode, forceRefresh, undefined, f);
      resolved = true;
      setUtilData(data);
    } catch (e) {
      resolved = true;
      const raw = String(e);
      bustCache(`util:v8:${from}:${to}:${mode}`);
      let friendlyMsg = "Something went wrong. Please try again.";
      if (raw.includes("abort") || raw.includes("timed out") || raw.includes("504") || raw.includes("timeout")) {
        friendlyMsg = "The server is taking too long to respond for this date range. Please try again in a moment.";
      } else if (raw.includes("401") || raw.includes("Unauthorized")) {
        friendlyMsg = "Your session has expired. Please log in again.";
      } else if (raw.includes("502") || raw.includes("503")) {
        friendlyMsg = "The RM ONE server is temporarily unavailable. Please try again shortly.";
      } else if (raw.includes("Network") || raw.includes("fetch")) {
        friendlyMsg = "Unable to connect. Please check your network and try again.";
      }
      setUtilError(friendlyMsg);
    } finally {
      if (showSpinnerTimer) clearTimeout(showSpinnerTimer);
      setUtilLoading(false);
    }
  }, [utilFilters]);

  const loadUtilization = useCallback(async (sd?: string, ed?: string, mode?: UtilMode) => {
    const from = sd ?? utilFrom;
    const to   = ed ?? utilTo;
    const m = mode ?? utilMode;
    await runUtilization(from, to, m, false);
  }, [utilFrom, utilTo, utilMode, runUtilization]);

  const openModal = (r: LiveResource, type: ModalType) => {
    auditOpen({ entityType: "resource", entityId: r.id });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setModalResource(r);
    setModalType(type);
  };
  const closeModal = () => {
    auditClose({ screen: "resources" });
    setModalType(null);
    setModalResource(null);
    setModalProjectSearch("");
  };

  const _peek = peekResourceAllocations();
  const [total, setTotal]             = useState(_peek?.total ?? 0);
  const [bench, setBench]             = useState(_peek?.bench ?? 0);
  const [healthy, setHealthy]         = useState(_peek?.healthy ?? 0);
  const [overAllocated, setOverAlloc] = useState(_peek?.overAllocated ?? 0);
  // Re-renders once the admin-tunable employment-type name colors load.
  useEmpColorsVersion();
  const [resources, setResources]     = useState<LiveResource[]>(_peek?.resources ?? []);
  const [projectNames, setProjectNames] = useState<Record<string, string>>(_peek?.projectNameMap ?? {});
  const pName = useCallback((pid: string) => projectNames[pid] || pid, [projectNames]);

  const applyData = useCallback((data: typeof _peek) => {
    if (!data) return;
    setTotal(data.total);
    setBench(data.bench);
    setHealthy(data.healthy);
    setOverAlloc(data.overAllocated);
    setResources(data.resources);
    if (data.projectNameMap) setProjectNames(prev => ({ ...prev, ...data.projectNameMap }));
  }, []);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else {
        const peeked = peekResourceAllocations();
        if (peeked) applyData(peeked);
        else setLoading(true);
        const peekedCon = peekModuleRecords("CON");
        if (peekedCon) {
          const conMapped = (peekedCon.data ?? [])
            .map(mapCON)
            .filter(c => c.id)
            .sort((a, b) => a.name.localeCompare(b.name));
          setContacts(conMapped);
        }
      }
      setError(null);
      const results = await Promise.allSettled([
        getResourceAllocations((fresh) => applyData(fresh)),
        getModuleRecords("CON"),
      ]);
      if (results[0].status === "fulfilled") {
        applyData(results[0].value);
      } else {
        const reason = String(results[0].reason);
        console.warn("[Resources] Allocations failed:", reason);
        setResources(prev => {
          if (prev.length === 0) {
            if (reason.includes("401") || reason.includes("Unauthorized")) setError("Your session has expired. Please log in again.");
            else if (reason.includes("timed out") || reason.includes("timeout")) setError("The server is taking too long to respond. Please try again.");
            else setError("Unable to load staff data. Please try again.");
          }
          return prev;
        });
      }
      if (results[1].status === "fulfilled") {
        const conRaw = results[1].value.data ?? [];
        const conMapped = conRaw
          .map(mapCON)
          .filter(c => c.id)
          .sort((a, b) => a.name.localeCompare(b.name));
        setContacts(conMapped);
        if (conMapped.length === 0 && !isRefresh) {
          console.log("[Resources] CON returned 0 records on initial load, scheduling retry…");
          setTimeout(async () => {
            try {
              bustCacheByPrefix("module:CON:");
              const retry = await getModuleRecords("CON");
              const mapped = (retry.data ?? [])
                .map(mapCON)
                .filter((c: Contact) => c.id)
                .sort((a: Contact, b: Contact) => a.name.localeCompare(b.name));
              if (mapped.length > 0) {
                setContacts(mapped);
                console.log("[Resources] CON retry got", mapped.length, "contacts");
              }
            } catch {}
          }, 3000);
        }
      } else {
        console.warn("[Resources] Contacts failed:", String(results[1].reason));
        setTimeout(async () => {
          try {
            console.log("[Resources] Retrying CON fetch…");
            bustCacheByPrefix("module:CON:");
            const retry = await getModuleRecords("CON");
            const conMapped = (retry.data ?? [])
              .map(mapCON)
              .filter((c: Contact) => c.id)
              .sort((a: Contact, b: Contact) => a.name.localeCompare(b.name));
            setContacts(conMapped);
            console.log("[Resources] CON retry succeeded:", conMapped.length, "contacts");
          } catch (e2) {
            console.warn("[Resources] CON retry also failed:", String(e2));
          }
        }, 2000);
      }
    } catch (e) {
      console.warn("[Resources] loadData error:", String(e));
      // Only surface the error when we have no cached data to show
      setResources(prev => {
        if (prev.length === 0) {
          const raw = String(e);
          if (raw.includes("401") || raw.includes("Unauthorized")) setError("Your session has expired. Please log in again.");
          else if (raw.includes("timed out") || raw.includes("504") || raw.includes("timeout")) setError("The server is taking too long to respond. Please try again.");
          else if (raw.includes("Network") || raw.includes("fetch")) setError("Unable to connect. Please check your network.");
          else setError("Something went wrong. Please try again.");
        }
        return prev;
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyData]);

  const [demandError, setDemandError] = useState<string | null>(null);
  const loadDemands = useCallback(async () => {
    try {
      setDemandLoading(true);
      setDemandError(null);
      const res = await getResourceDemands();
      setDemandItems(res.data ?? []);
    } catch (e) {
      console.warn("[Resources] loadDemands error:", String(e));
      setDemandError("Unable to load demand data");
    }
    finally { setDemandLoading(false); }
  }, []);

  useEffect(() => {
    return onCacheBust(() => { loadData(true); });
  }, [loadData]);
  useFocusEffect(useCallback(() => {
    if (isResourceCacheFresh() && resources.length > 0) {
      return;
    }
    loadData();
  }, [loadData, resources.length]));

  useEffect(() => {
    const peeked = peekUtilization(utilFrom, utilTo, utilMode);
    if (peeked) {
      setUtilData(peeked);
    } else {
      loadUtilization();
    }
    loadDemands();
  }, []);

  const underCount = threshold === 0
    ? resources.filter(r => r.currentPct === 0).length
    : resources.filter(r => r.currentPct >= 0 && r.currentPct <= threshold).length;

  const filtered = resources.filter(r => {
    if (r.currentPct > threshold) return false;
    if (search.trim()) {
      // Normalized matching — treats hyphens, slashes, and extra whitespace as
      // equivalent so "anne marie" matches "Anne-Marie" and "PMM 25 000169"
      // matches "PMM-25-000169".
      if (nameMatches(r.name, search) || nameMatches(r.role, search)) return true;
      if (r.email && nameMatches(r.email, search)) return true;
      if (r.activeProjects.some(pid => nameMatches(pid, search))) return true;
      if (r.allProjectIds.some(pid => nameMatches(pid, search))) return true;
      if (r.activeProjects.some(pid => nameMatches(pName(pid), search))) return true;
      return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <View style={[styles.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Resources</Text>
          <Text style={styles.headerSub}>
            {loading ? "Loading..." :
              resView === "Staff"
                ? <><Text style={styles.headerSubBold}>{total}</Text>{` staff`}{healthy > 0 ? <>{` · `}<Text style={{ color: Colors.green }}>{healthy} optimal</Text></> : null}{overAllocated > 0 ? <>{` · `}<Text style={{ color: Colors.orange }}>{overAllocated} overloaded</Text></> : null}</>
                : resView === "Contacts"
                ? <><Text style={styles.headerSubBold}>{contacts.length}</Text>{` contacts · CON`}</>
                : resView === "Demand"
                ? <><Text style={styles.headerSubBold}>{demandItems.length}</Text>{` demand items · ${demandItems.filter(d => d.SoftAllocation).length} soft`}</>
                : utilData ? <><Text style={styles.headerSubBold}>{utilData.resources.filter(r => r.weeks.some(w => w.pct > 0)).length}</Text>{` active of ${utilData.resources.length} · ${utilData.periods.length} ${utilMode === "Monthly" ? "months" : "weeks"} · ${selectedQ}`}{activeFilterCount > 0 ? <Text style={{ color: Colors.green }}>{` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}`}</Text> : null}</> : `${utilMode} allocation grid`
            }
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            style={[styles.addBtn, refreshing && { opacity: 0.7 }]}
            disabled={refreshing}
            onPress={() => { auditAction({ screen: "resources" }); bustCache(); loadData(true); loadDemands(); }}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Feather name="refresh-cw" size={14} color={Colors.white} />
            )}
            <Text style={styles.addBtnText}>{refreshing ? "Refreshing…" : "Refresh"}</Text>
          </Pressable>
          <ProfileMenu topOffset={Math.max(insets.top, Platform.OS === "web" ? 54 : 0)} />
        </View>
      </View>

      {/* ── Staff / Contacts / Timeline toggle ─────────────────────────── */}
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
        {(["Timeline", "Staff", "Demand", "Contacts"] as ResView[]).map(v => (
          <Pressable
            key={v}
            style={[styles.tabPill, resView === v && styles.tabPillActive, { flex: 1 }]}
            onPress={() => {
              auditFilter({ screen: "resources" });
              setResView(v);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (v === "Timeline" && !utilData && !utilLoading) {
                const peeked = peekUtilization(utilFrom, utilTo, utilMode);
                if (peeked) { setUtilData(peeked); } else { loadUtilization(); }
              }
              if (v === "Demand" && demandItems.length === 0 && !demandLoading) loadDemands();
              if (v === "Contacts" && contacts.length === 0 && !loading) {
                (async () => {
                  try {
                    setLoading(true);
                    bustCacheByPrefix("module:CON:");
                    const res = await getModuleRecords("CON");
                    const mapped = (res.data ?? [])
                      .map(mapCON)
                      .filter((c: Contact) => c.id)
                      .sort((a: Contact, b: Contact) => a.name.localeCompare(b.name));
                    setContacts(mapped);
                  } catch (e) {
                    console.warn("[Resources] CRM reload failed:", String(e));
                  } finally { setLoading(false); }
                })();
              }
            }}
          >
            <Text style={[styles.tabText, resView === v && styles.tabTextActive, { fontSize: 10 }]}>
              {v === "Staff" ? `Staff (${total})` : v === "Contacts" ? `CRM (${contacts.length})` : v === "Demand" ? `Demand (${demandItems.length})` : "Timeline"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Timeline controls: quarter dropdown + mode toggle ─────── */}
      {resView === "Timeline" && (() => {
        const pickQ = (q: typeof allQuarters[number]) => {
          auditFilter({ screen: "resources" });
          setSelectedQ(q.label);
          setShowQDropdown(false);
          const peeked = peekUtilization(q.sd, q.ed, utilMode);
          if (peeked) {
            setUtilData(peeked);
            setUtilLoading(false);
            setUtilError(null);
          } else {
            setUtilLoading(true);
            setUtilError(null);
            runUtilization(q.sd, q.ed, utilMode, false);
          }
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        };
        return (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8 }}>
              <Pressable
                onPress={() => { auditOpen({ screen: "resources" }); setShowQDropdown(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.green, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 }}
              >
                <Feather name="calendar" size={13} color="#fff" />
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>{selectedQ}</Text>
                <Feather name="chevron-down" size={12} color="#fff" />
              </Pressable>

              <View style={{ flexDirection: "row", backgroundColor: Colors.darkCard, borderRadius: 10, borderWidth: 2, borderColor: Colors.cardBorderStrong, overflow: "hidden" }}>
                {(["Weekly", "Monthly"] as UtilMode[]).map(m => (
                  <Pressable
                    key={m}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8,
                      backgroundColor: utilMode === m ? Colors.green : "transparent",
                      borderRadius: utilMode === m ? 8 : 0,
                    }}
                    onPress={() => {
                      auditFilter({ screen: "resources" });
                      setUtilMode(m);
                      const peeked = peekUtilization(utilFrom, utilTo, m);
                      if (peeked) { setUtilData(peeked); setUtilLoading(false); setUtilError(null); }
                      else { setUtilData(null); runUtilization(utilFrom, utilTo, m, false); }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: utilMode === m ? "#fff" : Colors.textPrimary }}>{m}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Modal visible={showQDropdown} transparent animationType="fade" onRequestClose={() => { auditClose({ screen: "resources" }); setShowQDropdown(false); }}>
              <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center" }} onPress={() => { auditClose({ screen: "resources" }); setShowQDropdown(false); }}>
                <Pressable style={{ backgroundColor: Colors.dark, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, width: 220, maxHeight: 380, overflow: "hidden" }} onPress={() => {}}>
                  <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary }}>Select Quarter</Text>
                  </View>
                  <ScrollView showsVerticalScrollIndicator nestedScrollEnabled>
                    {allQuarters.slice().reverse().map((q) => {
                      const isSelected = q.label === selectedQ;
                      const isCurrent = q.label === currentQLabel;
                      return (
                        <Pressable
                          key={q.label}
                          style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11, backgroundColor: isSelected ? Colors.orange + "15" : "transparent" }}
                          onPress={() => pickQ(q)}
                        >
                          {isSelected && <Feather name="check" size={13} color={Colors.orange} style={{ marginRight: 8 }} />}
                          <Text style={{ fontFamily: isSelected ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 14, color: isSelected ? Colors.orange : Colors.textPrimary, flex: 1 }}>{q.label}</Text>
                          {isCurrent && !isSelected && <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted }}>current</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>
          </>
        );
      })()}

      {/* ── Search ─────────────────────────────────────────────────────── */}
      {resView === "Staff" && (
        <View style={styles.searchRow}>
          <Feather name="search" size={14} color={Colors.textSecondary} style={{ marginRight: 8 }} />
          <AppTextInput
            style={styles.searchInput}
            placeholder="Search name, role, or project…"
            placeholderTextColor={Colors.textSecondary}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => auditSearch({ screen: "resources" })}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={14} color={Colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {/* ── Threshold Slider (always visible on Staff) ───────────────── */}
      {resView === "Staff" && (
        <View>
          <ThresholdSlider value={threshold} onChange={setThreshold} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>
              Showing staff under <Text style={{ color: Colors.orange, fontWeight: "700" }}>{Math.round(threshold)}%</Text> allocation
            </Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 12 }}>
              {filtered.length} of {total}
            </Text>
          </View>
        </View>
      )}

      {/* ══ TIMELINE VIEW ═══════════════════════════════════════════════ */}
      {resView === "Timeline" && (
        <View style={{ flex: 1 }}>
          {/* Search + Refresh */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}>
            <View style={[styles.searchRow, { flex: 1, margin: 0 }]}>
              <Feather name="search" size={14} color={Colors.textSecondary} style={{ marginRight: 8 }} />
              <AppTextInput
                style={styles.searchInput}
                placeholder="Filter by name…"
                placeholderTextColor={Colors.textSecondary}
                value={utilSearch}
                onChangeText={setUtilSearch}
                onSubmitEditing={() => auditSearch({ screen: "resources" })}
                returnKeyType="search"
              />
              {utilSearch.length > 0 && (
                <Pressable onPress={() => setUtilSearch("")}>
                  <Feather name="x" size={14} color={Colors.textSecondary} />
                </Pressable>
              )}
            </View>
            <Pressable
              style={[{ backgroundColor: Colors.darkCard, borderRadius: 10, padding: 9 }, activeFilterCount > 0 && { backgroundColor: Colors.green }]}
              onPress={() => {
                if (showUtilFilters) auditClose({ screen: "resources" });
                else auditOpen({ screen: "resources" });
                setShowUtilFilters(prev => !prev);
              }}
            >
              <Feather name="sliders" size={14} color={activeFilterCount > 0 ? "#fff" : Colors.textSecondary} />
              {activeFilterCount > 0 && (
                <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: Colors.orange, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: "#fff" }}>{activeFilterCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              style={{ backgroundColor: Colors.darkCard, borderRadius: 10, padding: 9 }}
              onPress={() => loadUtilization()}
            >
              <Feather name="refresh-cw" size={14} color={utilLoading ? Colors.green : Colors.textSecondary} />
            </Pressable>
          </View>

          {showUtilFilters && (
            <View style={{ backgroundColor: Colors.darkCard, marginHorizontal: 16, borderRadius: 12, padding: 12, marginBottom: 8 }}>
              {([
                { key: "includeClosedProject" as const,      label: "Closed Projects" },
                { key: "includeSoftAllocations" as const,    label: "Include Soft Allocations" },
                { key: "onlyNCO" as const,                   label: "Only NCO" },
                { key: "showActuals" as const,               label: "Show Actuals" },
              ]).map(opt => (
                <Pressable
                  key={opt.key}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: opt.key === "showActuals" ? 0 : StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.08)" }}
                  onPress={() => {
                    auditFilter({ screen: "resources" });
                    setUtilFilters(prev => ({ ...prev, [opt.key]: !prev[opt.key] }));
                  }}
                >
                  <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textPrimary }}>{opt.label}</Text>
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: utilFilters[opt.key] ? Colors.green : Colors.textSecondary, backgroundColor: utilFilters[opt.key] ? Colors.green : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {utilFilters[opt.key] && <Feather name="check" size={14} color="#fff" />}
                  </View>
                </Pressable>
              ))}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Pressable
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center" }}
                  onPress={() => {
                    auditClose({ screen: "resources" });
                    setShowUtilFilters(false);
                  }}
                >
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.green, alignItems: "center" }}
                  onPress={() => {
                    auditFilter({ screen: "resources" });
                    setShowUtilFilters(false);
                    runUtilization(utilFrom, utilTo, utilMode, true, utilFilters);
                  }}
                >
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" }}>Apply</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Legend */}
          <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingBottom: 8, flexWrap: "wrap" }}>
            {[
              { color: Colors.green,  label: `Good ≥${underAllocatedPct}%` },
              { color: Colors.red,    label: `Under <${underAllocatedPct}%` },
              { color: "#F08C22",     label: `Over >${overCapacityPct}%` },
            ].map(l => (
              <View key={l.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: l.color }} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary }}>{l.label}</Text>
              </View>
            ))}
          </View>

          {utilLoading ? (() => {
            const hint = `Loading ${utilMode.toLowerCase()} utilization for ${selectedQ}…`;
            return (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={Colors.green} />
                <Text style={styles.loadingText}>Loading…</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, textAlign: "center", marginTop: 6, paddingHorizontal: 30 }}>{hint}</Text>
              </View>
            );
          })() : utilError && (!utilData || utilData.resources.length === 0) ? (
            <View style={styles.centerBox}>
              <Feather name="alert-circle" size={32} color={Colors.red} />
              <Text style={styles.errorText}>{utilError}</Text>
              <Pressable style={styles.retryBtn} onPress={() => runUtilization(utilFrom, utilTo, utilMode, true)}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : !utilData || utilData.resources.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="calendar" size={32} color={Colors.textMuted} />
              <Text style={styles.errorText}>No utilization data found</Text>
              <Pressable style={styles.retryBtn} onPress={() => loadUtilization()}>
                <Text style={styles.retryBtnText}>Load Data</Text>
              </Pressable>
            </View>
          ) : (() => {
            const filteredUtil = utilSearch.trim()
              ? utilData.resources.filter(r => r.name.toLowerCase().includes(utilSearch.toLowerCase()))
              : utilData.resources;
            const NAME_W  = 118;
            const ROW_H   = 40;
            const HDR_H   = 30;
            const numPeriods = utilData.periods.length;
            const CELL_W = utilMode === "Monthly" && numPeriods > 0
              ? Math.max(56, Math.floor((screenW - NAME_W) / numPeriods))
              : 56;
            const months: Record<string,string> = { Jan:"1",Feb:"2",Mar:"3",Apr:"4",May:"5",Jun:"6",Jul:"7",Aug:"8",Sep:"9",Oct:"10",Nov:"11",Dec:"12" };

            if (filteredUtil.length === 0) {
              return (
                <View style={{ flex: 1, padding: 40, alignItems: "center" }}>
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted }}>No results for "{utilSearch}"</Text>
                </View>
              );
            }

            const bH = tableBodyH > 60 ? tableBodyH : 400; // fallback until measured

            return (
              <View
                style={{ flex: 1 }}
                onLayout={e => {
                  const h = e.nativeEvent.layout.height - HDR_H;
                  if (h > 60 && h !== tableBodyH) setTableBodyH(h);
                }}
              >
                {/* ── Fixed header row (never scrolls vertically) ─────────── */}
                <View style={{ flexDirection: "row", height: HDR_H, backgroundColor: Colors.darkDeep, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                  <View style={{ width: NAME_W, justifyContent: "center", paddingHorizontal: 10, borderRightWidth: 1, borderRightColor: Colors.border + "60" }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.textSecondary, letterSpacing: 1 }}>PERSON</Text>
                  </View>
                  {/* Date headers – driven by body horizontal scroll */}
                  <ScrollView ref={hHeaderRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row" }}>
                      {utilData.periods.map(p => {
                        const parts = p.split("-");
                        const label = `${months[parts[0]] ?? parts[0]}/${parseInt(parts[1] ?? "0", 10)}`;
                        return (
                          <Pressable key={p} onPress={() => { auditOpen({ screen: "resources" }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeekColModal({ period: p }); }} style={({ pressed }) => ({ width: CELL_W, alignItems: "center", justifyContent: "center", borderLeftWidth: 1, borderLeftColor: Colors.border + "40", backgroundColor: pressed ? Colors.green + "22" : "transparent" })}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 9, color: Colors.green }}>{label}</Text>
                            <Feather name="chevron-down" size={7} color={Colors.green + "80"} />
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>

                {/* ── Horizontal scroll arrows ─────────────────────────── */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.border + "40" }}>
                  <Pressable
                    onPress={() => {
                      const x = Math.max(0, hScrollX.current - CELL_W * 3);
                      hBodyRef.current?.scrollTo({ x, animated: true });
                    }}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: Colors.darkCard }}
                  >
                    <Feather name="chevron-left" size={14} color={Colors.textSecondary} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.textSecondary, marginLeft: 2 }}>Scroll</Text>
                  </Pressable>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.textSecondary }}>
                    {utilData.periods.length} {utilMode === "Monthly" ? "months" : "weeks"} — swipe or tap arrows
                  </Text>
                  <Pressable
                    onPress={() => {
                      const maxX = NAME_W + CELL_W * utilData!.periods.length;
                      const x = Math.min(maxX, hScrollX.current + CELL_W * 3);
                      hBodyRef.current?.scrollTo({ x, animated: true });
                    }}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: Colors.darkCard }}
                  >
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.textSecondary, marginRight: 2 }}>Scroll</Text>
                    <Feather name="chevron-right" size={14} color={Colors.textSecondary} />
                  </Pressable>
                </View>

                {/* ── Body: unified scroll — name overlay + full-width data ─── */}
                <View style={{ flex: 1, height: bH, position: "relative" }}>
                  <ScrollView
                    ref={hBodyRef}
                    horizontal
                    showsHorizontalScrollIndicator={true}
                    directionalLockEnabled={true}
                    style={{ flex: 1, height: bH }}
                    onScroll={e => {
                      const x = e.nativeEvent.contentOffset.x;
                      hScrollX.current = x;
                      hHeaderRef.current?.scrollTo({ x, animated: false });
                    }}
                    scrollEventThrottle={16}
                  >
                    <ScrollView
                      style={{ height: bH }}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      directionalLockEnabled={true}
                      contentContainerStyle={{ paddingBottom: 80 }}
                      onScroll={e => nameColRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false })}
                      scrollEventThrottle={16}
                    >
                      {filteredUtil.map((r, i) => (
                        <View key={r.userId || `u${i}`} style={{ flexDirection: "row", height: ROW_H, borderBottomWidth: 1, borderBottomColor: Colors.border + "30" }}>
                          <View style={{ width: NAME_W }} />
                          {r.weeks.map(w => {
                            const bg = w.pct > overCapacityPct ? "#F08C22" : w.pct >= underAllocatedPct ? Colors.green : Colors.red;
                            return (
                              <Pressable
                                key={w.period}
                                onPress={() => w.hours > 0 ? openCellModal(r.name, w.period, { pct: w.pct, hours: w.hours }, r.userId) : openAnalysis(r.name, w.period)}
                                style={({ pressed }) => ({ width: CELL_W, height: ROW_H, alignItems: "center", justifyContent: "center", backgroundColor: bg + (pressed ? "44" : "22"), borderLeftWidth: 1, borderLeftColor: Colors.border + "30" })}
                              >
                                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: w.hours > 0 ? "#FFFFFF" : Colors.textMuted + "50" }}>{w.hours > 0 ? w.hours : 0}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ))}
                    </ScrollView>
                  </ScrollView>

                  <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, width: NAME_W, height: bH, backgroundColor: Colors.darkDeep, borderRightWidth: 1, borderRightColor: Colors.border + "60" }}>
                    <ScrollView
                      ref={nameColRef}
                      scrollEnabled={false}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={{ paddingBottom: 80 }}
                    >
                      {filteredUtil.map((r, i) => (
                        <Pressable
                          key={r.userId || `nu${i}`}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openAnalysis(r.name); }}
                          style={({ pressed }) => ({ height: ROW_H, justifyContent: "center", paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: Colors.border + "30", backgroundColor: pressed ? Colors.green + "20" : "transparent" })}
                        >
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.textPrimary }} numberOfLines={1}>{r.name}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </View>
            );
          })()}
        </View>
      )}

      {resView === "Contacts" ? (
        /* ── Contacts View ─────────────────────────────────────────────── */
        <View style={{ flex: 1 }}>
          <View style={styles.searchRow}>
            <Feather name="search" size={14} color={Colors.textSecondary} style={{ marginRight: 8 }} />
            <AppTextInput
              style={styles.searchInput}
              placeholder="Search contact or company…"
              placeholderTextColor={Colors.textSecondary}
              value={contactsSearch}
              onChangeText={(text) => {
                setContactsSearch(text);
                if (contactsSearchTimer.current) clearTimeout(contactsSearchTimer.current);
                contactsSearchTimer.current = setTimeout(() => setContactsSearchDebounced(text), 300);
              }}
              onSubmitEditing={() => auditSearch({ screen: "resources" })}
              returnKeyType="search"
            />
            {contactsSearch.length > 0 && (
              <Pressable onPress={() => { setContactsSearch(""); setContactsSearchDebounced(""); if (contactsSearchTimer.current) clearTimeout(contactsSearchTimer.current); }}>
                <Feather name="x" size={14} color={Colors.textSecondary} />
              </Pressable>
            )}
          </View>
          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={Colors.green} />
              <Text style={styles.loadingText}>Loading contacts…</Text>
            </View>
          ) : contacts.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="users" size={32} color={Colors.textMuted} />
              <Text style={styles.errorText}>No contacts found</Text>
            </View>
          ) : (
            <FlatList
              data={(() => {
                const csq = contactsSearchDebounced.toLowerCase().trim();
                if (!csq) return contacts;
                return contacts.filter(c =>
                  c.name.toLowerCase().includes(csq) ||
                  c.company.toLowerCase().includes(csq) ||
                  c.email.toLowerCase().includes(csq)
                );
              })()}
              keyExtractor={(c) => c.id}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 110 }}
              showsVerticalScrollIndicator={false}
              initialNumToRender={30}
              maxToRenderPerBatch={30}
              windowSize={11}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              removeClippedSubviews={true}
              renderItem={({ item: c, index: idx }) => {
                const displayName = c.name || c.email.replace("—", "") || c.id;
                const hasInitials = c.name.trim().length > 0;
                return (
                  <View
                    style={idx === 0 ? { backgroundColor: "#fff", borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: "hidden", width: "100%" } : { backgroundColor: "#fff", width: "100%" }}
                  >
                    {idx > 0 && <View style={{ height: 1, backgroundColor: "#F0F0F0", marginLeft: 64 }} />}
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 12 }}>
                      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: hasInitials ? Colors.green + "20" : "#E8E8E8", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {hasInitials ? (
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>{initials(c.name)}</Text>
                        ) : (
                          <Feather name="user" size={16} color="#AAAAAA" />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#111", lineHeight: 18 }} numberOfLines={1}>
                          {displayName}
                        </Text>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#999", lineHeight: 14, marginTop: 1 }} numberOfLines={1}>{c.id}</Text>
                        {c.title ? (
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#777", lineHeight: 16, marginTop: 1 }} numberOfLines={1}>{c.title}</Text>
                        ) : null}
                        {c.company ? (
                          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.green, lineHeight: 16, marginTop: 1 }} numberOfLines={1}>{c.company}</Text>
                        ) : c.email !== "—" ? (
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "#999", lineHeight: 16, marginTop: 1 }} numberOfLines={1}>{c.email}</Text>
                        ) : null}
                      </View>
                      {c.city ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
                          <Feather name="map-pin" size={10} color="#AAAAAA" />
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "#AAAAAA" }}>{c.city}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : null}

      {/* ── Demand View ──────────────────────────────────────────────── */}
      {resView === "Demand" && (
        <View style={{ flex: 1 }}>
          <View style={styles.searchRow}>
            <Feather name="search" size={14} color={Colors.textSecondary} style={{ marginRight: 8 }} />
            <AppTextInput
              style={styles.searchInput}
              placeholder="Filter by project or role…"
              placeholderTextColor={Colors.textSecondary}
              value={demandSearch}
              onChangeText={setDemandSearch}
              onSubmitEditing={() => auditSearch({ screen: "resources" })}
              returnKeyType="search"
            />
            {demandSearch.length > 0 && (
              <Pressable onPress={() => setDemandSearch("")}>
                <Feather name="x" size={14} color={Colors.textSecondary} />
              </Pressable>
            )}
          </View>
          {demandLoading && demandItems.length === 0 ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={Colors.green} />
              <Text style={styles.loadingText}>Loading demand items…</Text>
            </View>
          ) : demandError ? (
            <View style={styles.centerBox}>
              <Feather name="alert-circle" size={32} color={Colors.red} />
              <Text style={styles.errorText}>{demandError}</Text>
              <Pressable onPress={loadDemands} style={{ marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.green, borderRadius: 8 }}>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" }}>Retry</Text>
              </Pressable>
            </View>
          ) : demandItems.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="inbox" size={32} color={Colors.textMuted} />
              <Text style={styles.errorText}>No staffing demands found</Text>
            </View>
          ) : (() => {
            const q = demandSearch.toLowerCase();
            // Shared abbreviation-aware role matching ("PM" ⇄ "Project
            // Manager"); title/ID stay plain substring.
            const roleMatch = roleQueryMatcher(q);
            const filteredDemands = q
              ? demandItems.filter(d =>
                  (d.Title ?? "").toLowerCase().includes(q) ||
                  (d.TicketId ?? "").toLowerCase().includes(q) ||
                  roleMatch(d.Role)
                )
              : demandItems;
            const fmtD = (v: string | null) => {
              if (!v) return "—";
              const dt = new Date(v);
              return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
            };
            return (
              <FlatList
                data={filteredDemands}
                keyExtractor={(d, i) => `${d.TicketId}-${d.Role}-${i}`}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={11}
                ListEmptyComponent={
                  <View style={styles.centerBox}>
                    <Feather name="inbox" size={32} color={Colors.textMuted} />
                    <Text style={styles.errorText}>{q ? "No demands match your search" : "No active staffing demands"}</Text>
                  </View>
                }
                contentContainerStyle={{ paddingBottom: 120, paddingTop: 12 }}
                showsVerticalScrollIndicator={false}
                renderItem={({ item: d }) => (
                  <Pressable
                    style={[styles.whiteCard, { marginHorizontal: 16, marginTop: 6 }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      if (d.TicketId) router.push(`/project/${d.TicketId}`);
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.green }}>{d.TicketId}</Text>
                      {d.SoftAllocation && (
                        <View style={{ backgroundColor: Colors.orange + "20", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 9, color: Colors.orange }}>SOFT</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText, marginBottom: 6 }} numberOfLines={2}>{d.Title}</Text>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>ROLE</Text>
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText }}>{d.Role || "—"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>ALLOCATION</Text>
                        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.green }}>{Math.round(Number(d.PctAllocation) || 0)}%</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.cardBorder }}>
                      <View>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>START</Text>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardText }}>{fmtD(d.AllocationStartDate)}</Text>
                      </View>
                      <View style={{ alignItems: "center" }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>END</Text>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardText }}>{fmtD(d.AllocationEndDate)}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted }}>VALUE</Text>
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.cardText }}>{d.ApproxContractValue >= 1_000_000_000 ? compactUsd(d.ApproxContractValue) : d.ApproxContractValue >= 1_000_000 ? `$${(d.ApproxContractValue / 1_000_000).toFixed(1)}M` : d.ApproxContractValue > 0 ? `$${(d.ApproxContractValue / 1_000).toFixed(0)}K` : "—"}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                      <Pressable
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 7, backgroundColor: Colors.dark + "10", borderRadius: 6, borderWidth: 1.25, borderColor: "#253746" }}
                        onPress={(e) => {
                          e.stopPropagation();
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          if (d.TicketId) router.push(`/project/${d.TicketId}`);
                        }}
                      >
                        <Feather name="external-link" size={12} color={Colors.cardText} />
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.cardText }}>View Details</Text>
                      </Pressable>
                      <Pressable
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 7, backgroundColor: Colors.green + "12", borderRadius: 6, borderWidth: 1, borderColor: Colors.green + "30" }}
                        onPress={(e) => {
                          e.stopPropagation();
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          pushChat(`Find staff for demand: Project ${d.TicketId} (${d.Title}) needs a ${d.Role} at ${d.PctAllocation}% from ${fmtD(d.AllocationStartDate)} to ${fmtD(d.AllocationEndDate)}.`);
                        }}
                      >
                        <Feather name="user-check" size={12} color={Colors.green} />
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.green }}>Find Staff AI</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                )}
              />
            );
          })()}
        </View>
      )}

      {/* ── Staff Body ─────────────────────────────────────────────────── */}
      {resView === "Staff" && (loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={Colors.green} />
          <Text style={styles.loadingText}>Loading resource data…</Text>
        </View>
      ) : error ? (
        <View style={styles.centerBox}>
          <Feather name="alert-circle" size={32} color={Colors.red} />
          <Text style={styles.errorText}>Failed to load resources</Text>
          <Pressable style={styles.retryBtn} onPress={() => loadData()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r, i) => `${r.username || r.name}-${i}`}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={11}
          contentContainerStyle={[styles.scroll, { paddingBottom: 110 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              tintColor={Colors.green}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Feather name="users" size={32} color={Colors.textSecondary} />
              <Text style={styles.emptyText}>No results found</Text>
            </View>
          }
          renderItem={({ item: r }) => {
            const uid = r.username || r.name;
            const isSelected = selected === uid;
            const status = statusInfo(r.currentPct, underAllocatedPct, overCapacityPct);
            const isOver  = r.currentPct > overCapacityPct;
            const isBench = r.currentPct === 0;
            const ini = initials(r.name);
            const projectLabel = r.activeProjects.length > 0
              ? r.activeProjects.slice(0, 2).map(pid => pName(pid)).join(", ") + (r.activeProjects.length > 2 ? ` +${r.activeProjects.length - 2}` : "")
              : "— Bench";

            return (
              <Pressable
                onPress={() => {
                  setSelected(isSelected ? null : uid);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={[styles.card,
                  isOver  && { borderColor: Colors.red    + "50" },
                  isBench && { borderColor: Colors.orange + "30" },
                ]}
              >
                <View style={[styles.cardAccent, { backgroundColor: status.color }]} />

                <View style={styles.cardMain}>
                  <View style={[styles.avatar, { backgroundColor: status.color + "18", borderColor: status.color + "50" }]}>
                    <Text style={[styles.avatarText, { color: status.color }]}>{ini}</Text>
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.personName, empTypeColor(r.employeeType) ? { color: empTypeColor(r.employeeType)! } : null]}>{r.name}</Text>
                    <DisabledStaffControl
                      enabled={r.enabled}
                      userGuid={r.id}
                      tenantId={r.tenantId}
                      onReactivated={async (userGuid) => {
                        setResources(prev => prev.map(item => item.id.toLowerCase() === userGuid.toLowerCase() ? { ...item, enabled: true } : item));
                        setModalResource(prev => prev?.id.toLowerCase() === userGuid.toLowerCase() ? { ...prev, enabled: true } : prev);
                        await loadData(true);
                      }}
                    />
                    {r.role ? <Text style={styles.personRole}>{r.role}</Text> : null}
                    <Pressable
                      style={styles.projectRow}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (r.activeProjects.length > 0) {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push(`/project/${r.activeProjects[0]}`);
                        }
                      }}
                    >
                      <Feather name="briefcase" size={10} color={r.activeProjects.length > 0 ? Colors.green : Colors.cardMuted} />
                      <Text style={[styles.projectText, r.activeProjects.length > 0 && { color: Colors.green }]}>{projectLabel}</Text>
                    </Pressable>
                  </View>

                  <View style={styles.allocSide}>
                    <Text style={[styles.allocPct, { color: status.color }]}>{r.currentPct}%</Text>
                    <View style={styles.allocMiniBar}>
                      <View style={[styles.allocMiniFill, {
                        width: `${Math.min(r.currentPct, 100)}%` as any,
                        backgroundColor: status.color,
                      }]} />
                      {r.currentPct > 100 && (
                        <View style={[styles.overBar, { width: `${Math.min(r.currentPct - 100, 20)}%` as any }]} />
                      )}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: status.color + "18" }]}>
                      <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
                    </View>
                  </View>
                </View>

                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, paddingVertical: 8, backgroundColor: status.color + "12", borderRadius: 8, borderWidth: 1, borderColor: status.color + "25" }}
                  onPress={() => {
                    setSelected(isSelected ? null : uid);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Feather name={isSelected ? "chevron-up" : "chevron-down"} size={12} color={status.color} />
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: status.color }}>
                    {isSelected ? "Hide Details" : "View Details"}
                  </Text>
                </Pressable>

                {isSelected && (
                  <View style={styles.expandedSection}>
                    {isOver && (
                      <View style={[styles.impactRow, { backgroundColor: Colors.red + "0E", borderTopColor: Colors.red + "20" }]}>
                        <Feather name="alert-circle" size={12} color={Colors.red} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.impactTitle, { color: Colors.red }]}>
                            Overallocated — {r.currentPct - 100}% over capacity
                          </Text>
                          <Text style={styles.impactSub}>
                            {r.activeProjects.length} active project{r.activeProjects.length !== 1 ? "s" : ""} · review and reduce load
                          </Text>
                        </View>
                      </View>
                    )}

                    {isBench && (
                      <View style={[styles.impactRow, { backgroundColor: Colors.orange + "0E", borderTopColor: Colors.orange + "20" }]}>
                        <Feather name="trending-down" size={12} color={Colors.orange} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.impactTitle, { color: Colors.orange }]}>
                            No active allocation
                          </Text>
                          <Text style={styles.impactSub}>
                            {r.totalProjects} project{r.totalProjects !== 1 ? "s" : ""} total history
                            {r.lastActiveDate ? ` · last active ${r.lastActiveDate}` : ""}
                          </Text>
                        </View>
                      </View>
                    )}
                    {r.activeProjects.length > 0 && (
                      <View style={styles.projectsBlock}>
                        <View style={styles.projectsHeader}>
                          <Feather name="layers" size={11} color={Colors.green} />
                          <Text style={styles.projectsTitle}>ACTIVE PROJECTS</Text>
                        </View>
                        {r.activeProjects.map(pid => (
                          <Pressable
                            key={pid}
                            style={[styles.projectItem, { justifyContent: "space-between", paddingVertical: 8 }]}
                            onPress={(e) => {
                              e.stopPropagation();
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              router.push(`/project/${pid}`);
                            }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                              <Feather name="briefcase" size={11} color={Colors.green} />
                              <Text style={[styles.projectItemText, { color: Colors.green, flex: 1 }]} numberOfLines={1}>{pName(pid)}</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: Colors.green + "15", borderRadius: 6, borderWidth: 1, borderColor: Colors.green + "30" }}>
                              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.green }}>Details</Text>
                              <Feather name="chevron-right" size={10} color={Colors.green} />
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    )}

                    {r.username ? (
                      <View style={styles.emailRow}>
                        <Feather name="mail" size={11} color={Colors.textSecondary} />
                        <Text style={styles.emailText}>{r.username}</Text>
                      </View>
                    ) : null}

                    <View style={styles.statRow}>
                      <Pressable style={styles.statChip} onPress={() => openModal(r, "total")}>
                        <Text style={styles.statVal}>{r.totalProjects}</Text>
                        <Text style={styles.statLabel}>Total Projects</Text>
                        <Feather name="chevron-right" size={10} color={Colors.green} style={{ marginTop: 2 }} />
                      </Pressable>
                      <Pressable style={styles.statChip} onPress={() => openModal(r, "active")}>
                        <Text style={styles.statVal}>{r.activeProjects.length}</Text>
                        <Text style={styles.statLabel}>Currently Active</Text>
                        <Feather name="chevron-right" size={10} color={Colors.green} style={{ marginTop: 2 }} />
                      </Pressable>
                      <Pressable style={styles.statChip} onPress={() => openModal(r, "alloc")}>
                        <Text style={styles.statVal}>{r.currentPct}%</Text>
                        <Text style={styles.statLabel}>Allocated</Text>
                        <Feather name="chevron-right" size={10} color={Colors.green} style={{ marginTop: 2 }} />
                      </Pressable>
                    </View>

                    <View style={styles.expandedActions}>
                      <Pressable
                        style={[styles.expandBtn, { backgroundColor: Colors.green, flex: 1 }]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          setSelected(null);
                          const pctInfo = r.currentPct === 0 ? "on bench with 0% project utilization" : `at ${r.currentPct}% overall allocation`;
                          pushChat(`I want to assign ${r.name}${r.role ? ` (${r.role})` : ""}, who is ${pctInfo}${r.activeProjects.length ? `, ${r.activeProjects.length} currently active` : ""}${r.totalProjects ? `, ${r.totalProjects} total past projects` : ""}. First, look through the PMM active projects data you already have to find 3-5 projects that are currently active (In Progress, Construction, or similar active status). Match them based on the person's job title, past project experience, sector expertise, and location. List each recommended project with its full PMM ID, name, status, value, and why it's a good fit. Do NOT say there are no active projects — there are hundreds of active PMM projects in the data.`);
                        }}
                      >
                        <Feather name="user-check" size={12} color={Colors.white} />
                        <Text style={[styles.expandBtnText, { color: Colors.cardText }]}>Assign</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.expandBtn, { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder, flex: 1 }]}
                        onPress={() => openModal(r, "profile")}
                      >
                        <Feather name="eye" size={12} color={Colors.cardMuted} />
                        <Text style={[styles.expandBtnText, { color: Colors.cardMuted }]}>Profile</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      ))}

      {/* ── Detail Modal ────────────────────────────────────────────────── */}
      <Modal
        visible={modalType !== null}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={closeModal} />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(60, insets.bottom + 20) }]}>

            {/* Handle bar */}
            <View style={styles.modalHandle} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {modalType === "total"   ? "Project History" :
                   modalType === "active"  ? "Active Allocations" :
                   modalType === "profile" ? "Resource Profile" :
                   "Allocation Breakdown"}
                </Text>
                {modalResource && (
                  <Text style={styles.modalSub}>
                    {modalResource.name}{modalResource.role ? ` · ${modalResource.role}` : ""}
                  </Text>
                )}
              </View>
              <Pressable style={styles.modalClose} onPress={closeModal}>
                <Feather name="x" size={16} color={Colors.cardMuted} />
              </Pressable>
            </View>

            {/* Summary badge — hidden for profile type (has its own hero) */}
            {modalResource && modalType !== "profile" && (
              <View style={styles.modalBadgeRow}>
                {modalType === "total" && (() => {
                  const sq = modalProjectSearch.toLowerCase().trim();
                  const count = sq
                    ? modalResource.allProjectIds.filter(pid => pid.toLowerCase().includes(sq) || pName(pid).toLowerCase().includes(sq)).length
                    : modalResource.totalProjects;
                  return (
                    <View style={[styles.modalBadge, { backgroundColor: Colors.green + "18" }]}>
                      <Feather name="briefcase" size={13} color={Colors.green} />
                      <Text style={[styles.modalBadgeText, { color: Colors.green }]}>
                        {sq ? `${count} of ${modalResource.totalProjects} projects` : `${modalResource.totalProjects} total projects`}
                      </Text>
                    </View>
                  );
                })()}
                {modalType === "active" && (
                  <View style={[styles.modalBadge, { backgroundColor: Colors.green + "18" }]}>
                    <Feather name="activity" size={13} color={Colors.green} />
                    <Text style={[styles.modalBadgeText, { color: Colors.green }]}>
                      {modalResource.activeProjects.length} currently active
                    </Text>
                  </View>
                )}
                {modalType === "alloc" && (
                  <View style={[styles.modalBadge, {
                    backgroundColor: (modalResource.currentPct > 100 ? Colors.orange : Colors.green) + "18"
                  }]}>
                    <Feather name="pie-chart" size={13}
                      color={modalResource.currentPct > 100 ? Colors.orange : Colors.green} />
                    <Text style={[styles.modalBadgeText, {
                      color: modalResource.currentPct > 100 ? Colors.orange : Colors.green
                    }]}>
                      {modalResource.currentPct}% total allocated
                      {modalResource.currentPct > 100 ? " — Overloaded" : ""}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Search for project history */}
            {modalType === "total" && modalResource && modalResource.allProjectIds.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F5F5F5", borderRadius: 10, paddingHorizontal: 12, height: 40 }}>
                  <Feather name="search" size={15} color={Colors.cardMuted} />
                  <AppTextInput
                    style={{ flex: 1, color: Colors.cardText, fontFamily: "Inter_400Regular", fontSize: 14, marginLeft: 8, paddingVertical: 0, outlineStyle: "none" } as any}
                    placeholder="Search projects..."
                    placeholderTextColor={Colors.cardMuted}
                    value={modalProjectSearch}
                    onChangeText={setModalProjectSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {modalProjectSearch.length > 0 && (
                    <Pressable onPress={() => setModalProjectSearch("")} hitSlop={8}>
                      <Feather name="x-circle" size={15} color={Colors.cardMuted} />
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            {/* Content */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={modalType === "profile" ? styles.modalProfileContent : styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              {/* TOTAL PROJECTS list */}
              {modalType === "total" && modalResource && (() => {
                const sq = modalProjectSearch.toLowerCase().trim();
                const filtered = sq
                  ? modalResource.allProjectIds.filter(pid => {
                      const name = pName(pid);
                      return pid.toLowerCase().includes(sq) || name.toLowerCase().includes(sq);
                    })
                  : modalResource.allProjectIds;
                return filtered.length === 0 ? (
                  <View style={styles.modalEmpty}>
                    <Feather name="inbox" size={28} color={Colors.textSecondary} />
                    <Text style={styles.modalEmptyText}>{sq ? "No matching projects" : "No project history"}</Text>
                  </View>
                ) : (
                  filtered.map((pid, idx) => {
                    const rawPrefix = pid.split("-")[0];
                    const isKnownModule = rawPrefix === "PMM" || rawPrefix === "OPM" || rawPrefix === "LEM";
                    const prefix = isKnownModule ? rawPrefix : "JOB";
                    const prefixColor = rawPrefix === "PMM" ? Colors.green : rawPrefix === "OPM" ? Colors.orange : rawPrefix === "LEM" ? Colors.greenLight : Colors.cardMuted;
                    const isActive = modalResource.activeProjects.includes(pid);
                    const name = pName(pid);
                    // RM ONE sometimes returns names that start with the contract id ("20-164-0278.01 - NYCHA …").
                    // Strip a leading "<id> -" / "<id>:" so the name reads cleanly under the badge.
                    const escapedPid = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const cleanName = name.replace(new RegExp("^" + escapedPid + "\\s*[-:]\\s*", "i"), "").trim() || name;
                    const showName = cleanName && cleanName !== pid;
                    return (
                      <View key={pid} style={[styles.modalRow, idx > 0 && styles.modalRowBorder]}>
                        <View style={[styles.modalPrefixBadge, { backgroundColor: prefixColor + "18" }]}>
                          <Text style={[styles.modalPrefixText, { color: prefixColor }]}>{prefix}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modalRowId} numberOfLines={1}>{showName ? cleanName : pid}</Text>
                          {showName && <Text style={{ fontSize: 11, color: Colors.cardMuted, marginTop: 1 }}>{pid}</Text>}
                        </View>
                        {isActive && (
                          <View style={[styles.modalActivePill]}>
                            <View style={styles.modalActiveDot} />
                            <Text style={styles.modalActivePillText}>Active</Text>
                          </View>
                        )}
                      </View>
                    );
                  })
                );
              })()}

              {/* ACTIVE ALLOCATIONS list */}
              {modalType === "active" && modalResource && (
                modalResource.activeAllocations.length === 0 ? (
                  <View style={styles.modalEmpty}>
                    <Feather name="moon" size={28} color={Colors.textSecondary} />
                    <Text style={styles.modalEmptyText}>No active allocations right now</Text>
                    {modalResource.lastActiveDate && (
                      <Text style={styles.modalEmptySubText}>Last active: {modalResource.lastActiveDate}</Text>
                    )}
                  </View>
                ) : (
                  modalResource.activeAllocations.map((a, idx) => {
                    const prefix = a.projectId.split("-")[0];
                    const prefixColor = prefix === "PMM" ? Colors.green : prefix === "OPM" ? Colors.orange : Colors.greenLight;
                    const barWidth = Math.min(a.pct, 100);
                    const name = pName(a.projectId);
                    return (
                      <View key={a.projectId} style={[styles.modalActiveCard, idx > 0 && { marginTop: 10 }]}>
                        <View style={styles.modalActiveTop}>
                          <View style={[styles.modalPrefixBadge, { backgroundColor: prefixColor + "18" }]}>
                            <Text style={[styles.modalPrefixText, { color: prefixColor }]}>{prefix}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.modalRowId} numberOfLines={1}>{name !== a.projectId ? name : a.projectId}</Text>
                            {name !== a.projectId && <Text style={{ fontSize: 11, color: Colors.cardMuted }}>{a.projectId}</Text>}
                          </View>
                          <Text style={[styles.modalAllocPct, { color: a.pct > 100 ? Colors.orange : Colors.green }]}>
                            {fmtPct(a.pct)}
                          </Text>
                        </View>
                        <View style={styles.modalBarTrack}>
                          <View style={[styles.modalBarFill, {
                            width: `${barWidth}%` as any,
                            backgroundColor: a.pct > 100 ? Colors.orange : Colors.green,
                          }]} />
                        </View>
                        <Text style={styles.modalDateRange}>
                          {a.startDate} → {a.endDate}
                        </Text>
                      </View>
                    );
                  })
                )
              )}

              {/* ALLOCATION BREAKDOWN */}
              {modalType === "alloc" && modalResource && (
                <View>
                  {/* Total bar */}
                  <View style={styles.modalTotalRow}>
                    <Text style={styles.modalTotalLabel}>Total Allocation</Text>
                    <Text style={[styles.modalTotalPct, {
                      color: modalResource.currentPct > 100 ? Colors.orange : Colors.green
                    }]}>{modalResource.currentPct}%</Text>
                  </View>
                  <View style={styles.modalBarTrackLarge}>
                    <View style={[styles.modalBarFillLarge, {
                      width: `${Math.min(modalResource.currentPct, 100)}%` as any,
                      backgroundColor: modalResource.currentPct > 100 ? Colors.orange : Colors.green,
                    }]} />
                    {modalResource.currentPct > 100 && (
                      <View style={[styles.modalBarFillLarge, {
                        width: `${Math.min(modalResource.currentPct - 100, 20)}%` as any,
                        backgroundColor: Colors.red,
                      }]} />
                    )}
                  </View>
                  <View style={styles.modalCapacityRow}>
                    <View style={styles.modalCapacityMark}>
                      <Text style={styles.modalCapacityLabel}>0%</Text>
                    </View>
                    <View style={[styles.modalCapacityMark, { alignItems: "center" }]}>
                      <Text style={styles.modalCapacityLabel}>50%</Text>
                    </View>
                    <View style={[styles.modalCapacityMark, { alignItems: "flex-end" }]}>
                      <Text style={styles.modalCapacityLabel}>100%</Text>
                    </View>
                  </View>

                  {modalResource.activeAllocations.length > 0 ? (
                    <>
                      <Text style={styles.modalBreakdownHeading}>Per-Project Breakdown</Text>
                      {modalResource.activeAllocations.map((a, idx) => {
                        const prefix = a.projectId.split("-")[0];
                        const prefixColor = prefix === "PMM" ? Colors.green : prefix === "OPM" ? Colors.orange : Colors.greenLight;
                        const share = modalResource.currentPct > 0
                          ? Math.round((a.pct / modalResource.currentPct) * 100) : 0;
                        const name = pName(a.projectId);
                        return (
                          <View key={a.projectId} style={[styles.modalAllocRow, idx > 0 && styles.modalRowBorder]}>
                            <View style={[styles.modalPrefixBadge, { backgroundColor: prefixColor + "18" }]}>
                              <Text style={[styles.modalPrefixText, { color: prefixColor }]}>{prefix}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.modalRowId} numberOfLines={1}>{name !== a.projectId ? name : a.projectId}</Text>
                              <Text style={styles.modalDateRange}>{name !== a.projectId ? `${a.projectId} · ` : ""}{a.startDate} → {a.endDate}</Text>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={[styles.modalAllocPct, { color: Colors.green }]}>{fmtPct(a.pct)}</Text>
                              <Text style={styles.modalShareText}>{share}% of load</Text>
                            </View>
                          </View>
                        );
                      })}
                    </>
                  ) : (
                    <View style={styles.modalEmpty}>
                      <Feather name="moon" size={28} color={Colors.textSecondary} />
                      <Text style={styles.modalEmptyText}>No active allocation right now</Text>
                    </View>
                  )}
                </View>
              )}
              {/* PROFILE */}
              {modalType === "profile" && modalResource && (() => {
                const status = statusInfo(modalResource.currentPct, underAllocatedPct, overCapacityPct);
                const ini = initials(modalResource.name);
                return (
                  <View>
                    {/* Avatar hero */}
                    <View style={styles.profileHero}>
                      <View style={[styles.profileAvatar, { backgroundColor: status.color + "20", borderColor: status.color + "60" }]}>
                        <Text style={[styles.profileAvatarText, { color: status.color }]}>{ini}</Text>
                      </View>
                      <Text style={styles.profileName}>{modalResource.name}</Text>
                       <DisabledStaffControl
                         enabled={modalResource.enabled}
                         userGuid={modalResource.id}
                         tenantId={modalResource.tenantId}
                         onReactivated={async (userGuid) => {
                           setResources(prev => prev.map(item => item.id.toLowerCase() === userGuid.toLowerCase() ? { ...item, enabled: true } : item));
                           setModalResource(prev => prev?.id.toLowerCase() === userGuid.toLowerCase() ? { ...prev, enabled: true } : prev);
                           await loadData(true);
                         }}
                       />
                      {modalResource.role ? <Text style={styles.profileRole}>{modalResource.role}</Text> : null}
                      {modalResource.username ? (
                        <View style={styles.profileEmailRow}>
                          <Feather name="mail" size={12} color={Colors.cardMuted} />
                          <Text style={styles.profileEmail}>{modalResource.username}</Text>
                        </View>
                      ) : null}
                      <View style={[styles.profileStatusBadge, { backgroundColor: status.color + "18" }]}>
                        <View style={[styles.profileStatusDot, { backgroundColor: status.color }]} />
                        <Text style={[styles.profileStatusText, { color: status.color }]}>{status.label}</Text>
                      </View>
                    </View>

                    <Pressable
                      style={[styles.profileAssignBtn, { marginTop: 0, marginBottom: 0, marginHorizontal: 20 }]}
                      onPress={() => {
                        const res = modalResource;
                        const pctInfo = res.currentPct === 0 ? "on bench with 0% project utilization" : `at ${res.currentPct}% overall allocation`;
                        closeModal();
                        modalToChat(`I want to assign ${res.name}${res.role ? ` (${res.role})` : ""}, who is ${pctInfo}${res.activeProjects.length ? `, ${res.activeProjects.length} currently active` : ""}${res.totalProjects ? `, ${res.totalProjects} total past projects` : ""}. First, look through the PMM active projects data you already have to find 3-5 projects that are currently active (In Progress, Construction, or similar active status). Match them based on the person's job title, past project experience, sector expertise, and location. List each recommended project with its full PMM ID, name, status, value, and why it's a good fit. Do NOT say there are no active projects — there are hundreds of active PMM projects in the data.`);
                      }}
                    >
                      <Feather name="user-check" size={14} color={Colors.white} />
                      <Text style={styles.profileAssignText}>Assign to Project via AI</Text>
                    </Pressable>

                    {/* Stats row */}
                    <View style={styles.profileStatsRow}>
                      <View style={styles.profileStat}>
                        <Text style={[styles.profileStatVal, { color: status.color }]}>{modalResource.currentPct}%</Text>
                        <Text style={styles.profileStatLabel}>Current Load</Text>
                      </View>
                      <View style={styles.profileStatDivider} />
                      <View style={styles.profileStat}>
                        <Text style={styles.profileStatVal}>{modalResource.totalProjects}</Text>
                        <Text style={styles.profileStatLabel}>Total Projects</Text>
                      </View>
                      <View style={styles.profileStatDivider} />
                      <View style={styles.profileStat}>
                        <Text style={styles.profileStatVal}>{modalResource.activeProjects.length}</Text>
                        <Text style={styles.profileStatLabel}>Active Now</Text>
                      </View>
                    </View>

                    {/* Allocation bar */}
                    <View style={styles.profileSection}>
                      <Text style={styles.profileSectionTitle}>CAPACITY</Text>
                      <View style={styles.profileBarRow}>
                        <View style={styles.profileBarTrack}>
                          <View style={[styles.profileBarFill, {
                            width: `${Math.min(modalResource.currentPct, 100)}%` as any,
                            backgroundColor: status.color,
                          }]} />
                        </View>
                        <Text style={[styles.profileBarPct, { color: status.color }]}>{modalResource.currentPct}%</Text>
                      </View>
                      <View style={styles.profileBarLabels}>
                        <Text style={styles.profileBarLabel}>0%</Text>
                        <Text style={styles.profileBarLabel}>50%</Text>
                        <Text style={styles.profileBarLabel}>100%</Text>
                      </View>
                    </View>

                    {/* Active allocations */}
                    {modalResource.activeAllocations.length > 0 && (
                      <View style={styles.profileSection}>
                        <Text style={styles.profileSectionTitle}>ACTIVE ALLOCATIONS</Text>
                        {modalResource.activeAllocations.map((a, idx) => {
                          const prefix = a.projectId.split("-")[0];
                          const prefixColor = prefix === "PMM" ? Colors.green : prefix === "OPM" ? Colors.orange : Colors.greenLight;
                          return (
                            <View key={a.projectId} style={[styles.profileAllocCard, idx > 0 && { marginTop: 8 }]}>
                              <View style={styles.profileAllocTop}>
                                <View style={[styles.modalPrefixBadge, { backgroundColor: prefixColor + "18" }]}>
                                  <Text style={[styles.modalPrefixText, { color: prefixColor }]}>{prefix}</Text>
                                </View>
                                <Text style={styles.profileAllocId}>{a.projectId}</Text>
                                <Text style={[styles.profileAllocPct, { color: Colors.green }]}>{fmtPct(a.pct)}</Text>
                              </View>
                              <Text style={styles.profileAllocDates}>{a.startDate} → {a.endDate}</Text>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Last active */}
                    {modalResource.lastActiveDate && (
                      <View style={styles.profileSection}>
                        <Text style={styles.profileSectionTitle}>HISTORY</Text>
                        <View style={styles.profileInfoRow}>
                          <Feather name="clock" size={13} color={Colors.cardMuted} />
                          <Text style={styles.profileInfoText}>Last active: {modalResource.lastActiveDate}</Text>
                        </View>
                        <View style={styles.profileInfoRow}>
                          <Feather name="briefcase" size={13} color={Colors.cardMuted} />
                          <Text style={styles.profileInfoText}>{modalResource.totalProjects} total projects</Text>
                        </View>
                      </View>
                    )}

                  </View>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AIAnalysisModal
        name={aiName}
        loading={aiLoading}
        text={aiText}
        error={aiError}
        ganttProjects={aiGantt}
        underAllocatedPct={underAllocatedPct}
        overCapacityPct={overCapacityPct}
        onClose={closeAnalysis}
      />

      {weekColModal && utilData && (
        <WeekColumnModal
          period={weekColModal.period}
          utilResources={utilData.resources}
          mode={utilMode}
          underAllocatedPct={underAllocatedPct}
          overCapacityPct={overCapacityPct}
          onClose={() => { auditClose({ screen: "resources" }); setWeekColModal(null); }}
        />
      )}

      {cellModal && (
        <CellDetailModal
          name={cellModal.name}
          resource={cellModal.resourceId ? resources.find(resource => resource.id.toLowerCase() === cellModal.resourceId!.toLowerCase()) : undefined}
          period={cellModal.period}
          pct={cellModal.pct}
          hours={cellModal.hours}
          weeklyData={cellModal.weeklyData}
          projectAllocs={cellModal.projectAllocs}
          workWeekHours={workWeekHours}
          underAllocatedPct={underAllocatedPct}
          overCapacityPct={overCapacityPct}
          onClose={() => { auditClose({ screen: "resources" }); setCellModal(null); }}
          onFullAnalysis={() => {
            const p = cellModal.period;
            const n = cellModal.name;
            setCellModal(null);
            openAnalysis(n, p);
          }}
          onReactivated={async (userGuid) => {
            setResources(prev => prev.map(item => item.id.toLowerCase() === userGuid.toLowerCase() ? { ...item, enabled: true } : item));
            await loadData(true);
          }}
        />
      )}
    </View>
  );
}

/* ─── AI Analysis Modal ─────────────────────────────────────────────────── */
function parseAnalysis(raw: string): { status: string; headline: string; driver: string; trend: string; insight: string; rec: string } {
  const out = { status: "", headline: "", driver: "", trend: "", insight: "", rec: "" };
  if (!raw) return out;
  const grab = (key: string) => {
    const m = raw.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im"));
    return m ? m[1].trim().replace(/\bpts?\b/gi, "%") : "";
  };
  out.status   = grab("STATUS").toLowerCase();
  out.headline = grab("HEADLINE");
  out.driver   = grab("DRIVER");
  out.trend    = grab("TREND");
  out.insight  = grab("INSIGHT");
  out.rec      = grab("REC") || grab("RECOMMENDATION");
  return out;
}

function AIAnalysisModal({
  name, loading, text, error, ganttProjects, underAllocatedPct = 60, overCapacityPct = 110, onClose,
}: { name: string | null; loading: boolean; text: string; error: string | null; ganttProjects: { projectId: string; name: string; startDate: string; endDate: string; pct: number }[]; underAllocatedPct?: number; overCapacityPct?: number; onClose: () => void }) {
  const open = !!name;
  const parsed = parseAnalysis(text);
  const statusColor =
    parsed.status === "over"     ? "#F08C22" :
    parsed.status === "under"    ? Colors.red :
    parsed.status === "healthy"  ? Colors.green : Colors.textSecondary;
  const statusLabel = parsed.status ? parsed.status.toUpperCase() : "ANALYZING";

  // Pulse animation for loading dots
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loading, pulse]);
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  const agents = [
    { key: "alloc",  label: "Allocation agent",     color: Colors.green },
    { key: "trend",  label: "Trend agent",          color: "#5B8DEF" },
    { key: "insight",label: "Insight agent",        color: "#A26DD1" },
    { key: "rec",    label: "Recommendation agent", color: Colors.orange },
  ];

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 16 }}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />
        <View style={{ width: "100%", maxWidth: 460, height: "85%", backgroundColor: Colors.darkDeep, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border + "40" }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.green + "22", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
              <Feather name="cpu" size={16} color={Colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.textPrimary }} numberOfLines={1}>{name ?? ""}</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textSecondary }}>RM ONE — Utilization Analysis</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
              <Feather name="x" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
            {/* Loading panel */}
            {loading && !parsed.headline && (
              <View style={{ backgroundColor: Colors.cardBg, borderRadius: 12, padding: 14, borderWidth: 2, borderColor: Colors.cardBorderStrong }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText, marginBottom: 10 }}>RM ONE agents are evaluating…</Text>
                {agents.map((a, i) => (
                  <Animated.View key={a.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, opacity: pulseOpacity }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.color, marginRight: 10 }} />
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText }}>{a.label}</Text>
                    <View style={{ flex: 1 }} />
                    <ActivityIndicator size="small" color={a.color} />
                  </Animated.View>
                ))}
              </View>
            )}

            {/* Error */}
            {error && (
              <View style={{ backgroundColor: "#E03C3C22", borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: "#E03C3C55" }}>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#E03C3C" }}>{error}</Text>
              </View>
            )}

            {/* Empty state: done but nothing parsed */}
            {!loading && !error && !parsed.headline && (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <Feather name="alert-circle" size={28} color={Colors.textSecondary} />
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary, marginTop: 10, textAlign: "center" }}>
                  No analysis returned.{"\n"}Tap the person again to retry.
                </Text>
              </View>
            )}

            {/* Parsed result */}
            {parsed.headline ? (
              <View>
                {/* Status pill + headline */}
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                  <View style={{ backgroundColor: statusColor + "22", borderColor: statusColor + "66", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginRight: 8 }}>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: statusColor, letterSpacing: 0.8 }}>{statusLabel}</Text>
                  </View>
                  {loading && <ActivityIndicator size="small" color={Colors.textPrimary} />}
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.textPrimary, lineHeight: 22, marginBottom: 16 }}>
                  {parsed.headline}
                </Text>

                {/* Bullets */}
                {parsed.driver  ? <BulletRow color={Colors.orange} icon="zap"        label="DRIVER"  text={parsed.driver}  /> : null}
                {parsed.trend   ? <BulletRow color="#5B8DEF"      icon="trending-up" label="TREND"   text={parsed.trend}   /> : null}
                {parsed.insight ? <BulletRow color="#A26DD1"      icon="eye"         label="INSIGHT" text={parsed.insight} /> : null}

                {/* Recommendation card */}
                {parsed.rec ? (
                  <View style={{ marginTop: 8, borderRadius: 12, padding: 14, backgroundColor: Colors.green + "1A", borderWidth: 1, borderColor: Colors.green + "55" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                      <Feather name="target" size={14} color={Colors.green} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.green, letterSpacing: 1, marginLeft: 6 }}>RECOMMENDATION</Text>
                    </View>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textPrimary, lineHeight: 19 }}>{parsed.rec}</Text>
                  </View>
                ) : null}

                {/* Gantt — project timeline bars */}
                {!loading && ganttProjects.length > 0 && (
                  <View style={{ marginTop: 16, borderRadius: 12, padding: 12, backgroundColor: Colors.darkCard, borderWidth: 1, borderColor: Colors.cardBorderStrong }}>
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                      <Feather name="bar-chart-2" size={13} color={Colors.textSecondary} />
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.textSecondary, letterSpacing: 0.8, marginLeft: 6 }}>PROJECT TIMELINE</Text>
                    </View>
                    {ganttProjects.map(p => {
                      const allocColor = p.pct > overCapacityPct ? "#F08C22" : p.pct >= underAllocatedPct ? Colors.green : Colors.red;
                      const barW = Math.min(100, Math.max(4, p.pct));
                      const sd = p.startDate.slice(5).replace("-", "/");
                      const ed = p.endDate.slice(5).replace("-", "/");
                      return (
                        <View key={p.projectId} style={{ marginBottom: 10 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8 }}>
                              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: allocColor }}>{fmtPct(p.pct)}</Text>
                              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary }}>{sd}→{ed}</Text>
                            </View>
                          </View>
                          <View style={{ height: 5, borderRadius: 3, backgroundColor: Colors.border + "60", overflow: "hidden" }}>
                            <View style={{ width: `${barW}%` as any, height: "100%", backgroundColor: allocColor, borderRadius: 3 }} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BulletRow({ color, icon, label, text }: { color: string; icon: any; label: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 12 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color + "22", alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 1 }}>
        <Feather name={icon} size={12} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color, letterSpacing: 1, marginBottom: 2 }}>{label}</Text>
        <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textPrimary, lineHeight: 18 }}>{text}</Text>
      </View>
    </View>
  );
}

/* ─── WEEK COLUMN MODAL ─────────────────────────────────────────────────── */
function WeekColumnModal({
  period, utilResources, mode, underAllocatedPct = 60, overCapacityPct = 110, onClose,
}: {
  period: string;
  utilResources: UtilizationPerson[];
  mode: "Weekly" | "Monthly";
  underAllocatedPct?: number;
  overCapacityPct?: number;
  onClose: () => void;
}) {
  const MONTHS: Record<string,string> = { Jan:"1",Feb:"2",Mar:"3",Apr:"4",May:"5",Jun:"6",Jul:"7",Aug:"8",Sep:"9",Oct:"10",Nov:"11",Dec:"12" };
  const parts = period.split("-");
  const weekLabel = `${MONTHS[parts[0]] ?? parts[0]}/${parseInt(parts[1] ?? "0", 10)}`;

  const entries = useMemo(() => {
    return utilResources
      .map(r => {
        const w = r.weeks.find(wk => wk.period === period);
        return { name: r.name, hours: w?.hours ?? 0, pct: w?.pct ?? 0, status: w?.status ?? "" };
      })
      .filter(e => e.hours > 0)
      .sort((a, b) => b.hours - a.hours);
  }, [utilResources, period]);

  const maxH     = entries.length > 0 ? entries[0].hours : 1;
  const totalH   = entries.reduce((s, e) => s + e.hours, 0);
  const avgPct   = entries.length > 0 ? Math.round(entries.reduce((s, e) => s + e.pct, 0) / entries.length) : 0;
  const idleCount = utilResources.length - entries.length;

  const statusColor = (s: string) =>
    s === "Over" ? "#F08C22" : s === "Good" ? Colors.green : Colors.red;

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const stats = [
    { val: entries.length, suffix: "", label: "ACTIVE PEOPLE",   color: Colors.textPrimary },
    { val: totalH,         suffix: "h", label: "TOTAL HOURS",    color: Colors.textPrimary },
    { val: avgPct,         suffix: "%", label: "AVG UTIL",        color: avgPct >= 40 ? Colors.green : Colors.orange },
    { val: idleCount,      suffix: "", label: "IDLE PEOPLE",      color: Colors.textSecondary },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 16 }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 460, height: "85%", backgroundColor: Colors.darkDeep, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" }}>

          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border + "40", backgroundColor: Colors.darkCard }}>
            <View style={{ backgroundColor: Colors.green + "22", borderWidth: 2, borderColor: Colors.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginRight: 12 }}>
              <Text style={{ fontFamily: "Inter_900Black", fontSize: 20, color: Colors.green, lineHeight: 24 }}>{weekLabel}</Text>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 8, color: Colors.green, opacity: 0.8, textAlign: "center" }}>{mode === "Monthly" ? "month" : "week"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.textPrimary }}>All Resources</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, marginTop: 2 }}>Tap any row for details</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
              <Feather name="x" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>

          {/* Summary strip */}
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.border + "40", backgroundColor: Colors.dark }}>
            {stats.map((s, i) => (
              <View key={s.label} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRightWidth: i < stats.length - 1 ? 1 : 0, borderRightColor: Colors.border + "40" }}>
                <Text style={{ fontFamily: "Inter_900Black", fontSize: 20, color: s.color, lineHeight: 24 }}>{s.val}{s.suffix}</Text>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 8, color: Colors.textSecondary, letterSpacing: 0.6, marginTop: 2 }}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Rows */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, paddingBottom: 20 }}>
            {entries.length === 0 ? (
              <View style={{ padding: 40, alignItems: "center" }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary }}>No active allocations for this {mode === "Monthly" ? "month" : "week"}.</Text>
              </View>
            ) : entries.map((e, i) => {
              const c = statusColor(e.status);
              const barW = Math.max(2, Math.round((e.hours / maxH) * 100));
              const isExpanded = expandedIdx === i;
              return (
                <View key={e.name + i}>
                  <Pressable
                    onPress={() => setExpandedIdx(isExpanded ? null : i)}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 8,
                      borderRadius: 8, marginBottom: 1,
                      backgroundColor: isExpanded ? Colors.darkCard : (pressed ? Colors.darkCard + "80" : "transparent"),
                      borderBottomWidth: !isExpanded && i < entries.length - 1 ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor: Colors.border + "30",
                    })}
                  >
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.textSecondary, width: 20, textAlign: "right", marginRight: 8 }}>{i + 1}</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: isExpanded ? Colors.green : Colors.textPrimary, width: 120, marginRight: 8 }} numberOfLines={1}>{e.name}</Text>
                    <View style={{ flex: 1, height: 20, backgroundColor: Colors.dark, borderRadius: 4, overflow: "hidden", marginRight: 8 }}>
                      <View style={{ width: `${barW}%` as any, height: "100%", backgroundColor: c + "bb", borderRadius: 4 }} />
                    </View>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 11, color: c, width: 32, textAlign: "right" }}>{fmtPct(e.pct)}</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, width: 28, textAlign: "right" }}>{fmtHours(e.hours)}h</Text>
                    <View style={{ width: 52, marginLeft: 6, paddingVertical: 2, paddingHorizontal: 4, borderRadius: 4, backgroundColor: c + "25", borderWidth: 1, borderColor: c + "50", alignItems: "center" }}>
                      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 8, color: c }}>{e.status || "—"}</Text>
                    </View>
                  </Pressable>
                  {isExpanded && (
                    <View style={{ marginLeft: 30, marginBottom: 6, backgroundColor: Colors.darkCard, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: c + "40" }}>
                      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
                        {[
                          { v: `${fmtHours(e.hours)}h`, lbl: "THIS WEEK", col: c },
                          { v: fmtPct(e.pct), lbl: "UTILISATION", col: c },
                        ].map(({ v, lbl, col }) => (
                          <View key={lbl} style={{ alignItems: "center" }}>
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: col }}>{v}</Text>
                            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 8, color: Colors.textSecondary, letterSpacing: 0.6 }}>{lbl}</Text>
                          </View>
                        ))}
                        <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, backgroundColor: c + "22", borderWidth: 1, borderColor: c + "40" }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: c }}>{e.status}</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* Legend */}
          <View style={{ flexDirection: "row", gap: 14, borderTopWidth: 1, borderTopColor: Colors.border + "40", paddingHorizontal: 16, paddingVertical: 10, flexWrap: "wrap" }}>
            {[
              { c: Colors.green, label: `Good ≥${underAllocatedPct}%` },
              { c: Colors.red,   label: `Under <${underAllocatedPct}%` },
              { c: "#F08C22",    label: `Over >${overCapacityPct}%` },
            ].map(({ c, label }) => (
              <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary }}>{label}</Text>
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ─── CELL DETAIL MODAL ─────────────────────────────────────────────────── */
function CellDetailModal({
  name, period, pct, hours, weeklyData, projectAllocs, workWeekHours,
  underAllocatedPct = 60, overCapacityPct = 110,
  onClose, onFullAnalysis, resource, onReactivated,
}: {
  name: string; period: string; pct: number; hours: number;
  weeklyData: { period: string; pct: number; hours: number }[];
  projectAllocs: { projectId: string; projectName: string; pct: number; startDate: string; endDate: string }[];
  workWeekHours: number;
  underAllocatedPct?: number;
  overCapacityPct?: number;
  onClose: () => void;
  onFullAnalysis: () => void;
  resource?: LiveResource;
  onReactivated: (userGuid: string) => void | Promise<void>;
}) {
  const color = pct > overCapacityPct ? "#F08C22" : pct >= overCapacityPct * 0.9 ? "#F9AB33" : pct >= underAllocatedPct ? Colors.green : Colors.red;
  const label = pct > overCapacityPct ? "Over-allocated" : pct >= overCapacityPct * 0.9 ? "At capacity" : pct >= underAllocatedPct ? "Healthy" : pct > 0 ? "Under-utilized" : "Idle";
  const allocColor = (p: number) => p > overCapacityPct ? "#F08C22" : p >= underAllocatedPct ? Colors.green : p > 0 ? Colors.red : Colors.border;

  const MONTHS: Record<string,string> = { Jan:"1",Feb:"2",Mar:"3",Apr:"4",May:"5",Jun:"6",Jul:"7",Aug:"8",Sep:"9",Oct:"10",Nov:"11",Dec:"12" };
  const parts = period.split("-");
  const periodLabel = `${MONTHS[parts[0]] ?? parts[0]}/${parseInt(parts[1] ?? "0", 10)}`;

  const maxPct = Math.max(...weeklyData.map(w => w.pct), 1);
  const totalAllocPct = projectAllocs.reduce((s, a) => s + a.pct, 0) || 1;

  /* Group weeklyData by month */
  const monthGroups = useMemo(() => {
    const groups: { month: string; cols: typeof weeklyData }[] = [];
    for (const w of weeklyData) {
      const mo = w.period.slice(0, 3);
      if (!groups.length || groups[groups.length - 1].month !== mo) groups.push({ month: mo, cols: [w] });
      else groups[groups.length - 1].cols.push(w);
    }
    return groups;
  }, [weeklyData]);

  const BAR_MAX_H = 50;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 16 }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 460, height: "88%", backgroundColor: Colors.darkDeep, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" }}>

          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border + "40" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.textPrimary }}>{name}</Text>
              <DisabledStaffControl enabled={resource?.enabled} userGuid={resource?.id} tenantId={resource?.tenantId} onReactivated={onReactivated} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, marginTop: 2 }}>Week of {periodLabel}</Text>
            </View>
            <View style={{ backgroundColor: color + "22", borderWidth: 1.5, borderColor: color, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginRight: 10, alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_900Black", fontSize: 17, color, lineHeight: 20 }}>{periodLabel}</Text>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 8, color, opacity: 0.8 }}>week</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
              <Feather name="x" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>

            {/* Stat tiles */}
            <View style={{ flexDirection: "row", gap: 8, padding: 14 }}>
              <View style={{ flex: 1, backgroundColor: Colors.darkCard, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border }}>
                <Text style={{ fontFamily: "Inter_900Black", fontSize: 20, color, lineHeight: 24 }}>{fmtPct(pct)}</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, marginTop: 2 }}>Utilisation</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: Colors.darkCard, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border }}>
                <Text style={{ fontFamily: "Inter_900Black", fontSize: 20, color: Colors.textPrimary, lineHeight: 24 }}>{fmtHours(hours)}h</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, marginTop: 2 }}>Hours booked</Text>
              </View>
              <View style={{ flex: 1.6, backgroundColor: Colors.darkCard, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.border }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, marginBottom: 4 }}>{projectAllocs.length} Project{projectAllocs.length === 1 ? "" : "s"}</Text>
                {projectAllocs.slice(0, 2).map(a => (
                  <Text key={a.projectId} style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.textPrimary }} numberOfLines={1}>{a.projectName}</Text>
                ))}
                {projectAllocs.length > 2 && <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textSecondary }}>+{projectAllocs.length - 2} more</Text>}
              </View>
            </View>

            {/* Utilisation bar chart (all weeks) */}
            {weeklyData.length > 0 && (
              <View style={{ marginHorizontal: 14, marginBottom: 14, backgroundColor: Colors.darkCard, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" }}>
                <View style={{ padding: "10px 14px" as any, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }}>
                  <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.textSecondary, letterSpacing: 0.7 }}>RESOURCE TIMELINE</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 10 }}>
                  <View style={{ flexDirection: "row" }}>
                    {monthGroups.map(grp => (
                      <View key={grp.month} style={{ marginRight: 4 }}>
                        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.textSecondary, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, paddingBottom: 2 }}>{grp.month}</Text>
                        <View style={{ flexDirection: "row", gap: 2 }}>
                          {grp.cols.map(w => {
                            const isSel = w.period === period;
                            const barH = w.pct > 0 ? Math.max(3, Math.round((w.pct / Math.max(maxPct, 100)) * BAR_MAX_H)) : 0;
                            const bColor = w.pct > overCapacityPct ? "#F08C22" : w.pct >= underAllocatedPct ? Colors.green : w.pct > 0 ? Colors.red : Colors.border;
                            const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(w.period.slice(0, 3)) + 1;
                            const day = parseInt(w.period.split("-")[1] ?? "0");
                            const shortLabel = mo ? `${mo}/${day}` : w.period;
                            return (
                              <View key={w.period} style={{ width: 28, alignItems: "center" }}>
                                <View style={{ height: BAR_MAX_H, justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
                                  <View style={{ position: "absolute", bottom: Math.round(underAllocatedPct / 100 * BAR_MAX_H), left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, opacity: 0.5 }} />
                                  <View style={{ width: "90%", height: barH, backgroundColor: isSel ? bColor : bColor + "bb", borderRadius: 2, borderWidth: isSel ? 1 : 0, borderColor: bColor }} />
                                </View>
                                <Text style={{ fontFamily: isSel ? "Inter_700Bold" : "Inter_400Regular", fontSize: 7, color: isSel ? bColor : Colors.textSecondary, marginTop: 2 }} numberOfLines={1}>{w.pct > 0 ? fmtPct(w.pct) : "—"}</Text>
                                <Text style={{ fontFamily: isSel ? "Inter_700Bold" : "Inter_400Regular", fontSize: 7, color: isSel ? Colors.green : Colors.textSecondary, borderBottomWidth: isSel ? 1.5 : 0, borderBottomColor: Colors.green }} numberOfLines={1}>{shortLabel}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ))}
                  </View>
                </ScrollView>
                {/* Legend */}
                <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingBottom: 10, flexWrap: "wrap" }}>
                  {[
                    { c: Colors.green, l: `Good ≥${underAllocatedPct}%` },
                    { c: Colors.red,   l: `Under <${underAllocatedPct}%` },
                    { c: "#F08C22",    l: `Over >${overCapacityPct}%` },
                  ].map(({ c, l }) => (
                    <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: c }} />
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textSecondary }}>{l}</Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: Colors.green + "44", borderWidth: 1, borderColor: Colors.green }} />
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.green }}>Selected week</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Active projects */}
            <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.textSecondary, letterSpacing: 0.7 }}>ACTIVE PROJECTS</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary }}>{projectAllocs.length} allocation{projectAllocs.length === 1 ? "" : "s"}</Text>
              </View>
              {projectAllocs.length === 0 ? (
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary }}>No project allocations on record for this week.</Text>
              ) : projectAllocs.map(a => {
                const projHours = Math.round((a.pct / 100) * workWeekHours);
                const barW = Math.min(100, Math.round((a.pct / totalAllocPct) * 100));
                const aColor = allocColor(a.pct);
                const totalWeeks = a.startDate && a.endDate
                  ? Math.max(1, Math.round((new Date(a.endDate).getTime() - new Date(a.startDate).getTime()) / (7 * 24 * 3600 * 1000)))
                  : null;
                const totalHours = totalWeeks ? Math.round((a.pct / 100) * workWeekHours * totalWeeks) : null;
                return (
                  <View key={a.projectId} style={{ backgroundColor: Colors.darkCard, borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: Colors.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textPrimary }} numberOfLines={1}>{a.projectName}</Text>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary, marginTop: 1 }}>{a.projectId}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 12, color: aColor }}>{fmtPct(a.pct)}</Text>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary }}>~{fmtHours(projHours)}h/wk</Text>
                        {totalHours && <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary }}>{fmtHours(totalHours)}h total</Text>}
                      </View>
                    </View>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: Colors.border + "60", overflow: "hidden" }}>
                      <View style={{ width: `${barW}%` as any, height: "100%", backgroundColor: aColor, borderRadius: 2 }} />
                    </View>
                    {a.startDate ? (
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 9, color: Colors.textSecondary, marginTop: 4 }}>{a.startDate} → {a.endDate}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: Colors.border + "40" }}>
            <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: "center" }}>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.textSecondary }}>Close</Text>
            </Pressable>
            <Pressable onPress={onFullAnalysis} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.green + "22", alignItems: "center", borderWidth: 1, borderColor: Colors.green + "55" }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.green }}>Full AI Analysis</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ─── STYLES ─────────────────────────────────────────────────────────────── */
const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },
  whiteCard: {
    backgroundColor: Colors.white ?? "#FFFFFF",
    borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    alignSelf: "stretch" as const,
  },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.textPrimary },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  headerSubBold: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.textPrimary },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.green, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
  },
  addBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText },
  filterIconBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: Colors.darkCard, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },

  summaryRow: {
    flexDirection: "row", gap: 8, flexWrap: "wrap",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  summaryPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: Colors.darkCard, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  summaryDot: { width: 6, height: 6, borderRadius: 3 },
  summaryText: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary },

  searchRow: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginVertical: 10,
    backgroundColor: Colors.darkCard, borderWidth: 2, borderColor: Colors.cardBorderStrong,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: {
    flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14,
    color: Colors.textPrimary,
    outlineStyle: "none" as any,
  },

  tabRow: {
    flexDirection: "row", gap: 6,
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tabPill: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: Colors.darkCard, borderWidth: 2, borderColor: Colors.cardBorderStrong,
    alignItems: "center",
  },
  tabPillActive: { backgroundColor: Colors.green, borderColor: Colors.green },
  tabText: { fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.textPrimary },
  tabTextActive: { fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  filterPill: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: Colors.darkCard, borderWidth: 2, borderColor: Colors.cardBorderStrong,
    alignItems: "center",
  },
  filterPillActive: { backgroundColor: Colors.green, borderColor: Colors.green },
  filterPillText: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.textPrimary },
  filterPillTextActive: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#FFFFFF" },

  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
  errorText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  retryBtn: {
    backgroundColor: Colors.green, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  retryBtnText: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.cardText },

  emptyBox: { alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 60 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },

  scroll: { padding: 16, gap: 8 },

  card: {
    backgroundColor: Colors.cardBg, borderRadius: 14,
    borderWidth: 2, borderColor: Colors.cardBorderStrong, overflow: "hidden",
    shadowColor: Colors.dark, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
    width: "100%" as any,
    alignSelf: "stretch" as const,
  },
  cardAccent: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14, paddingLeft: 16 },

  avatar: {
    width: 38, height: 38, borderRadius: 11,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  personName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText },
  personRole: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  projectText: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted },

  allocSide: { alignItems: "flex-end", gap: 3 },
  allocPct: { fontFamily: "Inter_700Bold", fontSize: 22 },
  allocMiniBar: { width: 44, height: 3, backgroundColor: "#F0F3F6", borderRadius: 2, overflow: "hidden", flexDirection: "row" },
  allocMiniFill: { height: 3, borderRadius: 2 },
  overBar: { height: 3, backgroundColor: Colors.red, borderRadius: 2 },
  statusPill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  statusPillText: { fontFamily: "Inter_600SemiBold", fontSize: 8 },

  impactRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    borderTopWidth: 1,
  },
  impactTitle: { fontFamily: "Inter_700Bold", fontSize: 11, marginBottom: 1 },
  impactSub: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted, lineHeight: 14 },

  expandedSection: { borderTopWidth: 1, borderTopColor: Colors.cardBorder },

  projectsBlock: { borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  projectsHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6,
    backgroundColor: Colors.green + "08",
  },
  projectsTitle: { fontFamily: "Inter_700Bold", fontSize: 9, color: Colors.green, letterSpacing: 1.1 },
  projectItem: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: "#F0F3F6",
  },
  projectItemText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardText },

  emailRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder,
  },
  emailText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted },

  statRow: {
    flexDirection: "row", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder,
  },
  statChip: {
    flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 8,
    paddingVertical: 6, alignItems: "center",
  },
  statVal: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.cardText },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 8, color: Colors.cardMuted, marginTop: 1 },

  expandedActions: { flexDirection: "row", gap: 6, padding: 10, paddingTop: 8 },
  expandBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, borderRadius: 10, paddingVertical: 9,
  },
  expandBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },

  /* ── Contacts ── */
  cardName: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#111" },
  cardRole: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#666", marginTop: 1 },
  actionBtnGreen: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: Colors.green, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  actionBtnGreenText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.cardText },

  /* ── Modal ── */
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: "85%", minHeight: "60%", paddingBottom: 60,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#D1D9E0", alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  modalHeader: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: "#EEF1F5",
  },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.cardText },
  modalSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted, marginTop: 3 },
  modalClose: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#F0F3F6", alignItems: "center", justifyContent: "center",
  },

  modalBadgeRow: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#EEF1F5" },
  modalBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9,
  },
  modalBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  modalContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  modalRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 11,
  },
  modalRowBorder: { borderTopWidth: 1, borderTopColor: "#F0F3F6" },
  modalPrefixBadge: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 42, alignItems: "center",
  },
  modalPrefixText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 },
  modalRowId: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText, flex: 1 },
  modalActivePill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: Colors.green + "18", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  modalActiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.green },
  modalActivePillText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: Colors.green },

  modalActiveCard: {
    backgroundColor: "#F8FAFB", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#EEF1F5",
  },
  modalActiveTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  modalAllocPct: { fontFamily: "Inter_700Bold", fontSize: 18 },

  modalBarTrack: {
    height: 6, backgroundColor: "#EEF1F5", borderRadius: 3,
    overflow: "hidden", flexDirection: "row",
  },
  modalBarFill: { height: 6, borderRadius: 3 },
  modalDateRange: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted, marginTop: 6 },

  modalTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  modalTotalLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardText },
  modalTotalPct: { fontFamily: "Inter_700Bold", fontSize: 24 },
  modalBarTrackLarge: {
    height: 10, backgroundColor: "#EEF1F5", borderRadius: 5,
    overflow: "hidden", flexDirection: "row", marginBottom: 4,
  },
  modalBarFillLarge: { height: 10, borderRadius: 5 },
  modalCapacityRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  modalCapacityMark: { flex: 1 },
  modalCapacityLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted },

  modalBreakdownHeading: {
    fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.cardText,
    letterSpacing: 0.8, marginBottom: 10,
  },
  modalAllocRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  modalShareText: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted, marginTop: 2 },

  modalEmpty: { alignItems: "center", gap: 10, paddingVertical: 40 },
  modalEmptyText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.cardMuted },
  modalEmptySubText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted },

  /* ── Profile modal ── */
  modalProfileContent: { paddingBottom: 60 },

  profileHero: {
    alignItems: "center", paddingVertical: 28,
    paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: "#EEF1F5",
  },
  profileAvatar: {
    width: 72, height: 72, borderRadius: 22, borderWidth: 2,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  profileAvatarText: { fontFamily: "Inter_700Bold", fontSize: 26 },
  profileName: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.cardText, marginBottom: 3 },
  profileRole: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardMuted, marginBottom: 8 },
  profileEmailRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  profileEmail: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.cardMuted },
  profileStatusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
  },
  profileStatusDot: { width: 6, height: 6, borderRadius: 3 },
  profileStatusText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  profileStatsRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 18, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: "#EEF1F5",
  },
  profileStat: { flex: 1, alignItems: "center" },
  profileStatDivider: { width: 1, height: 36, backgroundColor: "#EEF1F5" },
  profileStatVal: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.cardText },
  profileStatLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted, marginTop: 3 },

  profileSection: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#EEF1F5" },
  profileSectionTitle: {
    fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.cardMuted,
    letterSpacing: 1.2, marginBottom: 12,
  },
  profileBarRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  profileBarTrack: { flex: 1, height: 8, backgroundColor: "#EEF1F5", borderRadius: 4, overflow: "hidden" },
  profileBarFill: { height: 8, borderRadius: 4 },
  profileBarPct: { fontFamily: "Inter_700Bold", fontSize: 15, minWidth: 40, textAlign: "right" },
  profileBarLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  profileBarLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.cardMuted },

  profileAllocCard: {
    backgroundColor: "#F8FAFB", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#EEF1F5",
  },
  profileAllocTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  profileAllocId: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.cardText, flex: 1 },
  profileAllocPct: { fontFamily: "Inter_700Bold", fontSize: 16 },
  profileAllocDates: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.cardMuted },

  profileInfoRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  profileInfoText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.cardMuted },

  profileAssignBtn: {
    margin: 20, backgroundColor: Colors.green, borderRadius: 8,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14,
  },
  profileAssignText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.cardText },
}));
