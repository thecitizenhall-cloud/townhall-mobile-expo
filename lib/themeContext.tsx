// The active palette, for screens and components. Read it with useTheme(),
// and build styles with useStyles(makeStyles), where makeStyles is
// `(T: Palette) => StyleSheet.create({...})` at module scope. A module-scope
// StyleSheet.create runs once at import, so it could never follow a theme
// change; a factory can.
//
// Stage 2 of light mode: the provider always supplies the dark palette, so
// nothing on screen changes. Choosing and resolving a theme comes with the
// Appearance control in Profile.
import { createContext, useContext, type ReactNode } from "react";
import { T as DARK, byMode, type Palette } from "./theme";

const ThemeContext = createContext<Palette>(DARK);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={DARK}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext);
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
export type { Palette };
