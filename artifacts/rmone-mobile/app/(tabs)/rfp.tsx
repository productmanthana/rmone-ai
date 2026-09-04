import { AppTextInput } from "@/components/AppTextInput";
import { Feather } from "@/lib/icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { getProjectList } from "@/lib/api";

type Stage = "All" | "RFP Response" | "Qualification" | "Discovery";

interface Opp {
  id: string;
  name: string;
  value: string;
  stage: Stage;
  daysLeft: number;
  probability: number;
  type: string;
  resources: number;
}

function daysColor(d: number) {
  if (d <= 5) return { text: Colors.orange, bg: Colors.orange + "1A" };
  if (d <= 10) return { text: "#CA8A04", bg: "#FEF3C7" };
  return { text: Colors.green, bg: Colors.green + "1A" };
}

function probColor(p: number) {
  if (p >= 70) return Colors.green;
  if (p >= 50) return Colors.orange;
  return "#B0C4B0";
}

const AVATAR_COLORS = [Colors.green, Colors.orange, "#4A9A9F"];

export default function RFPScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [opps, setOpps] = useState<Opp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Stage>("All");
  const [search, setSearch] = useState("");
  const [selectedRFP, setSelectedRFP] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getProjectList(user.username)
      .then((ids: string[]) => {
        const parsed: Opp[] = ids
          .filter(id => id.toUpperCase().includes("OPP") || id.toUpperCase().includes("RFP"))
          .map(id => ({
            id,
            name: id,
            value: "—",
            stage: "RFP Response" as Stage,
            daysLeft: 0,
            probability: 0,
            type: "—",
            resources: 0,
          }));
        setOpps(parsed);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const filtered = opps.filter(o =>
    (filter === "All" || o.stage === filter) &&
    (o.name.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase()))
  );

  if (selectedRFP) {
    const opp = opps.find(o => o.id === selectedRFP);
    return <RFPDetailScreen id={selectedRFP} name={opp?.name ?? ""} onBack={() => setSelectedRFP(null)} insets={insets} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: Colors.surface }]}>
      <View style={[styles.topBar, { height: insets.top > 0 ? insets.top : 4 }]} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.headerTitle}>Opportunities</Text>
          <Text style={styles.headerSub}>
            {loading ? "Loading…" : `${opps.length} active`}
          </Text>
        </View>
        <Pressable style={styles.newBtn}>
          <Feather name="plus" size={14} color={Colors.white} />
          <Text style={styles.newBtnText}>New RFP</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchRow}>
          <Feather name="search" size={14} color="#B0C4B0" style={{ marginRight: 8 }} />
          <AppTextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search opportunities..."
            placeholderTextColor="#B0C4B0"
          />
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(["All", "RFP Response", "Qualification", "Discovery"] as Stage[]).map(f => (
            <Pressable key={f} style={[styles.filterPill, f === filter && styles.filterPillActive]} onPress={() => setFilter(f)}>
              <Text style={[styles.filterText, f === filter && styles.filterTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={{ paddingTop: 60, alignItems: "center" }}>
            <ActivityIndicator color={Colors.green} />
          </View>
        )}
        {!loading && filtered.length === 0 && (
          <View style={{ paddingTop: 60, alignItems: "center", paddingHorizontal: 32 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Feather name="file-text" size={24} color="#B0C4B0" />
            </View>
            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textPrimary, marginBottom: 6 }}>No opportunities</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textMuted, textAlign: "center" }}>Opportunities will appear here once connected to your RM ONE account.</Text>
          </View>
        )}
        {filtered.map(opp => {
          const dc = daysColor(opp.daysLeft);
          const pc = probColor(opp.probability);
          const emoji = opp.daysLeft <= 5 ? "🔴" : opp.daysLeft <= 10 ? "🟡" : "🟢";
          return (
            <View key={opp.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardLeft}>
                  <View style={styles.cardBadges}>
                    <View style={[styles.daysBadge, { backgroundColor: dc.bg }]}>
                      <Text style={[styles.daysText, { color: dc.text }]}>{emoji} {opp.daysLeft}d left</Text>
                    </View>
                    <Text style={styles.typeText}>{opp.type}</Text>
                  </View>
                  <Text style={styles.oppName}>{opp.name}</Text>
                  <Text style={styles.oppId}>{opp.id}</Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.oppValue}>{opp.value}</Text>
                  <Text style={styles.estLabel}>Est. Value</Text>
                </View>
              </View>

              <View style={styles.probRow}>
                <Text style={styles.probLabel}>Win Probability</Text>
                <Text style={[styles.probValue, { color: pc }]}>{opp.probability}%</Text>
              </View>
              <View style={styles.probBarBg}>
                <View style={[styles.probBarFill, { width: `${opp.probability}%` as any, backgroundColor: pc }]} />
              </View>

              <View style={styles.cardBottom}>
                <View style={styles.stagePill}>
                  <Text style={styles.stagePillText}>{opp.stage}</Text>
                </View>
                <View style={styles.avatarCluster}>
                  {Array.from({ length: Math.min(3, opp.resources) }).map((_, i) => (
                    <View key={i} style={[styles.clusterAvatar, { backgroundColor: AVATAR_COLORS[i], marginLeft: i > 0 ? -6 : 0 }]} />
                  ))}
                  <Text style={styles.resourceCount}>+{opp.resources}</Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <Pressable style={styles.viewBtn} onPress={() => setSelectedRFP(opp.id)}>
                  <Text style={styles.viewBtnText}>View RFP</Text>
                </Pressable>
                <Pressable style={styles.addResBtn}>
                  <Text style={styles.addResBtnText}>Add Resources</Text>
                </Pressable>
                <Pressable style={styles.notifyBtn}>
                  <Text style={styles.notifyBtnText}>Notify</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const STEPS = ["Create", "Estimate", "Resources", "Submit"];

function RFPDetailScreen({ id, name, onBack, insets }: { id: string; name: string; onBack: () => void; insets: any }) {
  const [step, setStep] = useState(2);
  const [laborCost, setLaborCost] = useState(2450000);
  const [notified, setNotified] = useState(false);

  const directLabor = Math.round((laborCost * 0.65) / 1000);
  const subcontractor = Math.round((laborCost * 0.25) / 1000);
  const overhead = Math.round((laborCost * 0.07) / 1000);
  const contingency = Math.round((laborCost * 0.03) / 1000);

  return (
    <View style={[styles.root, { backgroundColor: Colors.surface }]}>
      <View style={[styles.topBar, { height: insets.top > 0 ? insets.top : 4 }]} />

      <View style={[styles.detailHeader, { paddingTop: insets.top + 12 }]}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Feather name="chevron-left" size={16} color={Colors.textMuted} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailTitle}>{name}</Text>
          <Text style={styles.detailSub}>{id} · RFP Response</Text>
        </View>
        <View style={styles.daysLeftBadge}>
          <Text style={styles.daysLeftText}>5 days left</Text>
        </View>
      </View>

      {/* Steps */}
      <View style={styles.stepsRow}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.stepItem}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable onPress={() => setStep(i)} style={[styles.stepCircle, i <= step ? styles.stepCircleActive : styles.stepCircleInactive, i === step && styles.stepCircleCurrent]}>
                <Text style={[styles.stepNum, i <= step ? styles.stepNumActive : styles.stepNumInactive]}>
                  {i < step ? "✓" : i + 1}
                </Text>
              </Pressable>
              {i < STEPS.length - 1 && <View style={[styles.stepLine, i < step ? styles.stepLineActive : styles.stepLineInactive]} />}
            </View>
            <Text style={[styles.stepLabel, i === step ? styles.stepLabelActive : styles.stepLabelInactive]}>{s}</Text>
          </View>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>
        {/* General Conditions */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>General Conditions</Text>
          {[
            { label: "Contract Type", value: "GMP - Guaranteed Max Price" },
            { label: "Project Duration", value: "18 months" },
            { label: "Location", value: "Riverside, CA" },
            { label: "Scope", value: "Medical facility, 120,000 sq ft" },
          ].map(f => (
            <View key={f.label} style={styles.condRow}>
              <Text style={styles.condLabel}>{f.label}</Text>
              <Text style={styles.condValue}>{f.value}</Text>
            </View>
          ))}
        </View>

        {/* Labor Cost */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Labor Cost Estimate</Text>
            <Text style={styles.editableLabel}>Editable</Text>
          </View>
          <View style={styles.totalCostBox}>
            <Text style={styles.totalCostLabel}>Total Labor Cost</Text>
            <Text style={styles.totalCostValue}>${(laborCost / 1000000).toFixed(2)}M</Text>
          </View>
          <View style={styles.sliderWrapper}>
            <View style={styles.sliderBg2}>
              <View style={[styles.sliderFill2, { width: `${((laborCost - 1000000) / 4000000) * 100}%` as any }]} />
            </View>
          </View>
          <View style={styles.costGrid}>
            {[
              { label: "Direct Labor", value: `$${directLabor}K`, color: Colors.green },
              { label: "Subcontractor", value: `$${subcontractor}K`, color: "#4A9A9F" },
              { label: "Overhead", value: `$${overhead}K`, color: Colors.orange },
              { label: "Contingency", value: `$${contingency}K`, color: Colors.textMuted },
            ].map(c => (
              <View key={c.label} style={styles.costCell}>
                <Text style={[styles.costCellValue, { color: c.color }]}>{c.value}</Text>
                <Text style={styles.costCellLabel}>{c.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Resource Assignment */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Resource Assignment</Text>
            <Pressable style={styles.addSmallBtn}>
              <Feather name="plus" size={10} color={Colors.green} />
              <Text style={styles.addSmallText}>Add</Text>
            </Pressable>
          </View>
          <View style={{ paddingVertical: 16, alignItems: "center" }}>
            <Text style={{ fontSize: 12, color: Colors.textMuted, fontFamily: "Inter_400Regular" }}>No resources assigned</Text>
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Team Notifications</Text>
          <View style={styles.notifRow}>
            <View style={styles.notifIcon}>
              <Feather name="bell" size={14} color={Colors.orange} />
            </View>
            <Text style={styles.notifText}>
              {notified ? "✅ Marketing team and 4 estimators notified." : "Notify Marketing, Estimators, and PMs to collaborate on this RFP."}
            </Text>
          </View>
          <Pressable style={[styles.notifBtn, notified && styles.notifBtnSent]} onPress={() => setNotified(!notified)}>
            <Text style={[styles.notifBtnText, notified && styles.notifBtnTextSent]}>
              {notified ? "✓ Notifications Sent" : "Send Team Notifications"}
            </Text>
          </Pressable>
          <Pressable style={styles.submitBtn}>
            <Text style={styles.submitBtnText}>Submit RFP to Client</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },
  topBar: { backgroundColor: Colors.green, minHeight: 4 },
  header: { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.textPrimary },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.green, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  newBtnText: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.textPrimary },
  searchContainer: { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 20, paddingVertical: 10 },
  searchRow: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary },
  filterRow: { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 10 },
  filterScroll: { paddingHorizontal: 20, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterPillActive: { backgroundColor: Colors.green, borderColor: Colors.green },
  filterText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textMuted },
  filterTextActive: { fontFamily: "Inter_700Bold", color: Colors.textPrimary },
  scroll: { padding: 20, gap: 14, paddingBottom: 32 },
  card: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.cardBorderStrong, borderRadius: 20, padding: 16, shadowColor: Colors.dark, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  cardLeft: { flex: 1, paddingRight: 12 },
  cardBadges: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  daysBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  daysText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  typeText: { fontFamily: "Inter_400Regular", fontSize: 10, color: "#B0C4B0" },
  oppName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary, marginBottom: 2 },
  oppId: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },
  cardRight: { alignItems: "flex-end", flexShrink: 0 },
  oppValue: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.green },
  estLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  probRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  probLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },
  probValue: { fontFamily: "Inter_700Bold", fontSize: 10 },
  probBarBg: { height: 6, backgroundColor: Colors.surface, borderRadius: 3, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", marginBottom: 12 },
  probBarFill: { height: 6, borderRadius: 3 },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  stagePill: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  stagePillText: { fontFamily: "Inter_500Medium", fontSize: 11, color: "#4A6A50" },
  avatarCluster: { flexDirection: "row", alignItems: "center", gap: 4 },
  clusterAvatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.white },
  resourceCount: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },
  cardActions: { flexDirection: "row", gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  viewBtn: { flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: Colors.green + "1A", borderWidth: 1, borderColor: Colors.green + "4D", borderRadius: 12 },
  viewBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.green },
  addResBtn: { flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: Colors.orange + "1A", borderWidth: 1, borderColor: Colors.orange + "4D", borderRadius: 12 },
  addResBtnText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.orange },
  notifyBtn: { flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12 },
  notifyBtnText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textMuted },
  detailHeader: { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  backBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  detailTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.textPrimary },
  detailSub: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  daysLeftBadge: { backgroundColor: Colors.orange + "1A", borderWidth: 1, borderColor: Colors.orange + "4D", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  daysLeftText: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.orange },
  stepsRow: { flexDirection: "row", alignItems: "flex-start", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingHorizontal: 16, paddingVertical: 14 },
  stepItem: { flex: 1, alignItems: "center" },
  stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepCircleActive: { backgroundColor: Colors.green },
  stepCircleInactive: { backgroundColor: Colors.border },
  stepCircleCurrent: { borderWidth: 2, borderColor: Colors.green, shadowColor: Colors.green, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 2 },
  stepNum: { fontFamily: "Inter_700Bold", fontSize: 11 },
  stepNumActive: { color: Colors.textPrimary },
  stepNumInactive: { color: "#B0C4B0" },
  stepLine: { flex: 1, height: 2, marginHorizontal: 2, marginBottom: 14 },
  stepLineActive: { backgroundColor: Colors.green },
  stepLineInactive: { backgroundColor: Colors.border },
  stepLabel: { fontFamily: "Inter_500Medium", fontSize: 9, marginTop: 4 },
  stepLabelActive: { color: Colors.green },
  stepLabelInactive: { color: "#B0C4B0" },
  detailScroll: { padding: 16, gap: 14, paddingBottom: 32 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary, marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  editableLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.green },
  condRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border + "80" },
  condLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  condValue: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textPrimary },
  totalCostBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 14, marginBottom: 12 },
  totalCostLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  totalCostValue: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.green },
  sliderWrapper: { marginBottom: 12 },
  sliderBg2: { height: 6, backgroundColor: Colors.surface, borderRadius: 3, overflow: "hidden" },
  sliderFill2: { height: 6, backgroundColor: Colors.green, borderRadius: 3 },
  costGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  costCell: { flex: 1, minWidth: "44%", backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 10, alignItems: "center" },
  costCellValue: { fontFamily: "Inter_700Bold", fontSize: 14 },
  costCellLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  addSmallBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.green + "1A", borderWidth: 1, borderColor: Colors.green + "33", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  addSmallText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.green },
  resourceRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 6 },
  resourceRowAdded: { borderColor: Colors.green + "4D", backgroundColor: Colors.green + "08" },
  resourceRowDefault: { borderColor: Colors.border, backgroundColor: Colors.surface },
  resourceAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.green, alignItems: "center", justifyContent: "center" },
  resourceAvatarText: { fontFamily: "Inter_700Bold", fontSize: 10, color: Colors.textPrimary },
  resourceName: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textPrimary },
  resourceRole: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textMuted },
  resourceRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  resourceAlloc: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  resourceCheck: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  resourceCheckAdded: { backgroundColor: Colors.green },
  resourceCheckDefault: { backgroundColor: Colors.border },
  notifRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  notifIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.orange + "1A", borderWidth: 1, borderColor: Colors.orange + "4D", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  notifText: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#4A6A50", flex: 1, lineHeight: 18 },
  notifBtn: { backgroundColor: Colors.green, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 10 },
  notifBtnSent: { backgroundColor: Colors.green + "1A", borderWidth: 2, borderColor: Colors.green },
  notifBtnText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.textPrimary },
  notifBtnTextSent: { color: Colors.green },
  submitBtn: { backgroundColor: Colors.dark, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  submitBtnText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.textPrimary },
}));
