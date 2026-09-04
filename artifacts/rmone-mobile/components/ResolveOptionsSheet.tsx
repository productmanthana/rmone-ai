import React from "react";
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
import type { ResolveOption } from "@/lib/resolveOptions";

const DARK_BG = Colors.darkDeep;
const CARD_BG = Colors.darkCard;
const BORDER = "rgba(255,255,255,0.08)";
const TEXT_PRIMARY = "#FFFFFF";
const TEXT_SECONDARY = "rgba(255,255,255,0.55)";
const BRAND_GREEN = Colors.green;
const RED = "#E5484D";
const ORANGE = Colors.orange;

/**
 * Bottom sheet listing concrete ways to resolve a briefing risk. Each
 * option deep-links to the screen where the problem can actually be
 * fixed; the AI-chat hand-off renders last with a dashed border so it
 * reads as the fallback, not the default.
 */
export function ResolveOptionsSheet({
  open,
  title,
  subtitle,
  severity,
  options,
  onClose,
  onSelect,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  severity: string;
  options: ResolveOption[];
  onClose: () => void;
  onSelect: (opt: ResolveOption) => void;
}) {
  if (!open) return null;

  const sevColor = severity === "critical" ? RED : ORANGE;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
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
              <View style={[styles.sevPill, { borderColor: `${sevColor}66`, backgroundColor: `${sevColor}1F` }]}>
                <Text style={[styles.sevPillText, { color: sevColor }]}>
                  {severity.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.title} numberOfLines={3}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={3}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={16} color={TEXT_SECONDARY} />
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>How do you want to resolve this?</Text>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 6, gap: 10 }}
            showsVerticalScrollIndicator={false}
          >
            {options.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={() => onSelect(opt)}
                style={({ pressed }) => [
                  styles.optionCard,
                  opt.ai && styles.optionCardAi,
                  pressed && { opacity: 0.85 },
                ]}
                testID={`resolve-option-${opt.id}`}
              >
                <View style={[styles.optionIconWrap, opt.ai && styles.optionIconWrapAi]}>
                  <Feather
                    name={opt.icon as never}
                    size={16}
                    color={opt.ai ? BRAND_GREEN : TEXT_PRIMARY}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{opt.title}</Text>
                  <Text style={styles.optionSub}>{opt.sub}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={TEXT_SECONDARY} />
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onClose} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
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
    maxHeight: "88%",
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
    paddingBottom: 12,
  },
  sevPill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  sevPillText: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 9.5,
    letterSpacing: 1.2,
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
  sectionLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    color: TEXT_SECONDARY,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 3,
    borderLeftColor: BRAND_GREEN,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionCardAi: {
    borderStyle: "dashed",
    borderLeftWidth: 1,
    borderColor: "rgba(107,165,57,0.45)",
    backgroundColor: "rgba(107,165,57,0.06)",
  },
  optionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  optionIconWrapAi: {
    backgroundColor: "rgba(107,165,57,0.14)",
  },
  optionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 13.5,
    color: TEXT_PRIMARY,
    lineHeight: 18,
  },
  optionSub: {
    fontFamily: "Inter_500Medium",
    fontSize: 11.5,
    color: TEXT_SECONDARY,
    lineHeight: 15.5,
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: DARK_BG,
    alignItems: "flex-end",
    ...Platform.select({
      ios: { paddingBottom: 26 },
      default: { paddingBottom: 14 },
    }),
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
}));
