import React, { useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@/lib/icons";
import * as ReactDOM from "react-dom";

const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS = ["S","M","T","W","T","F","S"];

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function toISO(y: number, m: number, d: number): string { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function daysInMonth(y: number, m: number): number { return new Date(y, m + 1, 0).getDate(); }

export default function CalendarPopup({
  initialValue,
  onPick,
  onClose,
}: {
  initialValue: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const initial = useMemo(() => {
    if (initialValue && /^\d{4}-\d{2}-\d{2}$/.test(initialValue)) {
      const [y, m, d] = initialValue.split("-").map(n => parseInt(n, 10));
      return { y, m: m - 1, d };
    }
    return { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  const [viewYear, setViewYear] = useState(initial.y);
  const [viewMonth, setViewMonth] = useState(initial.m);
  const [showYearPicker, setShowYearPicker] = useState(false);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const goPrev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const yearOptions: number[] = [];
  for (let y = today.getFullYear() - 10; y <= today.getFullYear() + 15; y++) yearOptions.push(y);

  const inner = (
    <Pressable
      onPress={onClose}
      style={
        Platform.OS === "web"
          ? ({ position: "fixed" as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 99999 } as any)
          : { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 }
      }
    >
        <Pressable
          onPress={(e: any) => { e?.stopPropagation?.(); e?.preventDefault?.(); }}
          style={{
            width: 320,
            maxWidth: "100%",
            backgroundColor: "#1a2332",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
            padding: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Pressable onPress={goPrev} hitSlop={10} style={{ padding: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" }}>
              <Feather name="chevron-left" size={18} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => setShowYearPicker(v => !v)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)" }}
            >
              <Text style={{ fontFamily: "Inter_700Bold", color: "#fff", fontSize: 15 }}>
                {MONTHS_FULL[viewMonth]} {viewYear}
              </Text>
              <Feather name={showYearPicker ? "chevron-up" : "chevron-down"} size={14} color="rgba(255,255,255,0.5)" />
            </Pressable>
            <Pressable onPress={goNext} hitSlop={10} style={{ padding: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" }}>
              <Feather name="chevron-right" size={18} color="#fff" />
            </Pressable>
          </View>

          {showYearPicker ? (
            <ScrollView style={{ maxHeight: 240 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {yearOptions.map(y => (
                  <Pressable
                    key={y}
                    onPress={() => { setViewYear(y); setShowYearPicker(false); }}
                    style={{
                      width: "23%",
                      paddingVertical: 8,
                      borderRadius: 8,
                      alignItems: "center",
                      backgroundColor: y === viewYear ? "#6BA539" : "rgba(255,255,255,0.05)",
                    }}
                  >
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{y}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : (
            <>
              <View style={{ flexDirection: "row", marginBottom: 6 }}>
                {DAY_LABELS.map((l, i) => (
                  <View key={i} style={{ flex: 1, alignItems: "center" }}>
                    <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "Inter_600SemiBold" }}>{l}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {cells.map((d, i) => {
                  if (d === null) return <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
                  const iso = toISO(viewYear, viewMonth, d);
                  const isSelected = iso === initialValue;
                  const isToday = iso === toISO(today.getFullYear(), today.getMonth(), today.getDate());
                  return (
                    <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                      <Pressable
                        onPress={() => onPick(iso)}
                        style={{
                          flex: 1,
                          borderRadius: 8,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: isSelected ? "#6BA539" : (isToday ? "rgba(107,165,57,0.15)" : "transparent"),
                          borderWidth: isToday && !isSelected ? 1 : 0,
                          borderColor: "rgba(107,165,57,0.4)",
                        }}
                      >
                        <Text style={{
                          color: isSelected ? "#fff" : "rgba(255,255,255,0.85)",
                          fontFamily: isSelected || isToday ? "Inter_700Bold" : "Inter_400Regular",
                          fontSize: 13,
                        }}>{d}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.08)" }}>
            <Pressable onPress={onClose} hitSlop={6} style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: "rgba(255,255,255,0.5)", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onPick(toISO(today.getFullYear(), today.getMonth(), today.getDate()))}
              hitSlop={6}
              style={{ paddingHorizontal: 14, paddingVertical: 8 }}
            >
              <Text style={{ color: "#6BA539", fontFamily: "Inter_700Bold", fontSize: 13 }}>Today</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
  );

  if (Platform.OS === "web") {
    if (typeof document !== "undefined" && document.body) {
      return ReactDOM.createPortal(inner, document.body);
    }
    return inner;
  }
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      {inner}
    </Modal>
  );
}
