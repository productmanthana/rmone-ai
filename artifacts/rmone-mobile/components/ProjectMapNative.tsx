import React, { forwardRef } from "react";
import { View, Text, StyleSheet, Dimensions, Platform } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Colors, themed } from "@/constants/colors";

const SCREEN_W = Dimensions.get("window").width;

const MODULE_COLORS: Record<string, string> = {
  PMM: Colors.green,
  OPM: Colors.orange,
  LEM: "#38BDF8",
  COM: "#A78BFA",
};

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d2c3a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "landscape.man_made", elementType: "geometry.stroke", stylers: [{ color: "#334e87" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#1d3544" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6f9ba5" }] },
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#1e3a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#255763" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c5a71" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#255763" }] },
  { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#98a5be" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#0e1626" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4e6d70" }] },
];

const INITIAL_REGION = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 30,
  longitudeDelta: 60,
};

interface Cluster {
  city: string;
  items: any[];
  lat: number;
  lng: number;
  totalValue: number;
  count: number;
}

interface Props {
  clusters: Cluster[];
  maxCount: number;
  getMarkerSize: (count: number) => number;
  getDominantModule: (items: any[]) => string;
  onClusterPress: (cluster: Cluster) => void;
}

const ProjectMapNative = forwardRef<any, Props>(({ clusters, maxCount, getMarkerSize, getDominantModule, onClusterPress }, ref) => {
  return (
    <View style={s.mapWrap}>
      <MapView
        ref={ref}
        style={s.map}
        initialRegion={INITIAL_REGION}
        customMapStyle={DARK_MAP_STYLE}
        userInterfaceStyle="dark"
        showsUserLocation={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
        showsIndoors={false}
        toolbarEnabled={false}
      >
        {clusters.map((cl, idx) => {
          const size = getMarkerSize(cl.count);
          const dominant = getDominantModule(cl.items);
          const color = MODULE_COLORS[dominant] || Colors.green;

          return (
            <Marker
              key={`${cl.city}-${idx}`}
              coordinate={{ latitude: cl.lat, longitude: cl.lng }}
              tracksViewChanges={false}
              onPress={() => onClusterPress(cl)}
            >
              <View style={[s.markerOuter, { width: size + 8, height: size + 8 }]}>
                <View style={[s.markerPulse, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, borderColor: color + "40" }]} />
                <View style={[s.markerDot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
                  <Text style={[s.markerText, size < 36 && { fontSize: 10 }]}>{cl.count}</Text>
                </View>
              </View>
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
});

ProjectMapNative.displayName = "ProjectMapNative";
export default ProjectMapNative;

const s = themed(() => StyleSheet.create({
  mapWrap: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1a2a3a",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  map: {
    width: "100%",
    height: SCREEN_W * 0.75,
  },
  markerOuter: {
    alignItems: "center",
    justifyContent: "center",
  },
  markerPulse: {
    position: "absolute",
    borderWidth: 2,
  },
  markerDot: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    ...(Platform.OS === "ios" ? {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.4,
      shadowRadius: 4,
    } : { elevation: 4 }),
  },
  markerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
}));
