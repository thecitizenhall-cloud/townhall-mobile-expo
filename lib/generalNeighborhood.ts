// The town's general neighborhood for a given neighborhood, via the
// general_neighborhood_of rpc (web migration 120) — the one place that rule
// lives. civic-sync posts town-wide items (agendas, bulletins, NOAA alerts)
// there once, so a feed of "posts in my neighborhood" must read it too.
// Mirror of the web app's lib/generalNeighborhood.js — change both together.
//
// Never throws. Before 120 is applied, or on any error, it answers null and the
// caller reads its own neighborhood only, which is exactly the old behaviour.
import { supabase } from "./supabase";

const memo = new Map<string, string | null>();

export async function getGeneralNeighborhoodId(hoodId: string | null | undefined): Promise<string | null> {
  if (!hoodId) return null;
  if (memo.has(hoodId)) return memo.get(hoodId) ?? null;
  try {
    const { data, error } = await supabase.rpc("general_neighborhood_of", { p_neighborhood: hoodId });
    if (error) return null;
    const id = (data as string | null) || null;
    memo.set(hoodId, id);
    return id;
  } catch {
    return null;
  }
}

// A card scored to both a resident's neighborhood and the general one is a
// synced post in each, so a feed reading both would show it twice. Keeps the
// first (callers order by created_at); resident posts have no external_id and
// are never touched.
export function dedupeSyncedPosts<T extends { external_id?: string | null }>(posts: T[]): T[] {
  const seen = new Set<string>();
  return (posts || []).filter((p) => {
    if (!p.external_id) return true;
    if (seen.has(p.external_id)) return false;
    seen.add(p.external_id);
    return true;
  });
}
