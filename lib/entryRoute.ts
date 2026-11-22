// Where the app opens to, decided once at launch (app/index.tsx).
//
// "unreachable" is its own answer. It used to be folded into "not onboarded":
// a failed profile read and a missing profile both came back as null, so an
// onboarded resident who opened the app without a connection was sent back to
// onboarding step 1. A read that hangs instead of failing gets the same answer
// after ENTRY_TIMEOUT_MS, instead of a spinner for as long as the network
// stack takes to give up (about 30s on a phone with Wi-Fi off).

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

// Never rejects. A throw or a timeout is "unreachable"; a result that arrives
// after the timeout is dropped, so a late answer cannot navigate away from the
// Try again screen.
export function resolveEntry(deps: EntryDeps, timeoutMs: number = ENTRY_TIMEOUT_MS): Promise<EntryRoute> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: EntryRoute) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish("unreachable"), timeoutMs);
    decide(deps).then(finish, () => finish("unreachable"));
  });
}
