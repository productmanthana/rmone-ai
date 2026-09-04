import React, { useEffect, useState } from "react";
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
import { LinearGradient as LG } from "expo-linear-gradient";
import { Colors, themed } from "@/constants/colors";
import type { ActionDetail } from "@/lib/homeIntelligence";

const MAX_SELECT = 1;

const DARK_BG = Colors.darkDeep;
const CARD_BG = Colors.darkCard;
const BORDER = "rgba(255,255,255,0.08)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_SECONDARY = "rgba(255,255,255,0.55)";
const TEXT_MUTED = "rgba(255,255,255,0.35)";
const BRAND_GREEN = Colors.green;
const BRAND_GREEN_BG = "rgba(107,165,57,0.12)";
const BRAND_ORANGE = Colors.orange;
const BRAND_ORANGE_BG = "rgba(232,119,34,0.12)";

export function ActionModal({
  open,
  onClose,
  detail,
  ctaLabel,
  onConfirm,
  primaryCtaLabel,
  onPrimary,
  primaryBusy,
}: {
  open: boolean;
  onClose: () => void;
  detail: ActionDetail | null;
  ctaLabel?: string;
  onConfirm?: (payload: { selectedIndexes: number[] }) => void;
  primaryCtaLabel?: string;
  onPrimary?: (payload: { selectedIndexes: number[] }) => void;
  primaryBusy?: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [capFlash, setCapFlash] = useState(false);

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open, detail]);

  if (!open || !detail) return null;

  const rows = detail.rows ?? [];
  const cols = detail.columns ?? [];
  const atCap = selected.size >= MAX_SELECT;

  const flashCap = () => {
    setCapFlash(true);
    setTimeout(() => setCapFlash(false), 1200);
  };
  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        if (next.size >= MAX_SELECT) {
          flashCap();
          return prev;
        }
        next.add(i);
      }
      return next;
    });
  };
  const pickIndexes = (): number[] => {
    const base =
      selected.size > 0
        ? Array.from(selected).sort((a, b) => a - b)
        : rows.map((_, i) => i);
    return base.slice(0, MAX_SELECT);
  };
  const sendToAI = () => {
    onConfirm?.({ selectedIndexes: pickIndexes() });
    setSelected(new Set());
  };
  const firePrimary = () => {
    onPrimary?.({ selectedIndexes: pickIndexes() });
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <LG
            colors={["rgba(107,165,57,0.06)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.4 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.title} numberOfLines={2}>
                {detail.title}
              </Text>
              {detail.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={3}>
                  {detail.subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={16} color={TEXT_SECONDARY} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 14, gap: 10 }}
            showsVerticalScrollIndicator
          >
            {rows.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIconWrap}>
                  <Feather name="inbox" size={24} color={TEXT_MUTED} />
                </View>
                <Text style={styles.emptyText}>
                  {detail.emptyText ?? "No records to display."}
                </Text>
              </View>
            ) : (
              rows.map((r, i) => {
                const isSel = selected.has(i);
                const disabled = !isSel && atCap;

                const valueCol = cols.find((c) => c.align === "right") ?? null;
                const restCols = cols.filter((c) => c !== valueCol);
                const headingCol = restCols[0] ?? null;
                const metaCols = restCols.slice(1);

                const fmt = (v: unknown) =>
                  v == null || v === "" ? "—" : String(v);

                return (
                  <Pressable
                    key={i}
                    onPress={() => toggleRow(i)}
                    style={[
                      styles.rowCard,
                      isSel && styles.rowCardSelected,
                      disabled && { opacity: 0.45 },
                    ]}
                  >
                    <View style={styles.rowTopLine}>
                      <View
                        style={[
                          styles.checkbox,
                          isSel && styles.checkboxSelected,
                        ]}
                      >
                        {isSel ? (
                          <Feather name="check" size={11} color="#FFFFFF" />
                        ) : null}
                      </View>
                      <Text style={styles.rowIndex} numberOfLines={1}>
                        {r._id ? String(r._id) : `#${i + 1}`}
                      </Text>
                      {valueCol ? (
                        <View style={styles.valueChip}>
                          <Text style={styles.valueChipLabel}>
                            {valueCol.label}
                          </Text>
                          <Text style={styles.valueChipValue}>
                            {fmt(r[valueCol.key])}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {headingCol ? (
                      <Text style={styles.rowHeading} numberOfLines={2}>
                        {fmt(r[headingCol.key])}
                      </Text>
                    ) : null}

                    {metaCols.length > 0 ? (
                      <View style={styles.metaList}>
                        {metaCols.map((c) => (
                          <View key={c.key} style={styles.metaRow}>
                            <Text style={styles.metaLabel}>{c.label}</Text>
                            <Text style={styles.metaValue} numberOfLines={2}>
                              {fmt(r[c.key])}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text
              style={[
                styles.footerNote,
                capFlash && { color: BRAND_ORANGE, fontFamily: "Inter_700Bold" },
              ]}
            >
              {selected.size > 0
                ? `1 selected${capFlash ? " · only 1 row" : ""}`
                : capFlash
                  ? "Pick 1 row · larger picks confuse the AI"
                  : `${rows.length} record${rows.length === 1 ? "" : "s"} · pick 1 for AI`}
            </Text>
            <View style={styles.footerActions}>
              <Pressable onPress={onClose} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Close</Text>
              </Pressable>
              {primaryCtaLabel && onPrimary ? (
                <Pressable
                  onPress={firePrimary}
                  disabled={!!primaryBusy}
                  style={[
                    styles.btnPrimary,
                    primaryBusy && styles.btnPrimaryDisabled,
                  ]}
                >
                  <Feather name="check" size={12} color="#FFFFFF" />
                  <Text style={styles.btnPrimaryText}>
                    {primaryBusy ? "Saving…" : primaryCtaLabel}
                  </Text>
                </Pressable>
              ) : null}
              {ctaLabel && onConfirm ? (
                <Pressable
                  onPress={sendToAI}
                  disabled={selected.size === 0}
                  style={[
                    styles.btnPrimary,
                    selected.size === 0 && styles.btnPrimaryDisabled,
                  ]}
                >
                  <Feather
                    name="zap"
                    size={12}
                    color={selected.size === 0 ? TEXT_MUTED : "#FFFFFF"}
                  />
                  <Text
                    style={[
                      styles.btnPrimaryText,
                      selected.size === 0 && { color: TEXT_MUTED },
                    ]}
                  >
                    {selected.size > 0 ? (ctaLabel || "Ask AI") : "Select 1"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: DARK_BG,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: "92%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 24,
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  title: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 17,
    color: TEXT_PRIMARY,
    lineHeight: 22,
  },
  subtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12.5,
    color: TEXT_SECONDARY,
    marginTop: 4,
    lineHeight: 17,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  rowCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: BRAND_GREEN,
  },
  rowCardSelected: {
    borderColor: BRAND_GREEN,
    borderWidth: 1.5,
    backgroundColor: BRAND_GREEN_BG,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.20)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  checkboxSelected: {
    backgroundColor: BRAND_GREEN,
    borderColor: BRAND_GREEN,
  },
  rowIndex: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: TEXT_SECONDARY,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
    flex: 1,
  },
  valueChip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: BRAND_ORANGE_BG,
    borderWidth: 1,
    borderColor: "rgba(232,119,34,0.25)",
  },
  valueChipLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 9.5,
    color: BRAND_ORANGE,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  valueChipValue: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 13,
    color: TEXT_PRIMARY,
    fontVariant: ["tabular-nums"],
  },
  rowHeading: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: TEXT_PRIMARY,
    lineHeight: 19,
  },
  metaList: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    gap: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  metaLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 9.5,
    color: TEXT_MUTED,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    width: 64,
    flexShrink: 0,
    paddingTop: 2,
  },
  metaValue: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 12.5,
    color: "rgba(255,255,255,0.80)",
    lineHeight: 17,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: DARK_BG,
    gap: 8,
    ...Platform.select({
      ios: { paddingBottom: 24 },
      default: {},
    }),
  },
  footerNote: {
    fontFamily: "Inter_500Medium",
    fontSize: 11.5,
    color: TEXT_SECONDARY,
    flex: 1,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnGhostText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12.5,
    color: TEXT_PRIMARY,
  },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: BRAND_GREEN,
  },
  btnPrimaryDisabled: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  btnPrimaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12.5,
    color: "#FFFFFF",
  },
}));
