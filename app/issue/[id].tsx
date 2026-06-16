import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase, CivicIssue } from "../../lib/supabase";
import { T } from "../../lib/theme";

type Stake = { id: string; body: string; created_at: string };

export default function IssueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [issue, setIssue] = useState<CivicIssue | null>(null);
  const [stakes, setStakes] = useState<Stake[]>([]);
  const [isWatched, setIsWatched] = useState(false);
  const [stakeText, setStakeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);

      const { data: iss } = await supabase
        .from("civic_issues")
        .select("*")
        .eq("id", id)
        .single();
      setIssue(iss);

      const { data: sk } = await supabase
        .from("issue_stakes")
        .select("id, body, created_at")
        .eq("issue_id", id)
        .order("created_at", { ascending: false })
        .limit(10);
      setStakes(sk || []);

      if (user) {
        const { data: w } = await supabase
          .from("watched_concern_cards")
          .select("id")
          .eq("user_id", user.id)
          .eq("civic_issue_id", id)
          .maybeSingle();
        setIsWatched(!!w);
      }

      setLoading(false);
    })();
  }, [id]);

  async function toggleWatch() {
    if (!userId) return;
    if (isWatched) {
      await supabase.from("watched_concern_cards")
        .delete().eq("user_id", userId).eq("civic_issue_id", id);
      setIsWatched(false);
    } else {
      await supabase.from("watched_concern_cards")
        .insert({ user_id: userId, civic_issue_id: id, watched_at: new Date().toISOString() });
      setIsWatched(true);
    }
  }

  async function submitStake() {
    if (!stakeText.trim() || stakeText.trim().length < 10) {
      Alert.alert("Please write at least 10 characters about what's at stake for you.");
      return;
    }
    if (!userId) return;
    setSubmitting(true);
    const { error } = await supabase.from("issue_stakes").insert({
      issue_id: id, user_id: userId, body: stakeText.trim(),
    });
    if (error) {
      Alert.alert("Couldn't save your stake", error.message);
    } else {
      setStakeText("");
      const { data: sk } = await supabase
        .from("issue_stakes")
        .select("id, body, created_at")
        .eq("issue_id", id)
        .order("created_at", { ascending: false })
        .limit(10);
      setStakes(sk || []);
    }
    setSubmitting(false);
  }

  if (loading || !issue) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <View style={s.statusRow}>
        <Text style={s.status}>{issue.status?.toUpperCase()}</Text>
        {issue.scope && <Text style={s.scope}>{issue.scope}</Text>}
      </View>

      <Text style={s.title}>{issue.title}</Text>
      <Text style={s.body}>{issue.body}</Text>

      <View style={s.countsRow}>
        <Text style={s.count}>{issue.support_count ?? 0} support</Text>
        <Text style={s.countDot}>·</Text>
        <Text style={s.count}>{issue.oppose_count ?? 0} oppose</Text>
        <Text style={s.countDot}>·</Text>
        <Text style={s.count}>{issue.stake_count ?? 0} stakes</Text>
      </View>

      <TouchableOpacity
        style={[s.watchBtn, isWatched && s.watchBtnActive]}
        onPress={toggleWatch}
      >
        <Text style={[s.watchBtnText, isWatched && s.watchBtnTextActive]}>
          {isWatched ? "Following" : "Follow this issue"}
        </Text>
      </TouchableOpacity>

      <View style={s.stakeSection}>
        <Text style={s.stakeSectionLabel}>What's at stake for you?</Text>
        <Text style={s.stakePrompt}>
          Write one sentence about how this decision affects you specifically.
        </Text>
        <TextInput
          style={s.stakeInput}
          value={stakeText}
          onChangeText={setStakeText}
          multiline
          numberOfLines={3}
          placeholder="What's at stake for you in this decision?"
          placeholderTextColor={T.creamFaint}
        />
        <TouchableOpacity
          style={[s.stakeBtn, (submitting || stakeText.trim().length < 10) && s.stakeBtnDisabled]}
          onPress={submitStake}
          disabled={submitting || stakeText.trim().length < 10}
        >
          {submitting
            ? <ActivityIndicator color={T.bg} />
            : <Text style={s.stakeBtnText}>Share my stake</Text>}
        </TouchableOpacity>
      </View>

      {stakes.length > 0 && (
        <View style={s.stakesListSection}>
          <Text style={s.stakesListLabel}>How residents say this affects them</Text>
          {stakes.map(st => (
            <View key={st.id} style={s.stakeItem}>
              <Text style={s.stakeBody}>{st.body}</Text>
              <Text style={s.stakeDate}>
                {new Date(st.created_at).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 20, paddingBottom: 60 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  status: { color: T.teal, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  scope: { color: T.creamFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { color: T.cream, fontSize: 22, fontWeight: "600", lineHeight: 30, marginBottom: 14 },
  body: { color: T.creamDim, fontSize: 14, lineHeight: 24, marginBottom: 18 },
  countsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 18 },
  count: { color: T.creamDim, fontSize: 13 },
  countDot: { color: T.creamFaint, fontSize: 13 },
  watchBtn: {
    borderWidth: 1.5, borderColor: T.amber,
    borderRadius: 10, padding: 14, alignItems: "center", marginBottom: 28,
  },
  watchBtnActive: { backgroundColor: T.amber },
  watchBtnText: { color: T.amberHi, fontSize: 14, fontWeight: "600" },
  watchBtnTextActive: { color: T.bg },
  stakeSection: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: 18, marginBottom: 24,
  },
  stakeSectionLabel: { color: T.cream, fontSize: 16, fontWeight: "600", marginBottom: 6 },
  stakePrompt: { color: T.creamDim, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  stakeInput: {
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
    borderRadius: 10, padding: 14, color: T.cream, fontSize: 14,
    minHeight: 80, textAlignVertical: "top",
  },
  stakeBtn: {
    backgroundColor: T.amber, borderRadius: 10, padding: 12,
    alignItems: "center", marginTop: 12,
  },
  stakeBtnDisabled: { opacity: 0.4 },
  stakeBtnText: { color: T.bg, fontWeight: "600", fontSize: 14 },
  stakesListSection: { marginTop: 8 },
  stakesListLabel: {
    color: T.amberHi, fontSize: 11, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 12,
  },
  stakeItem: {
    borderLeftWidth: 2, borderLeftColor: T.amberMid,
    paddingLeft: 12, marginBottom: 14,
  },
  stakeBody: { color: T.cream, fontSize: 14, lineHeight: 22 },
  stakeDate: { color: T.creamFaint, fontSize: 11, marginTop: 4 },
});
