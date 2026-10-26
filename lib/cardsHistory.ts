import { supabase, CivicItem } from "./supabase";
import { cardToCivicItem } from "./townFeed";

// The town record: every live concern card for one town, newest meeting first,
// filterable by outcome and by topic. Mirror of web loadCardsHistory
// (components/town/townScreenData.js), which backs web's Record view. It is a
// plain table read, not town_feed: the record is the whole ledger, not the
// ranked feed, and it carries no bands.
//
// Two deliberate differences from web:
// - Web keeps a fallback for databases without concern_cards.town_id
//   (migration 060). Production has it on every card, so mobile reads town_id
//   directly.
// - This filters surfaces_to_feed and removed_at as well as archived, per the
//   listing rule in AGENTS.md. surfaces_to_feed is the card's visibility flag;
//   about half of live cards have it off, and web's Record shows them anyway.
//
// id breaks ties in the order, so a page boundary between two cards from the
// same meeting cannot repeat or drop one.
export type RecordOutcome = "all" | "approved" | "denied" | "deferred" | "pending";
export type RecordImpact = "all" | "zoning" | "budget" | "infrastructure" | "education" | "other";

export const RECORD_PAGE_SIZE = 25;

export async function loadCardsHistory(
  townId: string | null,
  { outcome = "all", impact = "all", offset = 0, pageSize = RECORD_PAGE_SIZE }:
    { outcome?: RecordOutcome; impact?: RecordImpact; offset?: number; pageSize?: number } = {},
): Promise<{ items: CivicItem[]; hasMore: boolean; error: string | null }> {
  if (!townId) return { items: [], hasMore: false, error: null };
  let q = supabase.from("concern_cards").select("*")
    .eq("archived", false)
    .eq("surfaces_to_feed", true)
    .is("removed_at", null)
    .eq("town_id", townId);
  if (outcome !== "all") q = q.eq("outcome_signal", outcome);
  if (impact !== "all") q = q.eq("impact_type", impact);
  const { data, error } = await q
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error || !data) {
    return { items: [], hasMore: false, error: error?.message ?? "The town record returned nothing." };
  }
  return {
    // The table has no first_seen; created_at is when the card first appeared.
    items: data.map((row: any) => cardToCivicItem({ ...row, first_seen: row.created_at })),
    hasMore: data.length === pageSize,
    error: null,
  };
}
