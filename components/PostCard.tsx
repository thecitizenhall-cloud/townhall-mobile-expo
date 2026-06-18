// PostCard — a resident post in the Town feed, ported from the PostCard in the
// web components/TownScreen.jsx: author/bot identity, tags, upvote, escalate to
// the civic tracker, "open issue" link, and a report menu. Bot (council) and
// official posts get distinct treatment.
import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, Alert } from "react-native";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";
import { timeAgo, initials } from "../lib/format";

const TAGS: Record<string, { bg: string; color: string; border: string }> = {
  banter: { bg: "#2A1E08", color: "#F0B84A", border: "#8C5E14" },
  issue: { bg: "#0D1E35", color: "#85B7EB", border: "#185FA5" },
  question: { bg: "#0A2A1E", color: "#4CAF80", border: "#1D9E75" },
  bulletin: { bg: "#1A1835", color: "#AFA9EC", border: "#534AB7" },
};

const AV_COLORS = [
  { bg: "#2A1E08", color: "#F0B84A" }, { bg: "#0A2A1E", color: "#4CAF80" },
  { bg: "#1A1835", color: "#AFA9EC" }, { bg: "#0D1E35", color: "#85B7EB" },
  { bg: "#2A0E0A", color: "#E57373" },
];
function av(id?: string) {
  let h = 0;
  for (let i = 0; i < String(id || "").length; i++) h = (h * 31 + String(id).charCodeAt(i)) | 0;
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
}

const REPORT_REASONS = [
  { key: "inappropriate", label: "Inappropriate content" },
  { key: "intimate_imagery", label: "Nonconsensual intimate imagery" },
  { key: "spam", label: "Spam or misleading" },
  { key: "harassment", label: "Harassment" },
  { key: "misinformation", label: "Misinformation" },
  { key: "other", label: "Other" },
];

function PostTag({ tag }: { tag: string }) {
  const st = TAGS[tag] || TAGS.banter;
  return <Text style={[s.tag, { backgroundColor: st.bg, color: st.color, borderColor: st.border }]}>{tag}</Text>;
}

export default function PostCard({
  post, currentUserId, onVote, onEscalate, onOpenIssue,
}: {
  post: any;
  currentUserId?: string | null;
  onVote: (post: any) => void;
  onEscalate: (post: any) => void;
  onOpenIssue: (issueId: string) => void;
}) {
  const [reported, setReported] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const name = post.profiles?.display_name || "Resident";
  const hood = post.profiles?.neighborhood || "Townhall";
  const isBot = post.profiles?.is_bot || false;
  const source = post.source_name || null;
  const a = av(post.author_id);
  const tags: string[] = post.tags || [];
  const isBulletin = tags.includes("bulletin") && !isBot;
  const isOfficialPost = isBulletin && post.profiles?.is_official;
  const canEscalate = currentUserId && !post.escalated && tags.some((t) => ["issue", "banter"].includes(t));

  function confirmEscalate() {
    Alert.alert("Escalate to civic tracker", "Move this post to the civic tracker? This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Escalate", onPress: () => onEscalate(post) },
    ]);
  }

  async function handleReport(reason: string) {
    setShowMenu(false);
    const { error } = await supabase.from("reported_posts").insert({ post_id: post.id, reporter_id: currentUserId, reason });
    if (!error || error.code === "23505") setReported(true);
  }

  return (
    <View style={s.post}>
      <View style={s.metaRow}>
        {isBot ? (
          <View style={s.botAvatar}><Text style={{ fontSize: 16 }}>🏛️</Text></View>
        ) : (
          <View style={[s.avatar, { backgroundColor: a.bg }]}><Text style={[s.avatarText, { color: a.color }]}>{initials(name)}</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <View style={s.authorRow}>
            <Text style={s.author}>{name}</Text>
            {isBot && source ? <Text style={s.sourceBadge}>{source}</Text> : null}
            {isOfficialPost ? <Text style={s.officialBadge}>✓ Official</Text> : null}
            {!isBot && post.author_id === currentUserId ? <Text style={s.youBadge}>you</Text> : null}
          </View>
          <Text style={s.hood}>{hood}</Text>
        </View>
        <View style={s.metaRight}>
          <Text style={s.time}>{timeAgo(post.created_at)}</Text>
          {post.author_id !== currentUserId && !isBot && currentUserId ? (
            <Pressable onPress={() => setShowMenu((m) => !m)} hitSlop={8}>
              <Text style={[s.flag, reported && { color: T.amberHi }]}>⚑</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {showMenu && !reported && (
        <View style={s.reportMenu}>
          <Text style={s.reportMenuHead}>Report reason</Text>
          {REPORT_REASONS.map((r) => (
            <Pressable key={r.key} onPress={() => handleReport(r.key)} style={s.reportItem}>
              <Text style={s.reportItemText}>{r.label}</Text>
            </Pressable>
          ))}
          <Text style={s.reportNote}>Nonconsensual intimate imagery is removed within 48 hours.</Text>
        </View>
      )}

      <Text style={s.body}>{post.body}</Text>

      <View style={s.tagsRow}>
        {tags.map((t) => <PostTag key={t} tag={t} />)}
        {post.escalated ? <Text style={[s.tag, { backgroundColor: T.blueLo, color: T.blueHi, borderColor: T.blue }]}>escalated</Text> : null}
      </View>

      <View style={s.actions}>
        <Pressable onPress={() => onVote(post)} style={[s.actionBtn, post.user_has_upvoted && s.actionBtnVoted]}>
          <Text style={[s.actionBtnText, post.user_has_upvoted && { color: T.amberHi }]}>▲ {post.upvote_count || 0}</Text>
        </Pressable>
        {post.source_url ? (
          <Pressable onPress={() => Linking.openURL(post.source_url)} style={s.actionBtn}>
            <Text style={[s.actionBtnText, { color: T.blueHi }]}>View source ↗</Text>
          </Pressable>
        ) : null}
        {canEscalate ? (
          <Pressable onPress={confirmEscalate} style={s.actionBtn}>
            <Text style={[s.actionBtnText, { color: T.blueHi }]}>↑ Escalate</Text>
          </Pressable>
        ) : null}
        {post.escalated && post.escalated_issue_id ? (
          <Pressable onPress={() => onOpenIssue(post.escalated_issue_id)} style={{ marginLeft: "auto" }}>
            <Text style={s.openIssue}>✓ Open issue →</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  post: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.border },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 12, fontWeight: "600" },
  botAvatar: { width: 34, height: 34, borderRadius: 9, backgroundColor: "#0D1E35", borderWidth: 1, borderColor: "#378ADD44", alignItems: "center", justifyContent: "center" },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  author: { fontSize: 13, fontWeight: "500", color: T.cream },
  sourceBadge: { fontSize: 10, backgroundColor: "#0D1E35", color: "#85B7EB", borderWidth: 1, borderColor: "#378ADD44", borderRadius: 99, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  officialBadge: { fontSize: 10, backgroundColor: T.tealLo, color: T.tealHi, borderWidth: 1, borderColor: T.teal, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 1, fontWeight: "500", overflow: "hidden" },
  youBadge: { fontSize: 10, color: T.amberHi },
  hood: { fontSize: 11, color: T.creamFaint, marginTop: 2 },
  metaRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  time: { fontSize: 11, color: T.creamFaint },
  flag: { fontSize: 14, color: T.creamFaint, paddingHorizontal: 2 },
  reportMenu: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 9, paddingVertical: 6, marginTop: 8 },
  reportMenuHead: { paddingHorizontal: 12, paddingBottom: 6, fontSize: 10, color: T.creamFaint, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.8 },
  reportItem: { paddingHorizontal: 14, paddingVertical: 8 },
  reportItemText: { fontSize: 13, color: T.creamDim },
  reportNote: { borderTopWidth: 1, borderTopColor: T.border, marginTop: 6, paddingHorizontal: 14, paddingTop: 8, fontSize: 11, color: T.creamFaint, lineHeight: 16 },
  body: { fontSize: 14, color: T.cream, lineHeight: 22, marginTop: 10 },
  tagsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 10 },
  tag: { fontSize: 10, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, borderWidth: 1, overflow: "hidden", textTransform: "lowercase" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  actionBtnVoted: { backgroundColor: T.amberLo },
  actionBtnText: { fontSize: 12, color: T.creamDim },
  openIssue: { fontSize: 11, color: T.blueHi },
});
