import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import { T } from "../../lib/theme";
import { TouchableOpacity } from "react-native";

export default function OnboardingAccount() {
  return (
    <View style={s.root}>
      <Text style={s.step}>Account created</Text>
      <Text style={s.title}>Welcome to Townhall Cafe</Text>
      <Text style={s.body}>
        You have an account. Next: we'll detect your neighborhood so you can
        verify your residency and join your community's civic feed.
      </Text>
      <Text style={s.note}>
        Townhall uses zero-knowledge cryptography — your exact location never
        leaves your device. We only store a mathematical proof that you live
        where you say you do.
      </Text>
      <TouchableOpacity style={s.btn} onPress={() => router.push("/onboarding/neighborhood")}>
        <Text style={s.btnText}>Set my neighborhood</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 28, paddingTop: 48, backgroundColor: T.bg },
  step: { color: T.amber, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 14 },
  title: { color: T.cream, fontSize: 28, fontWeight: "600", marginBottom: 18, lineHeight: 36 },
  body: { color: T.creamDim, fontSize: 15, lineHeight: 24, marginBottom: 24 },
  note: {
    backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid,
    borderRadius: 12, padding: 16, color: T.cream, fontSize: 13, lineHeight: 20, marginBottom: 40,
  },
  btn: { backgroundColor: T.amber, borderRadius: 10, padding: 16, alignItems: "center" },
  btnText: { color: T.bg, fontSize: 15, fontWeight: "600" },
});
