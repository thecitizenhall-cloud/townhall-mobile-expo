// Where the app opens to, decided once at launch (app/index.tsx).
//
// "unreachable" is its own answer. It used to be folded into "not onboarded":
// a failed profile read and a missing profile both came back as null, so an
// onboarded resident who opened the app without a connection was sent back to
// onboarding step 1. A read that hangs instead of failing gets the same answer
// after ENTRY_TIMEOUT_MS, instead of a spinner for as long as the network
// stack takes to give up (about 30s on a phone with Wi-Fi off).

import type { SupabaseClient } from "@supabase/supabase-js";

export type EntryRoute =
  | "/auth/login"
  | "/onboarding/account"
  | "/onboarding/neighborhood"
  | "/tabs/feed"
  | "unreachable";

export type EntryProfile = { onboarded?: boolean | null; neighborhood_id?: string | null } | null;

export type EntryDeps = {
  // The signed-in user's id, or null when there is no session.
  getUserId: () => Promise<string | null>;
  // A profile read. `profile` is null when the row does not exist; `error` is
  // set when the read itself failed and the answer is unknown.
  getProfile: (userId: string) => Promise<{ profile: EntryProfile; error: unknown }>;
};

export const ENTRY_TIMEOUT_MS = 10_000;

async function decide(deps: EntryDeps): Promise<EntryRoute> {
  const userId = await deps.getUserId();
  if (!userId) return "/auth/login";

  const { profile, error } = await deps.getProfile(userId);
  if (error) return "unreachable";

  // Both, not onboarded alone — web gates on both too (pages/app.jsx:219,
  // :275, :400). A resident with neighborhood_id null reaches the feed
  // unscoped: platform-wide posts, an empty council record, and Jackson
  // bulletins served to a Lakewood resident. They have an account already,
  // so send them to the neighborhood step rather than back to the top.
  if (!profile?.onboarded) return "/onboarding/account";
  if (!profile.neighborhood_id) return "/onboarding/neighborhood";
  return "/tabs/feed";
}

// Never rejects. A throw or a timeout is "unreachable". The race settles once,
// so an answer arriving after the timeout cannot navigate away from Try again.
export function resolveEntry(deps: EntryDeps, timeoutMs: number = ENTRY_TIMEOUT_MS): Promise<EntryRoute> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<EntryRoute>((resolve) => {
    timer = setTimeout(() => resolve("unreachable"), timeoutMs);
  });
  const decided = decide(deps).catch((): EntryRoute => "unreachable");
  return Promise.race([decided, timeout]).finally(() => clearTimeout(timer));
}

// The real reads.
export function entryDeps(client: SupabaseClient): EntryDeps {
  return {
    // With an expired token and no network, getSession returns session: null
    // WITH an error while the session stays in storage. That is "we don't
    // know", not "signed out". A revoked refresh token also errors once, then
    // the session is gone and the next attempt correctly reaches login.
    getUserId: async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session?.user.id ?? null;
    },
    // maybeSingle, not single: no row is an answer (data null, no error) and
    // still means onboarding. With single it is an error, so a resident with
    // no profile row would be stuck on Try again.
    getProfile: async (id) => {
      const { data, error } = await client
        .from("profiles")
        .select("onboarded, neighborhood_id")
        .eq("id", id)
        .maybeSingle();
      return { profile: data, error };
    },
  };
}

// The way out when Try again keeps failing though the server answers, such as
// a rejected token. Local scope: other devices stay signed in. Returns false
// if it could not sign out, which is the case with no connection, so a
// resident on bad signal cannot lose their session from this screen.
export async function signOutHere(client: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    return !error;
  } catch {
    return false;
  }
}
