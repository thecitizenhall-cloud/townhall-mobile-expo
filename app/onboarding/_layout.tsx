import { Stack } from "expo-router";
import { T } from "../../lib/theme";

export default function OnboardingLayout() {
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
      <Stack.Screen name="account" options={{ title: "Step 1 of 4", headerLeft: () => null }} />
      <Stack.Screen name="neighborhood" options={{ title: "Step 2 of 4" }} />
      <Stack.Screen name="zk-proof" options={{ title: "Step 3 of 4" }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
    </Stack>
  );
}
