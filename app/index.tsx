import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { AccessibilityInfo, View, Text, Pressable, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/themeContext";
import { entryDeps, resolveEntry, signOutHere } from "../lib/entryRoute";

// Entry point: check auth + onboarding state, route accordingly.
// The decision lives in lib/entryRoute.ts, where it is tested.
export default function Index() {
  const T = useTheme();
  const [unreachable, setUnreachable] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  // Two quick taps can land before the re-render hides the buttons.
  const busy = useRef(false);

  const route = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setUnreachable(false);
    setSignOutFailed(false);
    const to = await resolveEntry(entryDeps(supabase));
    busy.current = false;
    if (to === "unreachable") setUnreachable(true);
    else router.replace(to);
  }, []);

  const signOut = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    // Back to the spinner while it runs, so neither button sits there dead.
    setUnreachable(false);
    setSignOutFailed(false);
    const ok = await signOutHere(supabase);
    busy.current = false;
    if (ok) {
      router.replace("/auth/login");
    } else {
      setSignOutFailed(true);
      setUnreachable(true);
    }
  }, []);

  useEffect(() => { route(); }, [route]);

  const message = signOutFailed
    ? "Signing out needs a connection. Check yours and try again."
    : "We couldn't reach Townhall. Check your connection and try again.";

  // Announced rather than a live region: this text appears by mounting, which
  // a live region does not report, and live regions are Android only.
  useEffect(() => {
    if (unreachable) AccessibilityInfo.announceForAccessibility(message);
  }, [unreachable, message]);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
      {unreachable ? (
        <>
          <Text style={{ color: T.cream, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 16 }}>
            {message}
          </Text>
          <Pressable
            onPress={route}
            accessibilityRole="button"
            style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: T.amberMid, backgroundColor: T.amberLo }}
          >
            <Text style={{ color: T.amberHi, fontSize: 14, fontWeight: "500" }}>Try again</Text>
          </Pressable>
          <Pressable
            onPress={signOut}
            accessibilityRole="button"
            style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 20, marginTop: 8 }}
          >
            <Text style={{ color: T.creamDim, fontSize: 13 }}>Sign out</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={T.amber} />
      )}
    </View>
  );
}
