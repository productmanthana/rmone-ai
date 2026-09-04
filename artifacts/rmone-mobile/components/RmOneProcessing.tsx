import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";

// React Native port of the web <RmOneProcessing /> popup
// (artifacts/rmone-web/src/components/CommandCentreLoader.tsx). Shows a
// compact, branded "processing" card over a dimmed backdrop while the
// project detail page loads — a pulsing RM core, a stage checklist that
// advances on its own so it feels like real work is happening, and a
// sweeping progress bar. Replaces the plain skeleton squares so the mobile
// loading state matches the web app's polished experience.

const C = {
  green: "#6BA539",
  greenLight: "#A9C23F",
  white: "#FFFFFF",
  panel: "#1B2B38",
  border: "rgba(255,255,255,0.10)",
  textMuted: "rgba(255,255,255,0.55)",
  textFaint: "rgba(255,255,255,0.30)",
};

const DEFAULT_PROJECT_STAGES = [
  "Fetching project record",
  "Loading team allocations",
  "Pulling pricing & financials",
  "Calculating health gauge",
  "Rendering dashboard",
];

function PulseRing({ delay }: { delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1800,
        delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: C.green,
        opacity: v.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.6, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.55] }) }],
      }}
    />
  );
}

function StageRow({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1.18, duration: 600, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [active]);
  const dotColor = done ? C.green : active ? C.greenLight : C.textFaint;
  return (
    <View style={styles.stageRow}>
      <Animated.View
        style={[
          styles.stageDot,
          {
            backgroundColor: done ? C.green : "transparent",
            borderWidth: done ? 0 : 1.5,
            borderColor: dotColor,
            transform: active ? [{ scale: breath }] : undefined,
          },
        ]}
      >
        {done ? <Text style={styles.stageCheck}>✓</Text> : null}
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[
          styles.stageLabel,
          {
            color: done ? C.textMuted : active ? C.white : C.textFaint,
            fontWeight: active ? "600" : "500",
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function RmOneProcessing({
  label = "Loading…",
  sublabel = "FETCHING REAL-TIME DATA",
  stages = DEFAULT_PROJECT_STAGES,
  stageIntervalMs = 750,
}: {
  label?: string;
  sublabel?: string;
  stages?: string[];
  stageIntervalMs?: number;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (stages.length <= 1) return;
    const id = setInterval(() => {
      setActiveIdx((i) => (i < stages.length - 1 ? i + 1 : i));
    }, stageIntervalMs);
    return () => clearInterval(id);
  }, [stages.length, stageIntervalMs]);

  // Breathing RM core.
  const coreBreath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(coreBreath, { toValue: 1.06, duration: 900, useNativeDriver: true }),
        Animated.timing(coreBreath, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Sweeping progress bar.
  const sweep = useRef(new Animated.Value(0)).current;
  const [barW, setBarW] = useState(0);
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        {/* Compact pulse + RM core */}
        <View style={styles.coreWrap}>
          <PulseRing delay={0} />
          <PulseRing delay={700} />
          <Animated.View style={[styles.core, { transform: [{ scale: coreBreath }] }]}>
            <Text style={styles.coreText}>RM</Text>
          </Animated.View>
        </View>

        {/* Header + stage list + sweep bar */}
        <View style={styles.body}>
          <Text numberOfLines={1} style={styles.label}>
            {label}
          </Text>

          <View style={styles.stages}>
            {stages.map((s, i) => (
              <StageRow key={i} label={s} done={i < activeIdx} active={i === activeIdx} />
            ))}
          </View>

          <View
            style={styles.barTrack}
            onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
          >
            <Animated.View
              style={[
                styles.barFill,
                {
                  transform: [
                    {
                      translateX: sweep.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-barW * 0.45, barW],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>

          {sublabel ? (
            <Text numberOfLines={1} style={styles.sublabel}>
              {sublabel}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9000,
    backgroundColor: "rgba(8, 14, 20, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    minWidth: 280,
    maxWidth: 360,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 14,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: "rgba(107,165,57,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  coreWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  core: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: C.greenLight,
  },
  coreText: { color: C.white, fontWeight: "800", fontSize: 11, letterSpacing: 0.4 },
  body: { flex: 1, minWidth: 0 },
  label: { color: C.white, fontWeight: "700", fontSize: 13, marginBottom: 10 },
  stages: { marginBottom: 10, gap: 4 },
  stageRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stageDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  stageCheck: { color: C.white, fontSize: 8, fontWeight: "800", lineHeight: 10 },
  stageLabel: { flex: 1, fontSize: 11.5 },
  barTrack: {
    width: "100%",
    height: 2,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    width: "45%",
    borderRadius: 2,
    backgroundColor: C.greenLight,
  },
  sublabel: {
    marginTop: 8,
    fontSize: 9,
    letterSpacing: 1.6,
    color: C.textFaint,
    fontFamily: "Inter_400Regular",
  },
});
