import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { T } from "../../lib/theme";
import ConcernCardItem from "../../components/ConcernCardItem";

type WatchedCard = { id: string; concern_card_id: string; watched_at: string; card: any };
type WatchedIssue = { id: string; civic_issue_id: string; watched_at: string; issue: any };

export default function YourIssuesScreen() {
  const [watchedCards, setWatchedCards] = useState<WatchedCard[]>([]);
  const [watchedIssues, setWatchedIssues] = useState<WatchedIssue[]>([]);
  const [lastSession, setLastSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadIssues(); }, []);

  async function loadIssues(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: p } = await supabase
      .from("profiles")
      .select("last_session_at")
      .eq("id", user.id)
      .single();
    setLastSession(p?.last_session_at ?? null);

    // Watched concern cards
    const { data: cw } = await supabase
      .from("card_watches")
      .select("id, concern_card_id, watched_at, concern_cards(*)")
      .eq("user_id", user.id)
      .order("watched_at", { ascending: false });

    // Watched civic issues
    const { data: iw } = await supabase
      .from("watched_concern_cards")
      .select("id, civic_issue_id, watched_at, civic_issues(*)")
      .eq("user_id", user.id)
      .order("watched_at", { ascending: false });

    setWatchedCards(
      (cw || []).map(w => ({ ...w, card: (w as any).concern_cards }))
    );
    setWatchedIssues(
      (iw || []).map(w => ({ ...w, issue: (w as any).civic_issues }))
    );

    // Update last_session_at
    await supabase.from("profiles")
      .update({ last_session_at: new Date().toISOString() })
      .eq("id", user.id);

    setLoading(false);
    setRefreshing(false);
  }

  const onRefresh = useCallback(() => loadIssues(true), []);

  function isNew(item: { watched_at: string; data?: any }) {
    if (!lastSession) return false;
    const itemDate = item.watched_at || item.data?.updated_at;
    if (!itemDate) return false;
    return new Date(itemDate) > new Date(lastSession);
  }

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }

  const hasAny = watchedCards.length > 0 || watchedIssues.length > 0;

  return (
    <FlatList
      style={s.root}
      contentContainerStyle={s.content}
      data={[]}
      renderItem={null}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.amber} />
      }
      ListHeaderComponent={
        <>
          <Text style={s.title}>Your Issues</Text>
          <Text style={s.sub}>Everything you're following, across all levels.</Text>

          {!hasAny && (
            <View style={s.empty}>
              <Text style={s.emptyText}>
                You're not following anything yet.{"\n"}Go to the Town feed and tap a card to start.
              </Text>
            </View>
          )}

          {watchedCards.length > 0 && (
            <>
              <Text style={s.sectionLabel}>Concern cards</Text>
              {watchedCards.map(w => (
                <View key={w.id} style={[s.itemWrap, isNew(w) && s.newItem]}>
                  {isNew(w) && <Text style={s.newTag}>New</Text>}
                  {w.card && (
                    <ConcernCardItem
                      card={w.card}
                      onPress={() =>
                        router.push({ pathname: "/card/[id]", params: { id: w.concern_card_id } })
                      }
                    />
                  )}
                </View>
              ))}
            </>
          )}

          {watchedIssues.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>Civic issues</Text>
              {watchedIssues.map(w => (
                <TouchableOpacity
                  key={w.id}
                  style={[s.issueCard, isNew(w) && s.newItem]}
                  onPress={() =>
                    router.push({ pathname: "/issue/[id]", params: { id: w.civic_issue_id } })
                  }
                >
                  {isNew(w) && <Text style={s.newTag}>New</Text>}
                  {w.issue && (
                    <>
                      <Text style={s.issueBadge}>{w.issue.status?.toUpperCase()}</Text>
                      <Text style={s.issueTitle}>{w.issue.title}</Text>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </>
          )}
        </>
      }
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: T.cream, fontSize: 22, fontWeight: "600", marginBottom: 4 },
  sub: { color: T.creamDim, fontSize: 13, marginBottom: 24 },
  sectionLabel: {
    color: T.amberHi, fontSize: 11, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10,
  },
  itemWrap: { marginBottom: 2 },
  newItem: { borderLeftWidth: 3, borderLeftColor: T.amber, borderRadius: 2, paddingLeft: 4 },
  newTag: {
    color: T.amberHi, fontSize: 10, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
  },
  issueCard: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 12, padding: 16, marginBottom: 10,
  },
  issueBadge: {
    color: T.teal, fontSize: 10, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
  },
  issueTitle: { color: T.cream, fontSize: 15, fontWeight: "500" },
  empty: { paddingVertical: 48, alignItems: "center" },
  emptyText: { color: T.creamDim, fontSize: 14, textAlign: "center", lineHeight: 22 },
});
