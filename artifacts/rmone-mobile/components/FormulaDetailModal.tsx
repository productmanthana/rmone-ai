import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { Feather } from "@/lib/icons";
import { Colors } from "@/constants/colors";
import { useTheme } from "@/lib/theme";
import type { ActionDetail, FormulaDetail } from "@/lib/homeIntelligence";

const ORANGE = Colors.orange;
const ORANGE_BG = "rgba(232,119,34,0.12)";
const ORANGE_BORDER = "rgba(232,119,34,0.35)";

export function FormulaDetailModal({
  open,
  onClose,
  title,
  valuePct,
  eyebrow,
  formula,
  detail,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  valuePct: number;
  eyebrow: string;
  formula: FormulaDetail;
  detail: ActionDetail | null;
}) {
  const { mode } = useTheme();
  const isLight = mode === "light";

  const BG        = isLight ? "#F0F4F8" : "#0F1A24";
  const CARD      = isLight ? "#FFFFFF" : "#1B2B38";
  const BORDER    = isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.08)";
  const TEXT      = isLight ? "#1A2A36" : "#FFFFFF";
  const MUTED     = isLight ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.42)";

  const barPct = Math.min(100, Math.max(0, valuePct));

  const rows    = detail?.rows    ?? [];
  const columns = detail?.columns ?? [];

  const [selRow, setSelRow] = useState<number | null>(null);

  if (!open) return null;

  const formulaParts = formula.formula.split("=");

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: BG }]}>
        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: BORDER }]}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={[styles.eyebrow, { color: MUTED }]}>{eyebrow}</Text>
            <View style={styles.titleRow}>
              <Text style={[styles.titleText, { color: TEXT }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[styles.titlePct, { color: ORANGE }]}>{valuePct}%</Text>
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Feather name="x" size={20} color={MUTED} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.body, { paddingBottom: Platform.OS === "ios" ? 40 : 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Progress bar */}
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${barPct}%` as any, backgroundColor: ORANGE }]} />
          </View>
          <View style={styles.barLabels}>
            <Text style={[styles.barLabel, { color: MUTED }]}>0%</Text>
            <Text style={[styles.barLabel, { color: MUTED }]}>100%</Text>
          </View>

          {/* Current Reading */}
          <View style={[styles.card, { backgroundColor: CARD, borderColor: BORDER }]}>
            <View style={styles.cardInner}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardLabel, { color: MUTED }]}>Current reading</Text>
                <Text style={[styles.cardBody, { color: TEXT }]}>{formula.currentReading}</Text>
              </View>
              <View style={[styles.valueBadge, { backgroundColor: ORANGE_BG, borderColor: ORANGE_BORDER }]}>
                <Text style={[styles.valueBadgePct, { color: ORANGE }]}>{valuePct}%</Text>
                <Text style={[styles.valueBadgeLabel, { color: ORANGE }]}>coverage</Text>
              </View>
            </View>
          </View>

          {/* How it's calculated */}
          <View style={[styles.card, { backgroundColor: CARD, borderColor: BORDER }]}>
            <Text style={[styles.cardLabel, { color: MUTED }]}>How it's calculated</Text>
            <Text style={[styles.cardBody, { color: TEXT }]}>{formula.howCalculated}</Text>
          </View>

          {/* Formula */}
          <View style={[styles.card, { backgroundColor: CARD, borderColor: BORDER }]}>
            <Text style={[styles.cardLabel, { color: MUTED }]}>Formula</Text>
            <Text style={[styles.formulaText, { color: TEXT }]}>
              {formulaParts.map((part, i) =>
                i === formulaParts.length - 1 ? (
                  <Text key={i} style={{ color: ORANGE, fontWeight: "700" }}>{part}</Text>
                ) : (
                  <Text key={i}>{part}=</Text>
                )
              )}
            </Text>
          </View>

          {/* DATA SOURCE pills */}
          {formula.dataSource && (
            <View style={styles.dsRow}>
              <Text style={[styles.dsLabel, { color: MUTED }]}>Data Source</Text>
              <View style={[styles.dsPill, { backgroundColor: CARD, borderColor: BORDER }]}>
                <Text style={[styles.dsPillText, { color: TEXT }]}>{formula.dataSource}</Text>
              </View>
              <View style={[styles.dsPill, { backgroundColor: ORANGE_BG, borderColor: ORANGE_BORDER }]}>
                <Text style={[styles.dsPillText, { color: ORANGE }]}>RM ONE · LIVE</Text>
              </View>
            </View>
          )}

          {/* Impact on RM ONE */}
          <View style={[styles.impactCard, { backgroundColor: "rgba(232,119,34,0.06)", borderColor: ORANGE_BORDER }]}>
            <Text style={[styles.impactLabel, { color: ORANGE }]}>Impact on RM ONE</Text>
            {formula.impact.split("\n").map((line, i) => {
              if (!line.trim()) return <View key={i} style={{ height: 6 }} />;
              const hm = line.match(/^(.+?)\s*—\s*(\d+%)$/);
              if (hm) {
                return (
                  <View key={i} style={styles.impactHeaderRow}>
                    <Text style={[styles.impactHeaderText, { color: TEXT }]}>{hm[1]}</Text>
                    <Text style={[styles.impactHeaderPct, { color: ORANGE }]}>{hm[2]}</Text>
                  </View>
                );
              }
              const isFormula = line.startsWith("100");
              return (
                <Text
                  key={i}
                  style={[
                    isFormula ? styles.impactFormulaLine : styles.impactBody,
                    { color: isFormula ? MUTED : TEXT },
                  ]}
                >
                  {line}
                </Text>
              );
            })}
          </View>

          {/* Primary table */}
          <Text style={[styles.tableTitle, { color: MUTED }]}>{formula.tableTitle}</Text>
          {rows.length === 0 ? (
            <View style={[styles.emptyBox, { backgroundColor: CARD, borderColor: BORDER }]}>
              <Text style={[styles.emptyText, { color: MUTED }]}>
                {detail?.emptyText ?? "No records to display."}
              </Text>
            </View>
          ) : (
            <View style={[styles.tableBox, { backgroundColor: CARD, borderColor: BORDER }]}>
              {/* Header row */}
              <View style={[styles.tableHead, { borderBottomColor: BORDER, backgroundColor: isLight ? "#F8FAFC" : "#243747" }]}>
                {columns.map((c) => (
                  <Text
                    key={c.key}
                    style={[
                      styles.tableHeadCell,
                      { color: MUTED, textAlign: c.align ?? "left", flex: c.align === "right" ? 0 : 1, minWidth: c.align === "right" ? 60 : undefined },
                    ]}
                    numberOfLines={1}
                  >
                    {c.label}
                  </Text>
                ))}
              </View>
              {rows.map((r, i) => (
                <Pressable
                  key={i}
                  onPress={() => setSelRow(selRow === i ? null : i)}
                  style={[
                    styles.tableRow,
                    { borderBottomColor: BORDER, backgroundColor: selRow === i ? ORANGE_BG : "transparent" },
                  ]}
                >
                  {columns.map((c) => (
                    <Text
                      key={c.key}
                      style={[
                        styles.tableCell,
                        { color: TEXT, textAlign: c.align ?? "left", flex: c.align === "right" ? 0 : 1, minWidth: c.align === "right" ? 60 : undefined },
                      ]}
                      numberOfLines={1}
                    >
                      {String(r[c.key] ?? "—")}
                    </Text>
                  ))}
                </Pressable>
              ))}
            </View>
          )}

          {/* Secondary table */}
          {formula.secondaryTable && formula.secondaryTable.rows.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={[styles.tableTitle, { color: MUTED }]}>{formula.secondaryTable.title}</Text>
              <View style={[styles.tableBox, { backgroundColor: CARD, borderColor: BORDER }]}>
                <View style={[styles.tableHead, { borderBottomColor: BORDER, backgroundColor: isLight ? "#F8FAFC" : "#243747" }]}>
                  {formula.secondaryTable.columns.map((c) => (
                    <Text
                      key={c.key}
                      style={[
                        styles.tableHeadCell,
                        { color: MUTED, textAlign: c.align ?? "left", flex: c.align === "right" ? 0 : 1, minWidth: c.align === "right" ? 60 : undefined },
                      ]}
                      numberOfLines={1}
                    >
                      {c.label}
                    </Text>
                  ))}
                </View>
                {formula.secondaryTable.rows.map((r, i) => (
                  <View
                    key={i}
                    style={[styles.tableRow, { borderBottomColor: BORDER }]}
                  >
                    {formula.secondaryTable!.columns.map((c) => (
                      <Text
                        key={c.key}
                        style={[
                          styles.tableCell,
                          { color: TEXT, textAlign: c.align ?? "left", flex: c.align === "right" ? 0 : 1, minWidth: c.align === "right" ? 60 : undefined },
                        ]}
                        numberOfLines={1}
                      >
                        {String(r[c.key] ?? "—")}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: BORDER, backgroundColor: isLight ? "#E8EEF4" : "#162230" }]}>
          <Text style={[styles.footerText, { color: MUTED }]}>
            Select rows above to ask AI about specific items
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 20 : 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  eyebrow: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  },
  titleText: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 20,
    lineHeight: 26,
  },
  titlePct: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 22,
    lineHeight: 26,
  },
  closeBtn: {
    padding: 4,
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  barTrack: {
    height: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    marginBottom: 4,
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  barLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10.5,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  cardInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  cardBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
  },
  valueBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    minWidth: 56,
  },
  valueBadgePct: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 18,
    lineHeight: 22,
  },
  valueBadgeLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 8.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 1,
  },
  formulaText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  dsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  dsLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dsPill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  dsPillText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  impactCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  impactLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  impactHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
    marginTop: 4,
  },
  impactHeaderText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12.5,
  },
  impactHeaderPct: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    marginLeft: 8,
  },
  impactBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 12.5,
    lineHeight: 19,
    marginBottom: 2,
  },
  impactFormulaLine: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    marginBottom: 2,
  },
  tableTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  tableBox: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  tableHead: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  tableHeadCell: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  tableCell: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  emptyBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    textAlign: "center",
  },
  footer: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    alignItems: "center",
  },
  footerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11.5,
  },
});
