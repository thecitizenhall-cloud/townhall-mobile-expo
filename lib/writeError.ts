// What a resident is told when a write fails. The database's own message
// ("new row violates row-level security policy for table card_watches") is
// for us, not for them, so no screen should put error.message in front of a
// resident; it goes through here instead.
//
// A standing refusal is the row-level-security answer a signed-in resident
// without a verified address gets on a standing action (follow, post, stake,
// position). 42501 is its code; the text test catches the same refusal when it
// arrives without one. Same rule the escalate, raise and standing-question
// paths already used inline.
//
// This is deliberately broad, and that is a decision, not an oversight: any
// 42501, or any message naming a policy or permission, reads as "verify your
// address". A verified resident refused by some OTHER policy therefore gets
// advice that cannot help them. The client cannot tell which policy refused a
// row, and web makes the same call in four places (standingQuestions.js,
// TownScreen.jsx twice, BudgetScreen.jsx), so the two apps say the same thing.
// Narrow it here and on web together, or not at all.
type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isStandingRefusal(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42501" || /row-level security|policy|permission|residen/i.test(error.message || "");
}

export type WriteFailure = "unverified" | "failed";

export function failureOf(error: DbError): WriteFailure {
  return isStandingRefusal(error) ? "unverified" : "failed";
}

// `action` finishes "Verify your address to …", e.g. "follow this matter".
export function writeErrorMessage(error: DbError, action: string): string {
  return isStandingRefusal(error)
    ? `Verify your address to ${action}.`
    : "That didn't go through. Check your connection and try again.";
}
