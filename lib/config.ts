// Canonical web origin. The mobile client reuses the web app's API routes
// (/api/civic-feed, /api/issue/interpret, /api/issue/synthesize, /api/zk-verify,
// /zk-prover) so both surfaces share one server. Override per-build with
// EXPO_PUBLIC_SITE_URL.
export const SITE_URL =
  process.env.EXPO_PUBLIC_SITE_URL ?? "https://www.townhallcafe.org";
