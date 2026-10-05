// lib/roundTrip.ts
//
// Shared "accountability clock" math — how long an issue/card has gone
// without an official response, and the day count/urgency threshold that
// escalates its visual weight.
//
// Mirror of the web lib/roundTrip.js — keep the two in step. The SETTLED and
// UNCLOCKED sets and the dateless guard are the parts that must never drift:
// each one exists because the clock was once put on something that had no
// deadline. daysSince / dayLabel already live in lib/format.ts and are reused
// rather than copied.
import { daysSince } from "./format";

export type AwaitingBadge = { days: number; urgent: boolean };

// Returns null if there's nothing to show (already responded, or too new to
// be meaningful yet), else { days, urgent } — urgent flips the badge to its
// amber/escalated look.
export function awaitingBadge(
  row: { created_at?: string | null; responded_at?: string | null; official_response?: string | null } | null | undefined,
  { minDays = 1, urgentAt = 7 }: { minDays?: number; urgentAt?: number } = {},
): AwaitingBadge | null {
  if (!row || row.responded_at || row.official_response) return null;
  const days = daysSince(row.created_at);
  if (days < minDays) return null;
  return { days, urgent: days >= urgentAt };
}

// A council matter is settled only when the board actually disposed of it.
// "deferred" is deliberately NOT in this set: a carried application is the exact
// case that goes quiet for months, so treating it as decided would hide the one
// silence most worth reporting.
const SETTLED = new Set(["approved", "denied", "rejected"]);

// Not settled — never clocked. An announcement (a collection schedule, a cleanup
// date) has no decision to wait for, and the date it carries is when the SERVICE
// happens, not when a board sits. Reading that as a missed deadline is how three
// Jackson DPW notices were published as 119, 133 and 141 days "past its expected
// date" for deadlines that never existed.
//
// The guard below for dateless cards already made half this argument — it just
// could not see a card whose date looked real. Classification is what tells the
// two apart, so it has to happen at extraction; see migration 107.
const UNCLOCKED = new Set(["announced"]);

export type StalledBadge = {
  days: number;
  reason: "overdue" | "quiet";
  urgent: boolean;
  since: string;
};

export type StallableCard = {
  outcome_signal?: string | null;
  next_action_date?: string | null;
  outcome_changed_at?: string | null;
  meeting_date?: string | null;
};

// The same accountability clock, pointed at the public record instead of an
// official's inbox. awaitingBadge asks "how long has nobody answered?"; this asks
// "how long has nothing moved?" — which is the only thing that can be said about
// a matter that is neither decided nor scheduled.
//
// Returns null when there is nothing to report: settled, or scheduled with a date
// still ahead of it. Otherwise { days, reason, urgent, since } where reason is
// "overdue" (it had a stated next date and blew through it) or "quiet" (it never
// had one and has simply gone still).
//
// Thresholds default to municipal rhythm, not inbox rhythm — councils typically
// sit twice a month, so a matter isn't "quiet" until it has missed a couple of
// cycles.
export function stalledBadge(
  card: StallableCard | null | undefined,
  { quietAfter = 21, urgentAt = 60 }: { quietAfter?: number; urgentAt?: number } = {},
): StalledBadge | null {
  if (!card) return null;
  const outcome = String(card.outcome_signal || "").toLowerCase();
  if (SETTLED.has(outcome) || UNCLOCKED.has(outcome)) return null;

  const next = card.next_action_date ? new Date(`${String(card.next_action_date).slice(0, 10)}T12:00:00`) : null;
  if (card.next_action_date && next && !Number.isNaN(next.getTime())) {
    if (next.getTime() > Date.now()) return null; // still scheduled — not stalled
    const days = daysSince(card.next_action_date);
    if (days < 1) return null;
    return { days, reason: "overdue", urgent: days >= urgentAt, since: card.next_action_date };
  }

  // No date at all. Only a matter the board explicitly carried is *expected*
  // back, so only that one can be meaningfully silent. Most dateless cards are
  // "pending" administrative records — a resolution passed, a guarantee released
  // — that have simply finished being interesting; putting a clock on those
  // turns 57% of the record amber and tells the resident nothing (measured
  // against the live Jackson set: 416 of 418 dateless non-settled cards).
  if (outcome !== "deferred") return null;
  const since = card.outcome_changed_at || card.meeting_date;
  if (!since) return null;
  const days = daysSince(since);
  if (days < quietAfter) return null;
  return { days, reason: "quiet", urgent: days >= urgentAt, since };
}
