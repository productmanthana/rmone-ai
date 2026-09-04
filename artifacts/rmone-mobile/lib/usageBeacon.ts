/**
 * Mobile module-visit beacon (task #487). Mirrors web usageBeacon.ts —
 * maps screen names to the same canonical module names and posts to the
 * shared usage telemetry endpoint. Fire-and-forget; deduplicated per
 * module per 30 s per session (in-memory, resets on app restart).
 *
 * Screen → module name mapping must stay in lockstep with:
 *   artifacts/rmone-web/src/lib/usageBeacon.ts  (RULES array)
 *   artifacts/rmone-web/src/lib/analyticsUsage.ts (KNOWN_MODULES)
 */
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBase } from "./api";

const DEDUPE_MS = 30_000; // one beacon per module per 30 s — matches web

// In-memory dedupe table: module name → last sent timestamp.
// Resets when the JS runtime restarts (app kill/restart), which is correct —
// a fresh launch is a new session.
const _lastSent = new Map<string, number>();

/**
 * Fire-and-forget POST to /api/rmone/usage-beacon.
 * - Skips if the same module+context was beaconed within the last 30 s.
 * - Silently drops the request if there is no auth token (not logged in).
 * - Never throws; never blocks the caller.
 *
 * @param feature  Canonical module name (e.g. "ProjectDetail").
 * @param context  Optional record / page identifier (e.g. "PMM-001"). Mirrors
 *                 the web beacon's contextForPath() output. Pass "" or omit
 *                 when no specific record context is available (list pages etc).
 */
export function sendMobileBeacon(feature: string, context = ""): void {
  const now = Date.now();
  const dedupeKey = context ? `${feature}|${context}` : feature;
  const last = _lastSent.get(dedupeKey) ?? 0;
  if (now - last < DEDUPE_MS) return;
  _lastSent.set(dedupeKey, now);

  void (async () => {
    try {
      const token = await AsyncStorage.getItem("rmone_token");
      if (!token) return; // not logged in — drop silently
      const body: { feature: string; context?: string } = { feature };
      if (context) body.context = context;
      await fetch(`${getApiBase()}/api/rmone/usage-beacon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // intentional no-op — beacons must never surface errors to the user
    }
  })();
}

/**
 * Hook: sends a beacon when the screen gains focus (initial mount and each
 * time the user navigates back to it). The 30 s dedupe window prevents
 * flooding from rapid tab switches.
 *
 * Drop this at the top of any screen component:
 *   useScreenBeacon("Projects");
 *
 * For record-detail screens, pass the record/ticket ID as context so the
 * Usage Analytics drill shows which record was visited:
 *   useScreenBeacon("ProjectDetail", id);
 */
export function useScreenBeacon(moduleName: string, context = ""): void {
  useFocusEffect(
    useCallback(() => {
      sendMobileBeacon(moduleName, context);
    }, [moduleName, context]),
  );
}
