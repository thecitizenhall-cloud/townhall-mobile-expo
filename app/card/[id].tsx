import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, Image, Alert, KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import {
  watchConcernCard, unwatchConcernCard, recordConcernCardView, getResidentNeighborhoodSlug,
} from "../../lib/concernCards";
import { goVerify, isVerifiedForCurrentNeighborhood } from "../../lib/residency";
import { T } from "../../lib/theme";
import { timeAgo } from "../../lib/format";
import { cleanAreaQuery, osmSearchUrl, townLabel } from "../../lib/cardArea";
import { SITE_URL } from "../../lib/config";
import CommentKit, { KitComment, Stance } from "../../components/CommentKit";

const OUTCOME_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending vote", color: T.amberHi, bg: T.amberLo },
  approved: { label: "Approved", color: T.tealHi, bg: T.tealLo },
  rejected: { label: "Rejected", color: T.redHi, bg: T.redLo },
  tabled: { label: "Tabled", color: T.creamDim, bg: T.surface },
  discussed: { label: "Under discussion", color: T.blueHi, bg: T.blueLo },
  introduced: { label: "Introduced", color: T.purpleHi, bg: T.purpleLo },
};

const IMPACT_LABELS: Record<string, string> = {
  budget: "💰 Budget", zoning: "🏛 Zoning", traffic: "🚦 Traffic", environment: "🌿 Environment",
  housing: "🏘 Housing", education: "🎓 Education", safety: "🛡 Safety", infrastructure: "🔧 Infrastructure",
};

const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;

function formatDate(d?: string | null) {
  if (!d) return "";
  const parts = String(d).split("T")[0].split("-");
  if (parts.length === 3) {
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// External map link + static-map URL for a card's affected area. The static map
// reuses the web /api/card-map route (server-side geocode + render), so mobile
// needs no map key of its own. cleanAreaQuery/osmSearchUrl live in lib/cardArea.
function mapSearchUrl(card: any) {
  return osmSearchUrl(cleanAreaQuery(card?.affected_area, card?.municipality_id));
}

function cardMapUri(card: any) {
  const p = new URLSearchParams({ area: card?.affected_area || "", muni: card?.municipality_id || "" });
  // Precise parcel pin when the Block/Lot resolved at ingest; else geocode.
  if (card?.parcel_lat != null && card?.parcel_lon != null) {
    p.set("lat", String(card.parcel_lat)); p.set("lon", String(card.parcel_lon));
  }
  return `${SITE_URL}/api/card-map?${p.toString()}`;
}

// Static map of the affected area; hidden if the route can't render it (no key
// / not geocodable) so the "View on map" link below remains the fallback.
function CardAreaMap({ card }: { card: any }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Pressable onPress={() => Linking.openURL(mapSearchUrl(card))} style={s.mapImageWrap}>
      <Image source={{ uri: cardMapUri(card) }} style={s.mapImage} resizeMode="cover"
        onError={() => setFailed(true)} />
    </Pressable>
  );
}

function withHighlight(sourceUrl?: string | null, quote?: string | null) {
  if (!sourceUrl || !quote) return sourceUrl || null;
  if (sourceUrl.includes("#")) return sourceUrl;
  if (/\.pdf(\?|$)/i.test(sourceUrl)) return sourceUrl;
  const snippet = quote.trim().replace(/\s+/g, " ").split(" ").slice(0, 12).join(" ");
  return `${sourceUrl}#:~:text=${encodeURIComponent(snippet)}`;
}

export default function ConcernCardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [card, setCard] = useState<any>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [watched, setWatched] = useState(false);
  const [watching, setWatching] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [relatedPosts, setRelatedPosts] = useState<any[]>([]);
  const [relatedCards, setRelatedCards] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [cardSubs, setCardSubs] = useState<any[]>([]);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [reportRecord, setReportRecord] = useState<any>(null);
  const [reportInfo, setReportInfo] = useState<any>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function load() {
    const u = await getCurrentUser();  // local read; no getUser network round-trip on mount
    setUser(u);

    // ── Phase 1: verification + report origin (need u) + card row (needs id) ──
    const [verifiedRes, { data: rr }, { data: c }] = await Promise.all([
      u ? isVerifiedForCurrentNeighborhood(u.id) : Promise.resolve(false),
      u
        ? supabase.from("resident_reports")
            .select("id, reporter_id, status, report_type, location_text, photo_url, official_response, official_response_name, official_response_email, responded_at")
            .eq("concern_card_id", id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("concern_cards").select("*").eq("id", id).maybeSingle(),
    ]);

    if (u) setVerified(verifiedRes);
    if (rr) { setReportInfo(rr); if (rr.reporter_id === u?.id) setReportRecord(rr); }
    setCard(c);

    if (c) {
      if (u) recordConcernCardView(u.id, id); // fire-and-forget, off the paint path
      const titleWords = c?.title?.split(" ").filter((w: string) => w.length > 4).slice(0, 3).join(" | ") || "";

      // ── Phase 2: everything scoped to the known card, in parallel ────────
      const [
        { data: related },
        { data: watch },
        { data: posts },
        { data: related311 },
        { data: evts },
        { data: subs, error: subErr },
        { data: anns },
      ] = await Promise.all([
        supabase.from("concern_cards")
          .select("id, meeting_date, source_url, pass1_confidence, outcome_signal, meeting_id, meetings(meeting_type)")
          .eq("municipality_id", c.municipality_id)
          .ilike("title", `%${c.title?.split("–")[0]?.split("—")[0]?.trim().slice(0, 30)}%`)
          .order("meeting_date", { ascending: true }),
        u
          ? supabase.from("card_watches")
              .select("id").eq("user_id", u.id).eq("concern_card_id", id).maybeSingle()
          : Promise.resolve({ data: null }),
        // Match ALL the significant title words (plainto_tsquery ANDs them) —
        // one generic word matched unrelated posts. removed_at: takedown leak.
        // Bot-synced posts are filtered after the fetch: they carry the card's
        // own text, so they always matched and echoed the card back into its
        // own comment section as a "Resident" (the ghost-post bug).
        (titleWords && c?.municipality_id)
          ? supabase.from("posts")
              .select("*, profiles!inner(display_name, trust_tier, is_bot)")
              .eq("profiles.is_bot", false)
              .textSearch("body", titleWords.split(" | ").join(" "), { type: "plain" })
              .is("removed_at", null)
              .order("created_at", { ascending: false }).limit(5)
          : Promise.resolve({ data: [] }),
        (c?.impact_type && c?.municipality_id)
          ? supabase.from("concern_cards")
              .select("*").eq("municipality_id", c.municipality_id).eq("impact_type", c.impact_type)
              .neq("id", id).eq("surfaces_to_feed", true)
              .order("meeting_date", { ascending: false }).limit(4)
          : Promise.resolve({ data: [] }),
        // No profiles embed: card_events.user_id has NO FK to profiles, so the
        // PostgREST join 400s. Author names are hydrated in a second step below.
        supabase.from("card_events")
          .select("*")
          .eq("concern_card_id", id).eq("event_type", "comment").is("removed_at", null)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("card_subissues")
          .select("id, title, created_at").eq("concern_card_id", id).order("created_at", { ascending: true }),
        // Same no-FK situation (expert_user_id has no FK to profiles) — hydrate below.
        supabase.from("expert_annotations")
          .select("id, annotation_text, corrected_impact_type, corrected_outcome_signal, created_at, expert_user_id")
          .eq("concern_card_id", id).order("created_at", { ascending: false }),
      ]);

      // Hydrate author profiles for comments + annotations in one batched read —
      // replaces the broken embedded joins (card_events / expert_annotations lack
      // the FK to profiles that PostgREST embedding requires).
      const evtRows: any[] = evts || [];
      const annRows: any[] = anns || [];
      const authorIds = [...new Set([
        ...evtRows.map((e) => e.user_id),
        ...annRows.map((a) => a.expert_user_id),
      ].filter(Boolean))];
      const profMap: Record<string, any> = {};
      if (authorIds.length) {
        const { data: profs } = await supabase.from("profiles")
          .select("id, display_name, expert_handle, expert_credential").in("id", authorIds);
        for (const p of (profs || [])) profMap[p.id] = p;
      }
      const evtsHydrated = evtRows.map((e) => ({ ...e, profiles: profMap[e.user_id] || null }));
      const annsHydrated = annRows.map((a) => ({ ...a, profiles: profMap[a.expert_user_id] || null }));

      const seen = new Set<string>();
      setMeetings((related || []).filter((m: any) => {
        const key = m.source_url || m.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
      setWatched(!!watch);
      setRelatedPosts((posts || []).filter((p: any) => !p.profiles?.is_bot));
      setRelatedCards(related311 || []);
      setReplies(evtsHydrated);
      if (!subErr) setCardSubs(subs || []);
      setAnnotations(annsHydrated);
    }
    setLoading(false);
  }

  async function handleWatch() {
    // Following is a standing action — guests must verify first.
    if (!user || !verified) { goVerify(); return; }
    setWatching(true);
    // Only flip the button if the write actually succeeded — RLS can reject it
    // (standing gate), and an optimistic flip would hide that failure.
    if (watched) {
      const { success } = await unwatchConcernCard(user.id, id);
      if (success) setWatched(false);
    } else {
      const { success, error } = await watchConcernCard(user.id, id, await getResidentNeighborhoodSlug(user.id));
      if (success) setWatched(true);
      else if (error) Alert.alert("Couldn't follow", error);
    }
    setWatching(false);
  }

  async function updateReportStatus(newStatus: string) {
    if (!reportRecord || updatingStatus) return;
    setUpdatingStatus(true);
    const { error } = await supabase.from("resident_reports").update({ status: newStatus }).eq("id", reportRecord.id);
    if (!error) {
      setReportRecord({ ...reportRecord, status: newStatus });
      const outcomeMap: Record<string, string> = { open: "pending", acknowledged: "pending", in_progress: "deferred", resolved: "approved" };
      await supabase.from("concern_cards").update({ outcome_signal: outcomeMap[newStatus] || "pending" }).eq("id", id);
    }
    setUpdatingStatus(false);
  }

  async function postCardComment({ body, stance, subId }: { body: string; stance: Stance; subId: string | null }) {
    if (!user || !body.trim()) return;
    const { data, error } = await supabase.from("card_events").insert({
      concern_card_id: id, neighborhood_id: card?.municipality_id || "unknown",
      event_type: "comment", user_id: user.id, body: body.trim(), stance, sub_issue_id: subId || null,
    }).select("*").single();  // no profiles embed — card_events has no FK to profiles (400s)
    if (error) return;
    // Attach author name locally (it's the current user); reloads hydrate from profiles.
    if (data) {
      const withAuthor = { ...data, profiles: { display_name: user.user_metadata?.display_name || null } };
      setReplies((prev) => (prev.some((r) => r.id === withAuthor.id) ? prev : [withAuthor, ...prev]));
    }
  }

  async function createCardSubIssue(title: string) {
    if (!user) return;
    const { data, error } = await supabase.from("card_subissues")
      .insert({ concern_card_id: id, title, created_by: user.id }).select("id, title, created_at").single();
    if (error) return;
    if (data) setCardSubs((prev) => [...prev, data]);
  }

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <Stack.Screen options={{ title: "Concern" }} />
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }
  if (!card) {
    return (
      <View style={[s.root, s.center]}>
        <Stack.Screen options={{ title: "Concern" }} />
        <Text style={s.emptyText}>Council item not found.</Text>
      </View>
    );
  }

  const outcome = OUTCOME_LABELS[card.outcome_signal] || OUTCOME_LABELS.pending;
  const impact = IMPACT_LABELS[card.impact_type] || "📋 Civic";

  const ckComments: KitComment[] = [
    ...replies.map((r) => ({
      id: String(r.id), body: r._body || r.body || "", stance: r.stance,
      name: r.profiles?.display_name || "Resident", created_at: r.created_at, sub_issue_id: r.sub_issue_id || null,
      reportType: "card_event" as const, reportId: r.id, authorId: r.user_id,
    })),
    ...relatedPosts.map((p) => ({
      id: "fp" + p.id,
      body: (p.body || "").slice(0, 220) + ((p.body || "").length > 220 ? "…" : ""),
      stance: "neutral", name: p.profiles?.display_name || "Resident", created_at: p.created_at,
      sub_issue_id: null, tag: "from the feed",
      reportType: "post" as const, reportId: p.id, authorId: p.author_id,
    })),
  ];
  const hasOfficial = !!(card?.official_response || reportInfo?.official_response);

  return (
    <KeyboardAvoidingView style={s.root} behavior="padding">
      <Stack.Screen options={{ title: "Council item" }} />
      <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={s.sourceRow}>
          <Text style={s.sourceTag}>{townLabel(card.municipality_id) || "Township"}</Text>
          <Text style={s.sourceDot}> · {formatDate(card.meeting_date)}</Text>
        </View>
        <Text style={s.title}>{card.title}</Text>
        {card.summary ? <Text style={s.summary}>{card.summary}</Text> : null}

        {card.source_quote ? (
          <View style={s.quote}>
            <Text style={s.quoteText}>"{card.source_quote}"</Text>
            {card.source_url ? (
              <Text style={s.quoteSrc} onPress={() => Linking.openURL(withHighlight(card.source_url, card.source_quote)!)}>
                View original document ↗
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={s.metaRow}>
          <Text style={[s.pill, { backgroundColor: outcome.bg, color: outcome.color, borderColor: outcome.color }]}>{outcome.label}</Text>
          <Text style={s.metaText}>{impact}</Text>
          {card.next_action_date ? <Text style={s.metaText}>· Next action: {formatDate(card.next_action_date)}</Text> : null}
        </View>

        {card.affected_area ? (
          <View style={{ marginTop: 14 }}>
            <Text style={s.sectionHead}>What this affects</Text>
            <Text style={s.explainerText}>{card.affected_area}</Text>
            <CardAreaMap card={card} />
            <Text style={s.mapLink} onPress={() => Linking.openURL(mapSearchUrl(card))}>📍 View on map ↗</Text>
          </View>
        ) : null}

        {reportInfo && (reportInfo.photo_url || reportInfo.location_text) ? (
          <View style={{ marginTop: 14 }}>
            {reportInfo.location_text ? <Text style={s.reportLoc}>📍 {reportInfo.location_text}</Text> : null}
            {reportInfo.photo_url ? <Image source={{ uri: reportInfo.photo_url }} style={s.reportPhoto} resizeMode="cover" /> : null}
          </View>
        ) : null}

        <Pressable
          onPress={handleWatch}
          disabled={watching}
          style={[s.watchBtn, watched ? s.watchBtnOn : s.watchBtnOff]}
        >
          <Text style={[s.watchBtnText, { color: watched ? T.tealHi : T.amberHi }]}>
            {watching ? "…" : !verified ? "Verify residency to follow"
              : watched ? "✓ Following this item — you'll be notified of updates" : "+ Follow this item"}
          </Text>
        </Pressable>
        {!user ? <Text style={s.signInNote}>Sign in to follow and receive updates</Text> : null}

        {/* Comments */}
        <View style={s.window}>
          <View style={s.windowHead}>
            <Text style={s.windowHeadText}>💬 Comments</Text>
            <Text style={s.windowCount}>{ckComments.length}</Text>
          </View>
          <CommentKit
            currentUser={user}
            subjectTitle={card.title}
            subjectSummary={card.summary || card.source_quote || ""}
            getToken={getToken}
            comments={ckComments}
            subIssues={cardSubs}
            timeAgo={timeAgo}
            onPost={postCardComment}
            onCreateSubIssue={createCardSubIssue}
          />
        </View>

        {/* Official reply */}
        <View style={s.window}>
          <View style={s.windowHead}><Text style={s.windowHeadText}>✅ Official reply</Text></View>
          {hasOfficial ? (
            <View>
              {card?.official_response ? (
                <View style={s.post}>
                  <Text style={s.postBody}>{card.official_response}</Text>
                  <Text style={s.postMeta}>
                    {card.official_response_name || "Official"}
                    {card.official_response_verified && card.official_response_email
                      ? ` · via ${String(card.official_response_email).split("@")[1]} · verified by email, not identity` : ""}
                  </Text>
                </View>
              ) : null}
              {reportInfo?.official_response ? (
                <View style={s.govInbox}>
                  <Text style={s.govInboxLabel}>Verified government inbox</Text>
                  <Text style={s.govInboxBody}>{reportInfo.official_response}</Text>
                  <Text style={s.govInboxMeta}>
                    {reportInfo.official_response_name ? `${reportInfo.official_response_name} · ` : ""}{reportInfo.official_response_email}
                    {reportInfo.responded_at ? ` · ${new Date(reportInfo.responded_at).toLocaleDateString()}` : ""}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={s.windowEmpty}>
              No official response yet. When the responsible official replies, it lands here — attributed to a verified government inbox, dated, on the record.
            </Text>
          )}
        </View>

        {/* Expert review */}
        <View style={s.window}>
          <View style={s.windowHead}>
            <Text style={s.windowHeadText}>🎓 Expert review</Text>
            {annotations.length > 0 ? <Text style={s.windowCount}>{annotations.length}</Text> : null}
          </View>
          {annotations.length > 0 ? (
            annotations.map((a) => (
              <View key={a.id} style={s.post}>
                <Text style={s.postBody}>{a.annotation_text}</Text>
                <Text style={s.postMeta}>
                  {a.profiles?.expert_handle || "Verified expert"}
                  {a.profiles?.expert_credential ? ` · ${a.profiles.expert_credential}` : ""}
                  {a.corrected_impact_type || a.corrected_outcome_signal ? " · suggested correction" : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={s.windowEmpty}>
              No expert review yet. Verified subject-matter experts can annotate this item with context or corrections.
            </Text>
          )}
        </View>

        {/* Round-trip status */}
        <View style={s.window}>
          <View style={s.windowHead}><Text style={s.windowHeadText}>🔄 Round-trip status</Text></View>
          <View style={s.statusRow}>
            <Text style={[s.pill, { backgroundColor: outcome.bg, color: outcome.color, borderColor: outcome.color }]}>{outcome.label}</Text>
            {reportRecord ? <Text style={s.metaText}>· report: {reportRecord.status}</Text> : null}
          </View>

          {meetings.length > 0 && (
            <>
              <Text style={[s.sectionHead, { marginTop: 8 }]}>
                Meeting history · {meetings.length} session{meetings.length !== 1 ? "s" : ""}
              </Text>
              <View style={s.timeline}>
                {meetings.map((m, i) => {
                  const mo = OUTCOME_LABELS[m.outcome_signal] || OUTCOME_LABELS.pending;
                  const last = i === meetings.length - 1;
                  return (
                    <View key={m.id} style={s.meetingRow}>
                      <View style={s.meetingRail}>
                        <View style={[s.meetingDot, { backgroundColor: mo.color }]} />
                        {!last && <View style={s.meetingLine} />}
                      </View>
                      <View style={s.meetingContent}>
                        <Text style={s.meetingDate}>{formatDate(m.meeting_date)}</Text>
                        <Text style={[s.pillSm, { backgroundColor: mo.bg, color: mo.color, borderColor: mo.color }]}>{mo.label}</Text>
                        <Text style={s.meetingType}>{m.meetings?.meeting_type || "Council meeting"}</Text>
                        {m.source_url ? (
                          <Text style={s.meetingLink} onPress={() => Linking.openURL(withHighlight(m.source_url, card.source_quote)!)}>View agenda ↗</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {reportRecord && (
            <View style={s.yourReport}>
              <Text style={s.yourReportLabel}>Your report</Text>
              <Text style={s.yourReportText}>
                You filed this report. Update its status as things develop — neighbors following this card are notified.
              </Text>
              <View style={s.statusBtns}>
                {([["open", "Open"], ["acknowledged", "Acknowledged by town"], ["in_progress", "Town is working on it"], ["resolved", "Resolved"]] as const).map(([val, label]) => {
                  const on = reportRecord.status === val;
                  return (
                    <Pressable key={val} disabled={updatingStatus || on} onPress={() => updateReportStatus(val)}
                      style={[s.statusBtn, { borderColor: on ? T.teal : T.border, backgroundColor: on ? T.tealLo : "transparent" }]}>
                      <Text style={[s.statusBtnText, { color: on ? T.tealHi : T.creamDim }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {meetings.length === 0 && !reportRecord && (
            <Text style={s.windowEmpty}>This item is on the record. Follow it to be told when its status changes.</Text>
          )}
        </View>

        {/* Related civic items */}
        {relatedCards.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={s.sectionHead}>Related civic items</Text>
            {relatedCards.map((rc) => {
              const ro = OUTCOME_LABELS[rc.outcome_signal] || OUTCOME_LABELS.pending;
              return (
                <Pressable key={rc.id} style={s.relatedCard} onPress={() => router.push({ pathname: "/card/[id]", params: { id: rc.id } })}>
                  <Text style={s.relatedKind}>{rc.source_url?.includes("seeclickfix") ? "311 Report" : "Council item"}</Text>
                  <Text style={s.relatedTitle}>{rc.title}</Text>
                  <View style={s.relatedMeta}>
                    <Text style={[s.pillSm, { backgroundColor: ro.bg, color: ro.color, borderColor: ro.color }]}>{ro.label}</Text>
                    <Text style={s.metaText}>{formatDate(rc.meeting_date)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {card.source_url ? (
          <Text style={s.sourceLink} onPress={() => Linking.openURL(card.source_url)}>→ View original council document ↗</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: "center", alignItems: "center" },
  content: { padding: 16, paddingBottom: 60 },
  emptyText: { color: T.creamDim, fontSize: 14 },

  sourceRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  sourceTag: { fontSize: 10, fontWeight: "500", color: T.amberHi, textTransform: "uppercase", letterSpacing: 1 },
  sourceDot: { fontSize: 10, color: T.creamFaint },
  title: { fontSize: 20, color: T.cream, lineHeight: 27, marginBottom: 12, fontWeight: "600" },
  summary: { fontSize: 14, color: T.creamDim, lineHeight: 25, marginBottom: 14 },
  quote: { paddingHorizontal: 14, paddingVertical: 10, borderLeftWidth: 3, borderLeftColor: T.amber, backgroundColor: T.surface, borderRadius: 8, marginBottom: 14 },
  quoteText: { fontSize: 13, color: T.cream, fontStyle: "italic", lineHeight: 22 },
  quoteSrc: { marginTop: 8, fontSize: 11, color: T.blueHi },
  metaRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99, fontSize: 11, fontWeight: "500", borderWidth: 1, overflow: "hidden" },
  pillSm: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 99, fontSize: 10, fontWeight: "500", borderWidth: 1, overflow: "hidden" },
  metaText: { fontSize: 11, color: T.creamFaint },
  sectionHead: { fontSize: 10, fontWeight: "500", color: T.creamFaint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  explainerText: { fontSize: 13, color: T.creamDim, lineHeight: 22 },
  mapLink: { marginTop: 8, fontSize: 12, color: T.blueHi },
  mapImageWrap: { marginTop: 10, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: T.border },
  mapImage: { width: "100%", aspectRatio: 2, backgroundColor: T.surface },
  reportLoc: { fontSize: 12, color: T.creamDim, marginBottom: 8 },
  reportPhoto: { width: "100%", height: 220, borderRadius: 10, borderWidth: 1, borderColor: T.border },

  watchBtn: { marginTop: 16, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  watchBtnOn: { backgroundColor: T.tealLo, borderColor: T.teal },
  watchBtnOff: { backgroundColor: T.amberLo, borderColor: T.amber },
  watchBtnText: { fontSize: 14, fontWeight: "500", textAlign: "center" },
  signInNote: { fontSize: 11, color: T.creamFaint, textAlign: "center", marginTop: 6 },

  window: { borderWidth: 1, borderColor: T.border, borderRadius: 14, backgroundColor: T.surface, padding: 14, marginTop: 14 },
  windowHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  windowHeadText: { flex: 1, fontSize: 11, fontWeight: "600", color: T.cream, textTransform: "uppercase", letterSpacing: 0.8 },
  windowCount: { fontSize: 11, color: T.creamFaint },
  windowEmpty: { paddingVertical: 16, color: T.creamFaint, fontSize: 12.5, lineHeight: 19, textAlign: "center" },

  post: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border },
  postBody: { fontSize: 13, color: T.creamDim, lineHeight: 22, marginBottom: 6 },
  postMeta: { fontSize: 11, color: T.creamFaint },
  govInbox: { backgroundColor: T.tealLo, borderWidth: 1, borderColor: T.teal, borderRadius: 10, padding: 14, marginTop: 10 },
  govInboxLabel: { fontSize: 10, color: T.tealHi, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "600", marginBottom: 8 },
  govInboxBody: { fontSize: 13, color: T.cream, lineHeight: 22 },
  govInboxMeta: { fontSize: 11, color: T.creamDim, marginTop: 8 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, flexWrap: "wrap" },
  timeline: { borderWidth: 1, borderColor: T.border, borderRadius: 12, backgroundColor: T.bg, paddingHorizontal: 14, paddingVertical: 2, marginBottom: 12 },
  meetingRow: { flexDirection: "row", gap: 12, paddingVertical: 12 },
  meetingRail: { alignItems: "center", alignSelf: "stretch" },
  meetingDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  meetingLine: { flex: 1, width: 1, backgroundColor: T.border, minHeight: 10 },
  meetingContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  meetingDate: { fontSize: 12, color: T.amberHi, fontWeight: "500" },
  meetingType: { fontSize: 12, color: T.creamDim },
  meetingLink: { fontSize: 11, color: T.blueHi },

  yourReport: { borderTopWidth: 1, borderTopColor: T.tealLo, paddingTop: 12, marginTop: 4 },
  yourReportLabel: { fontSize: 10, color: T.tealHi, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "500", marginBottom: 8 },
  yourReportText: { fontSize: 12, color: T.creamDim, marginBottom: 10, lineHeight: 20 },
  statusBtns: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusBtnText: { fontSize: 11 },

  relatedCard: { padding: 12, borderWidth: 1, borderColor: T.border, borderRadius: 10, marginBottom: 8, backgroundColor: T.surface },
  relatedKind: { fontSize: 10, color: T.amberHi, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "500" },
  relatedTitle: { fontSize: 13, color: T.cream, fontWeight: "500", marginBottom: 6, lineHeight: 18 },
  relatedMeta: { flexDirection: "row", gap: 8, alignItems: "center" },
  sourceLink: { fontSize: 13, color: T.blueHi, marginTop: 16 },
});
