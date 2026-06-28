import { router } from "expo-router";
import { supabase } from "./supabase";

// Standing in Townhall is established by a verified residency proof — never by
// merely holding an account or finishing onboarding. POSITION.md / CHARTER §I:
// "Verified residency establishes standing. Voice belongs to the governed of a
// place." A row in residency_proofs is the single source of truth (the same
// signal the profile screen reads). Reading is open to guests; standing is not.
//
// A proof carries the neighborhood_id it was sworn for (migration 056). The
// server's is_verified_resident()/vote-gate only honor a proof whose
// neighborhood_id matches the user's current profiles.neighborhood_id (a null
// neighborhood_id is a legacy wildcard). The gates below mirror that so a
// resident who switches towns is sent back through verification — and a fresh
// sworn affirmation — instead of acting on a stale proof and being silently
// rejected by the server.

// True only if the proof is valid to act in the given neighborhood. Pass the
// user's current profiles.neighborhood_id; omit it for the legacy existence-only
// check.
export function proofMatchesNeighborhood(
  proof: ResidencyProof | null,
  currentNeighborhoodId?: string | null,
): boolean {
  if (!proof) return false;
  if (currentNeighborhoodId == null) return true;
  return proof.neighborhood_id == null || proof.neighborhood_id === currentNeighborhoodId;
}

export async function hasResidencyProof(userId: string, currentNeighborhoodId?: string | null): Promise<boolean> {
  const proof = await getResidencyProof(userId);
  return proofMatchesNeighborhood(proof, currentNeighborhoodId);
}

// Convenience gate: fetch the user's current profile neighborhood + proof and
// decide whether they're verified for the place they're acting in. One call so
// every gate site enforces the same rule the server does.
export async function isVerifiedForCurrentNeighborhood(userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data: prof } = await supabase
    .from("profiles").select("neighborhood_id").eq("id", userId).maybeSingle();
  if (!prof?.neighborhood_id) return false;
  return hasResidencyProof(userId, prof.neighborhood_id);
}

// Send a guest into the verification flow. We re-enter at the neighborhood step
// (not zk-proof directly) so GPS coordinates are freshly captured — the proof is
// worthless without them, and they are never persisted, so they can't be reused.
// ?verify=1 marks this as an on-demand verify (neighborhood → zk-proof), distinct
// from initial onboarding (neighborhood → welcome, ZK deferred to first act).
export function goVerify() {
  router.push("/onboarding/neighborhood?verify=1");
}

// Mirrors lib/getResidencyProof.js on web. LIVE SCHEMA: residency_proofs is
// (id, user_id, commitment_hash, proof_hash, created_at, neighborhood_id) — no
// expiry. The vote-gate edge function needs the proof_hash to cast a ZK priority
// vote; neighborhood_id binds the proof to the town it was sworn for.
export type ResidencyProof = { proof_hash: string; neighborhood_id: string | null };

export async function getResidencyProof(userId: string): Promise<ResidencyProof | null> {
  if (!userId) return null;
  let { data, error } = await supabase
    .from("residency_proofs")
    .select("proof_hash, neighborhood_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 42703 = undefined column: DB predates migration 056. Retry legacy shape so a
  // missing migration never locks everyone out of voting.
  if (error && ((error as any).code === "42703" || /neighborhood_id/.test(error.message || ""))) {
    ({ data, error } = await supabase
      .from("residency_proofs")
      .select("proof_hash")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle());
  }

  if (error || !data) return null;
  return {
    proof_hash: (data as any).proof_hash,
    neighborhood_id: (data as any).neighborhood_id ?? null,
  };
}

export function validateProof(
  proof: ResidencyProof | null,
  currentNeighborhoodId?: string | null,
): { valid: boolean; reason: string | null } {
  if (!proof) return { valid: false, reason: "Residency proof required to vote" };
  if (!proofMatchesNeighborhood(proof, currentNeighborhoodId)) {
    return { valid: false, reason: "Re-verify your residency for this town to vote" };
  }
  return { valid: true, reason: null };
}
