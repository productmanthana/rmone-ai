import { useLocalSearchParams } from "expo-router";
import React from "react";
import { View } from "react-native";
import HomeScreen from "./(tabs)/index";
import PipelineScreen from "./(tabs)/projects";
import ResourcesScreen from "./(tabs)/resources";
import AIScreen from "./(tabs)/chat";
import ForecastScreen from "./(tabs)/forecast";
import DailyBriefingScreen from "./daily-briefing";

export default function ScreenshotRoute() {
  const { ss } = useLocalSearchParams<{ ss: string }>();

  const map: Record<string, React.ComponentType> = {
    home: HomeScreen,
    pipeline: PipelineScreen,
    resources: ResourcesScreen,
    ai: AIScreen,
    forecast: ForecastScreen,
    briefing: DailyBriefingScreen,
  };

  const key = String(ss ?? "home").split("-")[0];
  const Screen = map[key] ?? HomeScreen;

  return (
    <View style={{ flex: 1 }}>
      <Screen />
    </View>
  );
}
