// Shared display helpers, mirrored from the web app's IssueDetailScreen so the
// two surfaces phrase time and identity the same way.

export function timeAgo(d?: string | null): string {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

// Whole days elapsed since a timestamp (floored). Drives the accountability
// clock: the running days-awaiting counter that makes non-response visible.
export function daysSince(d?: string | null): number {
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
}

export function dayLabel(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Cheap stable hash for cache keys (signature of the input statements). Matches
// the web simpleHash so the shared synthesis cache key agrees across surfaces.
export function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

// Next Jackson Township Council meeting — 2nd & 4th Tuesdays (mirrors the feed's
// schedule generator and the web IssueDetailScreen). Deterministic, no network.
export function nextCouncilMeeting(from = new Date()): Date | null {
  const d = new Date(from);
  for (let i = 0; i < 70; i++) {
    d.setDate(d.getDate() + 1);
    const weekOfMonth = Math.ceil(d.getDate() / 7);
    if (d.getDay() === 2 && (weekOfMonth === 2 || weekOfMonth === 4)) return new Date(d);
  }
  return null;
}
