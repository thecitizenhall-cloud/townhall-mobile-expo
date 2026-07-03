import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  TextInput, Alert, ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import { reservedNameError } from "../../lib/displayName";
import { goVerify, hasResidencyProof } from "../../lib/residency";
import { T } from "../../lib/theme";
import { timeAgo } from "../../lib/format";

type WeekStats = { read: number; watched: number; voted: number; responded: number };

// Exactly the three types the notification promise allows.
const NOTIF_TYPES: Record<string, { icon: string; label: string }> = {
  round_trip_closed: { icon: "✓", label: "Round trip closed — a response landed" },
  meeting_imminent: { icon: "!", label: "A meeting affecting your neighborhood is coming up" },
  watched_item_moved: { icon: "→", label: "Something you follow has moved" },
};

const PREF_ROWS = [
  { key: "round_trip_closed", label: "An official responds to an issue you raised or voted on" },
  { key: "meeting_imminent", label: "A council meeting affecting your neighborhood is within 48 hours" },
  { key: "watched_item_moved", label: "A civic issue you're following has been updated" },
] as const;

export default function ProfileScreen() {
  const [profile, setProfile] = useState<any>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"profile" | "notifications">("profile");

  const [weekStats, setWeekStats] = useState<WeekStats | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [watchedCount, setWatchedCount] = useState<number | null>(null);
  const [lastRoundTrip, setLastRoundTrip] = useState<{ title: string; date: string } | null | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState(0);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifsLoaded, setNotifsLoaded] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({ round_trip_closed: true, meeting_imminent: true, watched_item_moved: true });
  const [prefsStatus, setPrefsStatus] = useState<"" | "saving" | "saved" | "error">("");

  // Reload on focus so activity/standing reflect actions taken on other tabs.
  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    try {
      const user = await getCurrentUser();  // local read; no getUser network round-trip on mount
      if (!user) { setLoading(false); return; }

      // This-week activity — attention reflected back (STRATEGY §4).
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // ── Phase 1: everything keyed on user.id, in parallel ──────────────
      // The week-stats stay a nested allSettled so a single missing count
      // table can't reject the whole batch (table-tolerance preserved).
      const [profRes, postsRes, weekStats, unreadRes, wCountRes, roundTripsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("posts").select("*", { count: "exact", head: true }).eq("author_id", user.id),
        Promise.allSettled([
          supabase.from("concern_card_views").select("*", { count: "exact", head: true }).eq("user_id", user.id).gte("first_viewed_at", weekAgo),
          supabase.from("card_watches").select("*", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", weekAgo),
          supabase.from("votes").select("*", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", weekAgo),
          supabase.from("issue_replies").select("*", { count: "exact", head: true }).eq("author_id", user.id).gte("created_at", weekAgo),
          supabase.from("issue_stakes").select("*", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", weekAgo),
        ]),
        supabase.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
        supabase.from("card_watches").select("*", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("civic_issues")
          .select("id, title, responded_at, official_response")
          .not("official_response", "is", null).order("responded_at", { ascending: false }).limit(5),
      ]);

      const prof = profRes.data;
      setProfile({ ...(prof || {}), email: user.email });
      setNameDraft(prof?.display_name || "");
      setPostCount(postsRes.count || 0);

      const [readR, watchR, voteR, replyR, stakeR] = weekStats;
      const cnt = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value.count || 0 : 0);
      setWeekStats({ read: cnt(readR), watched: cnt(watchR), voted: cnt(voteR), responded: cnt(replyR) + cnt(stakeR) });

      setUnreadCount(unreadRes.count || 0);
      setWatchedCount(wCountRes.count || 0);
      const roundTrips = roundTripsRes.data;

      // ── Phase 2: the two reads that depend on phase-1 results, in parallel ──
      const [verified, userVotesRes] = await Promise.all([
        hasResidencyProof(user.id, prof?.neighborhood_id ?? null),
        roundTrips?.length
          ? supabase.from("votes").select("issue_id").eq("user_id", user.id).in("issue_id", roundTrips.map((r) => r.id))
          : Promise.resolve({ data: null }),
      ]);

      setVerified(verified);
      if (roundTrips?.length) {
        const votedIds = new Set((userVotesRes.data || []).map((v: any) => v.issue_id));
        const match = roundTrips.find((r: any) => votedIds.has(r.id));
        setLastRoundTrip(match ? { title: match.title, date: match.responded_at } : null);
      } else setLastRoundTrip(null);
    } catch (e) {
      console.error("Profile load error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    if (notifsLoaded) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    setNotifications(data || []);
    setNotifsLoaded(true);
    const { data: prefs } = await supabase.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle();
    if (prefs) setNotifPrefs(prefs);
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    setUnreadCount(0);
  }

  async function saveNotifPrefs(key: string, val: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const prev = notifPrefs;
    const newPrefs = { ...notifPrefs, [key]: val };
    setNotifPrefs(newPrefs);
    setPrefsStatus("saving");
    const { error } = await supabase.from("notification_preferences")
      .upsert({ user_id: user.id, ...newPrefs, updated_at: new Date().toISOString() });
    if (error) { setNotifPrefs(prev); setPrefsStatus("error"); }
    else { setPrefsStatus("saved"); setTimeout(() => setPrefsStatus((s) => (s === "saved" ? "" : s)), 1500); }
  }

  async function saveName() {
    if (!nameDraft.trim() || saving) return;
    const nameErr = reservedNameError(nameDraft);
    if (nameErr) { Alert.alert("Choose a different name", nameErr); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("profiles").update({ display_name: nameDraft.trim() }).eq("id", user.id);
      if (!error) { setProfile((p: any) => ({ ...p, display_name: nameDraft.trim() })); setEditingName(false); }
      else Alert.alert("Couldn't save", error.message);
    }
    setSaving(false);
  }

  function handleSignOut() {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: async () => { await supabase.auth.signOut(); router.replace("/auth/login"); } },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert("Delete account", "This requests permanent deletion of your account and data. Continue?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Request deletion", style: "destructive",
        onPress: async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          await supabase.from("deletion_requests").insert({ user_id: user.id, email: user.email });
          Alert.alert("Requested", "Your deletion request has been recorded.");
        },
      },
    ]);
  }

  if (loading) {
    return <View style={[s.root, s.center]}><ActivityIndicator color={T.amber} /></View>;
  }

  return (
    <View style={s.root}>
      {/* Header + tabs */}
      <View style={s.head}>
        <Text style={s.headTitle}>Me</Text>
        <View style={s.tabs}>
          {[
            { key: "profile", label: "Profile" },
            { key: "notifications", label: unreadCount > 0 ? `Alerts · ${unreadCount}` : "Alerts" },
          ].map((tab) => (
            <Pressable key={tab.key} onPress={() => { setActiveTab(tab.key as any); if (tab.key === "notifications") loadNotifications(); }}
              style={[s.tab, activeTab === tab.key && s.tabActive]}>
              <Text style={[s.tabText, activeTab === tab.key && s.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === "profile" ? (
        <ScrollView style={s.root} contentContainerStyle={s.content}>
          <View style={s.identityCard}>
            <View style={s.avatar}><Text style={s.avatarLetter}>{(profile?.display_name?.[0] || "?").toUpperCase()}</Text></View>
            {editingName ? (
              <View style={{ width: "100%", marginTop: 8 }}>
                <TextInput style={s.nameInput} value={nameDraft} onChangeText={setNameDraft} autoFocus placeholder="Display name" placeholderTextColor={T.creamFaint} />
                <View style={s.nameBtns}>
                  <Pressable onPress={() => { setEditingName(false); setNameDraft(profile?.display_name || ""); }} style={s.ghostBtn}><Text style={s.ghostBtnText}>Cancel</Text></Pressable>
                  <Pressable onPress={saveName} disabled={!nameDraft.trim() || saving} style={[s.amberBtn, (!nameDraft.trim() || saving) && s.disabled]}><Text style={s.amberBtnText}>{saving ? "Saving…" : "Save"}</Text></Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setEditingName(true)}>
                <Text style={s.displayName}>{profile?.display_name ?? "Resident"} <Text style={s.editHint}>✎</Text></Text>
              </Pressable>
            )}
            {profile?.neighborhood ? <Text style={s.neighborhood}>{profile.neighborhood}</Text> : null}
          </View>

          {/* This week */}
          {weekStats && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>This week</Text>
              <Text style={s.weekLine}>
                {weekStats.read} concern card{weekStats.read === 1 ? "" : "s"} read · {weekStats.watched} item{weekStats.watched === 1 ? "" : "s"} watched · {weekStats.voted} vote{weekStats.voted === 1 ? "" : "s"} cast · {weekStats.responded} stake{weekStats.responded === 1 ? "" : "s"}/repl{weekStats.responded === 1 ? "y" : "ies"}
              </Text>
              <Text style={s.weekNote}>Attention is a civic act, and we count it as one.</Text>
            </View>
          )}

          {/* Residency */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Residency</Text>
            <View style={s.statusRow}>
              <View style={[s.dot, { backgroundColor: verified ? T.teal : T.creamFaint }]} />
              <Text style={s.statusText}>{verified ? "Verified resident (ZK proof on file)" : "Not yet verified"}</Text>
            </View>
            {!verified && (
              <TouchableOpacity style={s.verifyBtn} onPress={goVerify}><Text style={s.verifyBtnText}>Verify residency</Text></TouchableOpacity>
            )}
          </View>

          {/* Your civic standing */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Your civic standing</Text>
            <Text style={s.standingLine}>{watchedCount ?? 0} council item{watchedCount === 1 ? "" : "s"} followed · {postCount} post{postCount === 1 ? "" : "s"}</Text>
            {lastRoundTrip ? (
              <View style={s.roundTrip}>
                <Text style={s.roundTripLabel}>Most recent closed round trip</Text>
                <Text style={s.roundTripTitle}>{lastRoundTrip.title}</Text>
                <Text style={s.roundTripDate}>Official responded {timeAgo(lastRoundTrip.date)}</Text>
              </View>
            ) : (
              <Text style={s.weekNote}>No closed round trip yet — follow an issue to start one.</Text>
            )}
          </View>

          {/* Notification promise */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Notifications</Text>
            <Text style={s.notifNote}>
              Townhall notifies you only when something civically real is happening: a round trip closes, a meeting affecting you is imminent, or something you're watching moves.
            </Text>
            <Pressable onPress={() => { setActiveTab("notifications"); loadNotifications(); }}>
              <Text style={s.manageLink}>Manage alert settings →</Text>
            </Pressable>
          </View>

          <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}><Text style={s.signOutText}>Sign out</Text></TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteAccount}><Text style={s.deleteText}>Request account deletion</Text></TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView style={s.root} contentContainerStyle={s.content}>
          {!notifsLoaded ? (
            <View style={s.center}><ActivityIndicator color={T.amber} /></View>
          ) : (
            <>
              <View style={s.promiseBox}>
                <Text style={s.notifNote}>
                  Townhall only notifies you when something civically real is happening to you: an official response to an issue you raised or voted on, a meeting affecting your neighborhood within 48 hours, or something you're watching moving. We do not tell you about likes, replies, new posts, or other social activity.
                </Text>
                {prefsStatus ? (
                  <Text style={[s.prefsStatus, prefsStatus === "error" && { color: T.redHi }]}>
                    {prefsStatus === "saving" ? "Saving…" : prefsStatus === "saved" ? "Saved ✓" : "Couldn't save — check your connection."}
                  </Text>
                ) : null}
                {PREF_ROWS.map((pref) => {
                  const on = !!notifPrefs[pref.key];
                  return (
                    <View key={pref.key} style={s.prefRow}>
                      <Text style={s.prefLabel}>{pref.label}</Text>
                      <Pressable onPress={() => saveNotifPrefs(pref.key, !on)} style={[s.toggle, { backgroundColor: on ? T.teal : T.border }]}>
                        <View style={[s.toggleKnob, { left: on ? 20 : 3 }]} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {notifications.length === 0 ? (
                <View style={s.notifEmpty}>
                  <Text style={s.notifEmptyIcon}>🔔</Text>
                  <Text style={s.notifEmptyText}>You're all caught up.</Text>
                  <Text style={s.notifEmptySub}>You'll be notified only when something civically real happens.</Text>
                </View>
              ) : (
                notifications.map((n) => {
                  const meta = NOTIF_TYPES[n.type] || { icon: "·", label: n.type };
                  const body = n.payload?.message || n.payload?.response || n.payload?.title || n.payload?.change || n.payload?.body;
                  return (
                    <View key={n.id} style={[s.notifRow, !n.read && { backgroundColor: T.amberLo }]}>
                      <View style={s.notifIcon}><Text style={s.notifIconText}>{meta.icon}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.notifLabel}>{meta.label}</Text>
                        {body ? <Text style={s.notifBody}>{String(body).slice(0, 120)}{String(body).length > 120 ? "…" : ""}</Text> : null}
                        <Text style={s.notifTime}>{timeAgo(n.created_at)}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: "center", alignItems: "center", padding: 32 },
  content: { padding: 20, paddingBottom: 60 },

  head: { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 20, paddingTop: 14 },
  headTitle: { fontSize: 18, color: T.cream, marginBottom: 12, fontWeight: "600" },
  tabs: { flexDirection: "row" },
  tab: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: T.amber },
  tabText: { fontSize: 13, color: T.creamDim },
  tabTextActive: { color: T.amberHi, fontWeight: "500" },

  identityCard: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 14 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: T.amberLo, borderWidth: 2, borderColor: T.amber, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarLetter: { color: T.amberHi, fontSize: 24, fontWeight: "700" },
  displayName: { color: T.cream, fontSize: 20, fontWeight: "600" },
  editHint: { color: T.amberHi, fontSize: 14 },
  neighborhood: { color: T.creamDim, fontSize: 13, marginTop: 4 },
  nameInput: { backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: T.cream, fontSize: 16, textAlign: "center" },
  nameBtns: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 10 },

  section: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 18, marginBottom: 14 },
  sectionLabel: { color: T.amberHi, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 12 },
  weekLine: { color: T.cream, fontSize: 14, lineHeight: 22 },
  weekNote: { color: T.creamFaint, fontSize: 12, marginTop: 8, lineHeight: 18 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: T.cream, fontSize: 14 },
  verifyBtn: { marginTop: 14, backgroundColor: T.amber, borderRadius: 10, padding: 12, alignItems: "center" },
  verifyBtnText: { color: T.bg, fontWeight: "600", fontSize: 14 },
  standingLine: { color: T.cream, fontSize: 14, lineHeight: 22 },
  roundTrip: { marginTop: 12, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 12 },
  roundTripLabel: { color: T.creamFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  roundTripTitle: { color: T.cream, fontSize: 14, fontWeight: "500" },
  roundTripDate: { color: T.tealHi, fontSize: 12, marginTop: 4 },
  notifNote: { color: T.creamDim, fontSize: 13, lineHeight: 20 },
  manageLink: { color: T.amberHi, fontSize: 13, marginTop: 12 },

  signOutBtn: { marginTop: 10, borderWidth: 1, borderColor: T.border, borderRadius: 10, padding: 14, alignItems: "center" },
  signOutText: { color: T.creamDim, fontSize: 14 },
  deleteText: { color: T.redHi, fontSize: 12, textAlign: "center", marginTop: 16 },

  ghostBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: T.border },
  ghostBtnText: { color: T.creamDim, fontSize: 13 },
  amberBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: T.amber },
  amberBtnText: { color: T.bg, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.4 },

  promiseBox: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 16, marginBottom: 14 },
  prefsStatus: { fontSize: 11, marginTop: 12, color: T.teal },
  prefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  prefLabel: { fontSize: 12, color: T.creamDim, flex: 1, marginRight: 12, lineHeight: 18 },
  toggle: { width: 40, height: 22, borderRadius: 99, justifyContent: "center" },
  toggleKnob: { position: "absolute", top: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" },

  notifEmpty: { alignItems: "center", paddingVertical: 48 },
  notifEmptyIcon: { fontSize: 28, marginBottom: 12 },
  notifEmptyText: { color: T.creamDim, fontSize: 14 },
  notifEmptySub: { color: T.creamFaint, fontSize: 12, marginTop: 6, textAlign: "center", lineHeight: 18 },
  notifRow: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: T.border, marginBottom: 8 },
  notifIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" },
  notifIconText: { fontSize: 13, color: T.amberHi },
  notifLabel: { fontSize: 13, color: T.cream, marginBottom: 3 },
  notifBody: { fontSize: 12, color: T.creamDim, lineHeight: 18 },
  notifTime: { fontSize: 11, color: T.creamFaint, marginTop: 4 },
});
