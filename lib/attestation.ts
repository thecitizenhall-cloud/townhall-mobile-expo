// lib/attestation.ts
//
// Sworn residency attestation — mirrors the web client's lib/attestation.js.
// Keep the two in sync (statement wording + ATTESTATION_VERSION).
//
// Before the ZK residency proof runs, the resident affirms residency under
// penalty of perjury; we record that affirmation (timestamp + statement
// version) in the user's auth metadata. This is the document-free residency
// standard voter registration relies on — the legal weight is the sworn
// affirmation, not a stored document. Phase note: recorded client-side; a
// server-side record is the later hardening step.

import { supabase } from "./supabase";

export const ATTESTATION_VERSION = "v2-2026-06";

export function attestationStatement(townName?: string): string {
  const where = townName || "this municipality";
  return `I swear that ${where} is my real home — the place where I actually live, ` +
    `not a workplace, a second home, or a town I'm only passing through or once lived in. ` +
    `I understand that a verified resident's voice carries real weight here, and that ` +
    `claiming residency falsely is perjury and grounds for permanent removal. ` +
    `I make this statement knowingly, under penalty of perjury.`;
}

// Non-fatal by design: verification has already succeeded by the time this runs.
export async function recordAttestation(townName?: string): Promise<void> {
  try {
    await supabase.auth.updateUser({ data: {
      residency_attested:            true,
      residency_attested_at:         new Date().toISOString(),
      residency_attestation_version: ATTESTATION_VERSION,
      residency_attestation_town:    townName || null,
    }});
  } catch { /* non-fatal — verification already succeeded */ }
}
