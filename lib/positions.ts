// Registering a resident's position on an issue (the `disagreements` table,
// position "agree" | "disagree"). One position per resident per issue (web
// migration 034), and changing it replaces the old one.
//
// The replacement is a delete followed by an insert, and the two are not one
// transaction. If the insert then fails, a resident who had a position has
// lost it. Neither obvious client fix is available:
//   - an upsert cannot target 034's unique index, which is partial
//     (where issue_id is not null), so ON CONFLICT cannot infer it;
//   - updating the row in place would skip the insert policy's residency check
//     (migration 061 scopes it to the issue's neighborhood), because the update
//     policy checks only ownership. That would turn this into a way round the
//     standing gate.
// The real fix is server-side (one function doing both in one transaction).
// Until then: never insert if the delete failed, and if the insert fails, put
// the removed row back and say truthfully which of the two outcomes happened.
import { supabase } from "./supabase";
import { failureOf, writeErrorMessage, WriteFailure } from "./writeError";

export type PositionResult =
  | { ok: true; error: null; reason: null }
  | { ok: false; error: string; reason: WriteFailure; lost: boolean };

export async function replacePosition(
  userId: string, issueId: string, position: "agree" | "disagree", statement: string,
): Promise<PositionResult> {
  const { data: removed, error: delErr } = await supabase.from("disagreements")
    .delete().eq("user_id", userId).eq("issue_id", issueId)
    .select("id, user_id, issue_id, recognition_statement, position, created_at");
  if (delErr) {
    // Nothing was removed, so the earlier position (if any) still stands.
    return { ok: false, error: writeErrorMessage(delErr, "change your position"), reason: failureOf(delErr), lost: false };
  }

  const { error } = await supabase.from("disagreements").insert({
    user_id: userId, issue_id: issueId, recognition_statement: statement, position,
  });
  if (!error) return { ok: true, error: null, reason: null };

  const reason = failureOf(error);
  const base = writeErrorMessage(error, "share your position");
  const prior = (removed || [])[0];
  if (!prior) return { ok: false, error: base, reason, lost: false };

  const { error: restoreErr } = await supabase.from("disagreements").insert(prior);
  if (!restoreErr) {
    return { ok: false, error: `Your position didn't change. ${base}`, reason, lost: false };
  }
  // A failed restore is not proof of loss: another submission may have put a
  // position in between. Only say it is gone if there really is none.
  const { data: still } = await supabase.from("disagreements")
    .select("id").eq("user_id", userId).eq("issue_id", issueId).limit(1);
  if (still && still.length > 0) return { ok: false, error: base, reason, lost: false };
  return {
    ok: false,
    error: `Your earlier position was removed and the new one didn't save. ${base}`,
    reason,
    lost: true,
  };
}
