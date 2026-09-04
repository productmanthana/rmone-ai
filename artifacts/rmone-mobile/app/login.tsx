import { AppTextInput } from "@/components/AppTextInput";
import { AppIcon } from "@/components/AppIcon";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
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

import { BRIEFING_STORAGE_KEY, todayKey } from "./daily-briefing";

const noOutline = Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {};

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [tenant, setTenant] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!tenant.trim() || !username.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await signIn(tenant.trim(), username.trim(), password);
    } catch (e) {
      // Only sign-in errors land here. Post-success side-effects (haptics,
      // AsyncStorage, navigation) are handled below in their own guards so a
      // platform quirk like web-unsupported expo-haptics can't masquerade as
      // a connectivity failure.
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch { /* haptics unsupported on web */ }
      const msg = String(e);
      if (msg.includes("401") || msg.includes("400")) {
        setError("Invalid credentials. Check your tenant, username, and password.");
      } else {
        setError("Could not connect to RM ONE server. Please check your network.");
      }
      setLoading(false);
      return;
    }

    // Sign-in succeeded — every step from here is best-effort and must not
    // surface as a sign-in failure.
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { /* haptics unsupported on web */ }
    let seen: string | null = null;
    try {
      seen = await AsyncStorage.getItem(BRIEFING_STORAGE_KEY);
    } catch {
      /* best effort */
    }
    try {
      if (seen === todayKey()) {
        router.replace("/(tabs)");
      } else {
        router.replace("/daily-briefing");
      }
    } catch (navErr) {
      console.warn("[login] post-signin navigation failed:", String(navErr));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* Decorative glow top-right */}
      <View style={styles.glowTopRight} pointerEvents="none" />
      <View style={styles.glowBottomLeft} pointerEvents="none" />

      {/* Decorative grid lines */}
      <View style={styles.gridOverlay} pointerEvents="none">
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.gridLine, { top: `${20 + i * 20}%` as any }]} />
        ))}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 36 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* RM ONE wordmark */}
        <View style={styles.logoBlock}>
          <Image
            source={require("../assets/images/rmone-logo.png")}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel="RM ONE"
          />
          <Text style={styles.logoTagline}>OPERATIONAL INTELLIGENCE</Text>
        </View>

        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.subheading}>Sign in to your resource{"\n"}management dashboard</Text>

        <View style={styles.form}>
          {/* Tenant */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>TENANT / ORGANIZATION</Text>
            <View style={styles.inputRow}>
              <AppIcon name="home" size={15} color={Colors.green} style={styles.inputIcon} />
              <AppTextInput
                style={[styles.input, noOutline]}
                value={tenant}
                onChangeText={setTenant}
                placeholder="your-tenant"
                placeholderTextColor={Colors.cardMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                spellCheck={false}
              />
            </View>
          </View>

          {/* Username */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>USERNAME</Text>
            <View style={styles.inputRow}>
              <AppIcon name="user" size={15} color={Colors.green} style={styles.inputIcon} />
              <AppTextInput
                style={[styles.input, noOutline]}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter your username"
                placeholderTextColor={Colors.cardMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                spellCheck={false}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <View style={styles.inputRow}>
              <AppIcon name="lock" size={15} color={Colors.green} style={styles.inputIcon} />
              <AppTextInput
                style={[styles.input, { flex: 1 }, noOutline]}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.cardMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                spellCheck={false}
                keyboardType="default"
                onSubmitEditing={handleLogin}
                returnKeyType="go"
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <AppIcon name={showPassword ? "eye-off" : "eye"} size={14} color={Colors.cardMuted} />
              </Pressable>
            </View>
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <AppIcon name="alert-circle" size={14} color={Colors.orange} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.loginBtn, { opacity: pressed || loading ? 0.85 : 1 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.loginBtnText}>
                  Sign In to <Text style={{ color: "#FFFFFF" }}>RM </Text><Text style={{ color: "#1B2B38" }}>ONE</Text>
                </Text>
                <View style={styles.loginArrowBubble}>
                  <AppIcon name="arrow-right" size={14} color="#FFFFFF" />
                </View>
              </>
            )}
          </Pressable>
        </View>

        {/* Security badge */}
        <View style={styles.securityBadge}>
          <View style={styles.securityDot} />
          <Text style={styles.securityText}>JWT Secured · TLS 1.3 · End-to-End Encrypted</Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },

  glowTopRight: {
    position: "absolute",
    top: -120,
    right: -120,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: Colors.green,
    opacity: 0.18,
  },
  glowBottomLeft: {
    position: "absolute",
    bottom: -100,
    left: -100,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: Colors.green,
    opacity: 0.12,
  },
  gridOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.border,
    opacity: 0.5,
  },

  scrollContent: {
    paddingHorizontal: 24,
    flexGrow: 1,
  },

  logoBlock: {
    alignItems: "flex-start",
    marginBottom: 36,
  },
  logoImage: {
    width: 270,
    height: 59,
  },
  logoTagline: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    color: Colors.cardMuted,
    marginTop: 10,
    letterSpacing: 2.4,
  },

  heading: {
    fontFamily: "Inter_900Black" as any,
    fontSize: 34,
    color: Colors.textPrimary,
    marginBottom: 8,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  subheading: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.cardMuted,
    marginBottom: 28,
    lineHeight: 21,
  },

  formCard: {
    backgroundColor: Colors.cardBg,
    borderWidth: 2,
    borderColor: Colors.cardBorderStrong,
    borderRadius: 20,
    padding: 20,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  form: { gap: 16 },
  fieldGroup: {},
  fieldLabel: {
    // Login renders on a fixed dark brand background, so the label needs a
    // light color regardless of theme. `cardText` is dark slate and was
    // unreadable here.
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    color: "rgba(255,255,255,0.85)",
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 2,
    borderColor: Colors.cardBorderStrong,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  inputIcon: { marginRight: 12 },
  input: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.cardText,
    height: 52,
  },
  eyeBtn: { padding: 6 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.orange + "18",
    borderWidth: 1,
    borderColor: Colors.orange + "40",
    borderRadius: 14,
    padding: 12,
  },
  errorText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.orange,
    flex: 1,
  },
  loginBtn: {
    backgroundColor: Colors.green,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    shadowColor: Colors.green,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
    marginTop: 6,
  },
  loginBtnText: {
    fontFamily: "Inter_900Black" as any,
    fontSize: 15,
    color: "#FFFFFF",
    letterSpacing: 0.6,
  },
  loginArrowBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  securityBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 8,
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  securityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.green,
  },
  securityText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    color: Colors.cardText,
    letterSpacing: 0.3,
  },
}));
