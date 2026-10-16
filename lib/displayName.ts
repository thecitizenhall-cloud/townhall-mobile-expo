// lib/displayName.ts
//
// Reserved-name guard for resident display names. Mirrors the web client's
// lib/displayName.js — keep the two in sync.
//
// Pseudonyms are welcome; impersonation is not. We block names that pose as a
// public official, the township/government, or Townhall Cafe itself. Trust
// comes from the verified-resident badge, not the name. Officials/experts earn
// their standing through the application + admin-approval flow, never by typing
// a title into this field.

import { clipChars } from "./chars";

const RESERVED = [
  // platform / system
  "townhall", "townhall cafe", "town hall cafe", "townhallcafe", "town hall",
  "admin", "administrator", "moderator", "mod", "support", "staff", "system",
  "root", "owner", "official", "officials",
  // civic authority titles / bodies
  "mayor", "deputy mayor", "councilman", "councilwoman", "councilmember",
  "council member", "council", "committeeman", "committeewoman", "committee",
  "clerk", "town clerk", "township clerk", "department",
  "police", "police department", "fire department", "board",
  // government entities
  "township", "borough", "town of", "township of", "borough of", "city of",
];

// Lowercase, strip diacritics (café → cafe), punctuation → space, collapse runs.
export function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns a user-facing error string if the name impersonates an official,
// the government, or the platform; otherwise null.
export function reservedNameError(name: string): string | null {
  const norm = normalizeName(name);
  if (!norm) return null;
  const padded = ` ${norm} `; // whole-word / phrase matching
  for (const term of RESERVED) {
    if (padded.includes(` ${term} `)) {
      return "That name isn't available. Please don't use official titles " +
        "(mayor, council, clerk…), a government name, or “Townhall.” " +
        "A first name or nickname is perfect.";
    }
  }
  return null;
}

// The longest display name the database accepts: web migration 125's check is
// char_length(display_name) <= 50, and the signup trigger trims to the same.
// Counted in characters, through lib/chars.ts. Same value as web's
// DISPLAY_NAME_MAX in lib/onboardingFlow.mjs.
export const DISPLAY_NAME_MAX = 50;

// While typing: leading spaces are dropped (they would be trimmed anyway, and
// must not use up the limit); everything else is cut at the limit.
export function clipDisplayName(name: string): string {
  return clipChars((name || "").replace(/^\s+/, ""), DISPLAY_NAME_MAX);
}

// What is actually written: trimmed, then held to the limit, then trimmed
// again. The signup trigger is left(btrim(name), 50) with no final trim, so
// where the 50th character is a space this keeps 49 and the trigger 50 plus a
// trailing space. Both pass the check and this one is never longer; the two
// are not identical, so do not treat this as the server's rule if the client's
// value ever becomes the authoritative one.
export function finalDisplayName(name: string): string {
  return clipChars((name || "").trim(), DISPLAY_NAME_MAX).trim();
}
