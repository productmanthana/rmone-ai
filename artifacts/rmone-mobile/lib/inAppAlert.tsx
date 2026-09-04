import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, Modal, StyleSheet, Dimensions } from "react-native";
import { Colors, themed } from "@/constants/colors";

type AlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type AlertState = {
  visible: boolean;
  title: string;
  message: string;
  buttons: AlertButton[];
};

type InAppAlertContextType = {
  showAlert: (title: string, message: string, buttons?: AlertButton[]) => void;
};

const InAppAlertContext = createContext<InAppAlertContextType>({
  showAlert: () => {},
});

let _globalShowAlert: InAppAlertContextType["showAlert"] = () => {};

export function globalAlert(title: string, msg: string) {
  _globalShowAlert(title, msg, [{ text: "OK", style: "default" }]);
}

export function globalConfirm(
  title: string,
  msg: string,
  onOk: () => void,
  okText = "Yes",
  cancelText = "Cancel",
): void {
  _globalShowAlert(title, msg, [
    { text: cancelText, style: "cancel" },
    { text: okText, style: "default", onPress: onOk },
  ]);
}

export function globalConfirmAsync(
  title: string,
  msg: string,
  okText = "Yes",
  cancelText = "Cancel",
): Promise<boolean> {
  return new Promise((resolve) => {
    _globalShowAlert(title, msg, [
      { text: cancelText, style: "cancel", onPress: () => resolve(false) },
      { text: okText, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

export function useInAppAlert() {
  return useContext(InAppAlertContext);
}

export function InAppAlertProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AlertState>({
    visible: false,
    title: "",
    message: "",
    buttons: [],
  });
  const resolveRef = useRef<(() => void) | null>(null);

  const showAlert = useCallback(
    (title: string, message: string, buttons?: AlertButton[]) => {
      setState({
        visible: true,
        title,
        message,
        buttons: buttons || [{ text: "OK", style: "default" }],
      });
    },
    [],
  );

  _globalShowAlert = showAlert;

  const dismiss = useCallback((btn?: AlertButton) => {
    setState((s) => ({ ...s, visible: false }));
    btn?.onPress?.();
  }, []);

  return (
    <InAppAlertContext.Provider value={{ showAlert }}>
      {children}
      <Modal
        visible={state.visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => dismiss()}
      >
        <Pressable style={styles.overlay} onPress={() => dismiss()}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{state.title}</Text>
            {state.message ? (
              <Text style={styles.message}>{state.message}</Text>
            ) : null}
            <View style={styles.btnRow}>
              {state.buttons.map((btn, i) => {
                const isCancel = btn.style === "cancel";
                const isDestructive = btn.style === "destructive";
                return (
                  <Pressable
                    key={i}
                    style={[
                      styles.btn,
                      isCancel
                        ? styles.btnCancel
                        : isDestructive
                          ? styles.btnDestructive
                          : styles.btnPrimary,
                      state.buttons.length === 1 && { flex: 1 },
                    ]}
                    onPress={() => dismiss(btn)}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        isCancel && styles.btnTextCancel,
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </InAppAlertContext.Provider>
  );
}

const { width } = Dimensions.get("window");
const CARD_W = Math.min(340, width - 48);

const styles = themed(() => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: CARD_W,
    backgroundColor: Colors.dark,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: "#fff",
    marginBottom: 8,
  },
  message: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 20,
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnPrimary: {
    backgroundColor: Colors.green,
  },
  btnCancel: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  btnDestructive: {
    backgroundColor: "#D32F2F",
  },
  btnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#fff",
  },
  btnTextCancel: {
    color: "rgba(255,255,255,0.7)",
  },
}));
