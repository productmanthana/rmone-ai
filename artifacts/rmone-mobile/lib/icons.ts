import createIconSet from "@expo/vector-icons/createIconSet";
import {
  Feather as RNFeather,
  Ionicons as RNIonicons,
  MaterialCommunityIcons as RNMaterialCommunityIcons,
} from "@expo/vector-icons";

// Why this file exists:
// In Expo Go the runtime preloads its OWN bundled copy of the @expo/vector-icons
// fonts under the standard family names ("feather", "ionicons",
// "material-community"). When our app then calls Font.loadAsync for the same
// names, expo-font treats them as already loaded and skips our copy — so if the
// preloaded font is an older build than our glyph map, every glyph renders as a
// tofu box (▯) on Android.
//
// Re-registering each icon set under a UNIQUE family name guarantees that OUR
// font file (which matches OUR glyph map) is the one that loads, eliminating the
// collision. Render + load both go through these wrappers via `iconFonts`.
//
// We load OUR OWN copies of the .ttf files (vendored into assets/fonts from the
// installed @expo/vector-icons) instead of `Object.values(RN<X>.font)[0]`. In
// Expo Go the latter can resolve to the client's pre-bundled font asset (an
// older glyph build), which would still mismatch our glyph map and render tofu.
// Requiring a file that lives in OUR project guarantees Metro serves the exact
// bytes that match `getRawGlyphMap()`.

const featherAsset = require("../assets/fonts/Feather.ttf");
const ioniconsAsset = require("../assets/fonts/Ionicons.ttf");
const mciAsset = require("../assets/fonts/MaterialCommunityIcons.ttf");

export const Feather = createIconSet(
  (RNFeather as any).getRawGlyphMap(),
  "FeatherRMOne",
  featherAsset,
);

export const Ionicons = createIconSet(
  (RNIonicons as any).getRawGlyphMap(),
  "IoniconsRMOne",
  ioniconsAsset,
);

export const MaterialCommunityIcons = createIconSet(
  (RNMaterialCommunityIcons as any).getRawGlyphMap(),
  "MaterialCommunityIconsRMOne",
  mciAsset,
);

// Spread into the root `useFonts(...)` call so the fonts are registered before
// first paint under their unique names.
export const iconFonts = {
  ...Feather.font,
  ...Ionicons.font,
  ...MaterialCommunityIcons.font,
};
