import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabase";
import { SITE_URL } from "./config";

// Cache of the last token we successfully registered with the server. If the
// OS revokes notification permission before the user taps "disable" in-app,
// getExpoPushTokenAsync() throws and we'd otherwise have no token to send in
// the DELETE — the server-side row would outlive the in-app toggle. Read this
// on disable as a fallback so we can still ask the server to drop the row.
const LAST_TOKEN_KEY = "th_last_expo_push_token";

// Device push registration. We mint an Expo push token on this physical device
// and hand it to the web app's push subscribe endpoint (the same server the rest
// of the mobile client already talks to — see lib/config.ts). The web side owns
// the expo_push_tokens table and the actual send; the app only registers/unregisters.
//
// Contract (matches the web /api/push/subscribe route):
//   POST   { platform: "expo", token, device: "ios" | "android" }  + Bearer auth
//   DELETE { platform: "expo", token }                             + Bearer auth

// EAS projectId is required by getExpoPushTokenAsync. Read it from the running
// app config (app.json → extra.eas.projectId); fall back to the known id so a
// stripped config can't silently break registration.
const EAS_PROJECT_ID =
  (Constants.expoConfig?.extra as any)?.eas?.projectId ??
  (Constants as any)?.easConfig?.projectId ??
  "7bd9caad-12dc-453f-b721-a60b584dcd39";

export type PushReason =
  | "simulator"      // not a physical device — Expo can't issue a token
  | "denied"         // user declined the OS permission
  | "token_error"    // getExpoPushTokenAsync failed
  | "no_session"     // no signed-in supabase session to authorize with
  | "network"        // fetch threw
  | `http_${number}`;// endpoint returned non-2xx

export type PushResult = { ok: true; token: string } | { ok: false; reason: PushReason; token?: string };

async function authHeader(): Promise<Record<string, string> | null> {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

async function getToken(): Promise<{ ok: true; token: string } | { ok: false; reason: PushReason }> {
  try {
    const res = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    return { ok: true, token: res.data };
  } catch {
    return { ok: false, reason: "token_error" };
  }
}

// What the toggle should show on mount without changing anything: whether this
// build can do device push at all, and whether OS permission is already granted.
export async function getDevicePushState(): Promise<{ supported: boolean; granted: boolean }> {
  if (!Device.isDevice) return { supported: false, granted: false };
  const { status } = await Notifications.getPermissionsAsync();
  return { supported: true, granted: status === "granted" };
}

// Ask permission → mint token → POST it to the subscribe endpoint. Real-device
// only; simulators/emulators can't mint an Expo push token, so we return a
// graceful reason instead of throwing.
export async function enableDevicePush(): Promise<PushResult> {
  if (!Device.isDevice) return { ok: false, reason: "simulator" };

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return { ok: false, reason: "denied" };

  const tok = await getToken();
  if (!tok.ok) return tok;

  const auth = await authHeader();
  if (!auth) return { ok: false, reason: "no_session", token: tok.token };

  const device = Platform.OS === "ios" ? "ios" : "android";
  try {
    const resp = await fetch(`${SITE_URL}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ platform: "expo", token: tok.token, device }),
    });
    if (!resp.ok) return { ok: false, reason: `http_${resp.status}`, token: tok.token };
  } catch {
    return { ok: false, reason: "network", token: tok.token };
  }
  await AsyncStorage.setItem(LAST_TOKEN_KEY, tok.token);
  return { ok: true, token: tok.token };
}

// Tell the server to drop this device's token. Prefer re-deriving the token
// (Expo returns the same one per device); if that fails — e.g. OS permission
// was already revoked outside the app — fall back to the last token we cached
// on enable, so the server-side row still gets removed instead of persisting
// until the next push attempt prunes it.
export async function disableDevicePush(): Promise<PushResult> {
  if (!Device.isDevice) return { ok: false, reason: "simulator" };

  const tok = await getToken();
  const token = tok.ok ? tok.token : await AsyncStorage.getItem(LAST_TOKEN_KEY);
  if (!token) return tok.ok ? tok : { ok: false, reason: tok.reason };

  const auth = await authHeader();
  if (!auth) return { ok: false, reason: "no_session", token };

  try {
    const resp = await fetch(`${SITE_URL}/api/push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ platform: "expo", token }),
    });
    if (!resp.ok) return { ok: false, reason: `http_${resp.status}`, token };
  } catch {
    return { ok: false, reason: "network", token };
  }
  await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  return { ok: true, token };
}
