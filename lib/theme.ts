// Palette unified with the web app's IssueDetailScreen so the two surfaces render
// the same coffeehouse register. The *Hi accents, blue/purple/coral, and
// borderHi back the ported issue/card detail screens.
export const T = {
  bg: "#0F0E0C",
  surface: "#1A1916",
  surfaceHi: "#222019",
  border: "#2C2A26",
  borderHi: "#4A4640",
  cream: "#F2EDE4",
  // Contrast sweep 2026-08-20, measured against bg/surface/surfaceHi.
  //   creamFaint was #4A4640 — 1.74:1 to 2.06:1, far under WCAG 1.4.3's 4.5:1
  //   for body text. It is the token behind 98 usages across 18 files (every
  //   placeholder, caption and timestamp in the app), all of them text, so one
  //   token carried the whole defect.
  //   creamDim was #9A9188 — passing at 5.26:1, raised to the web value for
  //   parity and a little headroom.
  // #8F857B is the value that clears 4.5:1 on ALL THREE surfaces in BOTH apps;
  // web's #8D8379 reached only 4.39:1 on this app's lighter surfaceHi. Web was
  // moved to the same value in the same sweep — keep them identical.
  creamDim: "#AAA198",
  creamFaint: "#8F857B",
  amber: "#D4922A",
  amberLo: "#2A1E08",
  amberMid: "#8C5E14",
  amberHi: "#F0B84A",
  teal: "#1D9E75",
  tealLo: "#0A2A1E",
  tealHi: "#4CAF80",
  blue: "#378ADD",
  blueLo: "#0D1E35",
  blueHi: "#85B7EB",
  purple: "#7F77DD",
  purpleLo: "#1A1835",
  purpleHi: "#AFA9EC",
  purpleMid: "#534AB7",
  coral: "#D85A30",
  coralHi: "#F0997B",
  red: "#C0392B",
  redLo: "#2A0E0A",
  redHi: "#E57373",
} as const;

export type ThemeColor = keyof typeof T;
