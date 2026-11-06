import { useEffect, useRef, type RefObject } from "react";
import type WebView from "react-native-webview";
import { useThemeMode } from "./themeContext";
import { webThemeJS } from "./webTheme";

/**
 * The theme script for an embedded website page, for both inject props. When
 * the scheme changes while the page is open (the Appearance setting, or the
 * phone switching), it is re-run in the page, since the inject props only
 * apply on the next load.
 */
export function useWebTheme(ref: RefObject<WebView | null>): string {
  const { scheme } = useThemeMode();
  const js = webThemeJS(scheme);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    ref.current?.injectJavaScript(js);
  }, [js, ref]);
  return js;
}
