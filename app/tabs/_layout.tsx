import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T } from "../../lib/theme";

// One-screen shell (UX north star, mirrors web PR #64): the feed IS the app —
// no tab bar. Me opens from the avatar in the feed header with two tabs,
// Profile and Tracker; Alerts are folded inline into the Profile tab. The
// /tabs/* routes survive so existing navigations and deep links keep working.
export default function TabsLayout() {
  // The removed native headers used to clear the status bar — pad the top
  // inset here so screen content never sits under the notch.
  const insets = useSafeAreaInsets();
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
