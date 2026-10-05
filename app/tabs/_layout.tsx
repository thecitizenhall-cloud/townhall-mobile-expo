import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { T } from "../../lib/theme";

// Session-start shuffle (web migration 033, pages/app.jsx): start_session()
// moves last_session_at into previous_session_at when the gap exceeds three
// hours, which is the "since you last looked" baseline town_feed and the
// tracker read. Mobile never called it, so that baseline stayed frozen at the
// onboarding stamp. The three-hour rule lives in the function, so calling it
// again mid-session is harmless. Never blocks or surfaces an error.
function startSession() {
  supabase.rpc("start_session").then(() => {}, () => {});
}

// One-screen shell (UX north star, mirrors web PR #64): the feed IS the app —
// no tab bar. Me opens from the avatar in the feed header with two tabs,
// Profile and Tracker; Alerts are folded inline into the Profile tab. The
// /tabs/* routes survive so existing navigations and deep links keep working.
export default function TabsLayout() {
  // The removed native headers used to clear the status bar — pad the top
  // inset here so screen content never sits under the notch.
  const insets = useSafeAreaInsets();

  // On entry, and again each time the app returns to the foreground: a phone
  // app is resumed far more often than it is launched, so a mount-only call
  // would miss most return visits.
  useEffect(() => {
    startSession();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") startSession();
    });
    return () => sub.remove();
  }, []);
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: T.bg, paddingTop: insets.top },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="feed" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="issues" />
      <Stack.Screen name="budget" />
    </Stack>
  );
}
