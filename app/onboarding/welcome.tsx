import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { supabase, ConcernCard, Profile } from "../../lib/supabase";
import { T } from "../../lib/theme";
import ConcernCardItem from "../../components/ConcernCardItem";

export default function OnboardingWelcome() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cards, setCards] = useState<ConcernCard[]>([]);
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

      if (p?.neighborhood_id) {
        const { data: scores } = await supabase
          .from("neighborhood_scores")
          .select("concern_card_id, relevance_score")
          .eq("neighborhood_id", p.neighborhood_id)
          .gte("relevance_score", 0.65)
          .order("relevance_score", { ascending: false })
          .limit(3);

        if (scores?.length) {
          const ids = scores.map(s => s.concern_card_id);
          const { data: cc } = await supabase
            .from("concern_cards")
            .select("*")
            .in("id", ids)
            .order("created_at", { ascending: false });
          setCards(cc || []);
        }
      }

      // Mark first session complete
      await supabase.from("profiles").update({
        onboarded: true,
        first_session_completed_at: new Date().toISOString(),
        last_session_at: new Date().toISOString(),
      }).eq("id", user.id);

      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Text style={s.welcome}>
        Welcome to{" "}
        <Text style={{ color: T.amberHi, fontStyle: "italic" }}>
          {profile?.neighborhood || "your neighborhood"}.
        </Text>
      </Text>
      <Text style={s.sub}>
        This isn't a feed to scroll — it's your council's real decisions in plain English, the
        official record quoted first. Follow any item and we'll tell you when it moves. Verified
        neighbors only; your vote is never tied to your name.
      </Text>

      {cards.length > 0 && (
        <>
          <Text style={s.sectionLabel}>Happening in your neighborhood now</Text>
          {cards.map(card => (
            <ConcernCardItem key={card.id} card={card} onPress={() =>
              router.push({ pathname: "/card/[id]", params: { id: card.id } })
            } />
          ))}
          <Text style={s.hint}>Tap any card to follow it. You'll be told what happens next.</Text>
        </>
      )}

      <TouchableOpacity style={s.btn} onPress={() => router.replace("/tabs/feed")}>
        <Text style={s.btnText}>Go to my neighborhood feed</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 24, paddingTop: 60, backgroundColor: T.bg },
  welcome: { color: T.cream, fontSize: 28, fontWeight: "600", lineHeight: 36, marginBottom: 14 },
  sub: { color: T.creamDim, fontSize: 14, lineHeight: 22, marginBottom: 28 },
  sectionLabel: {
    color: T.amberHi, fontSize: 11, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 12,
  },
  hint: { color: T.creamDim, fontSize: 13, fontStyle: "italic", marginTop: 12, marginBottom: 24 },
  btn: {
    backgroundColor: T.amber, borderRadius: 10, padding: 16,
    alignItems: "center", marginTop: "auto",
  },
  btnText: { color: T.bg, fontSize: 15, fontWeight: "600" },
});
