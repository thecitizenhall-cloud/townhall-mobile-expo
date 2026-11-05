import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreferenceGate, isThemePreference, resolveScheme, THEME_PREFERENCES } from "./themeMode.ts";

test("an explicit choice wins over the phone", () => {
  for (const sys of ["light", "dark", null, undefined]) {
    assert.equal(resolveScheme("light", sys), "light");
    assert.equal(resolveScheme("dark", sys), "dark");
  }
});

test("System follows the phone, and anything unknown reads as dark", () => {
  assert.equal(resolveScheme("system", "light"), "light");
  assert.equal(resolveScheme("system", "dark"), "dark");
  for (const sys of [null, undefined, "", "unspecified"]) assert.equal(resolveScheme("system", sys), "dark");
});

test("only the three choices are accepted from storage", () => {
  for (const p of THEME_PREFERENCES) assert.ok(isThemePreference(p));
  for (const v of [null, undefined, "", "Light", "auto", 1, {}]) assert.equal(isThemePreference(v), false);
});

test("the saved choice applies when nothing was tapped first", () => {
  const seen = [];
  const g = createPreferenceGate((p) => seen.push(p));
  g.loaded("light");
  assert.deepEqual(seen, ["light"]);
});

test("a tap before the saved choice loads is not undone by it", () => {
  const seen = [];
  const g = createPreferenceGate((p) => seen.push(p));
  g.choose("dark");
  g.loaded("light");
  assert.deepEqual(seen, ["dark"]);
});

test("a missing or corrupt saved value changes nothing", () => {
  const seen = [];
  const g = createPreferenceGate((p) => seen.push(p));
  for (const v of [null, "auto", 3]) g.loaded(v);
  assert.deepEqual(seen, []);
});
