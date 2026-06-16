import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { T } from "../../lib/theme";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      Alert.alert("Sign in failed", error.message);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded")
      .eq("id", (await supabase.auth.getUser()).data.user!.id)
      .single();
    router.replace(profile?.onboarded ? "/tabs/feed" : "/onboarding/account");
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <View style={s.logo}>
            <Text style={s.logoMark}>T</Text>
          </View>
          <Text style={s.brandName}>Townhall Cafe</Text>
        </View>

        <Text style={s.tagline}>
          Civic life in{" "}
          <Text style={{ color: T.amberHi, fontStyle: "italic" }}>your neighborhood.</Text>
        </Text>

        <View style={s.form}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
            placeholderTextColor={T.creamFaint}
            placeholder="you@example.com"
          />

          <Text style={[s.label, { marginTop: 16 }]}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            placeholderTextColor={T.creamFaint}
            placeholder="••••••••"
          />

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={T.bg} />
              : <Text style={s.btnText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/auth/register")}>
            <Text style={s.link}>New to Townhall? Create an account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  scroll: { flexGrow: 1, padding: 28, paddingTop: 80 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 32 },
  logo: {
    width: 32, height: 32, borderRadius: 8,
    borderWidth: 1.5, borderColor: T.amber,
    alignItems: "center", justifyContent: "center",
  },
  logoMark: { color: T.amber, fontWeight: "700", fontSize: 15 },
  brandName: { color: T.cream, fontSize: 18, fontWeight: "600" },
  tagline: { color: T.cream, fontSize: 26, fontWeight: "300", lineHeight: 34, marginBottom: 48 },
  form: { gap: 4 },
  label: { color: T.creamDim, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    borderRadius: 10, padding: 14, color: T.cream, fontSize: 15,
  },
  btn: {
    backgroundColor: T.amber, borderRadius: 10, padding: 16,
    alignItems: "center", marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: T.bg, fontSize: 15, fontWeight: "600" },
  link: { color: T.amberHi, fontSize: 14, textAlign: "center", marginTop: 20 },
});
