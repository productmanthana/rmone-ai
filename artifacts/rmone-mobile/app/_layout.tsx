import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Feather, Ionicons, MaterialCommunityIcons } from "@/lib/icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/lib/auth";
import { InAppAlertProvider } from "@/lib/inAppAlert";
import { ThemeProvider } from "@/lib/theme";
import { Colors } from "@/constants/colors";
import { BRIEFING_STORAGE_KEY, todayKey } from "./daily-briefing";
import { resetStageRulesCache } from "@/lib/stageRules";
import { auditView } from "@/lib/api";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Module-scope tracker so a theme-driven remount of `RootLayoutNav` never
// re-runs the initial redirect (which would bounce the user away from a deep
// route like /project/123 on every dark/light toggle). We re-route only when
// auth state actually transitions (login / logout), not on pure remounts.
let _lastRoutedAuthKey: string | null = null;

/**
 * Keep analytics to route templates only. In particular, a project URL may
 * contain an ID, which must never be sent as interaction telemetry.
 */
function auditScreenForPath(pathname: string): import("../lib/api").AuditScreen | null {
  if (pathname === "/project/create") return "project-create";
  if (pathname.startsWith("/project/")) return "project-detail";

  const staticScreens: Record<string, import("../lib/api").AuditScreen> = {
    "/": "home",
    "/alerts": "alerts",
    "/chat": "chat",
    "/daily-briefing": "daily-briefing",
    "/forecast": "forecast",
    "/login": "login",
    "/profile": "profile",
    "/projects": "projects",
    "/rate-card": "rate-card",
    "/resources": "resources",
    "/rfp": "rfp",
    "/screenshot": "screenshot",
    "/superadmin": "superadmin",
  };
  return staticScreens[pathname] ?? null;
}

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    const screen = auditScreenForPath(pathname);
    if (screen) auditView(screen);
  }, [pathname]);

  useEffect(() => {
    if (isLoading) return;
    const authKey = user ? `in:${user.username}` : "out";
    if (authKey === _lastRoutedAuthKey) return;

    const isScreenshot =
      typeof window !== "undefined" &&
      window.location.pathname.includes("screenshot");

    if (isScreenshot) { _lastRoutedAuthKey = authKey; return; }

    _lastRoutedAuthKey = authKey;

    // Clear the stage-rules singleton on every auth transition so the new
    // tenant's tips are always fetched fresh (tenant-isolation rule: no
    // cross-tenant data may survive in in-memory caches).
    resetStageRulesCache();

    if (user) {
      AsyncStorage.getItem(BRIEFING_STORAGE_KEY)
        .then((seen) => {
          if (seen === todayKey()) {
            router.replace("/(tabs)");
          } else {
            router.replace("/daily-briefing");
          }
        })
        .catch(() => {
          router.replace("/daily-briefing");
        });
    } else {
      router.replace("/login");
    }
  }, [user, isLoading]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark },
        animation: "fade",
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="daily-briefing" options={{ headerShown: false, animation: "fade", gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="project/[id]" options={{ headerShown: false, animation: "slide_from_right" }} />
      <Stack.Screen name="project/create" options={{ headerShown: false, animation: "slide_from_bottom" }} />
      <Stack.Screen name="screenshot" options={{ headerShown: false }} />
      <Stack.Screen name="rate-card" options={{ headerShown: false, animation: "slide_from_right" }} />
      <Stack.Screen name="superadmin" options={{ headerShown: false, animation: "slide_from_right" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Icon fonts must be loaded explicitly — on Android the @expo/vector-icons
    // glyphs render as tofu boxes (▯) until their font is registered.
    ...Feather.font,
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
              <ThemeProvider>
                <InAppAlertProvider>
                  <RootLayoutNav />
                </InAppAlertProvider>
              </ThemeProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
