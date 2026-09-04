import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { bustCache, bustCacheByPrefix, setOnboardingMemberActive } from "@/lib/api";
import { globalAlert } from "@/lib/inAppAlert";
import { Feather } from "@/lib/icons";
import { canReactivateDisabledStaff } from "@/lib/disabledStaff";

/** A compact, identity-safe disabled indicator with the staff-admin recovery action. */
export function DisabledStaffControl({
  enabled,
  userGuid,
  tenantId,
  onReactivated,
}: {
  enabled?: boolean;
  userGuid?: string;
  tenantId?: string;
  onReactivated?: (userGuid: string) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  if (enabled !== false) return null;

  // Never fall back to user.tenant: in a cross-tenant superadmin view that
  // would reactivate the same GUID in the wrong company.
  const canReactivate = canReactivateDisabledStaff(enabled, userGuid, tenantId, user?.capabilities.manageStaff === true);
  const reactivate = async () => {
    if (!canReactivate || saving || !userGuid) return;
    setSaving(true);
    try {
      await setOnboardingMemberActive(tenantId!, userGuid, true);
      // Resource, project-team, allocation, and utilization cache entries can
      // all carry this person's enabled state. Clear before callers refetch.
      bustCacheByPrefix("resource-allocations:");
      bustCacheByPrefix("project-team:");
      bustCacheByPrefix("project-alloc:");
      bustCacheByPrefix("util:");
      bustCache();
      await onReactivated?.(userGuid);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      globalAlert("Could not reactivate", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.badge} testID="disabled-staff-badge">
        <Feather name="slash" size={10} color={Colors.red} />
        <Text style={styles.badgeText}>Disabled</Text>
      </View>
      {canReactivate ? (
        <Pressable
          testID={`reactivate-staff-${userGuid}`}
          accessibilityRole="button"
          accessibilityLabel="Reactivate staff member"
          disabled={saving}
          onPress={reactivate}
          style={({ pressed }) => [styles.action, (pressed || saving) && styles.actionPressed]}
        >
          {saving ? <ActivityIndicator size="small" color={Colors.green} /> : <Feather name="rotate-ccw" size={11} color={Colors.green} />}
          <Text style={styles.actionText}>{saving ? "Reactivating…" : "Reactivate"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: Colors.red + "18", borderWidth: 1, borderColor: Colors.red + "45" },
  badgeText: { color: Colors.red, fontFamily: "Inter_700Bold", fontSize: 10 },
  action: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4, paddingVertical: 4 },
  actionPressed: { opacity: 0.6 },
  actionText: { color: Colors.green, fontFamily: "Inter_700Bold", fontSize: 11 },
});