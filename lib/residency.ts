import { router } from "expo-router";
import { supabase } from "./supabase";

// Standing in Townhall is established by a verified residency proof — never by
// merely holding an account or finishing onboarding. POSITION.md / CHARTER §I:
// "Verified residency establishes standing. Voice belongs to the governed of a
// place." A row in residency_proofs is the single source of truth (the same
// signal the profile screen reads). Reading is open to guests; standing is not.
export async function hasResidencyProof(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("residency_proofs")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
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
// (id, user_id, commitment_hash, proof_hash, created_at) — no expiry. The
// vote-gate edge function needs the proof_hash to cast a ZK priority vote.
export type ResidencyProof = { proof_hash: string };

export async function getResidencyProof(userId: string): Promise<ResidencyProof | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("residency_proofs")
    .select("proof_hash")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as ResidencyProof;
}

export function validateProof(proof: ResidencyProof | null): { valid: boolean; reason: string | null } {
  if (!proof) return { valid: false, reason: "Residency proof required to vote" };
  return { valid: true, reason: null };
}
