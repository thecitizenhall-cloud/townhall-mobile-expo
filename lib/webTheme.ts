// Keep the website pages the app embeds (the map, the report pin picker, the
// residency prover) on the same palette as the app.
//
// The website picks its palette from the th_theme cookie ("light" or "dark"),
// or, with no cookie, from prefers-color-scheme (web lib/themeMode.mjs).
// prefers-color-scheme is not usable here: on Android 7's WebView it does not
// follow the app's theme at all (measured on the Moto, Chrome 119). So the app
// always writes the cookie, with the RESOLVED scheme (System already turned
// into light or dark), which also replaces the year-long th_theme=dark cookie
// earlier versions of the app stored.
//
// It does what the website's own setting does: stores th_theme (same cookie
// and attributes as web's cookieFor), sets html[data-theme], and asks the page
// to recolour anything drawn with literal colours.
//
// Pass it to both injectedJavaScriptBeforeContentLoaded and injectedJavaScript.
// On Android the first runs as the page STARTS loading, which can race the
// page's own first script; the second runs once the page has loaded, so the
// page always ends on the right palette. useWebTheme() also re-runs it in an
// open page when the scheme changes.
import type { Scheme } from "./themeMode";

export function webThemeJS(scheme: Scheme): string {
  const mode = scheme === "light" ? "light" : "dark";
  return `
(function () {
  try {
    var mode = "${mode}";
    if (!new RegExp("(?:^|;\\\\s*)th_theme=" + mode + "(?:;|$)").test(document.cookie || "")) {
      document.cookie = "th_theme=" + mode + "; Max-Age=31536000; Path=/; SameSite=Lax"
        + (location.protocol === "https:" ? "; Secure" : "");
    }
    var root = document.documentElement;
    if (root && root.getAttribute("data-theme") !== mode) {
      root.setAttribute("data-theme", mode);
      if (typeof window.__thSyncThemeColor === "function") window.__thSyncThemeColor();
      try { window.dispatchEvent(new CustomEvent("th-theme-change", { detail: { mode: mode } })); } catch (e) {}
    }
  } catch (e) {}
})();
true;
`;
}
