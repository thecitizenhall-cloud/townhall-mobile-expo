// Shared utilities for concern cards and civic watching, ported from the web
// lib/concernCards.js so both surfaces watch, view-track, and summarize activity
// the same way.
//   concern_cards uses municipality_id (civic-engine schema)
//   card_watches is the civic-engine watch table
//   watched_concern_cards is the front-end table for civic_issues watching
import { supabase } from "./supabase";

// The resident's neighborhood SLUG — the text key neighborhood_scores and
// card_watches use (the notifier seeds/queries by it). profiles stores the
// uuid, so resolve through neighborhoods.
export async function getResidentNeighborhoodSlug(userId: string): Promise<string | null> {
  const { data: p } = await supabase.from("profiles").select("neighborhood_id").eq("id", userId).maybeSingle();
  if (!p?.neighborhood_id) return null;
  const { data: h } = await supabase.from("neighborhoods").select("slug").eq("id", p.neighborhood_id).maybeSingle();
  return h?.slug ?? null;
}

export async function watchCivicIssue(userId: string, issueId: string) {
  const { error } = await supabase.from("watched_concern_cards").insert({
    user_id: userId, issue_id: issueId, notify_on_move: true,
  });
  if (error && error.code !== "23505") return { success: false, error: error.message };
  return { success: true, error: null };
}

export async function unwatchCivicIssue(userId: string, issueId: string) {
  const { error } = await supabase.from("watched_concern_cards")
    .delete().eq("user_id", userId).eq("issue_id", issueId);
  return { success: !error, error: error?.message || null };
}

export async function watchConcernCard(userId: string, concernCardId: string, neighborhoodId?: string | null) {
  const { error } = await supabase.from("card_watches").insert({
    user_id: userId, concern_card_id: concernCardId, neighborhood_id: neighborhoodId || "unknown",
  });
  if (error && error.code !== "23505") return { success: false, error: error.message };
  return { success: true, error: null };
}

export async function unwatchConcernCard(userId: string, concernCardId: string) {
  const { error } = await supabase.from("card_watches")
    .delete().eq("user_id", userId).eq("concern_card_id", concernCardId);
  return { success: !error, error: error?.message || null };
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
  const { data } = await supabase.from("neighborhood_scores")
    .select("*, concern_cards(*)")
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
    supabase.from("watched_concern_cards").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("watched_at", weekAgo),
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
