import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  TextInput, Alert, ActivityIndicator,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import YourIssuesScreen from "./issues";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import { reservedNameError } from "../../lib/displayName";
import { goVerify, hasResidencyProof } from "../../lib/residency";
import { T } from "../../lib/theme";
import { timeAgo } from "../../lib/format";
import { enableDevicePush, disableDevicePush, getDevicePushState, PushReason } from "../../lib/push";

type WeekStats = { read: number; watched: number; voted: number; responded: number };

// Exactly the types the notification promise allows.
const NOTIF_TYPES: Record<string, { icon: string; label: string }> = {
  round_trip_closed: { icon: "✓", label: "Round trip closed — a response landed" },
  meeting_imminent: { icon: "!", label: "A meeting affecting your neighborhood is coming up" },
  watched_item_moved: { icon: "→", label: "Something you follow has moved" },
  route_affected: { icon: "🚧", label: "Something affects a road on one of your routes" },
};

const PREF_ROWS = [
  { key: "round_trip_closed", label: "An official responds to an issue you raised or voted on" },
  { key: "meeting_imminent", label: "A council meeting affecting your neighborhood is within 48 hours" },
  { key: "watched_item_moved", label: "A civic issue you're following has been updated" },
  { key: "route_affected", label: "Something affects a road on one of your routes" },
] as const;

// Trust-tier ladder — mirrored verbatim from web (components/ProfileScreen.jsx
// TIERS): same keys, labels, thresholds (trust_score points), and accent colors.
// Standing rises with trust_score; the current tier is highlighted and tiers not
// yet reached are dimmed.
const TIERS = [
  { key: "resident",    label: "Resident",        pts: 0,    color: T.creamDim, dot: T.creamFaint },
  { key: "contributor", label: "Contributor",     pts: 200,  color: T.amberHi,  dot: T.amber },
  { key: "voice",       label: "Community voice",  pts: 600,  color: T.blueHi,   dot: T.blue },
  { key: "moderator",   label: "Moderator",        pts: 1200, color: T.purpleHi, dot: T.purple },
] as const;
const currentTier = (score: number) => [...TIERS].reverse().find((t) => score >= t.pts) || TIERS[0];
const nextTier = (score: number) => TIERS.find((t) => t.pts > score) || null;

export default function ProfileScreen() {
  // /tabs/profile?tab=tracker opens straight onto the Tracker tab (the old
  // standalone tracker destination, now folded into Me).
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"profile" | "tracker">(tab === "tracker" ? "tracker" : "profile");

  const [weekStats, setWeekStats] = useState<WeekStats | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [answerCount, setAnswerCount] = useState(0);
  const [watchedCount, setWatchedCount] = useState<number | null>(null);
  const [lastRoundTrip, setLastRoundTrip] = useState<{ title: string; date: string } | null | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState(0);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifsLoaded, setNotifsLoaded] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({ round_trip_closed: true, meeting_imminent: true, watched_item_moved: true, route_affected: true });
  const [prefsStatus, setPrefsStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [muniId, setMuniId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<{ id: string; name: string; roads: { id: string; road_name: string }[] }[]>([]);
  const [newRouteName, setNewRouteName] = useState("");
  const [newRoadInput, setNewRoadInput] = useState("");
  const [newRouteRoads, setNewRouteRoads] = useState<string[]>([]);
  const [routeSaving, setRouteSaving] = useState(false);
  const [routeError, setRouteError] = useState("");

  // Device (phone) push opt-in. `pushSupported` is false on simulators/emulators
  // (Expo can't mint a token there); `pushOn` reflects OS permission on mount and
  // the last successful subscribe/unsubscribe after that.
  const [pushSupported, setPushSupported] = useState(true);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    getDevicePushState().then(({ supported, granted }) => {
      if (!active) return;
      setPushSupported(supported);
      setPushOn(granted);
    });
    return () => { active = false; };
  }, []));

  // Reload on focus so activity/standing reflect actions taken on other tabs.
  useFocusEffect(useCallback(() => { load(); }, []));

  // Alerts now live inline on the Profile tab, so load them whenever the profile
  // loads (fire-and-forget — a notifications hiccup must never blank the profile).
  useFocusEffect(useCallback(() => { loadNotifications(); }, []));

  async function load() {
    setLoadError(null);
    try {
      const user = await getCurrentUser();  // local read; no getUser network round-trip on mount
      if (!user) { setLoading(false); return; }

      // This-week activity — attention reflected back (STRATEGY §4).
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // ── Phase 1: everything keyed on user.id, in parallel ──────────────
      // The week-stats stay a nested allSettled so a single missing count
      // table can't reject the whole batch (table-tolerance preserved).
      const [profRes, postsRes, answersRes, weekStats, unreadRes, wCountRes, roundTripsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("posts").select("*", { count: "exact", head: true }).eq("author_id", user.id),
        // Expert answers authored — same source/shape as web (expert_answers.expert_id).
        supabase.from("expert_answers").select("*", { count: "exact", head: true }).eq("expert_id", user.id),
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
      setAnswerCount(answersRes.count || 0);

      const [readR, watchR, voteR, replyR, stakeR] = weekStats;
      const cnt = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value.count || 0 : 0);
      setWeekStats({ read: cnt(readR), watched: cnt(watchR), voted: cnt(voteR), responded: cnt(replyR) + cnt(stakeR) });

      setUnreadCount(unreadRes.count || 0);
      setWatchedCount(wCountRes.count || 0);
      const roundTrips = roundTripsRes.data;

      // ── Phase 2: the two reads that depend on phase-1 results, in parallel ──
      const [verified, userVotesRes, hoodRes] = await Promise.all([
        hasResidencyProof(user.id, prof?.neighborhood_id ?? null),
        roundTrips?.length
          ? supabase.from("votes").select("issue_id").eq("user_id", user.id).in("issue_id", roundTrips.map((r) => r.id))
          : Promise.resolve({ data: null }),
        prof?.neighborhood_id
          ? supabase.from("neighborhoods").select("slug").eq("id", prof.neighborhood_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      setVerified(verified);
      if (roundTrips?.length) {
        const votedIds = new Set((userVotesRes.data || []).map((v: any) => v.issue_id));
        const match = roundTrips.find((r: any) => votedIds.has(r.id));
        setLastRoundTrip(match ? { title: match.title, date: match.responded_at } : null);
      } else setLastRoundTrip(null);

      // municipality_id for route_watches — derived from the slug, same
      // approach as web (not a possibly-unset profiles column).
      const prefix = hoodRes.data?.slug?.split("-")[0];
      if (prefix) setMuniId(`${prefix}_nj`);
      loadRoutes(user.id);
    } catch (e) {
      // A dropped connection must say so, not leave the screen blank/stale.
      console.error("Profile load error:", e);
      setLoadError("Couldn't load your profile — tap to retry.");
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    const user = await getCurrentUser(); // local read; no getUser round-trip on the paint path
    if (!user) return;
    const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    setNotifications(data || []);
    setNotifsLoaded(true);
    const { data: prefs } = await supabase.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle();
    if (prefs) setNotifPrefs(prefs);
    // Opening your profile counts as seeing your alerts — mark them read.
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

  // Mirrors web's ProfileScreen.jsx / civic-engine/workers/notifier.py's
  // _normalize_road exactly — the server matches on road_name_normalized as
  // stored, so this must produce the same value for the same input.
  const ROUTE_ROAD_SUFFIXES = new Set([
    "road", "rd", "street", "st", "avenue", "ave", "drive", "dr", "lane", "ln",
    "boulevard", "blvd", "court", "ct", "way", "circle", "cir", "place", "pl",
    "parkway", "pkwy", "terrace", "ter",
  ]);
  function normalizeRoad(s: string): string {
    let lowered = (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    lowered = lowered.replace(/\b(?:route|rt|highway|hwy)\.?\s+(\d+[a-z]?)\b/g, "rt$1");
    const words = lowered.split(/\s+/).filter(Boolean);
    const filtered = words.filter((w) => !ROUTE_ROAD_SUFFIXES.has(w));
    return (filtered.length ? filtered : words).join(" ");
  }

  async function loadRoutes(userId: string) {
    const { data: rws } = await supabase.from("route_watches").select("id, name").eq("user_id", userId).order("created_at");
    if (!rws?.length) { setRoutes([]); return; }
    const { data: roads } = await supabase.from("route_watch_roads").select("id, route_id, road_name").in("route_id", rws.map((r) => r.id));
    setRoutes(rws.map((r) => ({ ...r, roads: (roads || []).filter((rd: any) => rd.route_id === r.id) })));
  }

  function addPendingRoad() {
    const name = newRoadInput.trim();
    if (!name || newRouteRoads.includes(name)) return;
    setNewRouteRoads((r) => [...r, name]);
    setNewRoadInput("");
  }

  async function saveRoute() {
    if (!newRouteName.trim() || newRouteRoads.length === 0 || !muniId || routeSaving) return;
    setRouteSaving(true);
    setRouteError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: route, error } = await supabase.from("route_watches")
        .insert({ user_id: user.id, municipality_id: muniId, name: newRouteName.trim() })
        .select("id, name").single();
      if (error || !route) { setRouteError(error?.message || "Couldn't save route"); return; }
      const { error: roadsErr } = await supabase.from("route_watch_roads").insert(
        newRouteRoads.map((road_name) => ({
          route_id: route.id, user_id: user.id,
          road_name, road_name_normalized: normalizeRoad(road_name),
        }))
      );
      if (roadsErr) { setRouteError(roadsErr.message); return; }
      setRoutes((r) => [...r, { ...route, roads: newRouteRoads.map((road_name, i) => ({ id: `local-${i}`, road_name })) }]);
      setNewRouteName(""); setNewRouteRoads([]); setNewRoadInput("");
    } finally {
      setRouteSaving(false);
    }
  }

  async function deleteRoute(routeId: string) {
    setRoutes((r) => r.filter((rt) => rt.id !== routeId));
    await supabase.from("route_watches").delete().eq("id", routeId);
  }

  function pushErrMsg(reason?: PushReason): string {
    switch (reason) {
      case "simulator":   return "Phone notifications need a real device — they can't be enabled on a simulator.";
      case "denied":      return "Notifications are turned off for Townhall in your device settings. Enable them there, then try again.";
      case "no_session":  return "Your session expired — sign in again and retry.";
      case "network":     return "Couldn't reach the server. Check your connection and try again.";
      default:            return "Something went wrong. Please try again.";
    }
  }

  async function toggleDevicePush() {
    if (pushBusy || !pushSupported) return;
    setPushBusy(true);
    if (!pushOn) {
      const r = await enableDevicePush();
      if (r.ok) setPushOn(true);
      else Alert.alert("Couldn't enable phone notifications", pushErrMsg(r.reason));
    } else {
      const r = await disableDevicePush();
      // A failed unsubscribe from a revoked-permission/token state still means
      // "off" to the user — only surface a real network/server failure.
      if (r.ok || r.reason === "denied" || r.reason === "token_error") setPushOn(false);
      else Alert.alert("Couldn't turn off phone notifications", pushErrMsg(r.reason));
    }
    setPushBusy(false);
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

  // Trust standing derived from trust_score (web parity).
  const score = profile?.trust_score || 0;
  const tier = currentTier(score);
  const next = nextTier(score);

  return (
    <View style={s.root}>
      {/* Header + tabs */}
      <View style={s.head}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/tabs/feed"))}
            accessibilityLabel="Back to your town"
            style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: T.creamDim, fontSize: 15, lineHeight: 18 }}>←</Text>
          </Pressable>
          <Text style={s.headTitle}>Me</Text>
        </View>
        <View style={s.tabs}>
          {[
            { key: "profile", label: "Profile" },
            { key: "tracker", label: "Tracker" },
          ].map((tab) => (
            <Pressable key={tab.key} onPress={() => setActiveTab(tab.key as any)}
              style={[s.tab, activeTab === tab.key && s.tabActive]}>
              <Text style={[s.tabText, activeTab === tab.key && s.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loadError ? (
        <Pressable onPress={() => { setLoading(true); load(); }} style={s.loadErr}>
          <Text style={s.loadErrText}>{loadError}</Text>
        </Pressable>
      ) : null}

      {activeTab === "profile" && (
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

            {/* Standing badges — rendered only when the profile column is set
                (web parity: is_expert / is_official / founding_number pills). */}
            {(profile?.is_expert || profile?.is_official || profile?.founding_number) ? (
              <View style={s.badgeRow}>
                {profile?.is_expert ? (
                  <Text style={[s.badge, { backgroundColor: T.purpleLo, borderColor: T.purpleMid, color: T.purpleHi }]}>
                    ✓ {profile?.expert_credential || "Verified contributor"}
                  </Text>
                ) : null}
                {profile?.is_official ? (
                  <Text style={[s.badge, { backgroundColor: T.tealLo, borderColor: T.teal, color: T.tealHi }]}>
                    ✓ Verified official
                  </Text>
                ) : null}
                {profile?.founding_number ? (
                  <Text style={[s.badge, { backgroundColor: T.amberLo, borderColor: T.amberMid, color: T.amberHi }]}>
                    ★ Founding resident #{profile.founding_number}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {profile?.is_expert && profile?.expert_handle ? (
              <Text style={s.expertHandle}>@{profile.expert_handle}</Text>
            ) : null}
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

          {/* Trust level — the standing ladder (web parity: TIERS). */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Trust level</Text>
            <Text style={s.tierScore}>
              <Text style={{ color: tier.color, fontWeight: "700" }}>{tier.label}</Text> · {score.toLocaleString()} pts
            </Text>
            <Text style={s.tierNext}>
              {next ? `${(next.pts - score).toLocaleString()} pts to ${next.label}` : "Top tier reached"}
            </Text>
            <View style={s.tierLadder}>
              {TIERS.map((t) => {
                const isCurrent = t.key === tier.key;
                const locked = score < t.pts;
                return (
                  <View key={t.key} style={[s.tierRow, isCurrent && s.tierRowCurrent, locked && s.tierRowLocked]}>
                    <View style={[s.tierDot, { backgroundColor: t.dot }]} />
                    <Text style={[s.tierLabel, { color: t.color }]}>{t.label}</Text>
                    <Text style={s.tierPts}>{t.pts === 0 ? "Start" : `${t.pts.toLocaleString()} pts`}</Text>
                  </View>
                );
              })}
            </View>
          </View>

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
            <Text style={s.standingLine}>
              {watchedCount ?? 0} council item{watchedCount === 1 ? "" : "s"} followed · {postCount} post{postCount === 1 ? "" : "s"}
              {answerCount > 0 ? ` · ${answerCount} expert answer${answerCount === 1 ? "" : "s"}` : ""}
            </Text>
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

          {/* Alerts — folded into the Profile tab (mirrors web). Preference
              toggles + recent notifications, inline. */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Alerts</Text>
            <Text style={s.notifNote}>
              Townhall notifies you only when something civically real is happening to you: an official responds to an issue you raised or voted on, a meeting affecting your neighborhood is within 48 hours, or something you're watching moves. No likes, replies, or other social noise.
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

            {/* Device push opt-in — registers this phone with Expo push and
                subscribes via the web /api/push/subscribe endpoint. Real-device
                only; disabled with a note on simulators. */}
            <View style={s.prefRow}>
              <Text style={s.prefLabel}>
                Also send these to my phone{!pushSupported ? " (needs a physical device)" : ""}
              </Text>
              <Pressable
                onPress={toggleDevicePush}
                disabled={pushBusy || !pushSupported}
                style={[s.toggle, { backgroundColor: pushOn ? T.teal : T.border, opacity: pushSupported ? 1 : 0.4 }]}>
                <View style={[s.toggleKnob, { left: pushOn ? 20 : 3 }]} />
              </Pressable>
            </View>

            {/* Honest delivery note: alerts always appear in-app; phone push is
                real now and reflects the toggle above. */}
            <Text style={s.deliveryNote}>
              {!pushSupported
                ? "These alerts appear here inside Townhall — on your 🔔 bell and in the list below. Phone notifications need a physical device."
                : pushOn
                ? "Phone notifications are on — civic alerts will also arrive on this device. They always appear here on your 🔔 bell too."
                : "These alerts appear here inside Townhall — on your 🔔 bell and in the list below. Turn on phone notifications above to also get them on this device."}
            </Text>

            <View style={s.alertsDivider} />
            <Text style={s.recentLabel}>Recent</Text>
            {!notifsLoaded ? (
              <ActivityIndicator color={T.amber} style={{ marginVertical: 16 }} />
            ) : notifications.length === 0 ? (
              <Text style={s.weekNote}>You're all caught up. You'll be notified only when something civically real happens.</Text>
            ) : (
              notifications.map((n) => {
                const meta = NOTIF_TYPES[n.type] || { icon: "·", label: n.type };
                const body = n.payload?.message || n.payload?.response || n.payload?.title || n.payload?.change || n.payload?.body;
                return (
                  <View key={n.id} style={s.notifRow}>
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
          </View>

          {/* Routes — a named group of roads a resident wants alerted on. No
              route geometry (no directions API, no PostGIS line data): matching
              is text-based against a card's title/summary/affected_area, so
              this means "mentions a road you use," not "falls on your literal
              path." Mirrors web's ProfileScreen.jsx Routes section. */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Routes</Text>
            <Text style={s.notifNote}>
              Add the roads you regularly drive — a commute, a school run — and get alerted when something (roadwork, a closure, a council item) mentions one of them.
            </Text>
            <Text style={s.routeCaption}>
              This matches by road name, not live traffic or an exact map — it can't tell if the roadwork is at your end of a long road or the other, and it may miss a road spelled differently than you typed it.
            </Text>

            {routes.map((route) => (
              <View key={route.id} style={s.routeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.routeName}>{route.name}</Text>
                  <View style={s.routeChips}>
                    {route.roads.map((rd) => (
                      <View key={rd.id} style={s.routeChip}><Text style={s.routeChipText}>{rd.road_name}</Text></View>
                    ))}
                  </View>
                </View>
                <Pressable onPress={() => deleteRoute(route.id)} hitSlop={10}>
                  <Text style={s.routeDelete}>✕</Text>
                </Pressable>
              </View>
            ))}

            <TextInput style={[s.nameInput, { textAlign: "left", marginTop: routes.length ? 14 : 0, marginBottom: 8 }]}
              value={newRouteName} onChangeText={setNewRouteName}
              placeholder="Route name (e.g. Commute to work)" placeholderTextColor={T.creamFaint} maxLength={60} />
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <TextInput style={[s.nameInput, { textAlign: "left", flex: 1 }]}
                value={newRoadInput} onChangeText={setNewRoadInput}
                onSubmitEditing={addPendingRoad}
                placeholder="Road name (e.g. Cedar Swamp Road)" placeholderTextColor={T.creamFaint} maxLength={80} />
              <Pressable onPress={addPendingRoad} disabled={!newRoadInput.trim()} style={s.routeAddBtn}>
                <Text style={{ color: T.creamDim, fontSize: 13 }}>Add</Text>
              </Pressable>
            </View>
            {newRouteRoads.length > 0 && (
              <View style={s.routeChips}>
                {newRouteRoads.map((name) => (
                  <View key={name} style={s.routePendingChip}>
                    <Text style={s.routePendingChipText}>{name}</Text>
                    <Pressable onPress={() => setNewRouteRoads((r) => r.filter((n) => n !== name))} hitSlop={8}>
                      <Text style={s.routePendingChipText}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {routeError ? <Text style={{ color: T.redHi, fontSize: 11, marginTop: 8 }}>{routeError}</Text> : null}
            <Pressable onPress={saveRoute} disabled={!newRouteName.trim() || newRouteRoads.length === 0 || routeSaving}
              style={[s.routeSaveBtn, (!newRouteName.trim() || newRouteRoads.length === 0 || routeSaving) && { opacity: 0.5 }]}>
              <Text style={s.routeSaveBtnText}>{routeSaving ? "Saving…" : "Save route"}</Text>
            </Pressable>
          </View>

          <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}><Text style={s.signOutText}>Sign out</Text></TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteAccount}><Text style={s.deleteText}>Request account deletion</Text></TouchableOpacity>
        </ScrollView>
      )}

      {/* Tracker — the round-trip ledger, folded into Me (mirrors web) */}
      {activeTab === "tracker" && <YourIssuesScreen />}
    </View>
  );
}

const s = StyleSheet.create({
  loadErr: { marginHorizontal: 16, marginTop: 12, padding: 12, borderWidth: 1, borderColor: T.redHi + "55", backgroundColor: T.redLo, borderRadius: 10 },
  loadErrText: { color: T.redHi, fontSize: 13, lineHeight: 18 },
  root: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: "center", alignItems: "center", padding: 32 },
  content: { padding: 20, paddingBottom: 60 },

  head: { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 20, paddingTop: 14 },
  headTitle: { fontSize: 18, color: T.cream, marginBottom: 12, fontWeight: "600" },
  // Segmented control — selection is the amber fill, so both labels stay
  // full-contrast (fixes the dim-text / unclear-pill problem). Mirrors web.
  tabs: { flexDirection: "row", alignSelf: "flex-start", gap: 4, marginBottom: 12,
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 11, padding: 4 },
  tab: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 8 },
  tabActive: { backgroundColor: T.amber },
  tabText: { fontSize: 13, color: T.cream },
  tabTextActive: { color: T.bg, fontWeight: "600" },

  identityCard: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 14 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: T.amberLo, borderWidth: 2, borderColor: T.amber, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarLetter: { color: T.amberHi, fontSize: 24, fontWeight: "700" },
  displayName: { color: T.cream, fontSize: 20, fontWeight: "600" },
  editHint: { color: T.amberHi, fontSize: 14 },
  neighborhood: { color: T.creamDim, fontSize: 13, marginTop: 4 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 10 },
  badge: { fontSize: 11, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, overflow: "hidden" },
  expertHandle: { color: T.purpleHi, fontSize: 11, marginTop: 6 },
  tierScore: { color: T.cream, fontSize: 15, marginBottom: 2 },
  tierNext: { color: T.creamDim, fontSize: 12, marginBottom: 12 },
  tierLadder: { gap: 6 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: "transparent" },
  tierRowCurrent: { backgroundColor: T.amberLo, borderColor: T.amberMid },
  tierRowLocked: { opacity: 0.35 },
  tierDot: { width: 9, height: 9, borderRadius: 5 },
  tierLabel: { fontSize: 13, fontWeight: "600", flex: 1 },
  tierPts: { fontSize: 11, color: T.creamDim },
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
  alertsDivider: { height: 1, backgroundColor: T.border, marginTop: 18, marginBottom: 14 },

  routeCaption: { color: T.creamFaint, fontSize: 11, lineHeight: 16, fontStyle: "italic", marginTop: 6 },
  routeRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border, marginTop: 12 },
  routeName: { color: T.cream, fontSize: 14, fontWeight: "600", marginBottom: 5 },
  routeChips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  routeChip: { backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  routeChipText: { color: T.creamDim, fontSize: 11 },
  routeDelete: { color: T.creamFaint, fontSize: 15, padding: 4 },
  routeAddBtn: { paddingHorizontal: 14, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: T.border },
  routePendingChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 4 },
  routePendingChipText: { color: T.amberHi, fontSize: 11 },
  routeSaveBtn: { backgroundColor: T.amber, borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  routeSaveBtnText: { color: T.bg, fontSize: 14, fontWeight: "700" },
  recentLabel: { color: T.creamFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

  signOutBtn: { marginTop: 10, borderWidth: 1, borderColor: T.border, borderRadius: 10, padding: 14, alignItems: "center" },
  signOutText: { color: T.creamDim, fontSize: 14 },
  deleteText: { color: T.redHi, fontSize: 12, textAlign: "center", marginTop: 16 },

  ghostBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: T.border },
  ghostBtnText: { color: T.creamDim, fontSize: 13 },
  amberBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: T.amber },
  amberBtnText: { color: T.bg, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.4 },

  prefsStatus: { fontSize: 11, marginTop: 12, color: T.teal },
  prefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  prefLabel: { fontSize: 12, color: T.creamDim, flex: 1, marginRight: 12, lineHeight: 18 },
  toggle: { width: 40, height: 22, borderRadius: 99, justifyContent: "center" },
  toggleKnob: { position: "absolute", top: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" },
  deliveryNote: { fontSize: 11, color: T.creamFaint, lineHeight: 17, marginTop: 14, padding: 12, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 8 },

  notifRow: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: T.border, marginBottom: 8 },
  notifIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" },
  notifIconText: { fontSize: 13, color: T.amberHi },
  notifLabel: { fontSize: 13, color: T.cream, marginBottom: 3 },
  notifBody: { fontSize: 12, color: T.creamDim, lineHeight: 18 },
  notifTime: { fontSize: 11, color: T.creamFaint, marginTop: 4 },
});
