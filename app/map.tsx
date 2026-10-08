import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { SITE_URL } from "../lib/config";
import { T } from "../lib/theme";

// The page can load while the map on it stays blank: MapLibre draws nothing,
// and says nothing, when its worker or WebGL is unavailable. From the app that
// looked like a working header over an empty screen with no way to tell why.
// This runs inside the page, collects the reasons a map can fail to draw, and
// reports once so the screen can say so and offer the browser instead.
const MAP_PROBE = `
(function () {
  var errors = [];
  function note(m) { if (errors.length < 4) errors.push(String(m).slice(0, 160)); }
  window.addEventListener("error", function (e) { note(e.message || "script error"); });
  window.addEventListener("unhandledrejection", function (e) { note((e.reason && e.reason.message) || e.reason || "rejection"); });
  var origError = console.error;
  console.error = function () { note(Array.prototype.join.call(arguments, " ")); origError.apply(console, arguments); };

  var worker = "untested";
  try {
    var w = new Worker("/maplibre/maplibre-gl-worker.mjs", { type: "module" });
    worker = "started";
    w.onerror = function (e) { worker = "failed" + (e && e.message ? ": " + String(e.message).slice(0, 80) : ""); };
    setTimeout(function () { try { w.terminate(); } catch (_) {} }, 9000);
  } catch (e) { worker = "unsupported: " + String(e && e.message).slice(0, 80); }

  function gl(kind) { try { return !!document.createElement("canvas").getContext(kind); } catch (_) { return false; } }

  setTimeout(function () {
    var canvas = document.querySelector(".maplibregl-canvas");
    var box = canvas ? canvas.getBoundingClientRect() : null;
    var tiles = 0;
    try {
      tiles = performance.getEntriesByType("resource").filter(function (r) { return r.name.indexOf("/api/map-assets") !== -1; }).length;
    } catch (_) {}
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: "map-probe",
      webgl2: gl("webgl2"), webgl: gl("webgl"),
      worker: worker,
      canvas: box ? Math.round(box.width) + "x" + Math.round(box.height) : "none",
      tiles: tiles,
      errors: errors,
    }));
  }, 12000);
})();
true;
`;

// The web map page reports its own failure when it runs inside the app
// (?native=1): { type: "map-error", reason, message }. reason is "no-webgl2",
// "load" (the library would not load or parse), "construct" or "no-load".
// When this arrives there is no need to wait for the probe.
type PageError = { reason: string; message?: string };

type Probe = { webgl2: boolean; webgl: boolean; worker: string; canvas: string; tiles: number; errors: string[] };

// Drawn = there is a canvas with a size and the map asked for at least one tile.
function mapFailed(p: Probe): boolean {
  return p.canvas === "none" || /(^|x)0$|^0x/.test(p.canvas) || p.tiles === 0 || p.worker.startsWith("failed") || p.worker.startsWith("unsupported");
}

export default function CivicMapScreen() {
  const params = useLocalSearchParams<{ muni?: string | string[] }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pageError, setPageError] = useState<PageError | null>(null);
  const failed = !!pageError || (!!probe && mapFailed(probe));
  // "no-webgl2" and "load" are the browser itself being unable to run the map,
  // so the system browser on the same phone would fail the same way.
  const browserCannot = pageError
    ? pageError.reason === "no-webgl2" || pageError.reason === "load"
    : !!probe && !probe.webgl2;

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
          setProbe(null);
          setPageError(null);
        }}
        injectedJavaScriptBeforeContentLoaded={MAP_PROBE}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg?.type === "map-probe") setProbe(msg as Probe);
            else if (msg?.type === "map-error") {
              setPageError({ reason: String(msg.reason ?? "unknown"), message: msg.message ? String(msg.message).slice(0, 200) : undefined });
            }
          } catch { /* not ours */ }
        }}
        // WebGL content in an Android WebView needs a hardware layer.
        androidLayerType="hardware"
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
      {failed && !error ? (
        <View style={s.notice}>
          <Text style={s.errorTitle}>The map didn’t draw on this device</Text>
          {!browserCannot ? (
            <>
              <Text style={s.statusText}>You can open it in your browser instead.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open the civic map in your browser"
                onPress={() => Linking.openURL(uri.replace("native=1&", "").replace("?native=1", "?"))}
                style={s.retry}
              >
                <Text style={s.retryText}>Open in browser</Text>
              </Pressable>
            </>
          ) : (
            // The map library needs WebGL 2 and a recent browser engine. A
            // phone without them shows the same blank map in its browser, so
            // sending the resident there would only repeat the failure.
            <Text style={s.statusText}>
              This phone’s browser can’t draw the map: it needs newer graphics support than is available here.
            </Text>
          )}
          {/* Plain facts for a bug report; small on purpose. */}
          <Text style={s.diag} selectable>
            {pageError ? `page: ${pageError.reason}${pageError.message ? ` (${pageError.message})` : ""}` : ""}
            {pageError && probe ? "\n" : ""}
            {probe ? `webgl2 ${probe.webgl2 ? "yes" : "no"} · webgl ${probe.webgl ? "yes" : "no"} · worker ${probe.worker} · canvas ${probe.canvas} · tiles ${probe.tiles}` : ""}
            {probe?.errors.length ? `\n${probe.errors.join("\n")}` : ""}
          </Text>
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
  notice: {
    position: "absolute", left: 12, right: 12, bottom: 16,
    alignItems: "center", gap: 8, padding: 14, borderRadius: 12,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
  },
  diag: { color: T.creamFaint, fontSize: 10, lineHeight: 14, textAlign: "center", marginTop: 4 },
  statusText: { color: T.creamDim, fontSize: 13, textAlign: "center", lineHeight: 19 },
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
