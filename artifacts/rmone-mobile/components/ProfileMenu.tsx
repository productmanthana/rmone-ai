import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Animated,
  Platform,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { getUserProfile } from "@/lib/api";
import { Colors, themed } from "@/constants/colors";
import { useTheme } from "@/lib/theme";

export default function ProfileMenu({ topOffset }: { topOffset: number }) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(user?.username ?? "");
  const [roleName, setRoleName] = useState("");
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.username);
    getUserProfile(user.username)
      .then((p: any) => {
        const name =
          p?.DisplayName ||
          p?.FullName ||
          p?.Name ||
          (p?.FirstName && p?.LastName ? `${p.FirstName} ${p.LastName}` : null) ||
          p?.FirstName ||
          p?.UserName ||
          user.username;
        if (name) setDisplayName(name);
        setRoleName(
          p?.RoleName || p?.Role || p?.JobTitle || p?.Title || p?.Designation || ""
        );
      })
      .catch(() => {});
  }, [user]);

  const initials = displayName.slice(0, 2).toUpperCase();

  const open = () => {
    setVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== "web" }),
      Animated.spring(scale, { toValue: 1, damping: 18, stiffness: 200, useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  };

  const close = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(scale, { toValue: 0.9, duration: 120, useNativeDriver: Platform.OS !== "web" }),
    ]).start(() => {
      setVisible(false);
      cb?.();
    });
  };

  return (
    <>
      <Pressable style={s.avatarBtn} onPress={open}>
        <Text style={s.avatarText}>{initials}</Text>
      </Pressable>

      {visible && (
        <Modal transparent visible animationType="none" onRequestClose={() => close()}>
          <Pressable style={s.overlay} onPress={() => close()}>
            <Animated.View
              style={[
                s.menu,
                { top: topOffset + 52, right: 16, opacity, transform: [{ scale }] },
              ]}
            >
              <View style={s.header}>
                <View style={s.avatarLg}>
                  <Text style={s.avatarLgText}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{displayName}</Text>
                  {roleName ? <Text style={s.role}>{roleName}</Text> : null}
                </View>
              </View>
              <View style={s.divider} />
              <Pressable
                style={s.item}
                onPress={() => close(() => router.push("/(tabs)/profile"))}
              >
                <Ionicons name="person-outline" size={18} color={Colors.textPrimary} />
                <Text style={s.itemText}>Profile</Text>
              </Pressable>
              {/* Re-open the morning briefing on demand. The once-per-day
                  auto-launch logic is keyed on AsyncStorage and is left
                  untouched here — we only navigate. */}
              <Pressable
                style={s.item}
                onPress={() => close(() => router.push("/daily-briefing"))}
                testID="menu-daily-briefing"
              >
                <Ionicons name="sunny-outline" size={18} color={Colors.textPrimary} />
                <Text style={s.itemText}>Daily Briefing</Text>
              </Pressable>
              {/* Alerts is no longer a primary tab — surface it from the
                  profile menu so it's reachable from any screen. The Home
                  Operational Risk Feed has a "View all" link to the same
                  destination. */}
              <Pressable
                style={s.item}
                onPress={() => close(() => router.push("/(tabs)/alerts"))}
                testID="menu-alerts"
              >
                <Ionicons name="notifications-outline" size={18} color={Colors.textPrimary} />
                <Text style={s.itemText}>Alerts</Text>
              </Pressable>
              <View style={s.divider} />
              <ThemeToggleItem onAfter={() => close()} />
              <View style={s.divider} />
              <Pressable
                style={s.item}
                onPress={() => {
                  close(() => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    signOut();
                  });
                }}
              >
                <Ionicons name="log-out-outline" size={18} color="#E05252" />
                <Text style={[s.itemText, { color: "#E05252" }]}>Log Out</Text>
              </Pressable>
            </Animated.View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

function ThemeToggleItem({ onAfter }: { onAfter?: () => void }) {
  const { mode, toggle } = useTheme();
  const isDark = mode === "dark";
  return (
    <Pressable
      style={s.item}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        toggle();
        onAfter?.();
      }}
      testID="menu-theme-toggle"
    >
      <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={18} color={Colors.textPrimary} />
      <Text style={s.itemText}>{isDark ? "Light Mode" : "Dark Mode"}</Text>
    </Pressable>
  );
}

const s = themed(() => StyleSheet.create({
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.white },
  overlay: { flex: 1 },
  menu: {
    position: "absolute",
    width: 220,
    backgroundColor: Colors.darkCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16 },
      android: { elevation: 12 },
      web: { boxShadow: "0 8px 32px rgba(0,0,0,0.45)" } as any,
    }),
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  avatarLg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.green,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  avatarLgText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.white },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary },
  role: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: Colors.border },
  item: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  itemText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.textPrimary },
}));
