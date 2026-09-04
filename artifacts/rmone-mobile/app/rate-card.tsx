import { AppTextInput } from "@/components/AppTextInput";
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, FlatList, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@/lib/icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, themed } from "@/constants/colors";
import { getDepartments, getJobTitles, saveJobTitleCostRate, type JobTitleRow } from "@/lib/api";
import { globalAlert } from "@/lib/inAppAlert";
import { useScreenBeacon } from "@/lib/usageBeacon";

type DeptRow = Record<string, unknown>;
const pickId = (d: DeptRow) => Number(d.Id ?? d.ID ?? d.DepartmentId ?? d.DepartmentID ?? 0);
const pickName = (d: DeptRow) => String(d.Name ?? d.DepartmentName ?? d.Title ?? d.ShortName ?? "—");

export default function RateCardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useScreenBeacon("BillingRates");
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [titles, setTitles] = useState<JobTitleRow[]>([]);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getDepartments().catch(() => []), getJobTitles().catch(() => [])])
      .then(([d, t]) => {
        if (!alive) return;
        const drows = (d as DeptRow[]).filter(r => pickId(r) > 0);
        setDepts(drows);
        setTitles(t as JobTitleRow[]);
        setDeptId(drows[0] ? pickId(drows[0]) : null);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => { setDraft({}); }, [deptId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return titles
      .filter(t => !q || (t.JobTitleName ?? t.Title ?? "").toLowerCase().includes(q))
      .sort((a, b) => (a.JobTitleName ?? a.Title).localeCompare(b.JobTitleName ?? b.Title));
  }, [titles, filter]);

  const deptLabel = useMemo(() => {
    const d = depts.find(x => pickId(x) === deptId);
    return d ? pickName(d) : "Select department";
  }, [depts, deptId]);

  async function save(t: JobTitleRow) {
    if (!deptId) return;
    const raw = draft[t.ID] ?? "";
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value < 0) {
      globalAlert("Invalid rate", "Enter a non-negative number.");
      return;
    }
    setSavingId(t.ID);
    try {
      await saveJobTitleCostRate({ JobTitleId: t.ID, DepartmentId: deptId, EmpCostRate: value });
      globalAlert("Saved", `${t.JobTitleName ?? t.Title} → $${value.toFixed(2)}/hr`);
    } catch (e) {
      globalAlert("Save failed", String(e));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <View style={[s.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />
      <View style={s.header}>
        <Pressable style={s.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>Rate Card</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator size="large" color={Colors.green} /></View>
      ) : (
        <>
          <View style={s.toolbar}>
            <Pressable style={s.deptBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.deptLabel}>DEPARTMENT</Text>
              <View style={s.deptValueRow}>
                <Text style={s.deptValue} numberOfLines={1}>{deptLabel}</Text>
                <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
              </View>
            </Pressable>
            <AppTextInput
              style={s.search}
              placeholder="Filter job titles…"
              placeholderTextColor={Colors.textSecondary}
              value={filter}
              onChangeText={setFilter}
            />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
            <View style={s.card}>
              {filtered.length === 0 && (
                <Text style={s.empty}>No job titles match.</Text>
              )}
              {filtered.map((t, i) => {
                const v = draft[t.ID] ?? "";
                const busy = savingId === t.ID;
                return (
                  <View key={t.ID} style={[s.row, i > 0 && s.rowDivider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.titleText}>{t.JobTitleName ?? t.Title}</Text>
                      <Text style={s.metaText}>
                        {(t.RoleName ?? "—")}
                        {t.JobType ? ` · ${t.JobType}` : ""}
                      </Text>
                    </View>
                    <View style={s.inputWrap}>
                      <Text style={s.dollar}>$</Text>
                      <AppTextInput
                        style={s.rateInput}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={Colors.textSecondary}
                        value={v}
                        onChangeText={(text) => setDraft(prev => ({ ...prev, [t.ID]: text }))}
                        editable={!busy && !!deptId}
                      />
                      <Pressable
                        style={[s.saveBtn, (!v || busy) && { opacity: 0.4 }]}
                        disabled={!v || busy}
                        onPress={() => save(t)}
                      >
                        <Text style={s.saveBtnText}>{busy ? "…" : "Save"}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.modalScrim} onPress={() => setPickerOpen(false)}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Select department</Text>
            <FlatList
              data={depts}
              keyExtractor={(d) => String(pickId(d))}
              renderItem={({ item }) => {
                const id = pickId(item);
                const active = id === deptId;
                return (
                  <Pressable
                    style={[s.modalRow, active && { backgroundColor: "rgba(107,165,57,0.15)" }]}
                    onPress={() => { setDeptId(id); setPickerOpen(false); }}
                  >
                    <Text style={[s.modalRowText, active && { color: Colors.green }]}>{pickName(item)}</Text>
                    {active && <Ionicons name="checkmark" size={18} color={Colors.green} />}
                  </Pressable>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  root: { flex: 1 },
  header: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, backgroundColor: Colors.darkDeep },
  back: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: "600" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  toolbar: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  deptBtn: { backgroundColor: Colors.darkDeep, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.border },
  deptLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, marginBottom: 4 },
  deptValueRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  deptValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: "500", flex: 1, marginRight: 8 },
  search: { backgroundColor: Colors.darkDeep, color: Colors.textPrimary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: Colors.border },
  card: { marginHorizontal: 16, backgroundColor: Colors.darkDeep, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  empty: { color: Colors.textSecondary, padding: 20, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  titleText: { color: Colors.textPrimary, fontSize: 14, fontWeight: "500" },
  metaText: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  dollar: { color: Colors.textSecondary, fontSize: 13 },
  rateInput: { backgroundColor: Colors.dark, color: Colors.textPrimary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, width: 88, textAlign: "right", borderWidth: 1, borderColor: Colors.border },
  saveBtn: { backgroundColor: Colors.green, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  saveBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, maxHeight: "80%", backgroundColor: Colors.darkDeep, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border },
  modalTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: "700", padding: 8 },
  modalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 8 },
  modalRowText: { color: Colors.textPrimary, fontSize: 14 },
}));
