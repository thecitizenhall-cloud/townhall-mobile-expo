import { Stack } from "expo-router";
import { useTheme } from "../../lib/themeContext";

export default function OnboardingLayout() {
  const T = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: T.bg },
        headerTintColor: T.cream,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: T.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="account" options={{ title: "Step 1 of 3", headerLeft: () => null }} />
      <Stack.Screen name="neighborhood" options={{ title: "Step 2 of 3" }} />
      <Stack.Screen name="zk-proof" options={{ title: "Verify residency" }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}
