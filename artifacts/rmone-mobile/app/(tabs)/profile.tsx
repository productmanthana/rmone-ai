import { Ionicons } from "@/lib/icons";
import { Feather } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { getUserProfile } from "@/lib/api";
import { useScreenBeacon } from "@/lib/usageBeacon";
import {
  ROLE_PERSONAS,
  loadRoleOverride,
  resolveActiveRole,
  resolveRoleFromString,
  rolePersonaShort,
  setRoleOverride,
  subscribeRoleOverride,
  type RolePersona,
} from "@/lib/roleResolver";

export const unstable_settings = { href: null };

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  useScreenBeacon("Profile");
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<RolePersona>(() =>
    resolveActiveRole(user?.userRoles, user?.username),
  );
  const [hasOverride, setHasOverride] = useState(false);

  useEffect(() => {
    if (!user) return;
    getUserProfile(user.username)
      .then((p) => setProfile(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    loadRoleOverride(user?.username).then((override) => {
      setHasOverride(!!override);
      setActiveRole(resolveActiveRole(user?.userRoles, user?.username));
    });
    const unsub = subscribeRoleOverride(() => {
      // Re-derive both pieces from the source of truth on every update.
      const next = resolveActiveRole(user?.userRoles, user?.username);
      setActiveRole(next);
      setHasOverride(next !== resolveRoleFromString(user?.userRoles));
    });
    return unsub;
  }, [user?.username, user?.userRoles]);

  const handlePickRole = (r: RolePersona | null) => {
    Haptics.selectionAsync();
    setRoleOverride(user?.username, r);
  };

  const displayName =
    profile?.DisplayName ||
    profile?.FullName ||
    [profile?.FirstName, profile?.LastName].filter(Boolean).join(" ") ||
    user?.username ||
    "";
  const initials = displayName.slice(0, 2).toUpperCase();
  const email = profile?.Email || profile?.EmailAddress || "";
  const phone = profile?.Phone || profile?.PhoneNumber || "";
  const department = profile?.Department || profile?.DepartmentName || "";
  const title = profile?.Title || profile?.JobTitle || "";
  const company = profile?.Company || profile?.CompanyName || user?.tenant || "";

  const infoRows = [
    { icon: "briefcase-outline" as const, label: "Title", value: title },
    { icon: "business-outline" as const, label: "Department", value: department },
    { icon: "home-outline" as const, label: "Company", value: company },
    { icon: "mail-outline" as const, label: "Email", value: email },
    { icon: "call-outline" as const, label: "Phone", value: phone },
  ].filter((r) => r.value);

  return (
    <View style={[styles.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.green} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.avatarSection}>
            <View style={styles.avatarLg}>
              <Text style={styles.avatarLgText}>{initials}</Text>
            </View>
            <Text style={styles.name}>{displayName}</Text>
            {title ? <Text style={styles.subtitle}>{title}</Text> : null}
          </View>

          <View style={styles.card}>
            {infoRows.map((row, i) => (
              <React.Fragment key={row.label}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.infoRow}>
                  <View style={styles.infoIconWrap}>
                    <Ionicons name={row.icon} size={18} color={Colors.green} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>{row.label}</Text>
                    <Text style={styles.infoValue}>{row.value}</Text>
                  </View>
                </View>
              </React.Fragment>
            ))}
            {infoRows.length === 0 && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>No profile details available</Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.infoRow}>
              <View style={styles.infoIconWrap}>
                <Ionicons name="server-outline" size={18} color={Colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Tenant</Text>
                <Text style={styles.infoValue}>{user?.tenant ?? "—"}</Text>
              </View>
            </View>
          </View>

          {/* View-as-role switcher. Persists per user in AsyncStorage so the
              demoer can preview any of the five home variants. "Use my
              role" clears the override and falls back to the resolved
              persona from userRoles. */}
          <View style={styles.roleSection}>
            <Text style={styles.roleSectionLabel}>VIEW AS ROLE</Text>
            <View style={styles.roleChips}>
              <Pressable
                onPress={() => handlePickRole(null)}
                style={[
                  styles.roleChip,
                  {
                    backgroundColor: !hasOverride ? Colors.green : "transparent",
                    borderColor: !hasOverride ? Colors.green : Colors.border,
                  },
                ]}
                testID="role-clear"
              >
                <Text
                  style={[
                    styles.roleChipText,
                    { color: !hasOverride ? "#FFFFFF" : "rgba(255,255,255,0.85)" },
                  ]}
                >
                  Use my role
                </Text>
              </Pressable>
              {ROLE_PERSONAS.map((r) => {
                const active = hasOverride && activeRole === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => handlePickRole(r)}
                    style={[
                      styles.roleChip,
                      {
                        backgroundColor: active ? Colors.green : "transparent",
                        borderColor: active ? Colors.green : Colors.border,
                      },
                    ]}
                    testID={`role-option-${r}`}
                  >
                    <Text
                      style={[
                        styles.roleChipText,
                        { color: active ? "#FFFFFF" : "rgba(255,255,255,0.85)" },
                      ]}
                    >
                      {rolePersonaShort(r)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.roleHint}>
              Currently rendering: {rolePersonaShort(activeRole)}
              {hasOverride ? " (override)" : " (from your role)"}
            </Text>
          </View>

          {/* Rate Card hidden until RM ONE exposes a GET endpoint to read
              saved EmpCostRate values per Department × JobTitle. Route still
              exists at /rate-card but is unlinked from the UI. */}

          <Pressable
            style={styles.logoutBtn}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              signOut();
            }}
          >
            <Ionicons name="log-out-outline" size={20} color="#fff" />
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.darkCard,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    color: Colors.textPrimary,
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 24, gap: 16 },
  avatarSection: { alignItems: "center", marginBottom: 8 },
  avatarLg: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.green,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  avatarLgText: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: Colors.cardText,
  },
  name: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  card: {
    backgroundColor: Colors.darkCard,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.cardBorderStrong,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 52 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.dark,
    alignItems: "center",
    justifyContent: "center",
  },
  infoLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.textPrimary,
    marginTop: 1,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#C0392B",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 8,
  },
  logoutText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#fff",
  },
  roleSection: {
    backgroundColor: Colors.darkCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  roleSectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  roleChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  roleChipText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  roleHint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
}));
