import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator,
  TouchableOpacity, Pressable, TextInput, Alert, ScrollView,
} from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Location from "expo-location";
import { supabase, CivicItem } from "../../lib/supabase";
import { hasResidencyProof, goVerify } from "../../lib/residency";
import { T } from "../../lib/theme";
import { SITE_URL } from "../../lib/config";
import CivicFeedItem from "../../components/CivicFeedItem";
import PostCard from "../../components/PostCard";

// The civic feed is aggregated server-side by the web app's /api/civic-feed route
// (concern cards + SeeClickFix + agendas + township news + NOAA), so both clients
// share one source list. Resident posts and civic issues are read from Supabase.

const TAGS: Record<string, { bg: string; color: string; border: string }> = {
  banter: { bg: "#2A1E08", color: "#F0B84A", border: "#8C5E14" },
  issue: { bg: "#0D1E35", color: "#85B7EB", border: "#185FA5" },
  question: { bg: "#0A2A1E", color: "#4CAF80", border: "#1D9E75" },
  bulletin: { bg: "#1A1835", color: "#AFA9EC", border: "#534AB7" },
};

const REPORT_TYPES = [
  { key: "pothole", label: "Pothole", icon: "🕳️" },
  { key: "road_closure", label: "Road closed", icon: "🚧" },
  { key: "streetlight", label: "Broken light", icon: "💡" },
  { key: "drainage", label: "Drainage/flood", icon: "🌊" },
  { key: "dumping", label: "Illegal dumping", icon: "🗑️" },
  { key: "sign", label: "Missing sign", icon: "🪧" },
  { key: "graffiti", label: "Graffiti", icon: "🖊️" },
  { key: "other", label: "Other", icon: "📍" },
];

type FeedItem =
  | { type: "civic"; data: CivicItem }
  | { type: "post"; data: any };

export default function FeedScreen() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [civic, setCivic] = useState<CivicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isFirstSession, setIsFirstSession] = useState(false);
  const [verified, setVerified] = useState(true);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [watchLoading, setWatchLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "issue" | "banter" | "escalated" | "bulletin">("all");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<any>(null);

  // Compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTag, setDraftTag] = useState("banter");
  const [posting, setPosting] = useState(false);

  // Report
  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState("pothole");
  const [reportDesc, setReportDesc] = useState("");
  const [reportLoc, setReportLoc] = useState("");
  const [reportCoords, setReportCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [reporting, setReporting] = useState(false);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => { loadFeed(); /* eslint-disable-next-line */ }, []);

  // Realtime new posts.
  useEffect(() => {
    const channel = supabase
      .channel("feed-posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, async (payload: any) => {
        const { data } = await supabase.from("posts").select("*, profiles(display_name,neighborhood,is_bot)").eq("id", payload.new.id).maybeSingle();
        if (data) setPosts((prev) => (prev.some((p) => p.id === data.id) ? prev : [data, ...prev]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "posts" }, (payload: any) => {
        setPosts((prev) => prev.map((p) => (p.id === payload.new.id ? { ...p, ...payload.new } : p)));
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, []);

  async function loadFeed(refresh = false) {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      if (!user) { setLoading(false); setRefreshing(false); return; }

      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p);
      setIsFirstSession(!p?.first_session_completed_at);
      setVerified(await hasResidencyProof(user.id));

      // Aggregated civic items from the shared web route (concern cards, bulletins…).
      let civicItems: CivicItem[] = [];
      try {
        const qs = new URLSearchParams();
        if (p?.neighborhood_id) qs.set("neighborhood_id", p.neighborhood_id);
        const res = await fetch(`${SITE_URL}/api/civic-feed?${qs.toString()}`);
        if (res.ok) civicItems = (await res.json()).items ?? [];
      } catch { /* degrade to posts-only */ }
      setCivic(civicItems);

      // Resident posts (with author profile), scoped to the neighborhood.
      let postQ = supabase.from("posts")
        .select("*, profiles(display_name,neighborhood,is_bot,is_official)")
        .is("removed_at", null).is("hidden_at", null)
        .order("created_at", { ascending: false }).limit(50);
      if (p?.neighborhood_id) postQ = postQ.eq("neighborhood_id", p.neighborhood_id);
      const { data: postRows } = await postQ;
      let withVotes = postRows || [];
      if (withVotes.length) {
        const { data: upvotes } = await supabase.from("post_upvotes")
          .select("post_id").eq("user_id", user.id).in("post_id", withVotes.map((pr) => pr.id));
        const upset = new Set((upvotes || []).map((u: any) => u.post_id));
        withVotes = withVotes.map((pr) => ({ ...pr, user_has_upvoted: upset.has(pr.id) }));
      }
      setPosts(withVotes);

      // Issues — first-session fallback + escalation target list.
      const { data: iss } = await supabase.from("civic_issues")
        .select("*").neq("status", "resolved").order("voice_count", { ascending: false }).limit(20);
      setIssues(iss || []);

      // Watch state across both watch tables.
      const [{ data: wi }, { data: wc }] = await Promise.all([
        supabase.from("watched_concern_cards").select("issue_id").eq("user_id", user.id),
        supabase.from("card_watches").select("concern_card_id").eq("user_id", user.id),
      ]);
      setWatchedIds(new Set([
        ...((wi || []).map((w: any) => w.issue_id).filter(Boolean)),
        ...((wc || []).map((w: any) => w.concern_card_id).filter(Boolean)),
      ]));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const onRefresh = useCallback(() => loadFeed(true), []);

  async function handleWatchCard(cardId: string) {
    if (!currentUser || !verified) { goVerify(); return; }
    setWatchLoading(cardId);
    const isOn = watchedIds.has(cardId);
    if (isOn) {
      await supabase.from("card_watches").delete().eq("user_id", currentUser.id).eq("concern_card_id", cardId);
      setWatchedIds((prev) => { const n = new Set(prev); n.delete(cardId); return n; });
    } else {
      await supabase.from("card_watches").insert({ user_id: currentUser.id, concern_card_id: cardId, neighborhood_id: profile?.neighborhood_id || "unknown" });
      setWatchedIds((prev) => new Set([...prev, cardId]));
    }
    setWatchLoading(null);
  }

  async function handleWatchIssue(issueId: string) {
    if (!currentUser || !verified) { goVerify(); return; }
    setWatchLoading(issueId);
    const isOn = watchedIds.has(issueId);
    if (isOn) {
      await supabase.from("watched_concern_cards").delete().eq("user_id", currentUser.id).eq("issue_id", issueId);
      setWatchedIds((prev) => { const n = new Set(prev); n.delete(issueId); return n; });
    } else {
      await supabase.from("watched_concern_cards").insert({ user_id: currentUser.id, issue_id: issueId, notify_on_move: true });
      setWatchedIds((prev) => new Set([...prev, issueId]));
    }
    setWatchLoading(null);
  }

  async function handlePost() {
    if (!draft.trim() || posting) return;
    setPosting(true);
    const { error } = await supabase.from("posts").insert({
      author_id: currentUser.id, neighborhood_id: profile?.neighborhood_id || null,
      body: draft.trim(), tags: [draftTag], upvote_count: 0, escalated: false,
    });
    if (error) {
      showToast(error.message.includes("Rate limit") ? "You've posted 10 times this hour — try again later" : "Failed to post — " + error.message);
    } else {
      setDraft(""); setComposeOpen(false);
      showToast("Posted to " + (profile?.neighborhood || "your town"));
      loadFeed(true);
    }
    setPosting(false);
  }

  async function handleVotePost(post: any) {
    if (!currentUser) return;
    if (post.user_has_upvoted) {
      await supabase.from("post_upvotes").delete().match({ user_id: currentUser.id, post_id: post.id });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, user_has_upvoted: false, upvote_count: Math.max(0, (p.upvote_count || 1) - 1) } : p)));
    } else {
      await supabase.from("post_upvotes").insert({ user_id: currentUser.id, post_id: post.id });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, user_has_upvoted: true, upvote_count: (p.upvote_count || 0) + 1 } : p)));
    }
  }

  async function handleEscalate(post: any) {
    if (!currentUser) return;
    if (!verified) { goVerify(); return; }
    const title = post.body.length > 100 ? post.body.slice(0, 100) + "…" : post.body;
    const { data: profEsc } = await supabase.from("profiles").select("neighborhood_id, display_name").eq("id", currentUser.id).maybeSingle();
    const escalatorName = profEsc?.display_name || "Resident";
    const authorName = post.profiles?.display_name || "Resident";
    const sourceLabel = post.author_id === currentUser.id
      ? `Escalated by ${escalatorName}` : `Escalated by ${escalatorName} · from a post by ${authorName}`;
    const { data: issue, error } = await supabase.from("civic_issues").insert({
      source_post_id: post.id, neighborhood_id: profEsc?.neighborhood_id || null,
      title, status: "escalated", voice_count: 0, priority_pct: 0, source_label: sourceLabel,
    }).select().single();
    if (error) {
      const denied = error.code === "42501" || /policy|permission|residen/i.test(error.message || "");
      showToast(denied ? "Verify your residency to escalate to the civic tracker." : "Couldn't escalate — please try again.");
      return;
    }
    await supabase.from("posts").update({ escalated: true, escalated_issue_id: issue.id }).eq("id", post.id);
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, escalated: true, escalated_issue_id: issue.id } : p)));
    showToast("Escalated as a civic issue");
  }

  async function handleUseMyLocation() {
    if (locating) return;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { showToast("Location permission denied"); setLocating(false); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude: lat, longitude: lng } = pos.coords;
      setReportCoords({ lat, lng });
      if (!reportLoc.trim()) {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
          const d = await r.json();
          const aa = d.address || {};
          const street = [aa.house_number, aa.road].filter(Boolean).join(" ");
          if (street) setReportLoc(street.slice(0, 200));
        } catch { /* coords stored regardless */ }
      }
    } catch { showToast("Could not get your location"); }
    setLocating(false);
  }

  async function handleReport() {
    if (!reportDesc.trim() || reporting) return;
    setReporting(true);
    const { data: prof } = await supabase.from("profiles").select("neighborhood_id, municipality_id").eq("id", currentUser.id).maybeSingle();
    const { error } = await supabase.from("resident_reports").insert({
      reporter_id: currentUser.id, neighborhood_id: prof?.neighborhood_id || null,
      municipality_id: prof?.municipality_id || "jackson_nj", report_type: reportType,
      title: REPORT_TYPES.find((r) => r.key === reportType)?.label || reportType,
      description: reportDesc.trim(), location_text: reportLoc.trim() || null,
      lat: reportCoords?.lat ?? null, lng: reportCoords?.lng ?? null, status: "open",
    });
    if (error) {
      showToast(error.message.includes("Rate limit") ? "Max 5 reports per hour" : "Failed to submit — " + error.message);
    } else {
      setReportDesc(""); setReportLoc(""); setReportType("pothole"); setReportCoords(null); setReportOpen(false);
      showToast("Report submitted — it will appear in the feed shortly");
    }
    setReporting(false);
  }

  // Derived: concern cards and bulletins out of the civic items.
  const concernCards = civic.filter((c) => c.source === "civic_engine" && c.concern_card_id);
  const nonBotPosts = posts.filter((p) => !p.profiles?.is_bot);

  // Stream items, filtered.
  let streamItems: FeedItem[] = [];
  if (filter === "all") {
    streamItems = [
      ...civic.map((c) => ({ type: "civic" as const, data: c })),
      ...posts.map((p) => ({ type: "post" as const, data: p })),
    ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());
  } else if (filter === "issue") {
    streamItems = concernCards.map((c) => ({ type: "civic" as const, data: c }));
  } else if (filter === "bulletin") {
    streamItems = civic.filter((c) => c.source === "township_news" || c.tag === "bulletin").map((c) => ({ type: "civic" as const, data: c }));
  } else if (filter === "banter") {
    streamItems = nonBotPosts.filter((p) => (p.tags || []).includes("banter")).map((p) => ({ type: "post" as const, data: p }));
  } else if (filter === "escalated") {
    streamItems = nonBotPosts.filter((p) => p.escalated).map((p) => ({ type: "post" as const, data: p }));
  }

  const hasEscalated = nonBotPosts.some((p) => p.escalated);
  const filterTabs = [
    { key: "all", label: "All", show: true },
    { key: "issue", label: "Council", show: concernCards.length > 0 },
    { key: "banter", label: "Banter", show: true },
    { key: "escalated", label: "Escalated", show: hasEscalated },
    { key: "bulletin", label: "Bulletins", show: civic.some((c) => c.source === "township_news") },
  ].filter((t) => t.show);

  function openCivic(c: CivicItem) {
    if (c.concern_card_id) router.push({ pathname: "/card/[id]", params: { id: c.concern_card_id } });
    else if (c.url) WebBrowser.openBrowserAsync(c.url);
  }

  if (loading) {
    return <View style={[s.root, s.center]}><ActivityIndicator color={T.amber} /></View>;
  }

  const neighborhood = profile?.neighborhood || "your town";

  return (
    <View style={s.root}>
      <FlatList
        style={s.root}
        contentContainerStyle={s.content}
        data={streamItems}
        keyExtractor={(item, i) => (item.type === "civic" ? `civic-${item.data.external_id}` : `post-${item.data.id ?? i}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.amber} />}
        ListHeaderComponent={
          <View>
            {profile?.neighborhood && (
              <View style={s.header}>
                <Text style={s.headerNeighborhood}>{profile.neighborhood}</Text>
                <Text style={s.headerLabel}>Town feed</Text>
              </View>
            )}

            {!verified && (
              <TouchableOpacity style={s.verifyBanner} onPress={goVerify} activeOpacity={0.8}>
                <Text style={s.verifyBannerTitle}>You're reading as a guest</Text>
                <Text style={s.verifyBannerText}>
                  Reading is open to everyone. Verify your residency to follow issues, share a stake, and have your voice count in your town.
                </Text>
                <Text style={s.verifyBannerCta}>Verify residency →</Text>
              </TouchableOpacity>
            )}

            {/* First-five-minutes — a designed arrival, not a flag flipped. */}
            {isFirstSession && (concernCards.length > 0 || issues.length > 0) && (
              <View style={s.firstTime}>
                <Text style={s.firstTimeTitle}>Happening in <Text style={s.firstTimeTitleEm}>{neighborhood}</Text> now</Text>
                <Text style={s.firstTimeSub}>
                  {concernCards.length > 0
                    ? "Three things your local government is working on right now. Follow any one to be notified the moment it moves."
                    : "Here's what your neighborhood is working on right now. Follow any issue to be notified when something changes."}
                </Text>
                {concernCards.length > 0
                  ? concernCards.slice(0, 3).map((c) => {
                      const on = watchedIds.has(c.concern_card_id!);
                      return (
                        <Pressable key={c.concern_card_id} style={s.firstCard} onPress={() => openCivic(c)}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.firstCardTitle}>{c.title}</Text>
                            <Text style={s.firstCardMeta}>Council · Jackson Township</Text>
                          </View>
                          <Pressable onPress={() => handleWatchCard(c.concern_card_id!)} disabled={watchLoading === c.concern_card_id}
                            style={[s.followBtn, { backgroundColor: on ? T.tealLo : T.amberLo, borderColor: on ? T.teal : T.amber }]}>
                            <Text style={[s.followBtnText, { color: on ? T.tealHi : T.amberHi }]}>
                              {watchLoading === c.concern_card_id ? "…" : on ? "✓ Following" : "Follow"}
                            </Text>
                          </Pressable>
                        </Pressable>
                      );
                    })
                  : issues.slice(0, 3).map((iss) => {
                      const on = watchedIds.has(iss.id);
                      return (
                        <Pressable key={iss.id} style={s.firstCard} onPress={() => router.push({ pathname: "/issue/[id]", params: { id: iss.id } })}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.firstCardTitle}>{iss.title}</Text>
                            <Text style={s.firstCardMeta}>{iss.voice_count || 0} votes · {iss.priority_pct || 0}% priority</Text>
                          </View>
                          <Pressable onPress={() => handleWatchIssue(iss.id)} disabled={watchLoading === iss.id}
                            style={[s.followBtn, { backgroundColor: on ? T.tealLo : T.amberLo, borderColor: on ? T.teal : T.amber }]}>
                            <Text style={[s.followBtnText, { color: on ? T.tealHi : T.amberHi }]}>
                              {watchLoading === iss.id ? "…" : on ? "✓ Following" : "Follow"}
                            </Text>
                          </Pressable>
                        </Pressable>
                      );
                    })}
                <Text style={s.firstTimeFoot}>Tap any item to see the full details and what residents are saying ↓</Text>
              </View>
            )}

            {/* Filter tabs */}
            {filterTabs.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ gap: 4 }}>
                {filterTabs.map((t) => (
                  <Pressable key={t.key} onPress={() => setFilter(t.key as any)} style={[s.filterPill, filter === t.key && s.filterPillActive]}>
                    <Text style={[s.filterPillText, filter === t.key && s.filterPillTextActive]}>{t.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        }
        renderItem={({ item }) => {
          if (item.type === "civic") {
            return <CivicFeedItem item={item.data} onPress={() => openCivic(item.data)} />;
          }
          return (
            <PostCard
              post={item.data}
              currentUserId={currentUser?.id}
              onVote={handleVotePost}
              onEscalate={handleEscalate}
              onOpenIssue={(issueId) => router.push({ pathname: "/issue/[id]", params: { id: issueId } })}
            />
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>
              {filter === "all" ? `${neighborhood} is quiet right now.\nBe the first to share something.`
                : filter === "escalated" ? "No escalated posts yet.\nEscalate a post to move it to the civic tracker."
                : filter === "banter" ? "No banter posts yet.\nShare something with your neighbors."
                : "Nothing here right now."}
            </Text>
          </View>
        }
      />

      {/* Compose / report bar */}
      <View style={s.composeBar}>
        {!composeOpen && !reportOpen ? (
          <View style={{ gap: 8 }}>
            <Pressable style={s.composeTap} onPress={() => setComposeOpen(true)}>
              <Text style={s.composeTapText}>What's on your mind in {neighborhood}?</Text>
              <Text style={s.composeTapIcon}>✎</Text>
            </Pressable>
            <Pressable style={s.reportTap} onPress={() => setReportOpen(true)}>
              <Text style={s.reportTapText}>📍 Report a street issue (pothole, light out, dumping…)</Text>
            </Pressable>
          </View>
        ) : composeOpen ? (
          <View style={s.composeCard}>
            <TextInput style={s.composeInput} autoFocus multiline placeholder={`What's worth raising with your neighbors in ${neighborhood}?`}
              placeholderTextColor={T.creamFaint} value={draft} maxLength={2000} onChangeText={setDraft} />
            <View style={s.composeFooter}>
              <View style={s.tagRow}>
                {Object.entries(TAGS).map(([tag, ts]) => {
                  const on = draftTag === tag;
                  return (
                    <Pressable key={tag} onPress={() => setDraftTag(tag)} style={[s.tagChip, { backgroundColor: on ? ts.bg : "transparent", borderColor: on ? ts.border : T.border }]}>
                      <Text style={[s.tagChipText, { color: on ? ts.color : T.creamFaint }]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={s.composeBtns}>
              <Pressable onPress={() => { setComposeOpen(false); setDraft(""); }} style={s.ghostBtn}><Text style={s.ghostBtnText}>Cancel</Text></Pressable>
              <Pressable onPress={handlePost} disabled={!draft.trim() || posting} style={[s.postBtn, (!draft.trim() || posting) && s.disabled]}>
                <Text style={s.postBtnText}>{posting ? "Posting…" : "Post"}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView style={s.reportCard} keyboardShouldPersistTaps="handled">
            <Text style={s.reportHead}>Report a street issue</Text>
            <View style={s.reportTypes}>
              {REPORT_TYPES.map((rt) => {
                const on = reportType === rt.key;
                return (
                  <Pressable key={rt.key} onPress={() => setReportType(rt.key)} style={[s.reportTypeChip, { backgroundColor: on ? T.amberLo : "transparent", borderColor: on ? T.amberMid : T.border }]}>
                    <Text style={[s.reportTypeText, { color: on ? T.amberHi : T.creamDim }]}>{rt.icon} {rt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={s.locRow}>
              <TextInput style={[s.composeInput, { flex: 1, minHeight: 40 }]} placeholder="Street address or cross-streets (e.g. Oak St near Pine Ave)"
                placeholderTextColor={T.creamFaint} value={reportLoc} onChangeText={setReportLoc} />
            </View>
            <Pressable onPress={handleUseMyLocation} disabled={locating} style={s.locBtn}>
              <Text style={s.locBtnText}>{locating ? "Locating…" : reportCoords ? "📍 Location attached" : "📍 Use my location"}</Text>
            </Pressable>
            <TextInput style={[s.composeInput, { minHeight: 70, marginTop: 8 }]} multiline placeholder="Describe the issue briefly"
              placeholderTextColor={T.creamFaint} value={reportDesc} onChangeText={setReportDesc} />
            <View style={s.composeBtns}>
              <Pressable onPress={() => { setReportOpen(false); setReportDesc(""); setReportLoc(""); setReportCoords(null); }} style={s.ghostBtn}>
                <Text style={s.ghostBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleReport} disabled={!reportDesc.trim() || reporting} style={[s.postBtn, (!reportDesc.trim() || reporting) && s.disabled]}>
                <Text style={s.postBtnText}>{reporting ? "Submitting…" : "Submit report"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>

      {toast && <View style={s.toast} pointerEvents="none"><Text style={s.toastText}>{toast}</Text></View>}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: "center", alignItems: "center" },
  content: { paddingBottom: 200 },
  header: { paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 },
  headerNeighborhood: { color: T.cream, fontSize: 22, fontWeight: "600" },
  headerLabel: { color: T.creamDim, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 },

  verifyBanner: { marginHorizontal: 16, backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amber, borderRadius: 12, padding: 16, marginBottom: 16 },
  verifyBannerTitle: { color: T.amberHi, fontSize: 14, fontWeight: "600", marginBottom: 6 },
  verifyBannerText: { color: T.cream, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  verifyBannerCta: { color: T.amberHi, fontSize: 13, fontWeight: "600" },

  firstTime: { borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, backgroundColor: T.surface },
  firstTimeTitle: { fontSize: 17, color: T.cream, marginBottom: 4, fontWeight: "600" },
  firstTimeTitleEm: { color: T.amberHi, fontStyle: "italic" },
  firstTimeSub: { fontSize: 12, color: T.creamDim, marginBottom: 14, lineHeight: 20 },
  firstCard: { padding: 12, borderRadius: 9, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderLeftWidth: 3, borderLeftColor: T.amber, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  firstCardTitle: { fontSize: 13, color: T.cream, fontWeight: "500", marginBottom: 3, lineHeight: 18 },
  firstCardMeta: { fontSize: 11, color: T.creamFaint },
  followBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 7, borderWidth: 1 },
  followBtnText: { fontSize: 11, fontWeight: "500" },
  firstTimeFoot: { fontSize: 11, color: T.creamFaint, marginTop: 8, textAlign: "center" },

  filterRow: { borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 12 },
  filterPill: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  filterPillActive: { borderBottomColor: T.amber },
  filterPillText: { fontSize: 12, color: T.creamFaint },
  filterPillTextActive: { color: T.cream },

  empty: { padding: 40, alignItems: "center" },
  emptyText: { color: T.creamDim, fontSize: 14, textAlign: "center", lineHeight: 22 },

  composeBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: T.bg },
  composeTap: { flexDirection: "row", alignItems: "center", backgroundColor: T.surface, borderWidth: 1, borderColor: T.borderHi, borderRadius: 14, padding: 14 },
  composeTapText: { flex: 1, color: T.creamDim, fontSize: 13 },
  composeTapIcon: { fontSize: 18, color: T.amberHi },
  reportTap: { backgroundColor: "transparent", borderWidth: 1, borderColor: T.border, borderRadius: 9, padding: 12 },
  reportTapText: { color: T.creamDim, fontSize: 12 },
  composeCard: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.borderHi, borderRadius: 14, padding: 12 },
  composeInput: { backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: T.cream, minHeight: 70, textAlignVertical: "top" },
  composeFooter: { marginTop: 8 },
  tagRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tagChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  tagChipText: { fontSize: 12 },
  composeBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 7, borderWidth: 1, borderColor: T.border },
  ghostBtnText: { color: T.creamDim, fontSize: 12 },
  postBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: T.amber },
  postBtnText: { color: T.bg, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.4 },

  reportCard: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.borderHi, borderRadius: 14, padding: 12, maxHeight: 380 },
  reportHead: { fontSize: 12, color: T.amberHi, fontWeight: "600", marginBottom: 8, letterSpacing: 0.4, textTransform: "uppercase" },
  reportTypes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  reportTypeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  reportTypeText: { fontSize: 12 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  locBtn: { borderWidth: 1, borderColor: T.border, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  locBtnText: { color: T.amberHi, fontSize: 12 },

  toast: { position: "absolute", bottom: 200, left: 0, right: 0, alignItems: "center" },
  toastText: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, fontSize: 13, color: T.cream, overflow: "hidden" },
});
