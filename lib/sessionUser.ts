import { supabase } from "./supabase";

// Fast current-user read for MOUNT / data-load paths (parity with web
// lib/sessionUser). supabase.auth.getUser() is a NETWORK round-trip to the auth
// server that validates the token; screens were awaiting it before running any
// of their queries, adding a round-trip to every tab/detail load. getSession()
// reads the session from AsyncStorage (local; network only if a refresh is due),
// so it returns the user without that round-trip.
//
// SECURITY NOTE: never gate a security decision on this — RLS enforces access
// server-side using the access token the client attaches. This only supplies the
// id for scoping the user's own reads (e.g. .eq("author_id", user.id)).
export async function getCurrentUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
  } catch {
    return null;
  }
}
