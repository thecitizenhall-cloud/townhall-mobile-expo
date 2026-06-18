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
  creamDim: "#9A9188",
  creamFaint: "#4A4640",
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
