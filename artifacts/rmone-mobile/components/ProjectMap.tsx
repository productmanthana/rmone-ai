import { compactUsd } from "@/lib/money";
import { AppTextInput } from "@/components/AppTextInput";
import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Dimensions,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  Platform,
} from "react-native";
import { Feather } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { Colors, themed } from "@/constants/colors";
import NativeMapView from "./ProjectMapNative";

const SCREEN_W = Dimensions.get("window").width;

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  "san francisco": { lat: 37.78, lng: -122.42 },
  "los angeles": { lat: 34.05, lng: -118.24 },
  "new york": { lat: 40.71, lng: -74.01 },
  "chicago": { lat: 41.88, lng: -87.63 },
  "houston": { lat: 29.76, lng: -95.37 },
  "phoenix": { lat: 33.45, lng: -112.07 },
  "philadelphia": { lat: 39.95, lng: -75.17 },
  "san antonio": { lat: 29.42, lng: -98.49 },
  "san diego": { lat: 32.72, lng: -117.16 },
  "dallas": { lat: 32.78, lng: -96.80 },
  "austin": { lat: 30.27, lng: -97.74 },
  "jacksonville": { lat: 30.33, lng: -81.66 },
  "san jose": { lat: 37.34, lng: -121.89 },
  "fort worth": { lat: 32.75, lng: -97.33 },
  "columbus": { lat: 39.96, lng: -82.99 },
  "charlotte": { lat: 35.23, lng: -80.84 },
  "indianapolis": { lat: 39.77, lng: -86.16 },
  "seattle": { lat: 47.61, lng: -122.33 },
  "denver": { lat: 39.74, lng: -104.99 },
  "washington": { lat: 38.91, lng: -77.04 },
  "boston": { lat: 42.36, lng: -71.06 },
  "nashville": { lat: 36.16, lng: -86.78 },
  "el paso": { lat: 31.76, lng: -106.44 },
  "detroit": { lat: 42.33, lng: -83.05 },
  "memphis": { lat: 35.15, lng: -90.05 },
  "portland": { lat: 45.51, lng: -122.68 },
  "las vegas": { lat: 36.17, lng: -115.14 },
  "louisville": { lat: 38.25, lng: -85.76 },
  "baltimore": { lat: 39.29, lng: -76.61 },
  "milwaukee": { lat: 43.04, lng: -87.91 },
  "albuquerque": { lat: 35.08, lng: -106.65 },
  "tucson": { lat: 32.22, lng: -110.97 },
  "fresno": { lat: 36.74, lng: -119.77 },
  "sacramento": { lat: 38.58, lng: -121.49 },
  "kansas city": { lat: 39.10, lng: -94.58 },
  "mesa": { lat: 33.41, lng: -111.83 },
  "atlanta": { lat: 33.75, lng: -84.39 },
  "omaha": { lat: 41.26, lng: -95.94 },
  "raleigh": { lat: 35.78, lng: -78.64 },
  "miami": { lat: 25.76, lng: -80.19 },
  "cleveland": { lat: 41.50, lng: -81.69 },
  "tampa": { lat: 27.95, lng: -82.46 },
  "orlando": { lat: 28.54, lng: -81.38 },
  "minneapolis": { lat: 44.98, lng: -93.27 },
  "st. louis": { lat: 38.63, lng: -90.20 },
  "saint louis": { lat: 38.63, lng: -90.20 },
  "pittsburgh": { lat: 40.44, lng: -79.99 },
  "cincinnati": { lat: 39.10, lng: -84.51 },
  "anaheim": { lat: 33.84, lng: -117.91 },
  "irvine": { lat: 33.68, lng: -117.83 },
  "oakland": { lat: 37.80, lng: -122.27 },
  "honolulu": { lat: 21.31, lng: -157.86 },
  "salt lake city": { lat: 40.76, lng: -111.89 },
  "new orleans": { lat: 29.95, lng: -90.07 },
  "richmond": { lat: 37.54, lng: -77.44 },
  "boise": { lat: 43.62, lng: -116.21 },
  "scottsdale": { lat: 33.49, lng: -111.93 },
  "tempe": { lat: 33.43, lng: -111.94 },
  "chandler": { lat: 33.30, lng: -111.84 },
  "gilbert": { lat: 33.35, lng: -111.79 },
  "glendale": { lat: 33.54, lng: -112.19 },
  "reno": { lat: 39.53, lng: -119.81 },
  "spokane": { lat: 47.66, lng: -117.43 },
  "des moines": { lat: 41.59, lng: -93.62 },
  "baton rouge": { lat: 30.45, lng: -91.19 },
  "birmingham": { lat: 33.52, lng: -86.81 },
  "rochester": { lat: 43.16, lng: -77.61 },
  "modesto": { lat: 37.64, lng: -120.99 },
  "jersey city": { lat: 40.72, lng: -74.05 },
  "st. petersburg": { lat: 27.77, lng: -82.64 },
  "norfolk": { lat: 36.85, lng: -76.29 },
  "lincoln": { lat: 40.81, lng: -96.70 },
  "plano": { lat: 33.02, lng: -96.70 },
  "anchorage": { lat: 61.22, lng: -149.90 },
  "newark": { lat: 40.74, lng: -74.17 },
  "greensboro": { lat: 36.07, lng: -79.79 },
  "buffalo": { lat: 42.89, lng: -78.88 },
  "lexington": { lat: 38.05, lng: -84.50 },
  "stockton": { lat: 37.96, lng: -121.29 },
  "corpus christi": { lat: 27.80, lng: -97.40 },
  "henderson": { lat: 36.04, lng: -114.98 },
  "riverside": { lat: 33.95, lng: -117.40 },
  "santa ana": { lat: 33.75, lng: -117.87 },
  "long beach": { lat: 33.77, lng: -118.19 },
  "bakersfield": { lat: 35.37, lng: -119.02 },
  "st paul": { lat: 44.94, lng: -93.09 },
  "arlington": { lat: 32.74, lng: -97.11 },
  "madison": { lat: 43.07, lng: -89.40 },
  "virginia beach": { lat: 36.85, lng: -75.98 },
  "little rock": { lat: 34.75, lng: -92.29 },
  "hartford": { lat: 41.76, lng: -72.68 },
  "colorado springs": { lat: 38.83, lng: -104.82 },
  "tulsa": { lat: 36.15, lng: -95.99 },
  "wichita": { lat: 37.69, lng: -97.34 },
  "providence": { lat: 41.82, lng: -71.41 },
  "durham": { lat: 35.99, lng: -78.90 },
  "savannah": { lat: 32.08, lng: -81.09 },
  "knoxville": { lat: 35.96, lng: -83.92 },
  "chattanooga": { lat: 35.05, lng: -85.31 },
  "wilmington": { lat: 34.23, lng: -77.95 },
};

function lookupCity(cityName: string): { lat: number; lng: number } | null {
  const key = cityName.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

/** Common city aliases / abbreviations seen in CRM data. */
const CITY_ALIASES: Record<string, string> = {
  "la": "los angeles",
  "l.a.": "los angeles",
  "sf": "san francisco",
  "s.f.": "san francisco",
  "nyc": "new york",
  "ny": "new york",
  "n.y.": "new york",
  "sj": "san jose",
  "ssf": "south san francisco",
  "so san francisco": "south san francisco",
  "south sf": "south san francisco",
  "vegas": "las vegas",
  "philly": "philadelphia",
  "dc": "washington",
  "d.c.": "washington",
};

/**
 * Normalize a raw city string from CRM data.
 * Handles aliases (LA → Los Angeles), trims state suffix ("San Francisco, CA" → "San Francisco"),
 * and rejects garbage values too short or non-cities.
 * Returns null when the input is unusable.
 */
function normalizeCity(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  // Drop ", STATE" or " STATE" suffix (e.g. "San Francisco, CA")
  s = s.replace(/,\s*[A-Za-z]{2,}\s*\d{0,5}$/u, "").trim();
  s = s.replace(/\s+/g, " ");
  const lower = s.toLowerCase();
  if (CITY_ALIASES[lower]) return CITY_ALIASES[lower];
  // Reject garbage: too short, "tbd", "unknown", "n/a", just punctuation/digits
  if (lower.length < 3) return null;
  if (["tbd", "n/a", "na", "none", "unknown", "various"].includes(lower)) return null;
  if (!/[a-z]/i.test(lower)) return null;
  // Reject single-word fragments that are obvious truncations of a real city.
  // e.g. "San" alone is meaningless — but allow "San Jose", "Los Angeles", etc.
  const fragments = new Set(["san", "los", "new", "fort", "saint", "st", "south", "north", "east", "west", "el", "la"]);
  if (fragments.has(lower)) return null;
  return s;
}

interface MapItem {
  id: string;
  name: string;
  city: string;
  value: number;
  module: "PMM" | "OPM" | "LEM" | "COM";
  status: string;
}

interface CityCluster {
  city: string;
  items: MapItem[];
  lat: number;
  lng: number;
  totalValue: number;
  count: number;
}

const MODULE_COLORS: Record<string, string> = {
  PMM: Colors.green,
  OPM: Colors.orange,
  LEM: "#38BDF8",
  COM: "#A78BFA",
};

const MODULE_LABELS: Record<string, string> = {
  PMM: "Projects",
  OPM: "Opps",
  LEM: "Leads",
  COM: "Companies",
};

function fmtM(v: number) {
  if (!v || isNaN(v)) return "$0";
  if (v >= 1e9) return compactUsd(v);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

export interface ProjectMapProps {
  projects: { id: string; name: string; city: string; value: number; phase: string }[];
  opps: { id: string; name: string; city: string; value: number; stage: string }[];
  leads: { id: string; name: string; city: string; value: number; status: string }[];
  companies: { id: string; name: string; city: string }[];
  onItemPress: (id: string) => void;
  onAskAI: (prompt: string) => void;
  onStatsChange?: (s: { module: string; cities: number; records: number; totalValue: number }) => void;
}

export default function ProjectMap({ projects, opps, leads, companies, onItemPress, onAskAI, onStatsChange }: ProjectMapProps) {
  const [selectedCluster, setSelectedCluster] = useState<CityCluster | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const mapRef = useRef<any>(null);

  const allItems = useMemo(() => {
    const items: MapItem[] = [];
    for (const p of projects) {
      if (p.city) items.push({ id: p.id, name: p.name, city: p.city, value: p.value, module: "PMM", status: p.phase });
    }
    for (const o of opps) {
      if (o.city) items.push({ id: o.id, name: o.name, city: o.city, value: o.value, module: "OPM", status: o.stage });
    }
    for (const l of leads) {
      if (l.city) items.push({ id: l.id, name: l.name, city: l.city, value: l.value, module: "LEM", status: l.status });
    }
    for (const c of companies) {
      if (c.city) items.push({ id: c.id, name: c.name, city: c.city, value: 0, module: "COM", status: "" });
    }
    return items;
  }, [projects, opps, leads, companies]);

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (moduleFilter !== "All") items = items.filter(i => i.module === moduleFilter);
    if (searchQuery.trim()) {
      const sq = searchQuery.toLowerCase();
      items = items.filter(i => i.city.toLowerCase().includes(sq) || i.name.toLowerCase().includes(sq));
    }
    return items;
  }, [allItems, moduleFilter, searchQuery]);

  const clusters = useMemo(() => {
    const cityMap = new Map<string, MapItem[]>();
    for (const item of filteredItems) {
      const normalized = normalizeCity(item.city);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (!cityMap.has(key)) cityMap.set(key, []);
      cityMap.get(key)!.push(item);
    }

    const result: CityCluster[] = [];
    for (const [cityKey, items] of cityMap) {
      const coords = lookupCity(cityKey);
      // Cities without known coords still appear in Top Locations (lat/lng = NaN);
      // the native map markers filter these out via Number.isFinite.
      result.push({
        city: items[0].city,
        items,
        lat: coords ? coords.lat : Number.NaN,
        lng: coords ? coords.lng : Number.NaN,
        totalValue: items.reduce((s, i) => s + i.value, 0),
        count: items.length,
      });
    }
    return result.sort((a, b) => b.count - a.count);
  }, [filteredItems]);

  const mapClusters = useMemo(
    () => clusters.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)),
    [clusters],
  );

  const maxCount = Math.max(...clusters.map(c => c.count), 1);

  const stats = useMemo(() => {
    const cities = clusters.length;
    const total = filteredItems.length;
    const totalVal = filteredItems.reduce((s, i) => s + i.value, 0);
    return { cities, total, totalVal };
  }, [clusters, filteredItems]);

  useEffect(() => {
    onStatsChange?.({ module: moduleFilter, cities: stats.cities, records: stats.total, totalValue: stats.totalVal });
  }, [moduleFilter, stats.cities, stats.total, stats.totalVal, onStatsChange]);

  const handleClusterPress = useCallback((cluster: CityCluster) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedCluster(cluster);
    if (mapRef.current?.animateToRegion && Number.isFinite(cluster.lat) && Number.isFinite(cluster.lng)) {
      mapRef.current.animateToRegion({
        latitude: cluster.lat,
        longitude: cluster.lng,
        latitudeDelta: 2,
        longitudeDelta: 2,
      }, 400);
    }
  }, []);

  const handleSearchCity = useCallback((cluster: CityCluster) => {
    setSearchQuery("");
    setSearchFocused(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mapRef.current?.animateToRegion && Number.isFinite(cluster.lat) && Number.isFinite(cluster.lng)) {
      mapRef.current.animateToRegion({
        latitude: cluster.lat,
        longitude: cluster.lng,
        latitudeDelta: 2,
        longitudeDelta: 2,
      }, 500);
    }
    setTimeout(() => setSelectedCluster(cluster), 600);
  }, []);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const sq = searchQuery.toLowerCase();
    return clusters.filter(c => c.city.toLowerCase().includes(sq)).slice(0, 8);
  }, [clusters, searchQuery]);

  const modules = ["All", "PMM", "OPM", "LEM", "COM"];

  const getMarkerSize = (count: number) => {
    const ratio = count / maxCount;
    return Math.max(28, Math.min(56, 28 + ratio * 28));
  };

  const getDominantModule = (items: MapItem[]) => {
    const counts: Record<string, number> = {};
    for (const i of items) {
      counts[i.module] = (counts[i.module] || 0) + 1;
    }
    let max = 0;
    let mod = "PMM";
    for (const [k, v] of Object.entries(counts)) {
      if (v > max) { max = v; mod = k; }
    }
    return mod;
  };

  const renderClusterDetail = () => {
    if (!selectedCluster) return null;
    const cl = selectedCluster;
    const moduleCounts: Record<string, number> = {};
    for (const item of cl.items) {
      moduleCounts[item.module] = (moduleCounts[item.module] || 0) + 1;
    }

    return (
      <Modal visible transparent animationType="slide" onRequestClose={() => setSelectedCluster(null)}>
        <View style={ms.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setSelectedCluster(null)} />
          <View style={ms.modalSheet}>
            <View style={ms.modalHandle} />
            <View style={ms.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={ms.modalTitle}>{titleCase(cl.city)}</Text>
                <Text style={ms.modalSubtitle}>{cl.count} records · {fmtM(cl.totalValue)}</Text>
              </View>
              <Pressable style={ms.modalClose} onPress={() => setSelectedCluster(null)}>
                <Feather name="x" size={20} color={Colors.white} />
              </Pressable>
            </View>

            <View style={ms.modalModuleRow}>
              {Object.entries(moduleCounts).map(([mod, cnt]) => (
                <View key={mod} style={[ms.modalModulePill, { backgroundColor: MODULE_COLORS[mod] + "20" }]}>
                  <View style={[ms.modalModuleDot, { backgroundColor: MODULE_COLORS[mod] }]} />
                  <Text style={[ms.modalModuleText, { color: MODULE_COLORS[mod] }]}>{cnt} {MODULE_LABELS[mod] || mod}</Text>
                </View>
              ))}
            </View>

            <FlatList
              data={cl.items.slice(0, 50)}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 360 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable style={ms.modalItem} onPress={() => { setSelectedCluster(null); setTimeout(() => onItemPress(item.id), 200); }}>
                  <View style={[ms.modalItemDot, { backgroundColor: MODULE_COLORS[item.module] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={ms.modalItemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={ms.modalItemSub}>{item.module} · {item.status || "—"}{item.value ? ` · ${fmtM(item.value)}` : ""}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.3)" />
                </Pressable>
              )}
            />

            <Pressable
              style={ms.aiButton}
              onPress={() => {
                setSelectedCluster(null);
                onAskAI(`Analyze our presence in ${titleCase(cl.city)}: ${cl.count} records across ${Object.entries(moduleCounts).map(([m, c]) => `${c} ${MODULE_LABELS[m] || m}`).join(", ")}. Total value: ${fmtM(cl.totalValue)}. What strategic insights and recommendations can you provide?`);
              }}
            >
              <Feather name="cpu" size={16} color={Colors.white} />
              <Text style={ms.aiButtonText}>AI Analysis for {titleCase(cl.city)}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  };

  const renderMapArea = () => {
    if (Platform.OS !== "web") {
      return (
        <NativeMapView
          ref={mapRef}
          clusters={mapClusters}
          maxCount={maxCount}
          getMarkerSize={getMarkerSize}
          getDominantModule={getDominantModule}
          onClusterPress={handleClusterPress}
        />
      );
    }

    return (
      <View style={ms.mapWrap}>
        <View style={[ms.map, { backgroundColor: "#1a2a3a", alignItems: "center", justifyContent: "center" }]}>
          <Feather name="map" size={40} color="rgba(255,255,255,0.15)" />
          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, textAlign: "center", marginTop: 12, paddingHorizontal: 32, lineHeight: 20 }}>
            Native map available on iOS & Android.{"\n"}Browse locations from the list below.
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={ms.container}>
      <View style={ms.searchWrap}>
        <View style={ms.searchBar}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.4)" />
          <AppTextInput
            style={ms.searchInput}
            placeholder="Search city or project..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => { setSearchQuery(""); setSearchFocused(false); }}>
              <Feather name="x-circle" size={16} color="rgba(255,255,255,0.4)" />
            </Pressable>
          )}
        </View>

        {searchFocused && searchResults.length > 0 && (
          <View style={ms.searchDropdown}>
            {searchResults.map((cl, idx) => (
              <Pressable key={idx} style={ms.searchResult} onPress={() => handleSearchCity(cl)}>
                <Feather name="map-pin" size={14} color={Colors.green} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={ms.searchResultCity}>{titleCase(cl.city)}</Text>
                  <Text style={ms.searchResultSub}>{cl.count} records · {fmtM(cl.totalValue)}</Text>
                </View>
                <Feather name="arrow-right" size={14} color="rgba(255,255,255,0.3)" />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={ms.filterRow}>
        {modules.map(m => (
          <Pressable
            key={m}
            style={[ms.filterPill, moduleFilter === m && ms.filterPillActive]}
            onPress={() => { setModuleFilter(m); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            {m !== "All" && <View style={[ms.filterDot, { backgroundColor: MODULE_COLORS[m] }]} />}
            <Text style={[ms.filterText, moduleFilter === m && ms.filterTextActive]}>{m}</Text>
          </Pressable>
        ))}
      </View>

      <View style={ms.statsRow}>
        <View style={ms.statBox}>
          <Text style={ms.statValue}>{stats.cities}</Text>
          <Text style={ms.statLabel}>Cities</Text>
        </View>
        <View style={[ms.statBox, ms.statBorder]}>
          <Text style={ms.statValue}>{stats.total.toLocaleString()}</Text>
          <Text style={ms.statLabel}>Records</Text>
        </View>
        <View style={ms.statBox}>
          <Text style={[ms.statValue, { color: Colors.green }]}>{fmtM(stats.totalVal)}</Text>
          <Text style={ms.statLabel}>Total Value</Text>
        </View>
      </View>

      {renderMapArea()}

      <View style={ms.legendRow}>
        {["PMM", "OPM", "LEM", "COM"].map(m => (
          <View key={m} style={ms.legendItem}>
            <View style={[ms.legendDot, { backgroundColor: MODULE_COLORS[m] }]} />
            <Text style={ms.legendText}>{MODULE_LABELS[m]}</Text>
          </View>
        ))}
      </View>

      <View style={ms.sectionHeader}>
        <Text style={ms.sectionTitle}>Top Locations</Text>
        <Text style={ms.sectionSub}>{clusters.length} cities</Text>
      </View>

      {clusters.length === 0 && (() => {
        const rawByModule: Record<string, number> = { PMM: projects.length, OPM: opps.length, LEM: leads.length, COM: companies.length };
        const totalRaw = moduleFilter === "All"
          ? projects.length + opps.length + leads.length + companies.length
          : (rawByModule[moduleFilter] ?? 0);
        const moduleName = moduleFilter === "All" ? "this view" : `${moduleFilter} (${MODULE_LABELS[moduleFilter] ?? moduleFilter})`;
        return (
          <View style={ms.emptyLocations}>
            <Feather name="map-pin" size={28} color="rgba(255,255,255,0.25)" />
            <Text style={ms.emptyTitle}>No location data</Text>
            <Text style={ms.emptyText}>
              0 of {totalRaw.toLocaleString()} {moduleFilter === "All" ? "records have" : `${moduleFilter} records have`} a city populated in RM ONE for this tenant.
            </Text>
            {moduleFilter !== "All" && moduleFilter !== "LEM" && (
              <Text style={ms.emptyHint}>Try the LEM filter — leads in Liro_POC do have city values.</Text>
            )}
          </View>
        );
      })()}

      {clusters.slice(0, 20).map((cl, idx) => {
        const moduleCounts: Record<string, number> = {};
        for (const item of cl.items) {
          moduleCounts[item.module] = (moduleCounts[item.module] || 0) + 1;
        }
        return (
          <Pressable key={idx} style={ms.locationCard} onPress={() => handleClusterPress(cl)}>
            <View style={ms.locationRank}>
              <Text style={ms.locationRankText}>{idx + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ms.locationName}>{titleCase(cl.city)}</Text>
              <View style={ms.locationTagRow}>
                {Object.entries(moduleCounts).map(([mod, cnt]) => (
                  <View key={mod} style={[ms.locationTag, { backgroundColor: MODULE_COLORS[mod] + "20" }]}>
                    <Text style={[ms.locationTagText, { color: MODULE_COLORS[mod] }]}>{cnt} {mod}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={ms.locationCount}>{cl.count}</Text>
              {cl.totalValue > 0 && <Text style={ms.locationValue}>{fmtM(cl.totalValue)}</Text>}
            </View>
            <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.3)" style={{ marginLeft: 8 }} />
          </Pressable>
        );
      })}

      <Pressable
        style={ms.aiGlobalBtn}
        onPress={() => {
          const topCities = clusters.slice(0, 10).map(c => `${titleCase(c.city)} (${c.count} records, ${fmtM(c.totalValue)})`).join("; ");
          onAskAI(`Analyze our geographic portfolio distribution across ${stats.cities} cities with ${stats.total} total records worth ${fmtM(stats.totalVal)}. Top cities: ${topCities}. Provide strategic insights on market concentration, geographic risks, expansion opportunities, and resource allocation recommendations.`);
        }}
      >
        <Feather name="cpu" size={18} color={Colors.white} />
        <Text style={ms.aiGlobalText}>AI Geographic Analysis</Text>
      </Pressable>

      {renderClusterDetail()}
    </View>
  );
}

const ms = themed(() => StyleSheet.create({
  container: { paddingHorizontal: 16 },
  searchWrap: { position: "relative", zIndex: 20, marginBottom: 10 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.darkCard,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  searchInput: {
    flex: 1,
    color: Colors.cardText,
    fontSize: 15,
    marginLeft: 10,
    paddingVertical: 0,
  },
  searchDropdown: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: Colors.darkCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    ...(Platform.OS === "ios" ? {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
    } : { elevation: 8 }),
  },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  searchResultCity: { color: Colors.cardText, fontSize: 14, fontWeight: "600" },
  searchResultSub: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 5,
  },
  filterPillActive: {
    backgroundColor: Colors.green + "25",
    borderWidth: 1,
    borderColor: Colors.green + "50",
  },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  filterText: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "500" },
  filterTextActive: { color: Colors.cardText },
  statsRow: {
    flexDirection: "row",
    backgroundColor: Colors.darkCard,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  statBox: { flex: 1, alignItems: "center", paddingVertical: 14 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  statValue: { color: Colors.cardText, fontSize: 20, fontWeight: "700" },
  statLabel: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 },
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
  legendRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginBottom: 16,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: { color: Colors.cardText, fontSize: 18, fontWeight: "700" },
  sectionSub: { color: "rgba(255,255,255,0.4)", fontSize: 13 },
  emptyLocations: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 18,
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  emptyTitle: { color: Colors.cardText, fontSize: 15, fontWeight: "700", marginTop: 4 },
  emptyText: { color: "rgba(255,255,255,0.55)", fontSize: 13, textAlign: "center", lineHeight: 18 },
  emptyHint: { color: Colors.green, fontSize: 12, fontWeight: "600", marginTop: 4 },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.darkCard,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  locationRank: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  locationRankText: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: "700" },
  locationName: { color: Colors.cardText, fontSize: 15, fontWeight: "600", marginBottom: 4 },
  locationTagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  locationTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  locationTagText: { fontSize: 11, fontWeight: "600" },
  locationCount: { color: Colors.cardText, fontSize: 18, fontWeight: "700" },
  locationValue: { color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 2 },
  aiGlobalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.green,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 8,
    marginBottom: 16,
    gap: 8,
  },
  aiGlobalText: { color: Colors.cardText, fontSize: 15, fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet: {
    backgroundColor: Colors.dark,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "80%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  modalTitle: { color: Colors.cardText, fontSize: 22, fontWeight: "700" },
  modalSubtitle: { color: "rgba(255,255,255,0.5)", fontSize: 14, marginTop: 2 },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalModuleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  modalModulePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  modalModuleDot: { width: 8, height: 8, borderRadius: 4 },
  modalModuleText: { fontSize: 13, fontWeight: "600" },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
    gap: 10,
  },
  modalItemDot: { width: 8, height: 8, borderRadius: 4 },
  modalItemName: { color: Colors.cardText, fontSize: 14, fontWeight: "500" },
  modalItemSub: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 },
  aiButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.green,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
    gap: 8,
  },
  aiButtonText: { color: Colors.cardText, fontSize: 15, fontWeight: "600" },
}));
