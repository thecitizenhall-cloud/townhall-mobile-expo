// lib/questionVocab.ts
//
// The words a standing question is described in — the condition picker and the
// four receipts. Pure: no supabase client, no session, nothing that needs the
// network.
//
// Ported from the web lib/questionVocab.js. Kept as a literal port, comments and
// all, because the reasoning IS the spec here: several of these strings are the
// difference between a claim the system can support and one it cannot. If the
// web copy changes, change it here in the same commit — a resident who reads the
// same question on both surfaces must not be told two different things.

import { daysSince, dayLabel } from "./format";

export type ConditionKind = "outcome" | "next_date" | "mention" | "none";
export type QuestionStatus =
  | "standing" | "answered" | "contradicted" | "overtaken" | "ignored" | "withdrawn";

export type Evidence = {
  id: string;
  source_url: string | null;
  source_quote: string | null;
  meeting_date: string | null;
};

export type StandingQuestion = {
  id: string;
  body: string;
  condition_kind: ConditionKind;
  status: QuestionStatus;
  expected_by: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_by_appearance_id?: string | null;
  asked_by?: string;
  concern_card_id?: string;
  evidence?: Evidence | null;
  concern_cards?: { title: string; municipality_id: string } | null;
};

export type Condition = {
  kind: ConditionKind;
  label: string;
  hint: string;
  unavailable?: boolean;
};

// The condition picker, in the resident's words. The enum never reaches the UI.
export const CONDITIONS: Condition[] = [
  {
    kind: "outcome",
    label: "When the board decides this",
    hint: "Comes back the moment the record shows an approval or a denial.",
  },
  {
    kind: "next_date",
    label: "When a date gets set for it",
    hint: "Comes back when the record schedules this for a meeting.",
  },
  {
    kind: "mention",
    label: "When the record addresses something specific",
    // Stage 2 — the matcher doesn't exist yet, and saying so is better than
    // implying a return that will never arrive.
    hint: "Not available yet — Townhall can't read for a topic in the minutes so far.",
    unavailable: true,
  },
  {
    kind: "none",
    label: "Just put it on the record",
    // Honest about what the resolver does with it: nothing, unless the board
    // disposes of the matter, which resolves it to 'overtaken' rather than
    // 'answered'.
    hint: "It will not come back on its own. It stands on the public record.",
  },
];

export function conditionLabel(kind: ConditionKind | string): string {
  return CONDITIONS.find((c) => c.kind === kind)?.label || "On the record";
}

// The same condition, stated about a question rather than to the person
// composing one — and stated as what the resolver will ACTUALLY do, which is not
// the same as what the picker's label promises.
//
// resolve_questions._resolve is the authority: 'none' and 'mention' can never
// return "answered". A settled matter resolves them to 'overtaken', and nothing
// else moves them at all.
const CONDITION_THIRD_PERSON: Record<string, string> = {
  outcome: "Comes back when the board decides this.",
  next_date: "Comes back when the record sets a date for it.",
  mention: "No return condition Townhall can check yet — it only stands.",
  none: "No return condition. It stands on the record, and comes back only if the board disposes of the matter without answering it.",
};

export function conditionSentence(kind: ConditionKind | string): string {
  return CONDITION_THIRD_PERSON[kind] || CONDITION_THIRD_PERSON.none;
}

// The status the resolver writes when a question's CONDITION was met. It is NOT
// a claim that the question's TEXT was answered, and nothing here may imply one.
//
// _resolve matches the condition, never the content. A resident who asks "should
// this money go to infrastructure?" under "when the board decides this" gets a
// vote on a cap override, which satisfies their condition and answers nothing.
// The old label, "Answered by the record", asserted an answer the system had not
// verified and could not verify.
const CONDITION_MET: Record<string, string> = {
  outcome: "The board decided this",
  next_date: "The record set a date",
};

function metLabel(kind?: string): string {
  // 'mention' and 'none' cannot reach this status today, so the fallback is a
  // hedge rather than a case.
  return (kind && CONDITION_MET[kind]) || "The record moved on this";
}

export type Tone = "neutral" | "teal" | "amber";
export type Receipt = { label: string; tone: Tone; waiting?: string };

// The four receipts, plus the two non-receipt states.
export const RECEIPTS: Record<string, Receipt> = {
  standing: { label: "Standing", tone: "neutral" },
  // Overridden per condition by receiptFor — never render this one directly.
  answered: { label: "The record moved on this", tone: "teal" },
  contradicted: { label: "The record disagreed", tone: "amber" },
  overtaken: { label: "Decided without it", tone: "amber" },
  ignored: { label: "No answer", tone: "amber" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export function receiptFor(question?: Partial<StandingQuestion> | null): Receipt {
  const base = (question?.status && RECEIPTS[question.status]) || RECEIPTS.standing;
  if (question?.status === "answered") {
    return { ...base, label: metLabel(question?.condition_kind) };
  }
  if (question?.status !== "standing") return base;
  // A standing question that has outlived the date the resident expected
  // movement is still standing — the resolver hasn't swept yet — but the wait
  // itself is worth showing rather than hiding until a nightly job catches up.
  const days = question?.expected_by ? daysSince(question.expected_by) : 0;
  if (question?.expected_by && days > 0) {
    return { ...base, waiting: `${dayLabel(days)} past the date you expected` };
  }
  return base;
}

// What the record did, said about a question that has already returned. The
// second-person twin lives in resolve_questions.RECEIPT_COPY, which writes the
// notification; keep the two saying the same thing.
const RESOLUTION_SENTENCE: Record<string, string> = {
  overtaken: "The board decided the matter without answering it.",
  ignored: "Nothing in the record answered it, past the date movement was expected.",
  contradicted: "The record went against what it assumed.",
};

// Continuations of the badge, which sits directly above them — so they do not
// restate the fact, they hand back the judgement the resolver is not entitled
// to make.
const CONDITION_MET_SENTENCE: Record<string, string> = {
  outcome: "Whether that decision answers the question is for you to read and judge.",
  next_date: "That is what the question asked to be told.",
};

export function resolutionSentence(question?: Partial<StandingQuestion> | null): string | null {
  const status = question?.status;
  if (status === "answered") {
    return CONDITION_MET_SENTENCE[question?.condition_kind || ""] || "The record moved on this.";
  }
  return (status && RESOLUTION_SENTENCE[status]) || null;
}

// What Townhall commits to doing, said to the person about to ask — the Phase C
// gate in one sentence: the system must state, without a human in the loop, the
// specific condition under which the question returns. "When something changes"
// is a failure; that is following, not asking.
//
// expectedLabel is the card's stated next step, already formatted, or null. It is
// never invented: a card with no next step in the record gets no clock, so the
// promise must not mention one.
export function returnPromise(kind: ConditionKind | string, expectedLabel: string | null): string {
  const clock = expectedLabel
    ? ` If nothing has answered it by ${expectedLabel}, Townhall will tell you it went unanswered.`
    : "";
  switch (kind) {
    case "outcome":
      return `Townhall will bring this back the moment the record shows an approval or a denial.${clock}`;
    case "next_date":
      return `Townhall will bring this back when the record schedules this for a meeting.${clock}`;
    case "mention":
      return "Townhall cannot read the minutes for a topic yet, so this would only stand on the record.";
    default:
      return expectedLabel
        ? `This will not come back on its own — it stands on the public record.${clock}`
        : "This will not come back on its own. It stands on the public record, and returns only if the board disposes of the matter without answering it.";
  }
}
