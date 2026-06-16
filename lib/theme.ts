export const T = {
  bg: "#0F0E0C",
  surface: "#1A1916",
  surfaceHi: "#242220",
  border: "#2C2A26",
  cream: "#F2EDE4",
  creamDim: "#9A9188",
  creamFaint: "#4A4640",
  amber: "#D4922A",
  amberLo: "#2A1E08",
  amberMid: "#8C5E14",
  amberHi: "#F0B84A",
  teal: "#1D9E75",
  tealLo: "#0A2A1E",
  red: "#C0392B",
  redLo: "#2A0E0A",
} as const;

export type ThemeColor = keyof typeof T;
