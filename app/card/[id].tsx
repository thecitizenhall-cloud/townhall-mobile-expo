import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking, Alert,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase, ConcernCard } from "../../lib/supabase";
import { T } from "../../lib/theme";

export default function ConcernCardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<ConcernCard | null>(null);
  const [isWatched, setIsWatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [watchLoading, setWatchLoading] = useState(false);
  const [localContext, setLocalContext] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("concern_cards")
        .select("*")
        .eq("id", id)
        .single();
      setCard(c);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: watch } = await supabase
          .from("card_watches")
          .select("id")
          .eq("user_id", user.id)
          .eq("concern_card_id", id)
          .maybeSingle();
        setIsWatched(!!watch);

        // Get local context for this card from neighborhood_scores
        const { data: p } = await supabase
          .from("profiles")
          .select("neighborhood_id")
          .eq("id", user.id)
          .single();

        if (p?.neighborhood_id) {
          const { data: score } = await supabase
            .from("neighborhood_scores")
            .select("local_context")
            .eq("concern_card_id", id)
            .eq("neighborhood_id", p.neighborhood_id)
            .maybeSingle();
          setLocalContext(score?.local_context ?? null);
        }
      }

      setLoading(false);
    })();
  }, [id]);

  async function toggleWatch() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setWatchLoading(true);
    if (isWatched) {
      await supabase.from("card_watches")
        .delete()
        .eq("user_id", user.id)
        .eq("concern_card_id", id);
      setIsWatched(false);
    } else {
      const { error } = await supabase.from("card_watches")
        .insert({ user_id: user.id, concern_card_id: id, watched_at: new Date().toISOString() });
      if (!error) setIsWatched(true);
    }
    setWatchLoading(false);
  }

  if (loading || !card) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      {card.source_label && (
        <Text style={s.source}>{card.source_label}</Text>
      )}

      <Text style={s.title}>{card.title}</Text>

      {card.outcome_signal && (
        <View style={s.outcomeBanner}>
          <Text style={s.outcomeLabel}>Outcome</Text>
          <Text style={s.outcomeText}>{card.outcome_signal}</Text>
        </View>
      )}

      {card.quote && (
        <View style={s.quoteBlock}>
          <Text style={s.quoteText}>"{card.quote}"</Text>
        </View>
      )}

      {localContext && (
        <View style={s.contextBlock}>
          <Text style={s.contextLabel}>Why this matters to your neighborhood</Text>
          <Text style={s.contextText}>{localContext}</Text>
        </View>
      )}

      <Text style={s.body}>{card.body}</Text>

      {card.source_url && (
        <TouchableOpacity onPress={() => Linking.openURL(card.source_url!)}>
          <Text style={s.sourceLink}>View source document</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.watchBtn, isWatched && s.watchBtnActive]}
        onPress={toggleWatch}
        disabled={watchLoading}
      >
        {watchLoading
          ? <ActivityIndicator color={isWatched ? T.bg : T.amber} />
          : (
            <Text style={[s.watchBtnText, isWatched && s.watchBtnTextActive]}>
              {isWatched ? "Following — tap to unfollow" : "Follow this issue"}
            </Text>
          )}
      </TouchableOpacity>

      {!isWatched && (
        <Text style={s.watchHint}>
          You'll be notified if the outcome changes or a meeting addresses this.
        </Text>
      )}

      <Text style={s.datestamp}>
        {new Date(card.created_at).toLocaleDateString("en-US", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        })}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 20, paddingBottom: 60 },
  source: { color: T.amber, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10 },
  title: { color: T.cream, fontSize: 22, fontWeight: "600", lineHeight: 30, marginBottom: 16 },
  outcomeBanner: {
    backgroundColor: T.tealLo, borderWidth: 1, borderColor: T.teal,
    borderRadius: 10, padding: 14, marginBottom: 16,
  },
  outcomeLabel: { color: T.teal, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 },
  outcomeText: { color: T.cream, fontSize: 14 },
  quoteBlock: {
    borderLeftWidth: 3, borderLeftColor: T.amberMid,
    paddingLeft: 14, marginBottom: 16,
  },
  quoteText: { color: T.creamDim, fontSize: 14, lineHeight: 22, fontStyle: "italic" },
  contextBlock: {
    backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid,
    borderRadius: 10, padding: 14, marginBottom: 16,
  },
  contextLabel: { color: T.amberHi, fontSize: 11, fontWeight: "600", textTransform: "uppercase", marginBottom: 6 },
  contextText: { color: T.cream, fontSize: 13, lineHeight: 20 },
  body: { color: T.creamDim, fontSize: 14, lineHeight: 24, marginBottom: 20 },
  sourceLink: { color: T.amberHi, fontSize: 13, textDecorationLine: "underline", marginBottom: 24 },
  watchBtn: {
    borderWidth: 1.5, borderColor: T.amber,
    borderRadius: 10, padding: 14, alignItems: "center", marginBottom: 10,
  },
  watchBtnActive: { backgroundColor: T.amber },
  watchBtnText: { color: T.amberHi, fontSize: 14, fontWeight: "600" },
  watchBtnTextActive: { color: T.bg },
  watchHint: { color: T.creamFaint, fontSize: 12, textAlign: "center", marginBottom: 24 },
  datestamp: { color: T.creamFaint, fontSize: 12, marginTop: 12 },
});
