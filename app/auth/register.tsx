import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { reservedNameError } from "../../lib/displayName";
import { T } from "../../lib/theme";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!email.trim() || !password || !displayName.trim()) {
      Alert.alert("Fill in all fields");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Password must be at least 8 characters");
      return;
    }
    const nameErr = reservedNameError(displayName);
    if (nameErr) {
      Alert.alert("Choose a different name", nameErr);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim() },
      },
    });
    setLoading(false);
    if (error) {
      Alert.alert("Registration failed", error.message);
      return;
    }
    // When email confirmation is enabled, signUp returns no session — there is
    // no authenticated user yet, so pushing into onboarding would dead-end in an
    // infinite loop (getUser() is null, the neighborhood step silently no-ops).
    // Send them to sign in after they confirm instead.
    if (!data.session) {
      Alert.alert(
        "Check your email",
        "We sent a confirmation link to " + email.trim() +
          ". Tap it, then sign in to finish setting up your neighborhood.",
      );
      router.replace("/auth/login");
      return;
    }
    router.replace("/onboarding/account");
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={s.title}>Create your account</Text>
        <Text style={s.sub}>
          Your account is the start of your civic identity — verified residency comes next.
        </Text>

        <View style={s.form}>
          <Text style={s.label}>What should neighbors call you?</Text>
          <TextInput
            style={s.input}
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            returnKeyType="next"
            placeholderTextColor={T.creamFaint}
            placeholder="Maya, MayaC, or a nickname"
          />
          <Text style={s.hint}>
            A first name or nickname is fine — you don't need your full legal name.
            Your verified-resident badge is what neighbors trust.
          </Text>

          <Text style={[s.label, { marginTop: 16 }]}>Email</Text>
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

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 6 }}>
            <Text style={[s.label, { marginBottom: 0 }]}>Password</Text>
            <TouchableOpacity onPress={() => setShowPw(v => !v)} hitSlop={10}>
              <Text style={{ color: T.amberHi, fontSize: 12, fontWeight: "600" }}>{showPw ? "Hide" : "Show"}</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            autoComplete="new-password"
            returnKeyType="done"
            onSubmitEditing={handleRegister}
            placeholderTextColor={T.creamFaint}
            placeholder="At least 8 characters"
          />

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={T.bg} />
              : <Text style={s.btnText}>Create account</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.link}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  scroll: { flexGrow: 1, padding: 28, paddingTop: 60 },
  back: { marginBottom: 28 },
  backText: { color: T.amberHi, fontSize: 14 },
  title: { color: T.cream, fontSize: 26, fontWeight: "600", marginBottom: 10 },
  sub: { color: T.creamDim, fontSize: 14, lineHeight: 22, marginBottom: 36 },
  form: { gap: 4 },
  label: { color: T.creamDim, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  hint: { color: T.creamDim, fontSize: 12, lineHeight: 18, marginTop: 6 },
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
