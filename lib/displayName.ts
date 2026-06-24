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
