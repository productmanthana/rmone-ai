import { Ionicons } from "@/lib/icons";
import { Tabs } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, Text, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed, getColorMode } from "@/constants/colors";
import { startInboxPolling, stopInboxPolling, loadPersistedReadIds, setInboxUser, requestNotificationPermission, registerPushToken, setPendingInboxOpen, getUnreadCount, subscribeInbox } from "@/lib/inboxStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";

type IoName = React.ComponentProps<typeof Ionicons>["name"];

interface TabDef {
  filled: IoName;
  outline: IoName;
}

// Task #11 + Task #9: primary nav exposes the core workflow tabs in the
// bottom bar. Profile and RFP keep their routes alive (deep links, in-app
// navigation) but are not visible in the bottom bar — they're reachable
// via the avatar / "More" disclosure in the home header.
const TAB_ICONS: Record<string, TabDef> = {
  index:     { filled: "home",          outline: "home-outline" },
  chat:      { filled: "chatbubble-ellipses", outline: "chatbubble-ellipses-outline" },
  projects:  { filled: "albums",        outline: "albums-outline" },
  resources: { filled: "people",        outline: "people-outline" },
  forecast:  { filled: "stats-chart",   outline: "stats-chart-outline" },
  alerts:    { filled: "notifications", outline: "notifications-outline" },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const def = TAB_ICONS[name] ?? TAB_ICONS.index;
  const scale = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const [unread, setUnread] = React.useState(getUnreadCount());

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0,
      damping: 15,
      stiffness: 140,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [focused]);

  // The Alerts tab badge mirrors the inbox unread count for now (the
  // Operational Risk Feed currently sources from the same inbox stream).
  // Once live alerts land in a follow-up task, swap this for an alerts
  // store subscriber.
  useEffect(() => {
    if (name !== "alerts") return;
    return subscribeInbox(() => setUnread(getUnreadCount()));
  }, [name]);

  const pillOpacity = scale.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const pillScaleX = scale.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const iconScale = scale.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const iconTranslateY = scale.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });

  return (
    <View style={styles.iconContainer}>
      <Animated.View
        style={[
          styles.pill,
          // In light mode, give the active-tab pill a stronger green border so
          // the highlighted icon reads as a clear "selected" affordance.
          getColorMode() === "light" && {
            borderWidth: 2,
            borderColor: Colors.green,
            backgroundColor: Colors.green + "26",
          },
          { opacity: pillOpacity, transform: [{ scaleX: pillScaleX }] },
        ]}
      />
      <Animated.View style={{ transform: [{ scale: iconScale }, { translateY: iconTranslateY }] }}>
        <Ionicons
          name={focused ? def.filled : def.outline}
          size={21}
          color={focused ? Colors.green : Colors.textMuted}
        />
        {name === "alerts" && unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? "9+" : String(unread)}</Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem("rmone_username"),
      AsyncStorage.getItem("rmone_userRoles"),
    ]).then(([u, roles]) => {
      if (u) setInboxUser(u, roles ?? undefined);
    });
    requestNotificationPermission();
    registerPushToken();
    loadPersistedReadIds().then(() => {
      setTimeout(() => startInboxPolling(30000), 3000);
    });

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.type === "inbox" || data?.type === "test") {
        setPendingInboxOpen();
        router.navigate("/(tabs)/" as never);
      }
    });

    return () => { stopInboxPolling(); sub.remove(); };
  }, []);

  return (
    <Tabs
      screenOptions={{
        lazy: true,
        tabBarActiveTintColor: Colors.green,
        tabBarInactiveTintColor: Colors.textMuted,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
          height: 62 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarBackground: () => {
          // Light mode renders on a near-white surface where a 1px translucent
          // hairline practically disappears — bump to a solid 2px so the bar
          // visually separates from the page above it.
          const isLight = getColorMode() === "light";
          return (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: Colors.darkDeep,
                  borderTopWidth: isLight ? 2 : 1,
                  borderTopColor: isLight ? Colors.borderStrong : Colors.border,
                },
              ]}
            />
          );
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_700Bold",
          fontSize: 12,
          letterSpacing: 0.3,
          marginTop: 0,
        },
        tabBarIconStyle: { marginTop: 6 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ focused }) => <TabIcon name="projects" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="resources"
        options={{
          title: "People",
          tabBarIcon: ({ focused }) => <TabIcon name="resources" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="forecast"
        options={{
          title: "Forecast",
          tabBarIcon: ({ focused }) => <TabIcon name="forecast" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "AI",
          tabBarIcon: ({ focused }) => <TabIcon name="chat" focused={focused} />,
        }}
      />
      {/* Off-bar routes — kept addressable for deep links and in-app
          navigation (e.g. "View all" link from the Home risk feed,
          avatar/"More" disclosure in the home header). Alerts is no
          longer a primary tab — its content is surfaced inline on Home
          (Operational Risk Feed) with a deep link to the full screen. */}
      <Tabs.Screen name="alerts" options={{ href: null }} />
      <Tabs.Screen name="rfp" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

const styles = themed(() => StyleSheet.create({
  iconContainer: {
    width: 52,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    position: "absolute",
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.green + "1A",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 7,
    backgroundColor: "#E03C3C",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 8 },
}));
