import { Feather } from "@/lib/icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useScreenBeacon } from "@/lib/usageBeacon";
import {
  resolveActiveRole,
  rolePersonaBadge,
  loadRoleOverride,
  subscribeRoleOverride,
  type RolePersona,
} from "@/lib/roleResolver";
import { setChatPrompt } from "@/lib/chatBridge";
import { ActionModal } from "@/components/ActionModal";
import { ResolveOptionsSheet } from "@/components/ResolveOptionsSheet";
import { buildBriefingResolveOptions } from "@/lib/resolveOptions";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { auditAction, auditClose, auditOpen } from "@/lib/api";
import {
  composeDailyBriefing,
  type BriefingChange,
  type BriefingHero,
  type BriefingKpi,
  type BriefingNotification,
  type BriefingWindow,
  type DailyBriefingData,
} from "@/lib/dailyBriefing";

export const BRIEFING_STORAGE_KEY = "lastBriefingShown";

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CRITICAL_RED = "#E03C3C";
const WARNING_ORANGE = "#FF9425";
const INSIGHT_GREEN = Colors.green;

// White-card palette so the briefing matches the homepage look on mobile:
// dark page bg + bright white cards. Page-level chrome (root, topBar,
// bottomBar) keeps light-on-dark styling.
const CARD_BG = "#FFFFFF";
const CARD_TEXT = "#1B2B38";
const CARD_MUTED = "rgba(27,43,56,0.65)";
const CARD_MUTED_DIM = "rgba(27,43,56,0.45)";
const CARD_BORDER = "rgba(27,43,56,0.10)";
const CARD_BORDER_SOFT = "rgba(27,43,56,0.06)";
const CARD_INNER_BG = "rgba(27,43,56,0.05)";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatHeaderDate(d: Date = new Date()) {
  return `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function kpiToneColor(tone: BriefingKpi["tone"]): string {
  if (tone === "critical") return CRITICAL_RED;
  if (tone === "good") return INSIGHT_GREEN;
  return CARD_TEXT;
}

function changeToneColor(tone: BriefingChange["tone"]): string {
  if (tone === "bad") return CRITICAL_RED;
  if (tone === "good") return INSIGHT_GREEN;
  // Neutral tone — dark card text so the delta stays readable on white.
  return CARD_TEXT;
}

function notifColor(tier: BriefingNotification["tier"]): string {
  if (tier === "CRITICAL") return CRITICAL_RED;
  if (tier === "WARNING") return WARNING_ORANGE;
  return INSIGHT_GREEN;
}

function notifBgTint(tier: BriefingNotification["tier"]): string {
  if (tier === "CRITICAL") return "rgba(224,60,60,0.10)";
  if (tier === "WARNING") return "rgba(255,148,37,0.10)";
  return "rgba(107,165,57,0.10)";
}

function heroSeverityColor(severity: "critical" | "warning" | "clear"): string {
  if (severity === "critical") return CRITICAL_RED;
  if (severity === "warning") return WARNING_ORANGE;
  return INSIGHT_GREEN;
}

function firstName(full: string | undefined): string {
  if (!full) return "there";
  return full.trim().split(/\s+/)[0] || "there";
}

export default function DailyBriefingScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  useScreenBeacon("DailyBriefing");
  const [now, setNow] = React.useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = React.useState(false);

  const [data, setData] = useState<DailyBriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active persona — same resolver the Home screen uses. Drives which
  // alert/KPIs lead and the header greeting. Reacts to login + profile
  // role-override toggles so the briefing stays in lockstep with Home.
  const [role, setRole] = useState<RolePersona>(() =>
    resolveActiveRole(user?.userRoles, user?.username),
  );
  useEffect(() => {
    loadRoleOverride(user?.username).then(() => {
      setRole(resolveActiveRole(user?.userRoles, user?.username));
    });
    const unsub = subscribeRoleOverride(() => {
      setRole(resolveActiveRole(user?.userRoles, user?.username));
    });
    return unsub;
  }, [user?.userRoles, user?.username]);
  const [modalDetail, setModalDetail] = useState<ActionDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Hero whose "Resolve now" options picker is currently open.
  const [resolveHero, setResolveHero] = useState<BriefingHero | null>(null);

  const openDetail = useCallback((detail: ActionDetail | undefined | null) => {
    if (!detail) return;
    auditOpen({ screen: "daily-briefing" });
    setModalDetail(detail);
    setModalOpen(true);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  // Build a row-specific prompt from the open ActionDetail and the
  // user's selected row, then hand the conversation off to AI Chat.
  // Used by the "Resolve with AI" footer CTA in the drill-down modal,
  // so the user can solve the specific record they care about (a
  // particular over-allocated person, a specific demand, etc.).
  const handleAskAI = useCallback(
    (payload: { selectedIndexes: number[] }) => {
      if (!modalDetail) return;
      auditAction({ screen: "daily-briefing" });
      const idx = payload.selectedIndexes?.[0] ?? 0;
      const row = modalDetail.rows?.[idx] as Record<string, unknown> | undefined;
      const cols = modalDetail.columns ?? [];
      const colKeys = cols.map((c) => c.key);
      const rowFacts = row && cols.length > 0
        ? cols
            .map((c) => {
              const isProjects = c.key === "Projects";
              const fullProjects = isProjects
                ? (row as Record<string, unknown>)._projectsAll
                : undefined;
              const v = (fullProjects ?? row[c.key]) as unknown;
              if (v == null || v === "") return null;
              return `- ${c.label}: ${String(v)}`;
            })
            .filter(Boolean)
            .join("\n")
        : "";
      const projectsAll = (row as Record<string, unknown> | undefined)
        ?._projectsAll as string | undefined;
      const projectIds = projectsAll
        ? projectsAll.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      // Branch the protocol on what kind of drill-down the user
      // launched from. Each kind needs different tool calls and a
      // different action picker — over-allocation needs project
      // pickers, opportunities need outreach/win actions, demands
      // need staffing candidates.
      const isAllocation = colKeys.includes("Utilization");
      const isOpportunity =
        colKeys.includes("Stage") ||
        colKeys.includes("Win") ||
        colKeys.includes("Weighted");
      const isDemand =
        colKeys.includes("Title") && colKeys.includes("Value");

      let protocol = "";
      let pickerLine = "";

      if (isAllocation && projectIds.length > 0) {
        pickerLine = `[BUTTONS:${projectIds.join(",")}]`;
        protocol =
          `Protocol:\n` +
          `1. Call get_weekly_utilization for THIS resource to read real ` +
          `weekly hours and capacity.\n` +
          `2. For EACH unique project ID, call get_project_details.\n` +
          `3. Report the EXACT situation in 3-5 short bullets with real ` +
          `numbers (hours over capacity, which weeks, which projects ` +
          `collide, who else on the team has slack).\n` +
          `4. Recommend ONE concrete headline fix that brings the resource ` +
          `to ≤100% utilization. Trim a few hours from SEVERAL projects ` +
          `(prefer ones where a teammate has slack on the same role); state ` +
          `per-project deltas, e.g. "-5h/wk on PMM-...-000167 → Alexander, ` +
          `-3h/wk on PMM-...-000220 → Peter; new util 99%". Always show the ` +
          `resulting total utilization %.\n` +
          `5. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}\n\n` +
          `When I tap a project ID button, open the weekly-allocation ` +
          `editor for that specific project EXACTLY ONCE and STOP. Render ` +
          `a single [WEEKLY_ALLOC:...] block and nothing else. Do NOT call ` +
          `edit_weekly_allocation, edit_phase_hours, update_allocations or ` +
          `execute_update — wait for me to make the change in the editor.`;
      } else if (isOpportunity) {
        pickerLine =
          `[BUTTONS:Draft outreach email,Recommend best-fit team,Show risks & blockers]`;
        protocol =
          `Protocol:\n` +
          `1. Call get_opportunities_by_status / get_awarded_opportunities ` +
          `as needed to confirm stage, owner, weighted value and last ` +
          `activity date for THIS pursuit.\n` +
          `2. Call get_workforce_summary and find_staff_for_project to ` +
          `identify 2-3 best-fit team members for the work this opportunity ` +
          `would generate.\n` +
          `3. Report the EXACT situation in 3-5 short bullets: stage, ` +
          `weighted $, days in stage, decision-maker / next milestone, and ` +
          `whether we have the team to deliver if we win.\n` +
          `4. Recommend ONE concrete next move (e.g. "Send proposal-` +
          `revision email to <decision-maker> by <date>; staff with ` +
          `<person A>, <person B>"), naming people and dates.\n` +
          `5. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}\n\n` +
          `🛑 HARD STOP after step 5. Do NOT continue with "Draft outreach ` +
          `email", "Recommend best-fit team", or "Show risks & blockers" ` +
          `output until the user actually taps the corresponding button in ` +
          `a follow-up turn. The conditional rules below describe what to ` +
          `do in those FUTURE turns — they are NOT part of this reply.\n\n` +
          `When I tap "Draft outreach email", draft the actual email body. ` +
          `When I tap "Recommend best-fit team", produce a DETAILED ` +
          `recommendation with these sections in order:\n` +
          `  • For EACH discipline the project actually needs (Plumbing ` +
          `Engineer, Mechanical Engineer, Senior Project Manager, ` +
          `Architect, etc.) call find_staff_for_project / ` +
          `get_workforce_summary and produce TWO sub-lists:\n` +
          `      ▸ "Top picks (best-fit)" — up to 3 names, each with: ` +
          `current title/role, current utilization %, years of relevant ` +
          `experience, 1–2 sentence reason explaining WHY they're a fit ` +
          `(matching past projects, sector experience, certifications, ` +
          `geography, etc.).\n` +
          `      ▸ "Bench (available capacity)" — EVERY OTHER person in ` +
          `that discipline who has spare capacity (utilization < 100%), ` +
          `as a compact comma-separated list "Name (role, util%)". Do ` +
          `NOT truncate this bench list — include all of them so the ` +
          `user sees the full pool.\n` +
          `  • End with a 1-line "Why these picks" summary explaining the ` +
          `selection criteria you used (utilization, sector match, ` +
          `recent similar work).\n` +
          `🔴 ABSOLUTE RULE: your reply MUST END with EXACTLY ONE ` +
          `consolidated picker line and nothing after it: ` +
          `[BUTTONS:Assign <Name1>,Assign <Name2>,Assign <Name3>,...] ` +
          `containing every TOP-PICK name across all discipline sections ` +
          `(max 9 buttons, comma-separated, each prefixed with "Assign "). ` +
          `Bench names go in the prose only, NOT in the button row. ` +
          `Without that picker line, the user has no way to assign ` +
          `anyone — re-output your reply if you forgot it. When I ` +
          `then tap "Assign <Name>", prepare an ` +
          `assign_person call (project_id from the record, role from the ` +
          `candidate's recommended role, pct=100, start/end from project ` +
          `dates), summarize the assignment in 2 lines and end with ` +
          `[BUTTONS:CONFIRM,Cancel]. Call assign_person ONLY after I tap ` +
          `CONFIRM. When I tap "Show risks & blockers", list the top 3 ` +
          `risks (stalled stage, missing decision-maker, capacity gaps, ` +
          `competitor activity) with the mitigation for each.`;
      } else if (isDemand) {
        pickerLine =
          `[BUTTONS:Suggest top candidates,Draft role brief,Defer demand]`;
        protocol =
          `Protocol:\n` +
          `1. Call find_staff_for_project / get_workforce_summary to ` +
          `identify 3 best-fit candidates (right role, current util ≤80%).\n` +
          `2. Call get_project_details for the related project to confirm ` +
          `dates, role mix and contract value.\n` +
          `3. Report the EXACT situation in 3-5 short bullets: role, hours ` +
          `needed, start date, contract value, top 3 candidates with their ` +
          `current utilization.\n` +
          `4. Recommend ONE concrete fill plan (e.g. "Assign <Person> at ` +
          `<X>h/wk starting <date>; backup <Person>"), naming people and ` +
          `dates.\n` +
          `5. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}\n\n` +
          `When I tap "Suggest top candidates", show a ranked roster of ` +
          `up to 3 candidates with names, roles and utilization, then end ` +
          `with EXACTLY: [BUTTONS:Assign <Name1>,Assign <Name2>,Assign ` +
          `<Name3>]. When I then tap "Assign <Name>", prepare an ` +
          `assign_person call (project_id from the record, role from the ` +
          `demand, pct=100, start/end from the demand dates), summarize in ` +
          `2 lines and end with [BUTTONS:CONFIRM,Cancel]. Call ` +
          `assign_person ONLY after I tap CONFIRM. When I tap "Draft role ` +
          `brief", draft a short JD I can post. When I tap "Defer demand", ` +
          `explain the impact of deferring and confirm.`;
      } else {
        pickerLine = `[BUTTONS:Show next steps,Open related record]`;
        protocol =
          `Protocol:\n` +
          `1. Use the appropriate tools (get_workforce_summary, ` +
          `get_project_details, get_resource_demands, etc.) to read the ` +
          `real data behind THIS record.\n` +
          `2. Report the EXACT situation in 3-5 short bullets with real ` +
          `numbers and names.\n` +
          `3. Recommend ONE concrete next move, naming people, dates and ` +
          `amounts.\n` +
          `4. End with EXACTLY this picker line and nothing after it:\n` +
          `${pickerLine}`;
      }

      const prompt =
        `Resolve a specific record from today's Daily Briefing.\n\n` +
        (rowFacts ? `Selected record:\n${rowFacts}\n\n` : "") +
        `Briefing section: ${modalDetail.title}` +
        (modalDetail.subtitle ? ` — ${modalDetail.subtitle}` : "") +
        `\n\nHARD RULES:\n` +
        `• No generic advice. Cite real numbers from tool calls.\n` +
        `• NEVER narrate what you are about to do ("The current context ` +
        `does not include...", "Let me retrieve...", "I'll first check..."). ` +
        `Call the tools silently, then answer with the result only.\n` +
        `• NEVER emit placeholder brackets like [Specific Details Needed], ` +
        `[Proposed Date: TBD], [Not specified], [Not listed], [TBD], or any ` +
        `other [bracketed] stand-in text. If a value is unknown, CALL THE ` +
        `TOOL to fetch it (get_workforce_summary for utilization, ` +
        `get_project_details for dates/contract values, ` +
        `find_staff_for_project for candidates). If the tool returns ` +
        `nothing, OMIT that bullet entirely — do not write a placeholder.\n` +
        `• Your FIRST reply MUST end with the picker line and MUST NOT ` +
        `contain any [WEEKLY_ALLOC:...], [SCHEDULE_TABLE:...], ` +
        `[ALLOC_FORM:...] or [LIFECYCLE_PICKER:...] block — the user picks ` +
        `the action.\n\n` +
        protocol;
      setChatPrompt(prompt, undefined, true);
      setModalOpen(false);
      if (Platform.OS !== "web") {
        Haptics.selectionAsync().catch(() => {});
      }
      router.push("/(tabs)/chat");
    },
    [modalDetail],
  );

  // "Resolve now" opens a picker of concrete fixes — each deep-links to
  // the screen where the problem actually lives; handing off to AI Chat
  // is the explicit last option rather than the default.
  const handleResolve = useCallback((hero: BriefingHero) => {
    if (!hero.resolveRef) return;
    auditOpen({ screen: "daily-briefing" });
    setModalOpen(false);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    setResolveHero(hero);
  }, []);

  // AI hand-off (the last option in the picker): builds a focused prompt
  // so the assistant can immediately propose a concrete fix (rebalance,
  // reassign, defer, etc.).
  const handleResolveAi = useCallback((hero: BriefingHero) => {
    const ref = hero.resolveRef;
    if (!ref) return;
    auditAction({ screen: "daily-briefing" });
    // Pull a real ticket ID out of the label/sub text if present; these
    // heroes can represent a single project ("PMM-25-000123 overdue") or a
    // portfolio-level aggregate ("$2.1M revenue at risk across 5 projects")
    // — only the former is safe to hand the AI a name/ID for.
    const refTicketMatch = `${ref.label} ${ref.sub ?? ""}`.match(/[A-Z]{2,4}-\d{2}-\d{4,6}/);
    const ticketGuard = refTicketMatch
      ? `TICKET ID: ${refTicketMatch[0]} — use this exact ID when calling any RM ONE lookup tool. Do NOT alter or substitute any other ID.`
      : `IMPORTANT: If this references a specific project by name, call search_projects with that name first and use the TicketId returned. If it's a portfolio-level aggregate with no single project name, do NOT call search_projects — answer using only the figures already given above.`;
    const prompt =
      `Help me resolve this risk surfaced in today's Daily Briefing:\n\n` +
      `Issue: ${ref.label}\n` +
      `Severity: ${ref.level}\n` +
      (ref.sub ? `Context: ${ref.sub}\n` : "") +
      `\nWalk me through the concrete options to fix it (e.g. rebalance ` +
      `allocations, reassign staff, defer scope) using the latest project ` +
      `and resource data, then recommend the best next action I should take.\n\n` +
      ticketGuard;
    setChatPrompt(prompt, undefined, true);
    setModalOpen(false);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    router.push("/(tabs)/chat");
  }, []);

  const windowKey: BriefingWindow = "7d";

  // Guard against a slow earlier compose (e.g. the initial one restored
  // from AsyncStorage) resolving AFTER a newer one and clobbering fresh
  // data. Each load gets a monotonically increasing id; only the latest
  // call is allowed to set state.
  const loadIdRef = useRef(0);
  const load = useCallback(async (forceRefresh = false) => {
    const myId = ++loadIdRef.current;
    setError(null);
    try {
      const next = await composeDailyBriefing({ forceRefresh, window: windowKey, role });
      if (loadIdRef.current !== myId) return;
      setData(next);
    } catch (e) {
      if (loadIdRef.current !== myId) return;
      console.warn("[DailyBriefing] composer failed:", String(e));
      const raw = String(e);
      if (raw.includes("401") || raw.includes("Unauthorized")) {
        setError("Your session has expired. Please log in again.");
      } else if (raw.includes("Network") || raw.includes("fetch")) {
        setError("Unable to connect. Please check your network and try again.");
      } else {
        setError("We couldn't pull your briefing just now. Pull to refresh.");
      }
    } finally {
      if (loadIdRef.current !== myId) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [role]);

  useEffect(() => {
    load();
  }, [load]);

  type BriefingTarget = "/(tabs)" | "/(tabs)/resources";

  async function markSeenAndGo(target: BriefingTarget) {
    auditAction({ screen: "daily-briefing" });
    try {
      await AsyncStorage.setItem(BRIEFING_STORAGE_KEY, todayKey());
    } catch {
      /* best effort */
    }
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    router.replace(target);
  }

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    // Bump the displayed "now" so the header date line re-renders, then
    // force a fresh briefing fetch (bypassing the in-memory cache so users
    // get truly current data on pull-to-refresh). `load()` clears
    // `refreshing` in its finally block so the spinner stops as soon as
    // the fetch resolves.
    setNow(new Date());
    load(true);
  }, [load]);

  const greetingName = firstName(user?.username);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 96 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.green}
            colors={[Colors.green]}
            progressBackgroundColor="rgba(28,40,52,0.92)"
          />
        }
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateText}>{formatHeaderDate(now)}</Text>
            <Text style={styles.greetingText}>Good morning, {greetingName}</Text>
            <View style={styles.roleLine}>
              <View style={styles.rolePill}>
                <Text style={styles.rolePillText}>{rolePersonaBadge(role)}</Text>
              </View>
              {data?.greeting ? (
                <Text style={styles.roleGreetingText}>{data.greeting}</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.livePulse}>
            <View style={styles.livePulseDot} />
            <Text style={styles.livePulseText}>
              {loading
                ? "SYNCING"
                : data
                ? `AS OF ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "LIVE PULSE"}
            </Text>
          </View>
        </View>

        {/* Loading skeleton */}
        {loading && !data ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.green} />
            <Text style={styles.loadingText}>Pulling your latest briefing…</Text>
          </View>
        ) : null}

        {/* Error state */}
        {!loading && error && !data ? (
          <View style={styles.errorCard}>
            <Feather name="wifi-off" size={28} color={CRITICAL_RED} />
            <Text style={styles.errorTitle}>Briefing unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => {
                auditAction({ screen: "daily-briefing" });
                setLoading(true);
                load();
              }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Degraded data banner */}
        {data && data.degraded ? (
          <View style={styles.degradedBanner}>
            <Feather name="alert-triangle" size={14} color={WARNING_ORANGE} />
            <Text style={styles.degradedBannerText}>
              {`Partial briefing — ${data.degradedSources.join(", ")} feed${data.degradedSources.length === 1 ? "" : "s"} offline. Some numbers may be incomplete.`}
            </Text>
          </View>
        ) : null}

        {/* Hero alert (live) */}
        {data ? (() => {
          const sevColor = heroSeverityColor(data.hero.severity);
          return (
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: sevColor + "0F",
                borderColor: sevColor + "66",
                shadowColor: sevColor,
              },
            ]}
          >
            <View style={styles.heroCardInner}>
              <View style={styles.heroTopRow}>
                <View style={styles.pinnedTag}>
                  <View style={[styles.pinnedDot, { backgroundColor: sevColor }]} />
                  <Text style={[styles.pinnedTagText, { color: sevColor }]}>{data.hero.tagLabel}</Text>
                </View>
                <View style={styles.next7Chip}>
                  <Text style={styles.next7ChipText}>{data.hero.windowLabel}</Text>
                </View>
                <Text style={styles.heroTimestamp}>{data.hero.agoLabel.toUpperCase()}</Text>
              </View>

              <Text style={styles.heroHeadline}>{data.hero.headline}</Text>
              <Text style={styles.heroSubline}>{data.hero.subline}</Text>

              <View style={styles.heroButtonRow}>
                <Pressable
                  style={({ pressed }) => [styles.resolveBtn, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => handleResolve(data.hero)}
                  disabled={!data.hero.resolveRef}
                >
                  <Text style={styles.resolveBtnText}>Resolve now</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.viewBtn, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => openDetail(data.hero.detail)}
                  disabled={!data.hero.detail}
                >
                  <Text style={styles.viewBtnText}>View</Text>
                </Pressable>
              </View>
            </View>
          </View>
          );
        })() : null}

        {/* Overnight Scan */}
        {data ? (
          <View style={styles.section}>
            <View style={styles.scanHeader}>
              <View style={styles.scanIconWrap}>
                <Feather name="zap" size={14} color={Colors.green} />
              </View>
              <Text style={styles.scanTitle}>OVERNIGHT SCAN</Text>
              <Text style={styles.scanSubStat}>{data.scan.subStat}</Text>
            </View>

            <View style={styles.kpiRow}>
              {data.scan.kpis.map((kpi, i) => (
                <Pressable
                  key={`${kpi.labelTop}-${i}`}
                  style={({ pressed }) => [
                    styles.kpiCell,
                    // Up to 3 KPIs fit side-by-side; 4+ wrap 2-per-row so
                    // the numbers stay readable on small phones.
                    data.scan.kpis.length <= 3
                      ? { width: `${100 / data.scan.kpis.length}%`, paddingHorizontal: 6 }
                      : null,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => openDetail(kpi.detail)}
                  disabled={!kpi.detail}
                >
                  <Text
                    style={[
                      styles.kpiNumber,
                      { color: kpiToneColor(kpi.tone) },
                      kpi.number.length > 4 ? { fontSize: 24 } : null,
                    ]}
                    numberOfLines={1}
                  >
                    {kpi.number}
                  </Text>
                  <Text style={styles.kpiLabel}>{kpi.labelTop}</Text>
                  <Text style={styles.kpiLabel}>{kpi.labelBottom}</Text>
                  <Text style={styles.kpiCaption}>{kpi.caption}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* What Changed */}
        {data ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.cardHeaderText}>{data.changesHeading}</Text>
                {data.changesAreSample ? (
                  <View style={styles.sampleBadge}>
                    <Text style={styles.sampleBadgeText}>SAMPLE</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.movesBadge}>
                <Text style={styles.movesBadgeText}>{data.changesBadge}</Text>
              </View>
            </View>
            {data.changes.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>
                  No movement detected — your operations were quiet overnight.
                </Text>
              </View>
            ) : (
              data.changes.map((row, i) => {
                const color = changeToneColor(row.tone);
                return (
                  <Pressable
                    key={`${row.label}-${i}`}
                    onPress={() => openDetail(row.detail)}
                    disabled={!row.detail}
                    style={({ pressed }) => [
                      styles.changeRow,
                      i < data.changes.length - 1 && styles.rowDivider,
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <View style={[styles.changeIconWrap, { backgroundColor: color + "1A" }]}>
                      <Feather name={row.icon} size={14} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.changeLabel}>{row.label}</Text>
                      <Text style={styles.changeContext} numberOfLines={2}>{row.context}</Text>
                    </View>
                    <Text style={[styles.changeDelta, { color }]} numberOfLines={1}>
                      {row.delta}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        {/* Critical Notifications */}
        {data ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={styles.cardHeaderText}>CRITICAL NOTIFICATIONS</Text>
              </View>
              <View
                style={[
                  styles.newBadge,
                  data.notificationsBadge === "NO ALERTS" && { backgroundColor: INSIGHT_GREEN },
                ]}
              >
                <Text style={styles.newBadgeText}>{data.notificationsBadge}</Text>
              </View>
            </View>
            {data.notifications.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>
                  No critical notifications in this window — nothing needs your attention right now.
                </Text>
              </View>
            ) : (
              data.notifications.map((n, i) => {
                const color = notifColor(n.tier);
                const bg = notifBgTint(n.tier);
                return (
                  <View
                    key={n.id}
                    style={[
                      styles.notifRow,
                      { backgroundColor: bg, borderLeftColor: color },
                      i < data.notifications.length - 1 && { marginBottom: 10 },
                    ]}
                  >
                    <View style={[styles.notifIconWrap, { backgroundColor: color + "26" }]}>
                      <View style={[styles.severityDot, { backgroundColor: color }]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.notifTopRow}>
                        <Text style={[styles.notifTier, { color }]}>{n.tier}</Text>
                        <Text style={styles.notifAgo}>· {n.ago}</Text>
                      </View>
                      <Text style={styles.notifDesc} numberOfLines={2}>{n.description}</Text>
                    </View>
                    <View style={[styles.timingChip, { backgroundColor: color + "26", borderColor: color + "55" }]}>
                      <Text style={[styles.timingChipText, { color }]}>{n.chip}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Drill-down modal for "View" / KPI / change rows. The "Resolve
          with AI" footer CTA hands the picked row off to AI Chat with
          a focused prompt so the user can actually solve the issue. */}
      <ActionModal
        open={modalOpen}
        onClose={() => {
          auditClose({ screen: "daily-briefing" });
          setModalOpen(false);
        }}
        detail={modalDetail}
        ctaLabel="Resolve with AI"
        onConfirm={handleAskAI}
      />

      {/* "Resolve now" options picker: concrete deep-links first, AI
          chat hand-off as the explicit last option. */}
      {resolveHero?.resolveRef ? (
        <ResolveOptionsSheet
          open
          title={resolveHero.resolveRef.label}
          subtitle={resolveHero.resolveRef.sub}
          severity={resolveHero.resolveRef.level}
          options={buildBriefingResolveOptions(resolveHero.resolveRef)}
          onClose={() => {
            auditClose({ screen: "daily-briefing" });
            setResolveHero(null);
          }}
          onSelect={(opt) => {
            auditAction({ screen: "daily-briefing" });
            const hero = resolveHero;
            setResolveHero(null);
            if (opt.ai) {
              handleResolveAi(hero);
            } else if (opt.to) {
              if (Platform.OS !== "web") {
                Haptics.selectionAsync().catch(() => {});
              }
              router.push(opt.to as never);
            }
          }}
        />
      ) : null}

      {/* Open command center CTA pinned to bottom */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable
          style={({ pressed }) => [styles.commandBtn, { opacity: pressed ? 0.9 : 1 }]}
          onPress={() => markSeenAndGo("/(tabs)")}
        >
          <Text style={styles.commandBtnText}>Open command center</Text>
          <Feather name="arrow-right" size={16} color={Colors.white} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.darkDeep },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },

  /* Time-window selector */
  windowSelector: {
    flexDirection: "row",
    alignSelf: "stretch",
    marginBottom: 14,
    padding: 2,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 2,
  },
  windowChip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  windowChipActive: {
    backgroundColor: Colors.green,
  },
  windowChipText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.55)",
  },
  windowChipTextActive: {
    color: "#FFFFFF",
  },

  /* Top bar */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  dateText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  greetingText: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.textPrimary,
  },
  roleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: Colors.green + "1F",
    borderWidth: 1,
    borderColor: Colors.green + "55",
  },
  rolePillText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.6,
    color: Colors.green,
  },
  roleGreetingText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 0.2,
  },
  livePulse: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.green + "1F",
    borderWidth: 1,
    borderColor: Colors.green + "55",
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.green,
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  livePulseText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: Colors.green,
    letterSpacing: 1,
  },

  /* Loading + error */
  loadingWrap: {
    paddingVertical: 60,
    alignItems: "center",
    gap: 14,
  },
  loadingText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.textMuted,
  },
  errorCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CRITICAL_RED + "55",
    padding: 22,
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  degradedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: WARNING_ORANGE + "1F",
    borderWidth: 1,
    borderColor: WARNING_ORANGE + "55",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 14,
  },
  degradedBannerText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 11.5,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 15,
  },
  errorTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: CARD_TEXT,
  },
  errorBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: CARD_MUTED,
    textAlign: "center",
    lineHeight: 17,
  },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: Colors.green,
  },
  retryBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: Colors.cardText,
  },

  /* Empty rows inside cards */
  emptyRow: {
    paddingVertical: 18,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: CARD_MUTED,
    textAlign: "center",
    lineHeight: 17,
  },

  /* Hero Card */
  heroCard: {
    borderRadius: 20,
    backgroundColor: CRITICAL_RED + "0F",
    borderWidth: 1.5,
    borderColor: CRITICAL_RED + "66",
    shadowColor: CRITICAL_RED,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 10,
    marginBottom: 28,
  },
  heroCardInner: {
    backgroundColor: CARD_BG,
    borderRadius: 19,
    padding: 18,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  pinnedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  pinnedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: CRITICAL_RED,
  },
  pinnedTagText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: CRITICAL_RED,
    letterSpacing: 0.8,
  },
  next7Chip: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: CARD_INNER_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  next7ChipText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: CARD_MUTED,
    letterSpacing: 0.6,
  },
  heroTimestamp: {
    marginLeft: "auto",
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: CARD_MUTED_DIM,
    letterSpacing: 0.5,
  },
  heroHeadline: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    lineHeight: 28,
    color: CARD_TEXT,
    marginBottom: 8,
  },
  heroSubline: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: CARD_MUTED,
    marginBottom: 18,
  },
  heroButtonRow: {
    flexDirection: "row",
    gap: 10,
  },
  resolveBtn: {
    flex: 1,
    backgroundColor: Colors.green,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 6,
  },
  resolveBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: Colors.cardText,
    letterSpacing: 0.2,
  },
  viewBtn: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: CARD_INNER_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  viewBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: CARD_TEXT,
    letterSpacing: 0.2,
  },

  /* Overnight Scan */
  section: {
    marginBottom: 22,
  },
  scanHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 8,
  },
  scanIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.green + "20",
  },
  scanTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: CARD_TEXT,
    letterSpacing: 1.2,
  },
  scanSubStat: {
    marginLeft: "auto",
    fontFamily: "Inter_500Medium",
    fontSize: 9,
    color: CARD_MUTED_DIM,
    letterSpacing: 0.6,
  },
  // KPIs now wrap to 2-per-row instead of cramming all in one horizontal row.
  // Older clients found 4-5 KPIs side-by-side too tiny to read.
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingVertical: 18,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  kpiCell: {
    width: "50%",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  kpiDivider: {
    display: "none",
  },
  kpiNumber: {
    fontFamily: "Inter_700Bold",
    fontSize: 32,
    lineHeight: 36,
    marginBottom: 6,
  },
  kpiLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: CARD_TEXT,
    letterSpacing: 0.6,
    textAlign: "center",
  },
  kpiCaption: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: CARD_MUTED_DIM,
    marginTop: 6,
    textAlign: "center",
  },

  /* Generic card */
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  cardHeaderText: {
    flex: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: CARD_TEXT,
    letterSpacing: 1.2,
  },
  movesBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: CARD_INNER_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  sampleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255,148,37,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,148,37,0.35)",
  },
  sampleBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: WARNING_ORANGE,
    letterSpacing: 0.8,
  },
  movesBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: CARD_MUTED,
    letterSpacing: 0.8,
  },
  newBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: WARNING_ORANGE,
  },
  newBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: Colors.cardText,
    letterSpacing: 0.8,
  },

  /* Change rows */
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER_SOFT,
  },
  changeIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  changeLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: CARD_TEXT,
    marginBottom: 2,
  },
  changeContext: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: CARD_MUTED,
  },
  changeDelta: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },

  /* Notification rows */
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    gap: 12,
  },
  notifIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  severityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  notifTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
  },
  notifTier: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  notifAgo: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: CARD_MUTED_DIM,
    marginLeft: 6,
  },
  notifDesc: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: CARD_TEXT,
    lineHeight: 16,
  },
  timingChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  timingChipText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.5,
  },

  /* Bottom CTA */
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: Colors.darkDeep,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  commandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.green,
    borderRadius: 14,
    paddingVertical: 18,
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
  },
  commandBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: Colors.cardText,
    letterSpacing: 0.3,
  },
}));
