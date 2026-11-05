// Palette unified with the web app's IssueDetailScreen so the two surfaces render
// the same coffeehouse register. The *Hi accents, blue/purple/coral, and
// borderHi back the ported issue/card detail screens.
export const T = {
  bg: "#0F0E0C",
  surface: "#1A1916",
  surfaceHi: "#222019",
  border: "#2C2A26",
  borderHi: "#4A4640",
  // The boundary of a CONTROL — a TextInput's edge, i.e. how you know it is
  // there. WCAG 1.4.11 asks 3:1 for that; border is 1.23:1 and borderHi 1.88:1,
  // and both stay as they are because they draw decorative card edges, which
  // the rule does not cover. 3.60 / 3.28 / 3.04 : 1 against bg / surface /
  // surfaceHi. Mirrors lib/theme.js on web — change both together.
  borderCtl: "#706A61",
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
  blueMid: "#185FA5",
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

// THE LIGHT PALETTE. Not used by any screen yet: until the screens read the
// palette at runtime, the app stays dark (T above). Values are web's LIGHT
// (lib/theme.js), key for key; change both together, and don't pick new hexes
// here. Light is a role swap, not an inversion: each colour family keeps its
// ladder (Lo is a wash behind text, Mid an accent edge, the base a fill, Hi
// the text colour), so on light Lo becomes a near-white tint and Hi becomes
// DARKER. One rule light adds: a family's BASE must also pass as text, because
// the code uses it as text (T.amber on links and labels). lib/theme.test.mjs
// checks every one of these.
export const LIGHT: Record<ThemeColor, string> = {
  bg: "#FBF9F4",
  surface: "#FFFFFF",
  surfaceHi: "#F3EFE7",
  border: "#E4DED3",
  borderHi: "#CFC7B8",
  borderCtl: "#8A8170",
  cream: "#1C1A16",
  creamDim: "#5E564B",
  creamFaint: "#6E655A",
  amber: "#8C5E14",
  amberLo: "#FBF0DC",
  amberMid: "#C99A4E",
  amberHi: "#7A5210",
  teal: "#137656",
  tealLo: "#E2F3EC",
  tealHi: "#0F6448",
  blue: "#1F5FA8",
  blueLo: "#E6EFFA",
  blueMid: "#7DA8DA",
  blueHi: "#1A4F8C",
  purple: "#4A42A8",
  purpleLo: "#EEEDFA",
  purpleHi: "#3D3690",
  purpleMid: "#958FD8",
  coral: "#A8431D",
  coralHi: "#933A18",
  red: "#B03024",
  redLo: "#FBE9E6",
  redHi: "#9A2A1F",
};

// What each token is for, so both palettes are held to the same rules
// (lib/theme.test.mjs). Same roles as web's ROLE.
//   text     body and secondary text: >= 4.5:1 (WCAG 1.4.3) on bg, surface, surfaceHi
//   control  the edge of an input: >= 3:1 (WCAG 1.4.11)
//   surface  a background text sits on
//   border   a decorative edge; no contrast rule applies
//   accent   a coloured border or rule (the *Mid tokens); not text
//   fill     a family's base: a fill, a dot, an icon (on light, also text)
//   wash     a tinted background behind text (the *Lo tokens)
export const ROLE: Record<ThemeColor, "text" | "control" | "surface" | "border" | "accent" | "fill" | "wash"> = {
  bg: "surface", surface: "surface", surfaceHi: "surface",
  border: "border", borderHi: "border", borderCtl: "control",
  cream: "text", creamDim: "text", creamFaint: "text",
  amber: "fill", amberLo: "wash", amberMid: "accent", amberHi: "text",
  teal: "fill", tealLo: "wash", tealHi: "text",
  blue: "fill", blueLo: "wash", blueMid: "accent", blueHi: "text",
  purple: "fill", purpleLo: "wash", purpleHi: "text", purpleMid: "accent",
  coral: "fill", coralHi: "text",
  red: "fill", redLo: "wash", redHi: "text",
};
