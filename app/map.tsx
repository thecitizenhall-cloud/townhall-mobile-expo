import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { muniLabel } from "../lib/cardArea";
import { SITE_URL } from "../lib/config";
import { T } from "../lib/theme";

// The page can load while the map on it stays blank. From the app that looked
// like a working header over an empty screen with no way to tell why. The page
// now reports its own failures (see PageError below); this probe is the
// backstop for a failure the page does not notice. It runs inside the page
// and reports once: whether a map canvas exists and has a size, plus readings
// that are printed for a bug report but decide nothing.
//
// It does NOT test for a worker file or infer anything from WebGL 2. Both did
// once, against a version of the web map that needed them; the web map has
// since gone back to a library version that needs neither, and a probe that
// keeps testing for them reports a failure over a map that drew.
const MAP_PROBE = `
(function () {
  var errors = [];
  function note(m) { if (errors.length < 4) errors.push(String(m).slice(0, 160)); }
  window.addEventListener("error", function (e) { note(e.message || "script error"); });
  window.addEventListener("unhandledrejection", function (e) { note((e.reason && e.reason.message) || e.reason || "rejection"); });
  var origError = console.error;
  console.error = function () { note(Array.prototype.join.call(arguments, " ")); origError.apply(console, arguments); };

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
      canvas: box ? Math.round(box.width) + "x" + Math.round(box.height) : "none",
      tiles: tiles,
      errors: errors,
    }));
  }, 12000);
})();
true;
`;

// The web map page reports its own failure when it runs inside the app
// (?native=1): { type: "map-error", reason, message }. reason is "no-webgl2"
// (the name is historical: the page sends it when the browser offers neither
// WebGL 2 nor WebGL 1), "load" (the library would not load or parse),
// "construct" or "no-load". When this arrives there is no need to wait for
// the probe.
type PageError = { reason: string; message?: string };

// Whether the map has finished drawing, which is later than the page loading.
// The page posts { type: "map-ready", errors } on the map's first idle after
// it loads (web #207), once per map build: a filter change rebuilds the map
// and posts it again, so this simply takes the latest. Idle means "finished
// trying": errors > 0 means some tiles failed, so that state must never be
// described as complete. The page sends exactly one of map-error or map-ready
// per build.
//
// On a rebuild the page first posts { type: "map-building" } (web #208),
// which starts a new drawing state with its own fallback timer. It goes out
// once the new map is constructed, ~1.25 s after a filter tap, so the
// previous build's status shows for that long; that is deliberate on the
// page, which only sends it once a result can follow. Do not assume the
// messages alternate: two quick filter changes give one map-building, and
// a map that never reaches idle gives map-building and nothing after it,
// which is what the fallback timer is for. A message the page re-sends is
// harmless, since each one only sets the latest state.
type DrawState = "drawing" | "slow" | "ready" | "gaps";

// After this long without map-ready, say plainly that it is still drawing.
// It must be longer than the slowest real draw: map imagery took ~26 s on a
// 2017 Android 7 phone (Moto E4), so a short timeout would fire before the
// page answers on exactly the phones this is for. It changes the message
// only; a map-ready that arrives later still settles the state.
const SLOW_DRAW_MS = 50_000;

type Probe = { webgl2: boolean; webgl: boolean; canvas: string; tiles: number; errors: string[] };

// Not drawn = no map canvas, or one with no size. Nothing else in the probe
// is allowed to decide this.
function mapFailed(p: Probe): boolean {
  return p.canvas === "none" || /(^|x)0$|^0x/.test(p.canvas);
}

export default function CivicMapScreen() {
  const params = useLocalSearchParams<{ muni?: string | string[] }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pageError, setPageError] = useState<PageError | null>(null);
  const [draw, setDraw] = useState<DrawState>("drawing");
  // Bumped by map-building, so a rebuild gets the same drawing state and
  // fallback timer as the first load.
  const [drawEpoch, setDrawEpoch] = useState(0);
  // When the current drawing state began, so a timer left over from the
  // previous build cannot call a build slow before its own 50 s are up.
  const drawStartedAt = useRef(Date.now());
  const failed = !!pageError || (!!probe && mapFailed(probe));
  // Only the page can say the browser itself is unable to run the map, in
  // which case the system browser on the same phone would fail the same way.
  // The probe's WebGL readings are not used for this: a phone without WebGL 2
  // draws the map perfectly well on WebGL 1.
  const browserCannot = pageError?.reason === "no-webgl2" || pageError?.reason === "load";

  const rawMuni = Array.isArray(params.muni) ? params.muni[0] : params.muni;
  // The app's own header carries the title and the back button, so the page
  // inside does not need to repeat either. "Jackson, NJ" -> "Jackson".
  const town = muniLabel(rawMuni).split(",")[0];

  const uri = useMemo(() => {
    const muni = rawMuni || "jackson_nj";
    const query = new URLSearchParams({ native: "1", muni });
    return `${SITE_URL}/map?${query.toString()}`;
  }, [rawMuni]);

  // A new map load is a new page (uri), a reload (reloadKey remounts the
  // WebView) or a rebuild the page announced (drawEpoch). Keyed on those
  // rather than onLoadStart, which can fire again for the same page and
  // would wipe a result the page already sent.
  // The reset to "drawing" happens here only for a new page or reload;
  // map-building resets it in its own handler, so a map-ready delivered in
  // the same batch is not overwritten by this effect running afterwards.
  useEffect(() => { drawStartedAt.current = Date.now(); setDraw("drawing"); }, [uri, reloadKey]);
  // The timer only ever moves "drawing" to "slow", so a result that landed
  // first is left alone.
  useEffect(() => {
    const t = setTimeout(() => {
      if (Date.now() - drawStartedAt.current < SLOW_DRAW_MS) return;
      setDraw((d) => (d === "drawing" ? "slow" : d));
    }, SLOW_DRAW_MS);
    return () => clearTimeout(t);
  }, [uri, reloadKey, drawEpoch]);

  return (
    <View style={s.root}>
      <Stack.Screen options={{ title: town ? `${town} civic map` : "Civic map" }} />
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
            else if (msg?.type === "map-building") {
              // A new build: the previous build's result no longer applies.
              setPageError(null);
              setProbe(null);
              drawStartedAt.current = Date.now();
              setDraw("drawing");
              setDrawEpoch((n) => n + 1);
            }
            else if (msg?.type === "map-ready") {
              // The latest build drew, so an earlier build's failure (page
              // error or a probe that found no canvas) no longer applies.
              setPageError(null);
              setProbe(null);
              setDraw(Number(msg.errors) > 0 ? "gaps" : "ready");
            }
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
        // The map handles its own pinch and pan. Without these the whole page
        // zoomed as well, so the filter bar grew and shrank under the fingers.
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        scalesPageToFit={false}
        overScrollMode="never"
      />
      {loading && !error ? (
        <View style={s.overlay} pointerEvents="none">
          <ActivityIndicator color={T.amber} />
          <Text style={s.statusText}>Loading civic map…</Text>
        </View>
      ) : null}
      {!loading && !error && !failed && (draw === "drawing" || draw === "slow") ? (
        <View style={s.drawing} pointerEvents="none" accessibilityLiveRegion="polite">
          <ActivityIndicator color={T.amber} size="small" />
          <Text style={s.statusText}>
            {draw === "slow" ? "Still drawing — this is slow on this device." : "Drawing the map…"}
          </Text>
        </View>
      ) : null}
      {!loading && !error && !failed && draw === "gaps" ? (
        <View style={s.notice} accessibilityLiveRegion="polite">
          <Text style={s.statusText}>Some parts of the map didn’t load.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload the civic map"
            onPress={() => setReloadKey((value) => value + 1)}
            style={s.retry}
          >
            <Text style={s.retryText}>Reload map</Text>
          </Pressable>
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
            // The page reported that this browser cannot run the map at all.
            // The phone's own browser would show the same thing, so sending
            // the resident there would only repeat the failure.
            <>
              <Text style={s.statusText}>
                This phone’s browser can’t draw the map: it needs newer graphics support than is available here.
              </Text>
              {/* "load" is usually an old browser that cannot read the map
                  code, but a dropped download fails the same way, so that
                  one case gets a retry. */}
              {pageError?.reason === "load" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading civic map"
                  onPress={() => setReloadKey((value) => value + 1)}
                  style={s.retry}
                >
                  <Text style={s.retryText}>Try again</Text>
                </Pressable>
              ) : null}
            </>
          )}
          {/* Plain facts for a bug report; small on purpose. */}
          <Text style={s.diag} selectable>
            {pageError ? `page: ${pageError.reason}${pageError.message ? ` (${pageError.message})` : ""}` : ""}
            {pageError && probe ? "\n" : ""}
            {probe ? `webgl2 ${probe.webgl2 ? "yes" : "no"} · webgl ${probe.webgl ? "yes" : "no"} · canvas ${probe.canvas} · tiles ${probe.tiles}` : ""}
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
  drawing: {
    position: "absolute", left: 12, right: 12, bottom: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
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
