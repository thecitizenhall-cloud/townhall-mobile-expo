import { supabase, CivicItem } from "./supabase";

// One server call for the council record. town_feed (web migration 101) resolves
// the resident's neighborhood and election district, applies the bands, and
// returns TOWN-WIDE counts alongside the page of cards.
//
// This replaces going through the web app's /api/civic-feed route for council
// matters. That route ordered by concern_cards.created_at — the moment the row
// was inserted — which is why a January hearing ingested in August surfaced
// stamped August, and why web and mobile could show ten cards each with no
// overlap. Bulletins, agendas and weather still come from the route; only the
// council record moved.
export type FeedFilter = "all" | "deciding" | "past_due" | "following" | "new";

export type FeedCounts = {
  n_total: number; n_receipts: number; n_returned: number; n_deciding: number;
  n_past_due: number; n_new: number; n_following: number; n_filtered: number;
};

export const EMPTY_COUNTS: FeedCounts = {
  n_total: 0, n_receipts: 0, n_returned: 0, n_deciding: 0,
  n_past_due: 0, n_new: 0, n_following: 0, n_filtered: 0,
};

const IMPACT_EMOJI: Record<string, string> = {
  housing: "🏘️", traffic: "🚗", schools: "🏫", taxes: "💰",
  environment: "🌳", safety: "🚨", other: "📋",
};

function outcomeLabel(signal?: string | null): string {
  switch (String(signal || "").toLowerCase()) {
    case "approved": return "✅ Approved";
    case "denied":
    case "rejected": return "❌ Not approved";
    case "deferred": return "⏸️ Deferred for another review";
    default:         return "⏳ Decision pending";
  }
}

// Map a town_feed card onto the CivicItem the feed already renders.
//
// created_at is the MEETING date, not the row's insertion time: it is what the
// stream sorts and displays by, and the insertion time is not a fact about the
// town. first_seen is carried separately so a card can say both — "First
// appeared Aug 22 · heard January 7" — instead of picking one and lying.
export function cardToCivicItem(card: any): CivicItem {
  const emoji = IMPACT_EMOJI[String(card.impact_type || "").toLowerCase()] ?? "📋";
  return {
    source: "civic_engine",
    external_id: `cc_${card.id}`,
    concern_card_id: card.id,
    tag: "council",
    title: `${emoji} ${card.title}`,
    body: [
      card.summary,
      "",
      outcomeLabel(card.outcome_signal),
      card.next_action_date ? `📅 Next action: ${card.next_action_date}` : null,
      card.affected_area ? `📍 ${card.affected_area}` : null,
      card.local_context ? `\n${card.local_context}` : null,
    ].filter((l) => l !== null).join("\n").trim(),
    url: card.source_url ?? null,
    address: card.affected_area ?? null,
    created_at: card.meeting_date || card.first_seen,
    image_url: null,
    outcome_signal: card.outcome_signal ?? null,
    impact_type: card.impact_type ?? null,
    relevance_score: card.relevance ?? undefined,
    _inDistrict: !!card.in_district,
    _onRoute: card.on_route ?? null,
    // Extras the RPC decided; the row renders the reason it was surfaced rather
    // than re-deriving one that could disagree with the ordering.
    _band: card.band,
    _bandReason: card.band_reason,
    _firstSeen: card.first_seen,
    _seen: !!card.seen,
    _followed: !!card.followed,
  } as CivicItem;
}

export async function loadTownFeed(
  slug: string | null,
  { filter = "all", limit = 20, offset = 0 }:
    { filter?: FeedFilter; limit?: number; offset?: number } = {},
): Promise<{ items: CivicItem[]; counts: FeedCounts; hasMore: boolean; note: string | null }> {
  const { data, error } = await supabase.rpc("town_feed", {
    p_slug: slug,
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) {
    return { items: [], counts: { ...EMPTY_COUNTS }, hasMore: false,
             note: error?.message ?? "town_feed returned nothing." };
  }
  return {
    items: (data.cards || []).map(cardToCivicItem),
    counts: { ...EMPTY_COUNTS, ...(data.counts || {}) },
    hasMore: !!data.has_more,
    note: data.note ?? null,
  };
}
