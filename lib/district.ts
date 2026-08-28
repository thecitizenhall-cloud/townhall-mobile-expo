// lib/district.ts
//
// The resident's election district lives in `resident_districts`, own-row only —
// NOT on `profiles`. profiles_public_read is `USING (true)` for anon and RLS is
// row-level, so a column on profiles is a column the whole internet can read.
// Migration 106 carries the full reasoning.
//
// Mirrored at newclaudeversion/lib/district.js — change both together.

import { supabase } from "./supabase";

/** The signed-in resident's own district id, or null. Never another user's. */
export async function getMyDistrictId(userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("resident_districts").select("district_id").eq("user_id", userId).maybeSingle();
  return (data as any)?.district_id ?? null;
}

/**
 * Store the district resolved on-device. Upsert, not insert: the row may already
 * exist from an earlier session, and a duplicate-key error here would surface as
 * a failed onboarding for something that is best-effort.
 */
export async function setMyDistrictId(userId?: string | null, districtId?: string | null): Promise<void> {
  if (!userId || !districtId) return;
  await supabase
    .from("resident_districts")
    .upsert({ user_id: userId, district_id: districtId, updated_at: new Date().toISOString() },
            { onConflict: "user_id" });
}
