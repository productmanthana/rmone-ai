import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

// SVG-drawn icons (Feather geometry) used on screens where font-based
// @expo/vector-icons glyphs render as tofu boxes (▯) inside Expo Go. Because
// these are vector paths and not font glyphs, they can never fail to render —
// on any device or runtime. Add new names here as needed.

export type AppIconName =
  | "home"
  | "user"
  | "lock"
  | "eye"
  | "eye-off"
  | "alert-circle"
  | "arrow-right";

type Props = {
  name: AppIconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

export function AppIcon({ name, size = 16, color = "#000", style }: Props) {
  const common = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style as StyleProp<ViewStyle>}
    >
      {name === "home" && (
        <>
          <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...common} />
          <Polyline points="9 22 9 12 15 12 15 22" {...common} />
        </>
      )}
      {name === "user" && (
        <>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...common} />
          <Circle cx="12" cy="7" r="4" {...common} />
        </>
      )}
      {name === "lock" && (
        <>
          <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" {...common} />
          <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...common} />
        </>
      )}
      {name === "eye" && (
        <>
          <Path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" {...common} />
          <Circle cx="12" cy="12" r="3" {...common} />
        </>
      )}
      {name === "eye-off" && (
        <>
          <Path
            d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
            {...common}
          />
          <Line x1="1" y1="1" x2="23" y2="23" {...common} />
        </>
      )}
      {name === "alert-circle" && (
        <>
          <Circle cx="12" cy="12" r="10" {...common} />
          <Line x1="12" y1="8" x2="12" y2="12" {...common} />
          <Line x1="12" y1="16" x2="12.01" y2="16" {...common} />
        </>
      )}
      {name === "arrow-right" && (
        <>
          <Line x1="5" y1="12" x2="19" y2="12" {...common} />
          <Polyline points="12 5 19 12 12 19" {...common} />
        </>
      )}
    </Svg>
  );
}
