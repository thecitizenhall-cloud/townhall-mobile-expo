import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { T } from "../../lib/theme";
import ConcernCardItem from "../../components/ConcernCardItem";

type FeedItem =
  | { type: "concern_card"; data: any }
  | { type: "civic_issue"; data: any }
  | { type: "post"; data: any };

export default function FeedScreen() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [isFirstSession, setIsFirstSession] = useState(false);

  useEffect(() => { loadFeed(); }, []);

  async function loadFeed(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      setProfile(p);

      const firstTime = !p?.first_session_completed_at;
      setIsFirstSession(firstTime);

      // Fetch concern cards for neighborhood
      let cardQuery = supabase
        .from("concern_cards")
        .select("*, neighborhood_scores!inner(relevance_score, neighborhood_id)")
        .gte("neighborhood_scores.relevance_score", 0.65)
        .order("created_at", { ascending: false })
        .limit(20);

      if (p?.neighborhood_id) {
        cardQuery = cardQuery.eq("neighborhood_scores.neighborhood_id", p.neighborhood_id);
      }

      const { data: cards } = await cardQuery;

      // Fetch recent civic posts
      const { data: posts } = await supabase
        .from("posts")
        .select("*")
        .is("removed_at", null)
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(10);

      const combined: FeedItem[] = [
        ...(cards || []).map(c => ({ type: "concern_card" as const, data: c })),
        ...(posts || []).map(p => ({ type: "post" as const, data: p })),
      ].sort((a, b) =>
        new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime()
      );

      setItems(combined);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const onRefresh = useCallback(() => loadFeed(true), []);

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }

  return (
    <FlatList
      style={s.root}
      contentContainerStyle={s.content}
      data={items}
      keyExtractor={(item, i) => `${item.type}-${item.data.id ?? i}`}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={T.amber}
        />
      }
      ListHeaderComponent={
        <>
          {profile?.neighborhood && (
            <View style={s.header}>
              <Text style={s.headerNeighborhood}>{profile.neighborhood}</Text>
              <Text style={s.headerLabel}>Town feed</Text>
            </View>
          )}
          {isFirstSession && items.length > 0 && (
            <View style={s.firstTimeBanner}>
              <Text style={s.firstTimeBannerText}>
                Tap any card to follow it. You'll be told what happens next.
              </Text>
            </View>
          )}
        </>
      }
      renderItem={({ item }) => {
        if (item.type === "concern_card") {
          return (
            <ConcernCardItem
              card={item.data}
              onPress={() =>
                router.push({ pathname: "/card/[id]", params: { id: item.data.id } })
              }
            />
          );
        }
        if (item.type === "post") {
          return (
            <View style={s.postCard}>
              <Text style={s.postBody}>{item.data.body}</Text>
              <Text style={s.postMeta}>
                {new Date(item.data.created_at).toLocaleDateString()}
              </Text>
            </View>
          );
        }
        return null;
      }}
      ListEmptyComponent={
        <View style={s.empty}>
          <Text style={s.emptyText}>No items yet in your neighborhood feed.</Text>
        </View>
      }
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 20 },
  headerNeighborhood: { color: T.cream, fontSize: 22, fontWeight: "600" },
  headerLabel: { color: T.creamDim, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 },
  firstTimeBanner: {
    backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid,
    borderRadius: 10, padding: 14, marginBottom: 16,
  },
  firstTimeBannerText: { color: T.cream, fontSize: 13, lineHeight: 20, fontStyle: "italic" },
  postCard: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 12, padding: 16, marginBottom: 10,
  },
  postBody: { color: T.cream, fontSize: 14, lineHeight: 22 },
  postMeta: { color: T.creamFaint, fontSize: 11, marginTop: 8 },
  empty: { padding: 40, alignItems: "center" },
  emptyText: { color: T.creamDim, fontSize: 14, textAlign: "center" },
});
