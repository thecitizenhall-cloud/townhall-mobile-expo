// The active palette, for screens and components. Read it with useTheme(),
// and build styles with useStyles(makeStyles), where makeStyles is
// `(T: Palette) => StyleSheet.create({...})` at module scope. A module-scope
// StyleSheet.create runs once at import, so it could never follow a theme
// change; a factory can.
//
// The choice is System, Light or Dark (Profile > Appearance), saved on the
// device. System follows the phone's setting. app.json still forces the
// native side dark, so until that is lifted System resolves to dark.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { T as DARK, LIGHT, byMode, type Palette } from "./theme";
import { createPreferenceGate, resolveScheme, type Scheme, type ThemePreference } from "./themeMode";

const STORAGE_KEY = "th_theme";

type ThemeState = {
  palette: Palette;
  scheme: Scheme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeState>({
  palette: DARK,
  scheme: "dark",
  preference: "system",
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>("system");

  // One gate for the provider's lifetime, so a tap made before the saved
  // value loads wins over it.
  const [gate] = useState(() =>
    createPreferenceGate(setPref, (p) => AsyncStorage.setItem(STORAGE_KEY, p)));

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(gate.loaded).catch(() => {});
  }, [gate]);

  const [setPreference] = useState(() => (p: ThemePreference) => { gate.choose(p); });

  const scheme = resolveScheme(preference, system);
  // The canonical palette objects, never copies: byMode() and the styles
  // cache both key on identity.
  const palette = scheme === "light" ? LIGHT : DARK;
  const value = useMemo(
    () => ({ palette, scheme, preference, setPreference }),
    [palette, scheme, preference, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The saved choice, what it resolved to, and a setter. For the Appearance control and the status bar. */
export function useThemeMode() {
  const { scheme, preference, setPreference } = useContext(ThemeContext);
  return { scheme, preference, setPreference };
}

export function useTheme(): Palette {
  return useContext(ThemeContext).palette;
}

// One styles object per (factory, palette) pair, shared by every instance of
// a component, so a list of 100 rows builds its styles once per theme.
const cache = new WeakMap<(T: Palette) => unknown, Map<Palette, unknown>>();

export function useStyles<S>(make: (T: Palette) => S): S {
  const T = useTheme();
  let byPalette = cache.get(make);
  if (!byPalette) cache.set(make, (byPalette = new Map()));
  let styles = byPalette.get(T) as S | undefined;
  if (styles === undefined) {
    styles = make(T);
    byPalette.set(T, styles);
  }
  return styles;
}

export { byMode };
export type { Palette, Scheme, ThemePreference };
