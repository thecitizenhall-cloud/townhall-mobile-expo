// Escape a value that is about to be interpolated into a PostgREST LIKE/ILIKE
// pattern. `.ilike()` passes the value straight through as a pattern, so '%'
// and '_' keep their wildcard meaning unless escaped; the backslash is in the
// character class so a literal '\' in the input cannot escape the escape.
//
// Mirror of the web lib/escapeLike.js — change both together.
export const escapeLike = (v: unknown) => String(v ?? "").replace(/[\\%_]/g, (m) => "\\" + m);

export default escapeLike;
