import { Stack } from "expo-router";
import { useTheme } from "../../lib/themeContext";

export default function AuthLayout() {
  const T = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: T.bg },
      }}
    />
  );
}
