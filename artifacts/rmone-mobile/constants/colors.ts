// ─── Theme palettes ────────────────────────────────────────────────────────
// The mobile app is built around a single `Colors` token namespace. To support
// runtime light/dark switching without touching every screen, `Colors` is a
// live Proxy that resolves each key against the current palette. Inline
// `style={{ color: Colors.x }}` usages update on re-render automatically.
// Module-scope `StyleSheet.create({...})` blocks are wrapped with `themed(...)`
// (see below) so that they re-evaluate against the active palette.

export type ThemeMode = "dark" | "light";

const DarkPalette = {
  green:         "#6BA539",
  greenLight:    "#A9C23F",
  greenDim:      "#6BA53930",
  orange:        "#E87722",
  orangeWarm:    "#FF9425",
  // Page background — the lighter RM ONE slate. Was "#253746" but it read
  // as near-black in the UI; the brand's lighter slate gives a softer,
  // more on-brand surface across every screen in dark mode.
  dark:          "#2E4557",
  // Modal / panel surface — keep distinctly darker than the page bg so
  // sheets and overlays pop forward.
  darkDeep:      "#1B2B38",
  // Nested card / chip surface — bumped slightly lighter than the page bg
  // so embedded surfaces still read as a distinct layer.
  darkCard:      "#3A536B",
  white:         "#FFFFFF",
  textPrimary:   "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted:     "rgba(255,255,255,0.35)",
  border:        "rgba(255,255,255,0.10)",
  borderStrong:  "rgba(255,255,255,0.18)",
  cardBg:        "#FFFFFF",
  cardBorder:    "#E8EDF2",
  cardBorderStrong: "#B5BDC5",
  cardText:      "#253746",
  cardMuted:     "#6B7E8A",
  surfaceAlt:    "#F5F7FA",
  // Real red (was "#E87722", identical to `orange`, which made the
  // red=under / orange=over utilization convention invisible in dark mode).
  red:           "#F87171",
  surface:       "#253746",
  // Theme-aware overlay surfaces (replace hardcoded rgba(255,255,255,x)):
  // subtle raised panel layers that must invert in light mode.
  panelSoft:     "rgba(255,255,255,0.03)",
  panel:         "rgba(255,255,255,0.05)",
  panelStrong:   "rgba(255,255,255,0.09)",
  // Theme-aware soft text (between textSecondary and textPrimary).
  textSoft:      "rgba(255,255,255,0.72)",
};

// Maps to web's :root[data-theme="light"] --rm-* tokens.
const LightPalette: typeof DarkPalette = {
  green:         "#A8D672",
  greenLight:    "#A8D672",
  greenDim:      "rgba(168,214,114,0.20)",
  orange:        "#C2410C",
  orangeWarm:    "#FB923C",
  dark:          "#F1F4F8", // page bg
  darkDeep:      "#FFFFFF", // panel surface
  darkCard:      "#F7F9FC", // soft panel
  white:         "#FFFFFF",
  textPrimary:   "#0F1923",
  textSecondary: "rgba(15,25,35,0.62)",
  textMuted:     "rgba(15,25,35,0.42)",
  border:        "rgba(15,25,35,0.12)",
  borderStrong:  "rgba(15,25,35,0.22)",
  cardBg:        "#FFFFFF",
  cardBorder:    "#E2E8EE",
  cardBorderStrong: "#B5BDC5",
  cardText:      "#0F1923",
  cardMuted:     "#6B7E8A",
  surfaceAlt:    "#F5F7FA",
  red:           "#B91C1C",
  surface:       "#FFFFFF",
  panelSoft:     "rgba(15,25,35,0.03)",
  panel:         "rgba(15,25,35,0.05)",
  panelStrong:   "rgba(15,25,35,0.09)",
  textSoft:      "rgba(15,25,35,0.72)",
};

let _mode: ThemeMode = "dark";
const _listeners = new Set<(m: ThemeMode) => void>();

export function getColorMode(): ThemeMode { return _mode; }

export function setColorMode(mode: ThemeMode) {
  if (mode === _mode) return;
  _mode = mode;
  _listeners.forEach((fn) => { try { fn(mode); } catch {} });
}

export function subscribeColorMode(fn: (m: ThemeMode) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function paletteFor(mode: ThemeMode) {
  return mode === "light" ? LightPalette : DarkPalette;
}

// Live proxy: every property access resolves against the current palette.
export const Colors: typeof DarkPalette = new Proxy({} as typeof DarkPalette, {
  get(_t, key: string) {
    return (paletteFor(_mode) as any)[key];
  },
  // Allow tooling/Object.keys to introspect.
  ownKeys() { return Object.keys(DarkPalette); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
}) as any;

/**
 * `themed(factory)` wraps a `StyleSheet.create({...})` call (or any plain
 * styles object) so its values are re-evaluated when the theme changes.
 *
 * Usage:
 *   const styles = themed(() => StyleSheet.create({
 *     container: { backgroundColor: Colors.dark },
 *   }));
 *
 * `styles.container` invokes the factory once per mode, caches the result,
 * and returns the matching style object. Module-scope cost is negligible.
 */
export function themed<T extends Record<string, any>>(factory: () => T): T {
  let cached: T | null = null;
  let cachedMode: ThemeMode | null = null;
  const ensure = (): T => {
    if (cached === null || cachedMode !== _mode) {
      cached = factory();
      cachedMode = _mode;
    }
    return cached;
  };
  return new Proxy({} as T, {
    get(_t, key) {
      const v = ensure();
      return (v as any)[key];
    },
    ownKeys() { return Object.keys(ensure() as object); },
    getOwnPropertyDescriptor(_t, key) {
      const v = ensure() as any;
      if (key in v) return { enumerable: true, configurable: true, value: v[key] };
      return undefined;
    },
  }) as T;
}

export default {
  light: {
    text: LightPalette.textPrimary,
    background: LightPalette.dark,
    tint: LightPalette.green,
    tabIconDefault: LightPalette.textMuted,
    tabIconSelected: LightPalette.green,
  },
  dark: {
    text: DarkPalette.textPrimary,
    background: DarkPalette.dark,
    tint: DarkPalette.green,
    tabIconDefault: DarkPalette.textMuted,
    tabIconSelected: DarkPalette.green,
  },
};
