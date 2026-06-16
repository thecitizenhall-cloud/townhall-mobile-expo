import { useEffect } from "react";
import { router } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";

// Entry point: check auth + onboarding state, route accordingly
export default function Index() {
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/auth/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("id", session.user.id)
        .single();

      if (!profile?.onboarded) {
        router.replace("/onboarding/account");
      } else {
        router.replace("/tabs/feed");
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator color={T.amber} />
    </View>
  );
}
