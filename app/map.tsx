import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { SITE_URL } from "../lib/config";
import { T } from "../lib/theme";

export default function CivicMapScreen() {
  const params = useLocalSearchParams<{ muni?: string | string[] }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const uri = useMemo(() => {
    const rawMuni = Array.isArray(params.muni) ? params.muni[0] : params.muni;
    const muni = rawMuni || "jackson_nj";
    const query = new URLSearchParams({ native: "1", muni });
    return `${SITE_URL}/map?${query.toString()}`;
  }, [params.muni]);

  return (
    <View style={s.root}>
      <WebView
        key={reloadKey}
        source={{ uri }}
        style={s.webView}
        onLoadStart={() => {
          setLoading(true);
          setError(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        startInLoadingState={false}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
      />
      {loading && !error ? (
        <View style={s.overlay} pointerEvents="none">
          <ActivityIndicator color={T.amber} />
          <Text style={s.statusText}>Loading civic map…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={s.overlay}>
          <Text style={s.errorTitle}>Couldn’t load the civic map</Text>
          <Text style={s.statusText}>Check your connection and try again.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading civic map"
            onPress={() => setReloadKey((value) => value + 1)}
            style={s.retry}
          >
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  webView: { flex: 1, backgroundColor: T.bg },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: T.bg,
  },
  statusText: { color: T.creamDim, fontSize: 13 },
  errorTitle: { color: T.cream, fontSize: 16, fontWeight: "600" },
  retry: {
    marginTop: 4,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: T.amber,
  },
  retryText: { color: T.bg, fontSize: 13, fontWeight: "600" },
});
