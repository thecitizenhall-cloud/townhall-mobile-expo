import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { supabase, Profile } from "../../lib/supabase";
import { T } from "../../lib/theme";

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      setProfile(p);

      const { data: proof } = await supabase
        .from("residency_proofs")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      setVerified(!!proof);

      setLoading(false);
    })();
  }, []);

  async function handleSignOut() {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/auth/login");
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.identityCard}>
        <View style={s.avatar}>
          <Text style={s.avatarLetter}>
            {profile?.display_name?.[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={s.displayName}>{profile?.display_name ?? "Resident"}</Text>
        {profile?.neighborhood && (
          <Text style={s.neighborhood}>{profile.neighborhood}</Text>
        )}
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>Residency</Text>
        <View style={s.statusRow}>
          <View style={[s.dot, { backgroundColor: verified ? T.teal : T.creamFaint }]} />
          <Text style={s.statusText}>
            {verified ? "Verified resident (ZK proof on file)" : "Not yet verified"}
          </Text>
        </View>
        {!verified && (
          <TouchableOpacity
            style={s.verifyBtn}
            onPress={() =>
              router.push({
                pathname: "/onboarding/zk-proof",
                params: {
                  neighborhoodId: profile?.neighborhood_id ?? "",
                  neighborhoodName: profile?.neighborhood ?? "",
                  municipalityId: "",
                  lat: "",
                  lng: "",
                },
              })
            }
          >
            <Text style={s.verifyBtnText}>Verify residency</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>Notifications</Text>
        <Text style={s.notifNote}>
          Townhall notifies you only when something civically real is happening: a round trip
          closes, a meeting affecting you is imminent, or something you're watching moves.
        </Text>
      </View>

      <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
        <Text style={s.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 20, paddingBottom: 60 },
  identityCard: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 24,
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: T.amberLo, borderWidth: 2, borderColor: T.amber,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  avatarLetter: { color: T.amberHi, fontSize: 24, fontWeight: "700" },
  displayName: { color: T.cream, fontSize: 20, fontWeight: "600" },
  neighborhood: { color: T.creamDim, fontSize: 13, marginTop: 4 },
  section: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: 18, marginBottom: 14,
  },
  sectionLabel: {
    color: T.amberHi, fontSize: 11, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: T.cream, fontSize: 14 },
  verifyBtn: {
    marginTop: 14, backgroundColor: T.amber,
    borderRadius: 10, padding: 12, alignItems: "center",
  },
  verifyBtnText: { color: T.bg, fontWeight: "600", fontSize: 14 },
  notifNote: { color: T.creamDim, fontSize: 13, lineHeight: 20 },
  signOutBtn: {
    marginTop: 24, borderWidth: 1, borderColor: T.border,
    borderRadius: 10, padding: 14, alignItems: "center",
  },
  signOutText: { color: T.creamDim, fontSize: 14 },
});
