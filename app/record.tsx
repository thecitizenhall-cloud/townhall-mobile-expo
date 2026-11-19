import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import CivicFeedItem from "../components/CivicFeedItem";
import { SITE_URL } from "../lib/config";
import { useTheme, useStyles, type Palette } from "../lib/themeContext";
import { RecordSearch, RECORD_QUERY_MAX } from "../lib/recordSearchClient";
import type { CivicItem } from "../lib/supabase";

// The searchable town record. The feed passes the town it is showing (its
// `townId`, "<town>_<state>"); the search itself runs on the web app's
// /api/town-record, so the matching is the web record's, not a copy.
const DEBOUNCE_MS = 300;

export default function TownRecord() {
  const T = useTheme();
  const s = useStyles(makeStyles);
  const params = useLocalSearchParams<{ town?: string | string[] }>();
  const town = (Array.isArray(params.town) ? params.town[0] : params.town) ?? "";

  // One controller per town; it owns the paging and which reply may land.
  const search = useMemo(
    () => (town ? new RecordSearch(town, SITE_URL, (url, init) => fetch(url, init)) : null),
    [town],
  );
  useEffect(() => () => search?.dispose(), [search]);
  const st = useSyncExternalStore(
    search ? search.subscribe : noSubscribe,
    search ? search.getState : getIdle,
    search ? search.getState : getIdle,
  );

  const [text, setText] = useState("");
  // The first load is immediate; later keystrokes wait for a pause.
  useEffect(() => {
    if (!search) return;
    const first = search.getState().status === "idle" && !search.getState().loaded;
    const id = setTimeout(() => { search.search(text); }, first ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search, text]);

  function open(c: CivicItem) {
    if (c.concern_card_id) router.push({ pathname: "/card/[id]", params: { id: c.concern_card_id } });
    else if (c.url) WebBrowser.openBrowserAsync(c.url);
  }

  const searching = st.q !== "";
  const firstFailed = st.status === "error" && st.errorOf === "first";

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: "Town record" }} />
      <View style={s.bar}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          maxLength={RECORD_QUERY_MAX}
          placeholder="Search decisions, topics, places"
          placeholderTextColor={T.creamFaint}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel="Search the town record"
        />
      </View>

      {!town ? (
        <Notice s={s} text="We couldn't tell which town's record to show." />
      ) : firstFailed ? (
        <View style={s.notice}>
          <Text style={s.noticeText}>{st.error}</Text>
          <Pressable onPress={() => search?.retry()} accessibilityRole="button" style={s.retry}>
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={st.items as unknown as CivicItem[]}
          keyExtractor={(it) => it.external_id}
          renderItem={({ item }) => <CivicFeedItem item={item} onPress={() => open(item)} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={0.6}
          onEndReached={() => { search?.loadMore(); }}
          ListEmptyComponent={
            st.status === "loading" || !st.loaded
              ? <View style={s.notice}><ActivityIndicator color={T.amber} /></View>
              : <Notice s={s} text={searching ? `No matches for "${st.q}".` : "Nothing on the record yet."} />
          }
          ListFooterComponent={
            st.status === "loadingMore" ? (
              <View style={s.foot}><ActivityIndicator color={T.amber} /></View>
            ) : st.status === "error" && st.errorOf === "more" ? (
              <View style={s.foot}>
                <Text style={s.noticeText}>{st.error}</Text>
                <Pressable onPress={() => search?.retry()} accessibilityRole="button" style={s.retry}>
                  <Text style={s.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : st.loaded && st.items.length > 0 && !st.hasMore ? (
              <View style={s.foot}><Text style={s.end}>End of the record</Text></View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const noSubscribe = () => () => {};
const IDLE = { q: "", items: [], hasMore: false, nextOffset: null, status: "idle" as const, errorOf: null, error: null, loaded: false };
const getIdle = () => IDLE;

function Notice({ s, text }: { s: ReturnType<typeof makeStyles>; text: string }) {
  return <View style={s.notice}><Text style={s.noticeText}>{text}</Text></View>;
}

const makeStyles = (T: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  bar: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border },
  input: { backgroundColor: T.surface, color: T.cream, borderWidth: 1, borderColor: T.borderCtl, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  notice: { padding: 32, alignItems: "center", gap: 14 },
  noticeText: { color: T.creamDim, fontSize: 13, textAlign: "center", lineHeight: 20 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: T.amberMid, backgroundColor: T.amberLo },
  retryText: { color: T.amberHi, fontSize: 13, fontWeight: "500" },
  foot: { paddingVertical: 18, alignItems: "center", gap: 10 },
  end: { color: T.creamFaint, fontSize: 11 },
});
