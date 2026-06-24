import { useRef, useState } from "react";
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert,
} from "react-native";
import { WebView } from "react-native-webview";
import { useLocalSearchParams, router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { attestationStatement, recordAttestation } from "../../lib/attestation";
import { T } from "../../lib/theme";

// The ZK proof is generated in a WebView using the same snarkjs + WASM artifacts
// that the web app uses. This avoids shipping a React Native snarkjs port while
// keeping the exact same cryptographic circuit (residency.wasm + residency.zkey).
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? "https://www.townhallcafe.org";
// Proof verification is the Supabase edge function — the same endpoint the web
// app hits (OnboardingScreen.jsx / VerifyResidencyModal.jsx). There is no
// Next.js /api/zk-verify route, so SITE_URL must NOT be used for verify.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";

export default function OnboardingZKProof() {
  const params = useLocalSearchParams<{
    neighborhoodId: string;
    neighborhoodName: string;
    municipalityId: string;
    lat: string;
    lng: string;
  }>();

  const webRef = useRef<WebView>(null);
  const [status, setStatus] = useState<"idle" | "proving" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("Waiting to start…");
  const [attested, setAttested] = useState(false);

  // Set params before page JS runs so they're available when the page posts "ready".
  // The page itself posts { type: "ready" } after its event listener is wired —
  // do NOT post "ready" here, because this script fires before page JS and the
  // listener would miss the subsequent injectJavaScript dispatch.
  const injectedJS = `
    (function() {
      window.TOWNHALL_ZK_PARAMS = {
        lat: ${parseFloat(params.lat) || 0},
        lng: ${parseFloat(params.lng) || 0},
        neighborhoodId: "${params.neighborhoodId}",
      };
    })();
    true;
  `;

  async function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === "ready") {
        setStatus("proving");
        setStatusMsg("Generating zero-knowledge proof…");
        // Tell the WebView to start proving
        webRef.current?.injectJavaScript(`
          window.dispatchEvent(new CustomEvent("townhall:start-zk"));
          true;
        `);
        return;
      }

      if (msg.type === "proof_generated") {
        setStatusMsg("Verifying proof on server…");
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/zk-verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            proof: msg.proof,
            publicSignals: msg.publicSignals,
            neighborhoodId: params.neighborhoodId,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Verification failed");
        }

        setStatus("done");
        setStatusMsg("Residency verified!");
        await recordAttestation(params.neighborhoodName);
        router.replace("/onboarding/welcome");
        return;
      }

      if (msg.type === "proof_error") {
        throw new Error(msg.error || "ZK proof generation failed");
      }
    } catch (e: any) {
      setStatus("error");
      setStatusMsg(e.message || "Something went wrong");
    }
  }

  return (
    <View style={s.root}>
      <Text style={s.title}>Proving residency</Text>
      <Text style={s.sub}>
        Your device is generating a zero-knowledge proof that you live in{" "}
        <Text style={{ color: T.amberHi }}>{params.neighborhoodName}</Text>.
        Your exact coordinates never leave this device.
      </Text>

      <View style={s.statusBox}>
        {(status === "proving") && <ActivityIndicator color={T.amber} style={{ marginBottom: 10 }} />}
        {status === "done" && <Text style={s.checkmark}>✓</Text>}
        {status === "error" && <Text style={s.errorMark}>✗</Text>}
        <Text style={[s.statusText, status === "error" && { color: T.red }]}>
          {statusMsg}
        </Text>
      </View>

      {/* WebView loads the site's ZK proof page which handles snarkjs + WASM */}
      <WebView
        ref={webRef}
        source={{ uri: `${SITE_URL}/zk-prover?native=1` }}
        style={{ height: 1, width: 1, opacity: 0 }}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled={false}
      />

      {status === "idle" && (
        <>
          <TouchableOpacity style={s.attestRow} activeOpacity={0.7} onPress={() => setAttested(a => !a)}>
            <View style={[s.checkbox, attested && s.checkboxOn]}>
              {attested && <Text style={s.checkboxMark}>✓</Text>}
            </View>
            <Text style={s.attestText}>{attestationStatement(params.neighborhoodName)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, !attested && s.btnDisabled]}
            disabled={!attested}
            onPress={() => {
              setStatus("proving");
              setStatusMsg("Requesting location permission…");
              webRef.current?.injectJavaScript(`
                window.dispatchEvent(new CustomEvent("townhall:start-zk"));
                true;
              `);
            }}
          >
            <Text style={s.btnText}>Generate proof</Text>
          </TouchableOpacity>
        </>
      )}

      {status === "error" && (
        <>
          <TouchableOpacity style={s.btn} onPress={() => {
            setStatus("idle");
            setStatusMsg("Waiting to start…");
          }}>
            <Text style={s.btnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSkip} onPress={() => router.replace("/onboarding/welcome")}>
            <Text style={s.btnSkipText}>Read without verifying</Text>
          </TouchableOpacity>
          <Text style={s.skipNote}>
            You can read your neighborhood feed now. Following issues, sharing a
            stake, and voting need a verified residency — you can do that anytime.
          </Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 28, paddingTop: 32, backgroundColor: T.bg },
  title: { color: T.cream, fontSize: 24, fontWeight: "600", marginBottom: 10 },
  sub: { color: T.creamDim, fontSize: 14, lineHeight: 22, marginBottom: 28 },
  statusBox: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 14, padding: 28, alignItems: "center", marginBottom: 28,
    minHeight: 100, justifyContent: "center",
  },
  statusText: { color: T.creamDim, fontSize: 14, textAlign: "center" },
  checkmark: { color: T.teal, fontSize: 36, marginBottom: 8 },
  errorMark: { color: T.red, fontSize: 36, marginBottom: 8 },
  btn: { backgroundColor: T.amber, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: T.bg, fontSize: 15, fontWeight: "600" },
  attestRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 18, paddingHorizontal: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: T.border,
    backgroundColor: T.surface, alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  checkboxOn: { backgroundColor: T.amber, borderColor: T.amber },
  checkboxMark: { color: T.bg, fontSize: 14, fontWeight: "700", lineHeight: 16 },
  attestText: { flex: 1, color: T.creamDim, fontSize: 13, lineHeight: 19 },
  btnSkip: { padding: 16, alignItems: "center" },
  btnSkipText: { color: T.creamDim, fontSize: 14 },
  skipNote: { color: T.creamFaint, fontSize: 12, lineHeight: 18, textAlign: "center", paddingHorizontal: 8 },
});
