import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ActivityIndicator, Alert,
  TextInput, TouchableOpacity, FlatList,
} from "react-native";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { detectDistrict } from "../../lib/detectDistrict";
import { T } from "../../lib/theme";

// Live schema: neighborhoods keys off city_id (FK to cities). There is no
// municipality_id column on this table — that lives on neighborhood_scores.
// center_lat/center_lng power the residency fallback when GPS is unavailable.
type Neighborhood = {
  id: string;
  name: string;
  city_id: string;
  center_lat: number | null;
  center_lng: number | null;
};

// Final fallback when neither GPS nor a neighborhood center is available —
// Jackson Township center, matching the web app (OnboardingScreen.jsx).
const JACKSON_LAT = 40.103;
const JACKSON_LNG = -74.349;

export default function OnboardingNeighborhood() {
  // ?verify=1 → on-demand just-in-time verification (continue to the ZK proof).
  // Absent → initial onboarding (enter and read; ZK runs later, on first act).
  const { verify } = useLocalSearchParams<{ verify?: string }>();
  const [detecting, setDetecting] = useState(true);
  const [detectedNeighborhood, setDetectedNeighborhood] = useState<Neighborhood | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Neighborhood[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    detectLocation();
  }, []);

  async function detectLocation() {
    setDetecting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setDetecting(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = loc.coords;
      setCoords({ lat, lng });

      // Reverse geocode via Nominatim to get area name
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "User-Agent": "TownhallCafe/1.0" } }
      );
      const geo = await geoRes.json();
      const suburb = geo.address?.suburb || geo.address?.neighbourhood || geo.address?.village;

      // Look up in Supabase cities table
      const { data: cities } = await supabase
        .from("cities")
        .select("id, name")
        .ilike("name", `%${geo.address?.city || geo.address?.town || ""}%`)
        .limit(1);

      if (cities && cities.length > 0) {
        const { data: hoods } = await supabase
          .from("neighborhoods")
          .select("id, name, city_id, center_lat, center_lng")
          .eq("city_id", cities[0].id)
          .limit(10);

        if (hoods && hoods.length > 0) {
          // Match suburb name if possible
          const match = suburb
            ? hoods.find(h => h.name.toLowerCase().includes(suburb.toLowerCase())) || hoods[0]
            : hoods[0];
          setDetectedNeighborhood(match);
        }
      }
    } catch {
      // silent — user can search manually
    } finally {
      setDetecting(false);
    }
  }

  async function searchNeighborhoods(q: string) {
    setSearch(q);
    if (q.length < 2) { setResults([]); return; }
    const { data } = await supabase
      .from("neighborhoods")
      .select("id, name, city_id, center_lat, center_lng")
      .ilike("name", `%${q}%`)
      .limit(8);
    setResults(data || []);
  }

  async function selectNeighborhood(hood: Neighborhood) {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // B3: resolve the resident's election district LOCALLY from GPS (point-in-
    // polygon on device — location never sent out); store only the district id.
    let district_id: string | null = null;
    if (coords?.lat != null && coords?.lng != null) {
      try { district_id = (await detectDistrict(coords.lat, coords.lng))?.id ?? null; } catch {}
    }

    await supabase.from("profiles").update({
      neighborhood_id: hood.id,
      neighborhood: hood.name,
      district_id,
    }).eq("id", user.id);

    setSaving(false);

    if (verify !== "1") {
      // Initial onboarding: neighborhood_id is now saved, so enter and read.
      // ZK runs just-in-time (goVerify → here with ?verify=1) the first time
      // the resident votes/stakes/escalates. welcome.tsx sets onboarded=true.
      router.replace("/onboarding/welcome");
      return;
    }

    // On-demand verification → run the ZK proof. Pass coords to the next step.
    router.push({
      pathname: "/onboarding/zk-proof",
      params: {
        neighborhoodId: hood.id,
        neighborhoodName: hood.name,
        municipalityId: hood.city_id,
        // Fallback chain mirrors web: real GPS → neighborhood center → Jackson.
        // A proof built on the neighborhood center still verifies (the center is
        // inside the boundary) — fine for town-level residency when GPS is denied.
        lat: (coords?.lat ?? hood.center_lat ?? JACKSON_LAT).toString(),
        lng: (coords?.lng ?? hood.center_lng ?? JACKSON_LNG).toString(),
      },
    });
  }

  return (
    <View style={s.root}>
      <Text style={s.title}>Your neighborhood</Text>
      <Text style={s.sub}>
        We'll use your location to place you in the right civic community.
      </Text>

      {detecting ? (
        <View style={s.detecting}>
          <ActivityIndicator color={T.amber} />
          <Text style={s.detectingText}>Detecting your location…</Text>
        </View>
      ) : detectedNeighborhood ? (
        <View style={s.detected}>
          <Text style={s.detectLabel}>Detected neighborhood</Text>
          <Text style={s.detectName}>{detectedNeighborhood.name}</Text>
          <View style={s.detectActions}>
            <TouchableOpacity
              style={s.btnPrimary}
              onPress={() => selectNeighborhood(detectedNeighborhood)}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={T.bg} />
                : <Text style={s.btnPrimaryText}>Yes, that's me</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btnSecondary}
              onPress={() => setDetectedNeighborhood(null)}
            >
              <Text style={s.btnSecondaryText}>Search instead</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={s.searchWrap}>
          <TextInput
            style={s.input}
            value={search}
            onChangeText={searchNeighborhoods}
            placeholder="Search for your neighborhood or municipality…"
            placeholderTextColor={T.creamFaint}
            autoFocus
          />
          <FlatList
            data={results}
            keyExtractor={i => i.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.resultRow}
                onPress={() => selectNeighborhood(item)}
              >
                <Text style={s.resultName}>{item.name}</Text>
              </TouchableOpacity>
            )}
            style={{ marginTop: 8 }}
          />
          {results.length === 0 && search.length >= 2 && (
            <Text style={s.noResults}>No neighborhoods found. Try a municipality name.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 28, paddingTop: 32, backgroundColor: T.bg },
  title: { color: T.cream, fontSize: 24, fontWeight: "600", marginBottom: 10 },
  sub: { color: T.creamDim, fontSize: 14, lineHeight: 22, marginBottom: 28 },
  detecting: { flexDirection: "row", alignItems: "center", gap: 12, padding: 20 },
  detectingText: { color: T.creamDim, fontSize: 14 },
  detected: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 20 },
  detectLabel: { color: T.creamDim, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  detectName: { color: T.cream, fontSize: 22, fontWeight: "600", marginBottom: 20 },
  detectActions: { gap: 10 },
  btnPrimary: { backgroundColor: T.amber, borderRadius: 10, padding: 14, alignItems: "center" },
  btnPrimaryText: { color: T.bg, fontSize: 15, fontWeight: "600" },
  btnSecondary: { padding: 14, alignItems: "center" },
  btnSecondaryText: { color: T.amberHi, fontSize: 14 },
  searchWrap: { flex: 1 },
  input: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 10, padding: 14, color: T.cream, fontSize: 15,
  },
  resultRow: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  resultName: { color: T.cream, fontSize: 15 },
  noResults: { color: T.creamDim, fontSize: 13, marginTop: 16, textAlign: "center" },
});
