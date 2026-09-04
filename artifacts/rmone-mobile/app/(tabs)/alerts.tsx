// Alerts tab — full Operational Risk Feed for the active role with
// severity filter chips. Reuses the same visual language as the home
// risk feed (see app/(tabs)/index.tsx).

import { Feather } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useScreenBeacon } from "@/lib/usageBeacon";
import { setChatPrompt } from "@/lib/chatBridge";
import {
  loadRoleOverride,
  resolveActiveRole,
  rolePersonaFullName,
  subscribeRoleOverride,
  type RolePersona,
} from "@/lib/roleResolver";
import { type RiskItem, type RiskTone } from "@/lib/roleHomeData";
import { fetchHomeRisks, type HomeLiveRisks } from "@/lib/homeLiveData";
import { ActionModal } from "@/components/ActionModal";
import type { ActionDetail } from "@/lib/homeIntelligence";
import { auditAction, auditClose, auditFilter, auditOpen } from "@/lib/api";

// Build the same popup detail table the home tab shows when you tap a
// risk row. Pulls any record IDs (PMM-25-####, OPM-25-####) out of the
// title/sub copy and renders one row per affected record so the user
// can pick which one to focus the AI hand-off on.
function buildRiskDetail(fullName: string, risk: RiskItem): ActionDetail {
  const cols = [
    { key: "record", label: "Record / Item" },
    { key: "issue", label: "Issue" },
    { key: "owner", label: "Owner" },
    { key: "due", label: "Due" },
  ];
  const sub = risk.sub ?? "";
  const ids = (`${risk.title} ${sub}`.match(/[A-Z]{2,4}-\d{2}-\d{4,6}/g) ?? []) as string[];
  const issue = risk.title.replace(/^[A-Z]{2,4}-\d{2}-\d{4,6}\s*[—-]\s*/, "").trim();
  const due = risk.tone === "high" ? "Today" : risk.tone === "med" ? "This week" : "—";
  let rows: Record<string, string>[];
  if (ids.length > 0) {
    rows = ids.map((rid, i) => ({
      record: rid,
      issue: i === 0 ? issue : sub,
      owner: i === 0 ? "Tom R." : i === 1 ? "Ana D." : "Unassigned",
      due,
    }));
  } else {
    // No real ticket ID can be extracted — this is a portfolio-level
    // metric or a curated/sample row, not a single addressable project.
    // Tag it so the chat hand-off never sends the AI hunting for a
    // project that doesn't exist (see _aggregate check in handleAskAI).
    rows = [{ record: risk.title, issue: sub, owner: "—", due, _aggregate: "true" }];
  }
  const tier = risk.tone === "high" ? "CRITICAL" : risk.tone === "info" ? "INFO" : "WARNING";
  return {
    title: risk.title,
    subtitle: `${tier} · ${fullName}${sub ? ` · ${sub}` : ""}`,
    columns: cols,
    rows,
  };
}

const GREEN = Colors.green;
const LIGHT_GREEN = Colors.greenLight;
const ORANGE = Colors.orange;
const ORANGE_WARM = Colors.orangeWarm;
const RED = "#FF4D2E";

type Filter = "all" | RiskTone;

const FILTERS: Array<{ key: Filter; label: string; color: string }> = [
  { key: "all", label: "All", color: LIGHT_GREEN },
  { key: "high", label: "Critical", color: RED },
  { key: "med", label: "Warn", color: ORANGE },
  { key: "info", label: "Info", color: LIGHT_GREEN },
];

export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  useScreenBeacon("Alerts");

  const [role, setRole] = useState<RolePersona>(() =>
    resolveActiveRole(user?.userRoles, user?.username),
  );
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    loadRoleOverride(user?.username).then(() => {
      setRole(resolveActiveRole(user?.userRoles, user?.username));
    });
    const unsub = subscribeRoleOverride(() => {
      setRole(resolveActiveRole(user?.userRoles, user?.username));
    });
    return unsub;
  }, [user?.username, user?.userRoles]);

  useFocusEffect(
    useCallback(() => {
      setRole(resolveActiveRole(user?.userRoles, user?.username));
    }, [user?.userRoles, user?.username]),
  );

  const fullName = rolePersonaFullName(role);

  // Live-data overlay — mirrors the web alerts page. REAL-DATA-ONLY: the
  // alerts feed renders exclusively live at-risk records (PMM/OPM whose
  // status flags an issue). No curated/illustrative backfill.
  const [overlay, setOverlay] = useState<HomeLiveRisks | null>(null);
  const [overlayLoading, setOverlayLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    // Reset overlay so a stale prior-context overlay can't keep
    // showing LIVE rows while the new (role, user) fetch is in
    // flight or after it fails.
    setOverlay(null);
    setOverlayLoading(true);
    fetchHomeRisks(role, { username: user?.username, limit: 10 })
      .then((o) => {
        if (!alive) return;
        setOverlay(o);
        setOverlayLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setOverlayLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [role, user?.username]);

  const mergedRisks: RiskItem[] = useMemo(() => {
    return overlay?.liveRisks ?? [];
  }, [overlay]);

  const filtered: RiskItem[] = useMemo(() => {
    if (filter === "all") return mergedRisks;
    return mergedRisks.filter((r) => r.tone === filter);
  }, [mergedRisks, filter]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: mergedRisks.length, high: 0, med: 0, info: 0 };
    for (const r of mergedRisks) c[r.tone]++;
    return c;
  }, [mergedRisks]);

  const liveAlertCount = overlay?.liveRisks.length ?? 0;

  // Tap-on-row matches the home tab: open a popup sheet with affected
  // records, then user taps "Ask AI" to hand off into chat. Avoids
  // the surprise of an immediate jump out of the alerts feed into a
  // chat session before the user can preview.
  const [modal, setModal] = useState<{ risk: RiskItem; detail: ActionDetail } | null>(null);

  const handleRisk = useCallback(
    (r: RiskItem) => {
      auditOpen({ entityType: "list", entityId: "alerts-feed" });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Live risks (bench list, over-allocated person, demand slots,
      // etc.) ship a `records` ActionDetail with the underlying rows
      // so the popup can list every affected resource/project. For
      // curated rows and live rows without records (e.g. backend-feed
      // sentinels), fall back to a synthesized single-row summary.
      const detail = r.records ?? buildRiskDetail(fullName, r);
      setModal({ risk: r, detail });
    },
    [fullName],
  );

  const handleAskAI = useCallback(
    (payload: { selectedIndexes: number[] }) => {
      if (!modal || !modal.detail) return;
      auditAction({ entityType: "list", entityId: "alerts-feed" });
      const idx = payload.selectedIndexes?.[0] ?? 0;
      const row = modal.detail.rows?.[idx];
      const ticketId: string = row
        ? String((row as Record<string, unknown>)._ticket ?? (row as Record<string, unknown>)._id ?? "").trim()
        : "";
      const isAggregate = row
        ? String((row as Record<string, unknown>)._aggregate ?? "") === "true"
        : false;
      const rowSummary = row
        ? Object.entries(row)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")
        : "";
      const ticketGuard = ticketId
        ? `TICKET ID: ${ticketId} — use this exact ID when calling any RM ONE lookup tool. Do NOT alter or substitute any other ID.`
        : isAggregate
        ? `NOTE: This item is a portfolio-level metric, not a single project record. Do NOT call search_projects for it — there is no project name to look up. Answer using only the figures already given above; recommend general next steps instead of naming a specific project.`
        : `IMPORTANT: If you need to look up a specific project by name, call search_projects with the name first and use the TicketId returned — NEVER guess or construct a ticket ID.`;
      const prompt = [
        `Acting as ${fullName}: there's an active alert on the operational risk feed — "${modal.risk.title}" (${modal.risk.sub ?? ""}).`,
        rowSummary ? `Focus on this affected record — ${rowSummary}.` : "",
        `Spell out the risk in one sentence, list who is affected by name, and recommend 2–3 specific mitigation steps with owners and deadlines.`,
        ticketGuard,
        `Use ONLY real names, project IDs, and figures you can verify from RM ONE tool results. NEVER output square-bracket placeholders. Omit a bullet if the data isn't available after a tool lookup.`,
      ].filter(Boolean).join(" ");
      setModal(null);
      setChatPrompt(prompt, undefined, true);
      setTimeout(() => {
        try { router.navigate("/(tabs)/chat"); } catch (_) {}
      }, 80);
    },
    [modal, fullName, router],
  );

  return (
    <View style={[styles.root, { backgroundColor: Colors.darkDeep }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />

      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={styles.title}>Alerts</Text>
          {overlayLoading ? (
            <View style={styles.liveBadgeNeutral}>
              <Text style={styles.liveBadgeNeutralText}>UPDATING</Text>
            </View>
          ) : liveAlertCount > 0 ? (
            <View style={styles.liveBadgeOn}>
              <View style={styles.liveBadgeDot} />
              <Text style={styles.liveBadgeOnText}>LIVE · {liveAlertCount}</Text>
            </View>
          ) : (
            <View style={styles.liveBadgeNeutral}>
              <Text style={styles.liveBadgeNeutralText}>NO ACTIVE ALERTS</Text>
            </View>
          )}
        </View>
        <Text style={styles.subtitle}>Operational risk feed · {fullName}</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  auditFilter({ entityType: "list", entityId: "alerts-feed" });
                  setFilter(f.key);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? f.color : "rgba(255,255,255,0.04)",
                    borderColor: active ? f.color : "rgba(255,255,255,0.10)",
                  },
                ]}
                testID={`filter-${f.key}`}
              >
                <Text
                  style={[
                    styles.filterChipLabel,
                    { color: active ? "#1B2B38" : "rgba(255,255,255,0.85)" },
                  ]}
                >
                  {f.label}
                </Text>
                <Text
                  style={[
                    styles.filterChipCount,
                    { color: active ? "#1B2B38" : "rgba(255,255,255,0.55)" },
                  ]}
                >
                  {counts[f.key]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No alerts at this severity for the active role.</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {filtered.map((r, i) => (
              <RiskRow key={i} r={r} onPress={() => handleRisk(r)} />
            ))}
          </View>
        )}
      </ScrollView>

      <ActionModal
        open={modal !== null}
        onClose={() => {
          auditClose({ entityType: "list", entityId: "alerts-feed" });
          setModal(null);
        }}
        detail={modal?.detail ?? null}
        ctaLabel="Ask AI"
        onConfirm={handleAskAI}
      />
    </View>
  );
}

function RiskRow({ r, onPress }: { r: RiskItem; onPress: () => void }) {
  const isHigh = r.tone === "high";
  const isInfo = r.tone === "info";
  const dotColor = isHigh ? RED : isInfo ? LIGHT_GREEN : ORANGE;
  const chipFg = isHigh ? "#B91C1C" : isInfo ? "#15803D" : "#B45309";
  const chipLabel = isHigh ? "CRIT" : isInfo ? "INFO" : "WARN";
  // White cards on dark page bg; CRIT keeps a soft red-tinted background
  // so it still reads as "needs attention".
  const bg = isHigh ? "#FFF5F5" : "#FFFFFF";
  const border = isHigh ? `${RED}66` : "rgba(0,0,0,0.08)";
  const titleColor = isHigh ? "#7F1D1D" : "#1B2B38";
  const subColor = isHigh ? "rgba(127,29,29,0.70)" : "rgba(27,43,56,0.65)";
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.riskRow,
        { backgroundColor: bg, borderColor: border },
      ]}
      testID="risk-row"
    >
      <View style={[styles.riskDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={[styles.riskTitle, { color: titleColor }]} numberOfLines={2}>{r.title}</Text>
          <View style={styles.rowLiveBadge}>
            <Text style={styles.rowLiveBadgeText}>LIVE</Text>
          </View>
        </View>
        <Text style={[styles.riskSub, { color: subColor }]} numberOfLines={2}>{r.sub}</Text>
      </View>
      <View
        style={[
          styles.riskChip,
          { backgroundColor: `${dotColor}1F`, borderColor: `${dotColor}66` },
        ]}
      >
        <Text style={[styles.riskChipText, { color: chipFg }]}>{chipLabel}</Text>
      </View>
      <Feather name="chevron-right" size={14} color="rgba(27,43,56,0.45)" />
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 22 },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  scroll: { paddingHorizontal: 16, paddingTop: 12 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  filterChipCount: { fontFamily: "Inter_700Bold", fontSize: 10 },

  empty: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyText: {
    color: "rgba(27,43,56,0.65)",
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
  },

  riskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  riskTitle: { color: Colors.darkDeep, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  riskSub: { color: "rgba(27,43,56,0.65)", fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
  riskChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  riskChipText: { fontFamily: "Inter_800ExtraBold", fontSize: 9, letterSpacing: 0.6 },

  liveBadgeOn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: GREEN,
  },
  liveBadgeOnText: {
    color: "#FFFFFF",
    fontFamily: "Inter_800ExtraBold",
    fontSize: 9,
    letterSpacing: 0.6,
  },
  liveBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  liveBadgeNeutral: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  liveBadgeNeutralText: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.6,
  },
  liveBadgeSample: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(232,119,34,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,148,37,0.33)",
  },
  liveBadgeSampleText: {
    color: ORANGE,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 9,
    letterSpacing: 0.6,
  },
  rowSampleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: "rgba(232,119,34,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,148,37,0.33)",
  },
  rowSampleBadgeText: {
    color: ORANGE,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 8,
    letterSpacing: 0.5,
  },
  rowLiveBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: GREEN,
  },
  rowLiveBadgeText: {
    color: "#FFFFFF",
    fontFamily: "Inter_800ExtraBold",
    fontSize: 8,
    letterSpacing: 0.5,
  },
}));
