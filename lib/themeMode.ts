// The pure part of the theme choice, kept free of React Native so it can be
// tested under plain Node.
export type ThemePreference = "system" | "light" | "dark";
export type Scheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === "system" || v === "light" || v === "dark";
}

/** System follows the phone; an unknown or missing phone setting reads as dark, the app's original look. */
export function resolveScheme(pref: ThemePreference, system: string | null | undefined): Scheme {
  if (pref === "light" || pref === "dark") return pref;
  return system === "light" ? "light" : "dark";
}

/**
 * Applies the saved choice once it loads, unless the person has already
 * picked one in the meantime: a tap must never be undone by a slow read.
 */
export function createPreferenceGate(apply: (p: ThemePreference) => void) {
  let chosen = false;
  return {
    choose(p: ThemePreference) { chosen = true; apply(p); },
    loaded(v: unknown) { if (!chosen && isThemePreference(v)) apply(v); },
  };
}
