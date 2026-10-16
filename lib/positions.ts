// Registering a resident's position on an issue (the `disagreements` table,
// position "agree" | "disagree"). One position per resident per issue (web
// migration 034), and changing it replaces the old one.
//
// This goes through set_position() (web migration 124), which deletes the old
// row and inserts the new one in ONE transaction under the caller's own RLS.
// A refused or failed insert rolls the delete back, so the resident keeps the
// position they had. It used to be two requests from here, and a failed
// insert after a successful delete left the resident with no position at all.
//
// Do not replace this with an upsert or an in-place UPDATE. 034's unique index
// is partial (where issue_id is not null), so ON CONFLICT cannot infer it, and
// an UPDATE is not how a position is meant to change: the insert policy's
// residency check is the one that decides.
//
// Issue-targeted positions only, which is every position this app writes.
// set_position does not cover a disagreement on a reply (reply_id set,
// issue_id null); if the app ever writes one, it needs its own path.
import { supabase } from "./supabase";
import { failureOf, writeErrorMessage, WriteFailure } from "./writeError";

export type PositionResult =
  | { ok: true; error: null; reason: null }
  | { ok: false; error: string; reason: WriteFailure };

export async function replacePosition(
  issueId: string, position: "agree" | "disagree", statement: string,
): Promise<PositionResult> {
  const { error } = await supabase.rpc("set_position", {
    p_issue_id: issueId, p_position: position, p_statement: statement,
  });
  if (!error) return { ok: true, error: null, reason: null };
  // The transaction rolled back, so whatever position they had still stands.
  return {
    ok: false,
    error: `Your position didn't change. ${writeErrorMessage(error, "share your position")}`,
    reason: failureOf(error),
  };
}
