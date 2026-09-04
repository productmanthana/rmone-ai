import React, { useCallback, useState } from "react";
import { Platform, Pressable, View, Text, Modal } from "react-native";
import { Feather } from "@/lib/icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import CalendarPopup from "./CalendarPopup";

interface DateInputProps {
  value: string;
  onChange: (val: string) => void;
  label?: string;
  placeholder?: string;
  error?: boolean;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDisplay(isoValue: string): string {
  if (!isoValue) return "";
  const parts = isoValue.split("-");
  if (parts.length !== 3) return isoValue;
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const y = parts[0];
  if (isNaN(m) || isNaN(d)) return isoValue;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export default function DateInput({ value, onChange, label, error }: DateInputProps) {
  const [showNativePicker, setShowNativePicker] = useState(false);
  const [showWebPopup, setShowWebPopup] = useState(false);

  const openPicker = useCallback(() => {
    if (Platform.OS === "web") setShowWebPopup(true);
    else setShowNativePicker(true);
  }, []);

  const parseInitialDate = (): Date => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(n => parseInt(n, 10));
      return new Date(y, m - 1, d);
    }
    return new Date();
  };

  const handleNativeChange = (event: any, selected?: Date) => {
    if (Platform.OS === "android") setShowNativePicker(false);
    if (event?.type === "dismissed") { setShowNativePicker(false); return; }
    if (selected) {
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, "0");
      const d = String(selected.getDate()).padStart(2, "0");
      onChange(`${y}-${m}-${d}`);
    }
  };

  const display = value ? formatDisplay(value) : "Select date";
  const hasValue = !!value;

  return (
    <View style={{ flex: 1 }}>
      {label ? (
        <Text style={{
          fontFamily: "Inter_600SemiBold",
          color: "rgba(255,255,255,0.5)",
          fontSize: 10,
          marginBottom: 5,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}>{label}</Text>
      ) : null}
      <Pressable
        onPress={openPicker}
        style={({ pressed }: any) => ({
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: pressed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
          borderRadius: 10,
          borderWidth: 1,
          borderColor: error ? "#E03C3C" : "rgba(255,255,255,0.15)",
          paddingHorizontal: 12,
          paddingVertical: 11,
          gap: 8,
          ...(Platform.OS === "web" ? { cursor: "pointer" as any } : {}),
        })}
      >
        <Feather name="calendar" size={14} color={hasValue ? "#6BA539" : "rgba(255,255,255,0.3)"} />
        <Text style={{
          fontFamily: hasValue ? "Inter_600SemiBold" : "Inter_400Regular",
          color: hasValue ? "#fff" : "rgba(255,255,255,0.35)",
          fontSize: 13,
          flex: 1,
        }}>
          {display}
        </Text>
        <Feather name="chevron-down" size={12} color="rgba(255,255,255,0.3)" />
      </Pressable>

      {Platform.OS === "web" && showWebPopup && (
        <CalendarPopup
          initialValue={value}
          onPick={(iso) => { onChange(iso); setShowWebPopup(false); }}
          onClose={() => setShowWebPopup(false)}
        />
      )}

      {Platform.OS === "android" && showNativePicker && (
        <DateTimePicker value={parseInitialDate()} mode="date" display="default" onChange={handleNativeChange} />
      )}

      {Platform.OS === "ios" && (
        <Modal transparent animationType="fade" visible={showNativePicker} onRequestClose={() => setShowNativePicker(false)}>
          <Pressable onPress={() => setShowNativePicker(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
            <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: "#1a2332", paddingBottom: 30, paddingTop: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingBottom: 4 }}>
                <Pressable onPress={() => setShowNativePicker(false)}>
                  <Text style={{ color: "#6BA539", fontFamily: "Inter_700Bold", fontSize: 15 }}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker value={parseInitialDate()} mode="date" display="spinner" themeVariant="dark" onChange={handleNativeChange} />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
