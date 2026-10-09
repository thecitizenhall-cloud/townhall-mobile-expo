import { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ActivityIndicator, Alert,
  TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView,
} from "react-native";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { getMyDistrictId, setMyDistrictId } from "../../lib/district";
import { supabase } from "../../lib/supabase";
import { detectDistrict } from "../../lib/detectDistrict";
import { escapeLike } from "../../lib/escapeLike";
import { T } from "../../lib/theme";

// Live schema: neighborhoods keys off city_id (FK to cities). There is no
// municipality_id column on this table — that lives on neighborhood_scores.
// center_lat/center_lng power the residency fallback when GPS is unavailable.
type Neighborhood = {
  id: string;
  name: string;
  slug: string | null;
  city_id: string;
  center_lat: number | null;
  center_lng: number | null;
  city?: { name: string; state: string } | null;
};

const HOOD_COLUMNS = "id, name, slug, city_id, center_lat, center_lng";

// The town-wide "-general" neighborhood leads, as on web: it is the one the
// engine is guaranteed to score.
const generalFirst = (a: Neighborhood, b: Neighborhood) =>
  (b.slug?.endsWith("-general") ? 1 : 0) - (a.slug?.endsWith("-general") ? 1 : 0) ||
  a.name.localeCompare(b.name);

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
  const searchSeq = useRef(0);

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
      const addr = geo.address ?? {};
      const suburb = addr.suburb || addr.neighbourhood || addr.village;
      const cityName = addr.municipality || addr.city || addr.town || addr.township || addr.village || addr.hamlet;
      const stateCode = String(addr["ISO3166-2-lvl4"] ?? "").replace(/^US-/, "");

      // Both the name and the state, or nothing. This used to be
      // `%${city || town || ""}%` with no state and limit(1): an address with
      // neither field collapsed to `%%` and matched every city, and a resident
      // of Lakewood, CO could be offered Lakewood Township, NJ. Whole-name
      // case-insensitive equality (ilike with the wildcards escaped), because
      // `state` is stored as both "NJ" and "nj". No match means manual search.
      if (!cityName || !stateCode) return;
      const { data: cities } = await supabase
        .from("cities")
        .select("id")
        .ilike("name", escapeLike(cityName))
        .ilike("state", escapeLike(stateCode));

      // Every matching row, not the first: (name, state) is not unique in
      // `cities`, and only one of the duplicates may carry neighborhoods.
      if (cities && cities.length > 0) {
        const { data } = await supabase
          .from("neighborhoods")
          .select(HOOD_COLUMNS)
          .in("city_id", cities.map(c => c.id))
          .limit(50);
        const hoods = ((data || []) as Neighborhood[]).sort(generalFirst);

        if (hoods.length > 0) {
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
    const seq = ++searchSeq.current;
    if (q.trim().length < 2) { setResults([]); return; }
    // Only neighborhoods that belong to a city, which is all the web picker
    // ever offers (it loads by city_id). The table also holds the per-election-
    // district rows ("Jackson District 30", city_id null); unscoped, those
    // filled the eight slots and the result went straight into
    // profiles.neighborhood_id.
    const { data } = await supabase
      .from("neighborhoods")
      .select(`${HOOD_COLUMNS}, city:cities(name, state)`)
      .not("city_id", "is", null)
      .ilike("name", `%${escapeLike(q.trim())}%`)
      .order("name")
      .limit(20);
    // A slower response to an earlier keystroke must not replace a newer one.
    if (seq !== searchSeq.current) return;
    setResults(((data || []) as unknown as Neighborhood[]).sort(generalFirst));
  }

  async function selectNeighborhood(hood: Neighborhood) {
    setSaving(true);
    // try/finally, not a bare setSaving(false) before the navigation: the
    // primary button renders a spinner while `saving` and carries
    // disabled={saving}, so ANY early return or throw below used to strand the
    // resident on the first write of onboarding with a spinner that never
    // stopped, no message and no way to retry.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert("Session expired", "Please sign in again.");
        router.replace("/auth/login");
        return;
      }

      // B3: resolve the resident's election district LOCALLY from GPS (point-in-
      // polygon on device — location never sent out); store only the district id.
      let district_id: string | null = null;
      if (coords?.lat != null && coords?.lng != null) {
        try { district_id = (await detectDistrict(coords.lat, coords.lng))?.id ?? null; } catch {}
      }

      // upsert, not update: if the signup trigger ever failed to create the
      // profiles row, update() matches 0 rows silently and the resident bounces
      // back to onboarding forever (same footgun web's OnboardingScreen guards).
      // Read before the write below replaces it: a resident who is changing
      // neighborhood has a district that belongs to the old one.
      const { data: before } = await supabase.from("profiles")
        .select("neighborhood_id").eq("id", user.id).maybeSingle();
      const changedNeighborhood = !!before?.neighborhood_id && before.neighborhood_id !== hood.id;

      const { error: profileErr } = await supabase.from("profiles").upsert({
        id: user.id,
        neighborhood_id: hood.id,
        neighborhood: hood.name,
      });
      // Checked, not fire-and-forget. This write can fail on a flaky
      // connection, or on migration 055's enforce_neighborhood_change_cooldown
      // raising on the UPDATE arm when a resident re-enters via ?verify=1
      // within 30 days of a previous change. Unchecked, it carried the resident
      // to the next screen believing their town was set while neighborhood_id
      // stayed null — and welcome.tsx then stamped onboarded=true over it.
      // Web's OnboardingScreen.jsx stays put on this error; match it.
      if (profileErr) {
        Alert.alert("Couldn't save your neighborhood", profileErr.message);
        return;
      }
      // District goes to its own table (migration 106), never onto profiles —
      // profiles is anon-readable in full. Kept OUT of the upsert above so a
      // district failure can never take onboarding's neighborhood write with it.
      // Fill a MISSING district, or replace one left over from a different
      // neighborhood. Otherwise leave it: this fix is the phone's GPS position
      // and nothing has checked it yet, so it must not replace a district that
      // a residency proof has since confirmed (zk-proof.tsx writes that one).
      // It is still worth writing here: most residents only read, never
      // generate a proof, and would otherwise have no district at all. The
      // district only orders the feed; it gates nothing.
      try {
        if (district_id && (changedNeighborhood || !(await getMyDistrictId(user.id)))) {
          await setMyDistrictId(user.id, district_id);
        }
      } catch { /* best effort: never holds up onboarding */ }

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
          // cityId, not municipalityId: this is neighborhoods.city_id, a uuid FK
          // to cities. The engine's municipality_id is a TEXT key ("jackson_nj")
          // that lives on neighborhood_scores / concern_cards. A uuid in a slot
          // named municipality_id matches zero rows instead of erroring — if a
          // real one is ever wanted here, derive it from the neighborhood slug
          // prefix the way tabs/feed.tsx and pages/api/civic-feed.js do.
          cityId: hood.city_id,
          // Fallback chain mirrors web: real GPS → neighborhood center → Jackson.
          // A proof built on the neighborhood center still verifies (the center is
          // inside the boundary) — fine for town-level residency when GPS is denied.
          // Whether lat/lng below are a real GPS fix rather than a fallback
          // centre. Only a real fix may be used to set a district.
          gps: coords ? "1" : "0",
          lat: (coords?.lat ?? hood.center_lat ?? JACKSON_LAT).toString(),
          lng: (coords?.lng ?? hood.center_lng ?? JACKSON_LNG).toString(),
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    // The search field sits at the top so it is never covered itself, but the
    // results list below it ran under the keyboard with no way to reach the
    // lower rows. Padding ends the list above the keyboard instead.
    <KeyboardAvoidingView style={s.root} behavior="padding">
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
                {item.city ? (
                  <Text style={s.resultCity}>{item.city.name}, {item.city.state.toUpperCase()}</Text>
                ) : null}
              </TouchableOpacity>
            )}
            style={{ marginTop: 8 }}
          />
          {results.length === 0 && search.length >= 2 && (
            <Text style={s.noResults}>No neighborhoods found. Try a municipality name.</Text>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
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
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.borderCtl,
    borderRadius: 10, padding: 14, color: T.cream, fontSize: 15,
  },
  resultRow: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  resultName: { color: T.cream, fontSize: 15 },
  resultCity: { color: T.creamDim, fontSize: 12, marginTop: 3 },
  noResults: { color: T.creamDim, fontSize: 13, marginTop: 16, textAlign: "center" },
});
