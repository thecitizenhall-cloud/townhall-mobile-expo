// Text length the way the database measures it. Postgres char_length() and
// length() count characters (code points); a JS string's .length counts UTF-16
// units, in which one emoji is two. A minimum checked with .length therefore
// lets short text through that the database then refuses (five emoji pass a
// 10-character check here and fail a 10-character check there), and a cut made
// with .slice() can split a character in half.
//
// Every limit that mirrors a database check counts and cuts with these. This
// mismatch turned up four separate times across the web and mobile apps before
// it had one helper.
export function charCount(text: string): number {
  return Array.from(text || "").length;
}

export function clipChars(text: string, max: number): string {
  return Array.from(text || "").slice(0, max).join("");
}
