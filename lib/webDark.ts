// Keep the website pages the app embeds (the map, the report pin picker, the
// residency prover) on the dark palette, the only one the app's own screens
// have.
//
// The website has a light palette. It shows when the th_theme cookie is
// "light", or when there is no cookie and the browser reports
// prefers-color-scheme: light (web lib/themeMode.mjs). Inside the app, Android's
// WebView reports the APP's theme, not the phone's, so the main fix is
// app.json's userInterfaceStyle "dark" taking effect through expo-system-ui,
// which puts the app in night mode. This script is the fallback for WebView
// versions that ignore the app's theme.
//
// It does what the website's own Dark setting does: stores th_theme=dark (same
// cookie and attributes as web's cookieFor) and sets html[data-theme="dark"],
// then asks the page to recolour anything drawn with literal colours. Clearing
// the cookie in a WebView (Max-Age=0) undoes it.
//
// Pass it to both injectedJavaScriptBeforeContentLoaded and injectedJavaScript.
// On Android the first runs as the page STARTS loading, which can race the
// page's own first script; the second runs once the page has loaded, so the
// page always ends dark, and the cookie is in place for every later load.
export const WEB_DARK_JS = `
(function () {
  try {
    if (!/(?:^|;\\s*)th_theme=dark(?:;|$)/.test(document.cookie || "")) {
      document.cookie = "th_theme=dark; Max-Age=31536000; Path=/; SameSite=Lax"
        + (location.protocol === "https:" ? "; Secure" : "");
    }
    var root = document.documentElement;
    if (root && root.getAttribute("data-theme") !== "dark") {
      root.setAttribute("data-theme", "dark");
      if (typeof window.__thSyncThemeColor === "function") window.__thSyncThemeColor();
      try { window.dispatchEvent(new CustomEvent("th-theme-change", { detail: { mode: "dark" } })); } catch (e) {}
    }
  } catch (e) {}
})();
true;
`;
