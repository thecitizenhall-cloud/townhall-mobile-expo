// One vocabulary for rendering a concern card's outcome_signal.
//
// This was three copies and two raw renderers. app/card/[id].tsx carried the
// only correct map; components/ConcernCardItem.tsx and
// components/CivicFeedItem.tsx each printed `Outcome: {outcome_signal}` inside
// a pill hardcoded to T.tealLo/T.teal -- the approval colours -- so a service
// announcement read "Outcome: announced" in green and a refused application
// read "Outcome: denied" in green. ConcernCardItem is mounted on
// app/onboarding/welcome.tsx, the first screen a resident sees after the ZK
// proof.
//
// Migration 107's own type comment is the rule this enforces: 'announced' "is
// not a decision state" and "nothing may put an accountability clock on it".
// Colour is a claim about the record, so a value this map does not recognise
// must render neutral and never green.
//
// Two gaps existed even in the good copy, both live on the detail screen: the
// engine's VALID_OUTCOME_SIGNALS are approved / denied / deferred / pending /
// announced (civic-engine/analysis/analyzer.py), but the map had `rejected`
// rather than `denied` and no `deferred` at all. Both fell through to
// `OUTCOME_LABELS.pending`, so a REFUSED application rendered as "Pending vote"
// in amber. Both spellings are kept: `denied` is what the engine writes,
// `rejected` is carried by older rows.
//
// The feed-band prose in lib/townFeed.ts (outcomeLabel) is deliberately a
// different vocabulary -- emoji + a sentence for the stream -- and is not
// merged here.
import { T } from "./theme";

export type OutcomeStyle = { label: string; color: string; bg: string };

export const OUTCOME_LABELS: Record<string, OutcomeStyle> = {
  pending:    { label: "Pending vote",      color: T.amberHi,  bg: T.amberLo },
  // Not a decision state -- nothing will be voted on. Neutral on purpose.
  announced:  { label: "For information",   color: T.creamDim, bg: T.surface },
  approved:   { label: "Approved",          color: T.tealHi,   bg: T.tealLo },
  denied:     { label: "Not approved",      color: T.redHi,    bg: T.redLo },
  rejected:   { label: "Rejected",          color: T.redHi,    bg: T.redLo },
  deferred:   { label: "Deferred",          color: T.creamDim, bg: T.surface },
  tabled:     { label: "Tabled",            color: T.creamDim, bg: T.surface },
  discussed:  { label: "Under discussion",  color: T.blueHi,   bg: T.blueLo },
  introduced: { label: "Introduced",        color: T.purpleHi, bg: T.purpleLo },
};

// Neutral, never green, and never the bare enum. An unrecognised signal is a
// value this app has not been taught to interpret, so it says so plainly
// instead of dressing it as an approval.
const UNKNOWN: OutcomeStyle = { label: "On the record", color: T.creamDim, bg: T.surface };

export function outcomeFor(signal?: string | null): OutcomeStyle {
  if (!signal) return UNKNOWN;
  return OUTCOME_LABELS[String(signal).toLowerCase()] ?? UNKNOWN;
}
