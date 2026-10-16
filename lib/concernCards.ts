// Shared utilities for concern cards and civic watching, ported from the web
// lib/concernCards.js so both surfaces watch, view-track, and summarize activity
// the same way.
//   concern_cards uses municipality_id (civic-engine schema)
//   card_watches is the civic-engine watch table
//   watched_concern_cards is the front-end table for civic_issues watching
import { supabase } from "./supabase";
import { failureOf, writeErrorMessage, WriteFailure } from "./writeError";

// The resident's neighborhood SLUG — the text key neighborhood_scores and
// card_watches use (the notifier seeds/queries by it). profiles stores the
// uuid, so resolve through neighborhoods.
export async function getResidentNeighborhoodSlug(userId: string): Promise<string | null> {
  const { data: p } = await supabase.from("profiles").select("neighborhood_id").eq("id", userId).maybeSingle();
  if (!p?.neighborhood_id) return null;
  const { data: h } = await supabase.from("neighborhoods").select("slug").eq("id", p.neighborhood_id).maybeSingle();
  return h?.slug ?? null;
}

// Since web migration 128 anyone signed in may follow a card; NOTIFICATIONS
// need standing (a verified address in the matter's town), checked when they
// are sent. A follow that succeeds and then never notifies has to say so, or it
// looks healthy and is not. Web's words, verbatim; keep the two the same.
export const FOLLOW_NO_NOTIFY_NOTE =
  "Following. Townhall will notify you when this moves once you verify your address in this town.";

// When the server could not say whether a follow notifies, say exactly that,
// rather than guess from a local check that cannot see the card's town.
export const FOLLOW_NOTIFY_UNKNOWN_NOTE =
  "Following. We couldn't check whether you'll be notified about this one; open it again later to see.";

// Will a follow on this card notify the signed-in resident? The server's
// answer (migration 127's is_verified_resident_for_card). null when it cannot
// say, and then no note is shown and no notification is promised either.
export async function followNotifies(concernCardId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("is_verified_resident_for_card", { p_card_id: concernCardId });
    return !error && typeof data === "boolean" ? data : null;
  } catch {
    return null;
  }
}

// Every follow/unfollow helper returns `error` as words a resident can read,
// never the database's own message, plus `reason` so a caller can tell a
// standing refusal (no verified address) from anything else. 23505 is an
// existing follow: already following counts as success.
type WatchResult = { success: boolean; error: string | null; reason: WriteFailure | null };

function watchResult(error: any, action: string): WatchResult {
  if (!error || error.code === "23505") return { success: true, error: null, reason: null };
  return { success: false, error: writeErrorMessage(error, action), reason: failureOf(error) };
}

export async function watchCivicIssue(userId: string, issueId: string): Promise<WatchResult> {
  const { error } = await supabase.from("watched_concern_cards").insert({
    user_id: userId, issue_id: issueId, notify_on_move: true,
  });
  return watchResult(error, "follow this issue");
}

export async function unwatchCivicIssue(userId: string, issueId: string): Promise<WatchResult> {
  const { error } = await supabase.from("watched_concern_cards")
    .delete().eq("user_id", userId).eq("issue_id", issueId);
  return watchResult(error, "change what you follow");
}

export async function watchConcernCard(
  userId: string, concernCardId: string, neighborhoodId?: string | null,
): Promise<WatchResult & { notifying: boolean | null }> {
  // Since 128 the server sets neighborhood_id from the follower's profile (or
  // leaves it null) and ignores what is sent; the slug goes only when known.
  // Never the old "unknown" placeholder, which looked like a value and routed
  // every notification for the follow nowhere.
  const { error } = await supabase.from("card_watches").insert({
    user_id: userId, concern_card_id: concernCardId,
    ...(neighborhoodId ? { neighborhood_id: neighborhoodId } : {}),
  });
  const result = watchResult(error, "follow this matter");
  return { ...result, notifying: result.success ? await followNotifies(concernCardId) : null };
}

export async function unwatchConcernCard(userId: string, concernCardId: string): Promise<WatchResult> {
  const { error } = await supabase.from("card_watches")
    .delete().eq("user_id", userId).eq("concern_card_id", concernCardId);
  return watchResult(error, "change what you follow");
}

// Record that a user opened a concern card (privacy-preserving; counts on the
// user's own side, never surfaced socially). First open writes the row; later
// opens leave first_viewed_at intact.
export async function recordConcernCardView(userId: string, concernCardId: string) {
  if (!userId || !concernCardId) return;
  await supabase.from("concern_card_views").upsert(
    { user_id: userId, concern_card_id: concernCardId, first_viewed_at: new Date().toISOString(), view_count: 1 },
    { onConflict: "user_id,concern_card_id", ignoreDuplicates: true }
  );
}

// Concern cards for a neighborhood via the neighborhood_scores join. Powers the
// first-five-minutes welcome block.
export async function getConcernCardsForNeighborhood(neighborhoodSlug?: string | null, limit = 5): Promise<any[]> {
  if (!neighborhoodSlug) return [];
  // `!inner` is load-bearing. A filter on a NON-inner embed filters the embedded
  // rows, not the parent: an unsurfaced or archived card still returns its
  // neighborhood_scores row with `concern_cards: null`. `limit` counts parent
  // rows, so those nulls eat slots and asking for 12 can yield far fewer. Same
  // fix as web lib/concernCards.js; pages/api/civic-feed.js already used it.
  const { data } = await supabase.from("neighborhood_scores")
    .select("*, concern_cards!inner(*)")
    .eq("neighborhood_id", neighborhoodSlug)
    .eq("concern_cards.surfaces_to_feed", true)
    .eq("concern_cards.archived", false)
    .order("relevance_score", { ascending: false })
    .limit(limit);
  return (data || [])
    .map((ns: any) => ns.concern_cards && { ...ns.concern_cards, relevance_score: ns.relevance_score, local_context: ns.local_context })
    .filter(Boolean);
}

export type WeeklyActivity = {
  cardsRead: number;
  itemsWatched: number;
  votesCast: number;
  responsesReceived: number;
};

// Weekly activity summary — the successful-session commitment (STRATEGY §4):
// attention and closing count as civic acts, not just contribution.
export async function getWeeklyActivity(userId: string): Promise<WeeklyActivity> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [views, watches, votes] = await Promise.allSettled([
    supabase.from("concern_card_views").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("first_viewed_at", weekAgo),
    // CQ-NEW-2, ported from web lib/concernCards.js: "items followed" counts
    // card_watches, the concern CARD follow table. watched_concern_cards is the
    // civic ISSUE follow table — a different table with a different schema, and
    // the note column is `created_at`, not `watched_at`. Counting the wrong one
    // reported 0 for any resident who followed only council cards, which is
    // exactly what the feed's Follow buttons and /api/seed-watchers produce.
    supabase.from("card_watches").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", weekAgo),
    supabase.from("votes").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", weekAgo),
  ]);

  const { data: userVotes } = await supabase.from("votes").select("issue_id").eq("user_id", userId);
  const issueIds = (userVotes || []).map((v: any) => v.issue_id);
  let responsesReceived = 0;
  if (issueIds.length) {
    const { count } = await supabase.from("civic_issues")
      .select("*", { count: "exact", head: true })
      .in("id", issueIds).not("official_response", "is", null).gte("updated_at", weekAgo);
    responsesReceived = count || 0;
  }

  const val = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value.count || 0 : 0);
  return {
    cardsRead: val(views),
    itemsWatched: val(watches),
    votesCast: val(votes),
    responsesReceived,
  };
}
