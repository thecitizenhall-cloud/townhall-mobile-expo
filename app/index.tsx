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
        .select("onboarded, neighborhood_id")
        .eq("id", session.user.id)
        .single();

      // Both, not onboarded alone — web gates on both too (pages/app.jsx:219,
      // :275, :400). A resident with neighborhood_id null reaches the feed
      // unscoped: platform-wide posts, an empty council record, and Jackson
      // bulletins served to a Lakewood resident. They have an account already,
      // so send them to the neighborhood step rather than back to the top.
      if (!profile?.onboarded) {
        router.replace("/onboarding/account");
      } else if (!profile?.neighborhood_id) {
        router.replace("/onboarding/neighborhood");
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
