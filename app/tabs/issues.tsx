import { useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Pressable,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import { getWeeklyActivity, WeeklyActivity } from "../../lib/concernCards";
import { T } from "../../lib/theme";
import ConcernCardItem from "../../components/ConcernCardItem";

const STATUS_META: Record<string, { bg: string; color: string; label: string }> = {
  open: { bg: T.blueLo, color: T.blueHi, label: "Open" },
  escalated: { bg: T.amberLo, color: T.amberHi, label: "Escalated" },
  expert: { bg: T.purpleLo, color: T.purpleHi, label: "Expert review" },
  resolved: { bg: "#1A2A1A", color: T.tealHi, label: "Resolved" },
};

// Civic-engine concern-card outcome signals (analyzer PASS1). Used to render a
// watched card's outcome when it returns to the resident on "Since last visit".
const OUTCOME_LABEL: Record<string, string> = {
  pending: "Pending", introduced: "Introduced", deferred: "Deferred",
  approved: "Approved", denied: "Denied",
};

// A single issue row, reused across the "following", "since last visit", and
// "neighborhood" sections. `highlight` draws the amber since-last-visit border.
function IssueRow({ issue, highlight, updated, onPress }: { issue: any; highlight?: boolean; updated?: boolean; onPress: () => void }) {
  const sm = STATUS_META[issue.status] || STATUS_META.open;
  return (
    <Pressable style={[s.issue, highlight && s.issueHighlight]} onPress={onPress}>
      <Text style={s.issueTitle}>{issue.title}</Text>
      <View style={s.issueRow}>
        <Text style={[s.statusPill, { backgroundColor: sm.bg, color: sm.color, borderColor: sm.color }]}>{sm.label}</Text>
        {updated ? (
          <Text style={s.updated}>Updated</Text>
        ) : (
          <Text style={s.voteMeta}>{issue.voice_count || 0} vote{(issue.voice_count || 0) === 1 ? "" : "s"} from verified residents</Text>
        )}
      </View>
      {issue.official_response ? (
        <View style={s.responseInd}>
          <Text style={s.responseIndText}>✓ Official response received</Text>
        </View>
      ) : (
        <View style={s.noResponse}>
          <View style={s.pulse} />
          <Text style={s.noResponseText}>Awaiting official response</Text>
        </View>
      )}
    </Pressable>
  );
}

// A watched CONCERN CARD whose outcome flipped since last visit — the automated
// civic-engine round trip's "return" leg (parity with web YourIssuesScreen).
function MovedCardRow({ card, onPress }: { card: any; onPress: () => void }) {
  const now = OUTCOME_LABEL[card.outcome_signal as string] || card.outcome_signal || "Updated";
  const when = card.outcome_changed_at
    // outcome_changed_at is a UTC-midnight date; format in UTC so it doesn't
    // slip a day earlier in western timezones.
    ? new Date(card.outcome_changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : null;
  return (
    <Pressable style={[s.issue, s.issueHighlight]} onPress={onPress}>
      <Text style={s.issueTitle}>{card.title}</Text>
      <View style={s.issueRow}>
        <Text style={[s.statusPill, { backgroundColor: T.amberLo, color: T.amberHi, borderColor: T.amberMid }]}>
          Outcome: {now}
        </Text>
        <Text style={s.updated}>{when ? `Decided ${when}` : "Outcome changed"}</Text>
      </View>
      {card.source_quote ? <Text style={s.cardQuote}>“{card.source_quote}”</Text> : null}
    </Pressable>
  );
}

export default function YourIssuesScreen() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [myVotes, setMyVotes] = useState<any[]>([]);
  const [neighborhoodIssues, setNeighborhoodIssues] = useState<any[]>([]);
  const [watchedIssues, setWatchedIssues] = useState<any[]>([]);
  const [sinceLastVisit, setSinceLastVisit] = useState<any[]>([]);
  const [sinceLastVisitCards, setSinceLastVisitCards] = useState<any[]>([]);
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivity | null>(null);
  const [concernCards, setConcernCards] = useState<any[]>([]);
  const [cardsAreFallback, setCardsAreFallback] = useState(false);

  // Reload on focus so follows/votes made elsewhere show without a manual pull.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      load(focusedOnce.current);
      focusedOnce.current = true;
    }, [])
  );

  async function load(refresh = false) {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const u = await getCurrentUser();  // local read; no getUser network round-trip on mount
      if (!u) { setLoading(false); setRefreshing(false); return; }
      setUser(u);

      const { data: posts } = await supabase.from("posts")
        .select("*, civic_issues(id, title, status, official_response, voice_count, priority_pct)")
        .eq("author_id", u.id).order("created_at", { ascending: false }).limit(50);
      setMyPosts(posts || []);

      const { data: votes } = await supabase.from("votes")
        .select("*, civic_issues(id, title, status, official_response, voice_count, priority_pct, source_label, created_at, updated_at)")
        .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
      setMyVotes(votes || []);

      const { data: prof } = await supabase.from("profiles")
        .select("neighborhood_id, previous_session_at").eq("id", u.id).maybeSingle();

      if (prof?.neighborhood_id) {
        const { data: nbhdIssues } = await supabase.from("civic_issues")
          .select("*").eq("neighborhood_id", prof.neighborhood_id).is("removed_at", null).order("voice_count", { ascending: false }).limit(5);
        setNeighborhoodIssues(nbhdIssues || []);
      }

      const { data: watched } = await supabase.from("watched_concern_cards")
        .select("*, civic_issues(*)").eq("user_id", u.id).not("issue_id", "is", null).order("watched_at", { ascending: false });
      setWatchedIssues((watched || []).map((w: any) => w.civic_issues).filter(Boolean));

      // Watched concern cards — two-step to avoid RLS join issues.
      const { data: cardWatches } = await supabase.from("card_watches")
        .select("concern_card_id, created_at").eq("user_id", u.id).order("created_at", { ascending: false });
      let watchedCardData: any[] = [];
      if (cardWatches?.length) {
        const { data: cards } = await supabase.from("concern_cards")
          .select("*").in("id", cardWatches.map((w: any) => w.concern_card_id)).eq("archived", false).is("removed_at", null);
        watchedCardData = cards || [];
        if (watchedCardData.length) { setConcernCards(watchedCardData); setCardsAreFallback(false); }
      }
      if (prof?.neighborhood_id && !watchedCardData.length) {
        const { data: hoodData } = await supabase.from("neighborhoods").select("slug").eq("id", prof.neighborhood_id).maybeSingle();
        if (hoodData?.slug) {
          const { data: scored } = await supabase.from("neighborhood_scores")
            .select("relevance_score, concern_cards(*)").eq("neighborhood_id", hoodData.slug)
            .eq("concern_cards.surfaces_to_feed", true).eq("concern_cards.archived", false)
            .order("relevance_score", { ascending: false }).limit(5);
          const topCards = (scored || []).map((ns: any) => ns.concern_cards).filter(Boolean);
          if (topCards.length) { setConcernCards(topCards); setCardsAreFallback(true); }
        }
      }

      setWeeklyActivity(await getWeeklyActivity(u.id));

      // Since-last-visit changes, diffed against previous_session_at.
      const watchedIssueIds = (watched || []).map((w: any) => w.issue_id).filter(Boolean);
      if (prof?.previous_session_at) {
        if (watchedIssueIds.length) {
          const { data: changed } = await supabase.from("civic_issues")
            .select("*").gt("updated_at", prof.previous_session_at).in("id", watchedIssueIds);
          setSinceLastVisit(changed || []);
        }
        // Watched CONCERN CARDS whose outcome flipped since last visit — the
        // automated civic-engine round trip's "return" leg. The engine stamps
        // outcome_changed_at when outcome_signal changes; surface it here so the
        // outcome actually comes back to the resident. (card_watches — separate
        // from the watched_concern_cards/civic_issues path above.)
        const base = new Date(prof.previous_session_at).getTime();
        const movedCards = (watchedCardData || []).filter((c: any) =>
          c.outcome_changed_at && new Date(c.outcome_changed_at).getTime() > base
        );
        setSinceLastVisitCards(movedCards);
      }
    } catch (e) {
      console.error("YourIssues load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const onRefresh = useCallback(() => load(true), []);
  const openIssue = (id: string) => router.push({ pathname: "/issue/[id]", params: { id } });
  const openCard = (id: string) => router.push({ pathname: "/card/[id]", params: { id } });

  const myEscalated = myPosts.filter((p) => p.escalated && p.civic_issues);
  const hasAnything =
    concernCards.length > 0 || watchedIssues.length > 0 || myVotes.length > 0 || myEscalated.length > 0 || sinceLastVisit.length > 0 || sinceLastVisitCards.length > 0;
  const wa = weeklyActivity;
  const showActivity = wa && (wa.cardsRead > 0 || wa.votesCast > 0 || wa.itemsWatched > 0 || wa.responsesReceived > 0);

  if (loading) {
    return <View style={[s.root, s.center]}><ActivityIndicator color={T.amber} /></View>;
  }

  return (
    <FlatList
      style={s.root}
      contentContainerStyle={s.content}
      data={[]}
      renderItem={null}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.amber} />}
      ListHeaderComponent={
        <View>
          <Text style={s.title}>Your Issues</Text>
          <Text style={s.sub}>Everything you're following, across all levels.</Text>

          {!hasAnything ? (
            <View>
              {neighborhoodIssues.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>Happening in your neighborhood</Text>
                  {neighborhoodIssues.map((iss) => <IssueRow key={iss.id} issue={iss} onPress={() => openIssue(iss.id)} />)}
                </>
              )}
              <View style={s.empty}>
                <Text style={s.emptyIcon}>🏛</Text>
                <Text style={s.emptyText}>
                  My civic record starts here — votes, issues I've raised, and official responses appear on this screen.
                </Text>
                <Text style={s.emptySub}>
                  Council items you can follow are waiting in your Town feed. Follow an item and you'll be notified when it moves.
                </Text>
              </View>
            </View>
          ) : (
            <>
              {showActivity && (
                <View style={s.activity}>
                  <Text style={s.activityHead}>This week</Text>
                  <View style={s.activityRow}>
                    {wa!.cardsRead > 0 && <Text style={s.activityStat}>{wa!.cardsRead} card{wa!.cardsRead !== 1 ? "s" : ""} read</Text>}
                    {wa!.itemsWatched > 0 && <Text style={s.activityStat}>{wa!.itemsWatched} item{wa!.itemsWatched !== 1 ? "s" : ""} followed</Text>}
                    {wa!.votesCast > 0 && <Text style={s.activityStat}>{wa!.votesCast} vote{wa!.votesCast !== 1 ? "s" : ""} cast</Text>}
                    {wa!.responsesReceived > 0 && <Text style={[s.activityStat, { color: T.tealHi }]}>{wa!.responsesReceived} response{wa!.responsesReceived !== 1 ? "s" : ""} received</Text>}
                  </View>
                </View>
              )}

              {(sinceLastVisit.length > 0 || sinceLastVisitCards.length > 0) && (
                <>
                  <Text style={[s.sectionLabel, { color: T.amberHi }]}>New since your last visit</Text>
                  {sinceLastVisitCards.map((card) => <MovedCardRow key={"card-" + card.id} card={card} onPress={() => openCard(card.id)} />)}
                  {sinceLastVisit.map((iss) => <IssueRow key={iss.id} issue={iss} highlight updated onPress={() => openIssue(iss.id)} />)}
                </>
              )}

              {concernCards.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>{cardsAreFallback ? "Relevant in your neighborhood" : "Following from council"}</Text>
                  {concernCards.map((card) => (
                    <ConcernCardItem key={card.id} card={card} onPress={() => openCard(card.id)} />
                  ))}
                </>
              )}

              {watchedIssues.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>Following · {watchedIssues.length}</Text>
                  {watchedIssues.map((iss) => <IssueRow key={iss.id} issue={iss} onPress={() => openIssue(iss.id)} />)}
                </>
              )}

              {myVotes.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>Issues you prioritized · {myVotes.length}</Text>
                  {myVotes.map((v) => v.civic_issues ? <IssueRow key={v.id} issue={v.civic_issues} onPress={() => openIssue(v.civic_issues.id)} /> : null)}
                </>
              )}

              {myEscalated.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>Issues you raised · {myEscalated.length}</Text>
                  {myEscalated.map((p) => <IssueRow key={p.id} issue={p.civic_issues} onPress={() => openIssue(p.civic_issues.id)} />)}
                </>
              )}
            </>
          )}
        </View>
      }
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: "center", alignItems: "center" },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: T.cream, fontSize: 22, fontWeight: "600", marginBottom: 4 },
  sub: { color: T.creamDim, fontSize: 13, marginBottom: 20 },
  sectionLabel: { color: T.amberHi, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.9, marginTop: 18, marginBottom: 10 },

  activity: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border, marginBottom: 4 },
  activityHead: { fontSize: 10, color: T.creamFaint, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  activityRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  activityStat: { fontSize: 12, color: T.creamDim },

  issue: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  issueHighlight: { borderLeftWidth: 3, borderLeftColor: T.amber },
  issueTitle: { color: T.cream, fontSize: 15, fontWeight: "500", lineHeight: 21 },
  issueRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  statusPill: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99, fontSize: 10, fontWeight: "500", borderWidth: 1, overflow: "hidden" },
  voteMeta: { fontSize: 10, color: T.creamFaint },
  updated: { fontSize: 10, color: T.amberHi, fontWeight: "500" },
  cardQuote: { color: T.creamDim, fontSize: 12, fontStyle: "italic", marginTop: 8, borderLeftWidth: 2, borderLeftColor: T.border, paddingLeft: 10, lineHeight: 18 },
  responseInd: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  responseIndText: { fontSize: 12, color: T.tealHi, fontWeight: "600" },
  noResponse: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  pulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.amberHi },
  noResponseText: { fontSize: 12, color: T.creamFaint },

  empty: { paddingVertical: 40, alignItems: "center" },
  emptyIcon: { fontSize: 28, marginBottom: 12 },
  emptyText: { color: T.creamDim, fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: 10 },
  emptySub: { color: T.creamFaint, fontSize: 12, textAlign: "center", lineHeight: 20 },
});
