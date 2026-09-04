import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setColorMode, type ThemeMode } from "@/constants/colors";

type ThemeCtx = {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
};

const STORAGE_KEY = "rmone-mobile:theme";

const Ctx = createContext<ThemeCtx>({ mode: "dark", toggle: () => {}, setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [hydrated, setHydrated] = useState(false);
  // Tracks the most recent mode the user (or storage) actually committed to,
  // so the persistence effect never clobbers stored prefs with the default.
  const persistedRef = useRef<ThemeMode | null>(null);

  // 1) Hydrate from storage on mount. Until this resolves we must NOT persist
  //    or re-key, otherwise the default "dark" state can overwrite a stored
  //    "light" preference before the read returns.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        const next: ThemeMode = stored === "light" ? "light" : "dark";
        persistedRef.current = next;
        setColorMode(next);
        if (next !== mode) setModeState(next);
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        persistedRef.current = "dark";
        setHydrated(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Sync module-level color resolver + persist — only after hydration and
  //    only when the user-facing mode actually changes.
  useEffect(() => {
    if (!hydrated) return;
    setColorMode(mode);
    if (persistedRef.current !== mode) {
      persistedRef.current = mode;
      AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
    }
  }, [mode, hydrated]);

  const value = useMemo<ThemeCtx>(() => ({
    mode,
    // Sync setColorMode() BEFORE the React state update so module-scope
    // `themed()` stylesheets and inline JSX (which reads themeMode from
    // context) cannot disagree for a frame during user-driven toggles.
    // Persistence still happens in the effect below.
    toggle: () => setModeState((m) => {
      const next: ThemeMode = m === "dark" ? "light" : "dark";
      setColorMode(next);
      return next;
    }),
    setMode: (m: ThemeMode) => {
      setColorMode(m);
      setModeState(m);
    },
  }), [mode]);

  // Re-key the tree on user-driven mode changes so module-scope `themed()`
  // stylesheets get refreshed against the new palette. We intentionally do
  // NOT re-key on the initial hydration flip (dark → stored value), because
  // that would unnecessarily remount the root nav. Module-scope `RootLayoutNav`
  // also guards its initial redirect with a ref so remounts here don't bounce
  // the user away from a deep route.
  return (
    <Ctx.Provider value={value}>
      <React.Fragment key={hydrated ? mode : "hydrating"}>{children}</React.Fragment>
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
