import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { AccessibilityInfo, View, Text, Pressable, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/themeContext";
import { entryDeps, resolveEntry } from "../lib/entryRoute";

// Entry point: check auth + onboarding state, route accordingly.
// The decision lives in lib/entryRoute.ts, where it is tested.
export default function Index() {
  const T = useTheme();
  const [unreachable, setUnreachable] = useState(false);
  // Two quick taps can land before the re-render hides the button.
  const busy = useRef(false);

  const route = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setUnreachable(false);
    const to = await resolveEntry(entryDeps(supabase));
    busy.current = false;
    if (to === "unreachable") setUnreachable(true);
    else router.replace(to);
  }, []);

  useEffect(() => { route(); }, [route]);

  const message = "We couldn't reach Townhall. Check your connection and try again.";

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
        </>
      ) : (
        <ActivityIndicator color={T.amber} />
      )}
    </View>
  );
}
