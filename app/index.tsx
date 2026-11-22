import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/themeContext";
import { resolveEntry } from "../lib/entryRoute";

// Entry point: check auth + onboarding state, route accordingly.
// The decision lives in lib/entryRoute.ts, where it is tested.
export default function Index() {
  const T = useTheme();
  const [unreachable, setUnreachable] = useState(false);

  const route = useCallback(async () => {
    setUnreachable(false);
    const to = await resolveEntry({
      getUserId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
      // maybeSingle, not single: no row is an answer (data null, no error)
      // and still means onboarding. Any error means we don't know.
      getProfile: async (id) => {
        const { data, error } = await supabase
          .from("profiles")
          .select("onboarded, neighborhood_id")
          .eq("id", id)
          .maybeSingle();
        return { profile: data, error };
      },
    });
    if (to === "unreachable") setUnreachable(true);
    else router.replace(to);
  }, []);

  useEffect(() => { route(); }, [route]);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
      {unreachable ? (
        <>
          <Text style={{ color: T.cream, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 16 }}>
            We couldn't reach Townhall. Check your connection and try again.
          </Text>
          <Pressable
            onPress={route}
            accessibilityRole="button"
            style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: T.amberMid, backgroundColor: T.amberLo }}
          >
            <Text style={{ color: T.amberHi, fontSize: 13, fontWeight: "500" }}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={T.amber} />
      )}
    </View>
  );
}
