import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { StatusBar } from "expo-status-bar";
import { T } from "../lib/theme";

export default function RootLayout() {
  // Edge-to-edge Android draws under the system nav bar — pad the bottom
  // inset globally so no screen's content sits behind it (also covers the
  // iOS home indicator).
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setSession(session)
    );

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: T.bg },
          headerTintColor: T.cream,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: T.bg, paddingBottom: insets.bottom },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="tabs" options={{ headerShown: false }} />
        <Stack.Screen
          name="card/[id]"
          options={{ title: "Concern", presentation: "card" }}
        />
        <Stack.Screen
          name="issue/[id]"
          options={{ title: "Issue", presentation: "card" }}
        />
      </Stack>
    </>
  );
}
