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
      // try/finally, not bare returns. `loading` gates this entire screen
      // on an ActivityIndicator with no retry, no message and no timeout,
      // so any early return or throw below stranded the resident on a
      // permanent spinner at the LAST step of onboarding — the only escape
      // being to kill the app, after which index.tsx sends them back to the
      // start. zk-proof.tsx documents fixing this exact shape in its own
      // handler; this screen has the same defect and was not covered.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          // getUser() is a network round-trip, and it returns null on an expired
          // refresh token — a realistic state at the end of onboarding on a
          // phone that just moved between networks. A bare return here left
          // `loading` true forever.
          router.replace("/auth/login");
          return;
        }

        const { data: p } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        setProfile(p);

        if (p?.neighborhood_id) {
          // CQ-MOB-1: neighborhood_scores.neighborhood_id is a text slug
          // ("jackson-general"), not the profiles uuid — resolve it first,
          // matching feed.tsx's hoodSlug pattern.
          const { data: hood } = await supabase
            .from("neighborhoods")
            .select("slug")
            .eq("id", p.neighborhood_id)
            .maybeSingle();

          const { data: scores } = hood?.slug
            ? await supabase
                .from("neighborhood_scores")
                .select("concern_card_id, relevance_score")
                .eq("neighborhood_id", hood.slug)
                .gte("relevance_score", 0.65)
                .order("relevance_score", { ascending: false })
                .limit(3)
            : { data: null };

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

        // Never stamp onboarded without a neighborhood. index.tsx routes on the
        // two together, so a stamp over a null neighborhood_id is what locked a
        // resident into /tabs/feed permanently: the posts query's .eq() is
        // skipped and every neighborhood's posts are served, because
        // posts_public_read gates on removed_at only and never scopes by
        // neighborhood — that .eq() is the whole of it. town_feed then returns
        // its honest-empty branch, and /api/civic-feed falls back to its
        // jackson-general default. Send them back to the one screen that fixes
        // it instead; it takes no params and re-detects location on mount.
        if (!p?.neighborhood_id) {
          router.replace("/onboarding/neighborhood");
          return;
        }

        // Mark first session complete. This stamp is why /tabs/feed is sent
        // ?arrival=1 below: the feed derives "first session" from
        // first_session_completed_at, and this write lands BEFORE the resident
        // ever reaches the feed — so without the param the arrival experience
        // is dead on the one session it exists for.
        // upsert, not update — see neighborhood.tsx: a missing profiles row
        // must not silently no-op the onboarding completion.
        const { error: stampErr } = await supabase.from("profiles").upsert({
          id: user.id,
          onboarded: true,
          first_session_completed_at: new Date().toISOString(),
          last_session_at: new Date().toISOString(),
        });
        // Logged, not blocking. The neighborhood is already saved, so the wrong
        // -town failure above cannot happen here; the cost of a failed stamp is
        // that index.tsx sends them through onboarding once more on next launch,
        // which is recoverable. Stranding them on this screen would not be.
        if (stampErr) console.warn("[welcome] onboarded stamp failed:", stampErr.message);

      } finally {
        setLoading(false);
      }
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

      <TouchableOpacity style={s.btn} onPress={() => router.replace("/tabs/feed?arrival=1")}>
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
