import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webThemeJS } from "./webTheme.ts";

// Runs the script against a fake page and returns what it did.
function run(scheme, { cookie = "", theme = null, protocol = "https:" } = {}) {
  const attrs = { "data-theme": theme };
  const events = [];
  const page = {
    cookieWrites: [],
    get cookie() { return cookie; },
    set cookie(v) { this.cookieWrites.push(v); cookie = v.split(";")[0]; },
  };
  const ctx = {
    document: Object.assign(page, {
      documentElement: { getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } },
    }),
    location: { protocol },
    window: { dispatchEvent: (e) => events.push(e.detail.mode) },
    CustomEvent: function (type, init) { this.detail = init.detail; },
  };
  vm.runInNewContext(webThemeJS(scheme), ctx);
  return { writes: page.cookieWrites, theme: attrs["data-theme"], events };
}

test("light replaces the old year-long dark cookie and recolours the page", () => {
  const r = run("light", { cookie: "a=1; th_theme=dark", theme: "dark" });
  assert.deepEqual(r.writes, ["th_theme=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure"]);
  assert.equal(r.theme, "light");
  assert.deepEqual(r.events, ["light"]);
});

test("dark on a fresh page writes the dark cookie", () => {
  const r = run("dark", { protocol: "http:" });
  assert.deepEqual(r.writes, ["th_theme=dark; Max-Age=31536000; Path=/; SameSite=Lax"]);
  assert.equal(r.theme, "dark");
});

test("a page already on the right palette is left alone", () => {
  const r = run("dark", { cookie: "th_theme=dark", theme: "dark" });
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.events, []);
});

test("a similar cookie name does not count as the theme cookie", () => {
  const r = run("light", { cookie: "xth_theme=light" , theme: "light" });
  assert.equal(r.writes.length, 1);
});
