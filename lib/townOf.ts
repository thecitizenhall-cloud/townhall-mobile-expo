// lib/townOf.ts — the governing-body municipality_id for a neighborhood.
//
// profiles.municipality_id is unset for nearly every resident, so anything
// that files or reads on their behalf (a street report, the budget, route
// watches) has to derive the town. The neighborhood slug carries it: a town's
// general neighborhood is "<town>-general" and its districts are
// "<town>-nj-dNN". The match is made against REAL governing-body ids in
// municipalities ("jackson_nj", "lakewood_nj"; board ids like
// "jackson_nj_planning" are excluded), not by splitting the slug on its first
// hyphen and appending "_nj" — that breaks for a multi-word town
// ("toms-river-general" -> "toms_nj") and for any other state. Longest town
// name wins, so "toms-river" beats a hypothetical "toms".
//
// Returns null when nothing matches; callers decide the fallback.
// Mirror of the web lib/townOf.js — keep the two in step. The by-slug form is
// mobile's addition, for callers that already hold the slug.
import { supabase } from "./supabase";

const STATE_SUFFIX = /_([a-z]{2})$/;

export async function municipalityForSlug(slug?: string | null): Promise<string | null> {
  if (!slug) return null;
  const { data: munis } = await supabase.from("municipalities").select("id");
  if (!munis?.length) return null;
  let best: string | null = null;
  let bestLen = 0;
  for (const { id } of munis as { id: string }[]) {
    if (!STATE_SUFFIX.test(id)) continue;          // a board, not a town
    const town = id.replace(STATE_SUFFIX, "").replace(/_/g, "-");
    if (slug.startsWith(town + "-") && town.length > bestLen) { best = id; bestLen = town.length; }
  }
  return best;
}

export async function municipalityForNeighborhood(neighborhoodId?: string | null): Promise<string | null> {
  if (!neighborhoodId) return null;
  const { data: hood } = await supabase.from("neighborhoods").select("slug").eq("id", neighborhoodId).maybeSingle();
  return municipalityForSlug(hood?.slug);
}

export default municipalityForNeighborhood;
