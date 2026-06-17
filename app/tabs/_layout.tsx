import { Tabs } from "expo-router";
import { View, Text } from "react-native";
import { T } from "../../lib/theme";

function TabIcon({ focused, char }: { focused: boolean; char: string }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={{ fontSize: 18, color: focused ? T.amberHi : T.creamFaint }}>
        {char}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: T.bg },
        headerTintColor: T.cream,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: T.surface,
          borderTopColor: T.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: T.amberHi,
        tabBarInactiveTintColor: T.creamFaint,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Town",
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} char="⌂" />,
        }}
      />
      <Tabs.Screen
        name="issues"
        options={{
          title: "Your Issues",
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} char="◎" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} char="○" />,
        }}
      />
    </Tabs>
  );
}
