// lib/standingQuestions.ts
//
// The standing question — the returnable unit — on mobile.
//
// Following a matter says "tell me when it moves." Asking says "tell me when
// THIS is settled," and the difference is the condition: a question carries an
// explicit statement of what would answer it, which is the only reason it can
// come back at all. A comment can't, because nothing about it says what would
// close it.
//
// Writes go straight through supabase-js so RLS does the enforcing — the insert
// policy in migration 099 gates on is_verified_resident() (asking is a standing
// action, same as following and posting per migration 049) and pins status to
// 'standing'. Resolution is the ingest worker's alone; nobody marks their own
// question answered, and browser/app roles hold no UPDATE grant.
//
// Ported from the web lib/standingQuestions.js. Same tables, same policies, same
// error handling — the two clients must not diverge in what they allow.

import { supabase } from "./supabase";
import type { ConditionKind, StandingQuestion } from "./questionVocab";

export * from "./questionVocab";

type AskArgs = {
  userId?: string | null;
  card: { id: string; municipality_id: string; next_action_date?: string | null };
  body: string;
  conditionKind?: ConditionKind;
  conditionDetail?: Record<string, unknown>;
};

export async function askQuestion(
  { userId, card, body, conditionKind, conditionDetail }: AskArgs
): Promise<{ ok: boolean; error?: string; question?: StandingQuestion }> {
  if (!userId) return { ok: false, error: "Sign in to ask a question." };
  const text = String(body || "").trim();
  if (text.length < 3) return { ok: false, error: "Write the question first." };

  const { data, error } = await supabase.from("card_questions").insert({
    concern_card_id: card.id,
    asked_by: userId,
    municipality_id: card.municipality_id,
    body: text.slice(0, 2000),
    condition_kind: conditionKind || "none",
    condition_detail: conditionDetail || {},
    // The resident's own expectation, taken from the record where the record
    // states one. Never invented — a card with no stated next step gets no clock.
    expected_by: card.next_action_date || null,
  }).select().maybeSingle();

  if (error) {
    // 42501 is the RLS refusal a resident without a verified address gets.
    if ((error as any).code === "42501") {
      return { ok: false, error: "Verify your address to put a question on the public record." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, question: data as StandingQuestion };
}

// The passage that settled a question is the closest thing to an answer the
// record actually contains. Without it a receipt only names a status, and the
// resident has to go find the answer themselves — the thing this whole feature
// exists to stop. Fetched by id rather than as an embed so a renamed foreign key
// cannot take the list down with it.
async function attachEvidence(questions: StandingQuestion[]): Promise<StandingQuestion[]> {
  const ids = (questions || []).map((q) => q.resolved_by_appearance_id).filter(Boolean) as string[];
  if (!ids.length) return questions;
  const { data } = await supabase
    .from("card_appearances")
    .select("id,source_url,source_quote,meeting_date")
    .in("id", ids);
  const byId = Object.fromEntries((data || []).map((a: any) => [a.id, a]));
  return questions.map((q) => ({
    ...q,
    evidence: q.resolved_by_appearance_id ? byId[q.resolved_by_appearance_id] || null : null,
  }));
}

export async function getCardQuestions(
  cardId: string
): Promise<{ questions: StandingQuestion[]; error: string | null }> {
  const { data, error } = await supabase
    .from("card_questions")
    .select("id,body,condition_kind,status,expected_by,created_at,resolved_at,asked_by,resolved_by_appearance_id")
    .eq("concern_card_id", cardId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false });
  return {
    questions: await attachEvidence((data || []) as StandingQuestion[]),
    error: error?.message || null,
  };
}

export async function getMyQuestions(
  userId?: string | null
): Promise<{ questions: StandingQuestion[]; error: string | null }> {
  if (!userId) return { questions: [], error: null };
  const { data, error } = await supabase
    .from("card_questions")
    // Embed the matter's title so the civic record can name what each question
    // was about without a second round trip.
    .select("id,body,condition_kind,status,expected_by,created_at,resolved_at,resolved_by_appearance_id,concern_card_id,concern_cards(title,municipality_id)")
    .eq("asked_by", userId)
    .order("created_at", { ascending: false });
  // supabase-js types a foreign-key embed as an array, but PostgREST returns a
  // single row for a to-one relationship. Normalize rather than cast past it,
  // so callers really do see one matter and not a list of them.
  const rows = ((data || []) as any[]).map((r) => ({
    ...r,
    concern_cards: Array.isArray(r.concern_cards) ? r.concern_cards[0] ?? null : r.concern_cards ?? null,
  })) as StandingQuestion[];
  return { questions: await attachEvidence(rows), error: error?.message || null };
}

// Withdrawal is the one state change that is genuinely the author's. It goes
// through a SECURITY DEFINER rpc rather than an UPDATE policy so a resident
// can't reach the resolution columns — or rewrite the question's text — in the
// same statement.
export async function withdrawQuestion(questionId: string): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc("withdraw_card_question", { p_question_id: questionId });
  return { ok: !error, error: error?.message || null };
}

// Split a resident's questions into the two things the civic record cares about:
// what came back, and what is still owed them. Returns outrank waiting, which is
// the ordering the whole receipts view is built on.
export function partitionQuestions(questions?: StandingQuestion[] | null) {
  const returned: StandingQuestion[] = [];
  const standing: StandingQuestion[] = [];
  for (const q of questions || []) {
    if (q.status === "withdrawn") continue;
    (q.status === "standing" ? standing : returned).push(q);
  }
  returned.sort((a, b) => String(b.resolved_at || "").localeCompare(String(a.resolved_at || "")));
  return { returned, standing };
}
