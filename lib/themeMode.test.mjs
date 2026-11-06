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

test("fast taps are saved in order, so the last tap is what stays stored", async () => {
  let stored = null;
  // The first save is the slowest; unqueued, it would land last.
  const delays = [30, 1, 1];
  const g = createPreferenceGate(() => {}, (p) =>
    new Promise((r) => setTimeout(() => { stored = p; r(); }, delays.shift())));
  g.choose("light");
  g.choose("dark");
  await g.choose("system");
  // Outlast every save, queued or not.
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(stored, "system");
});

test("a failed save does not stop later ones", async () => {
  let stored = null;
  let first = true;
  const g = createPreferenceGate(() => {}, async (p) => {
    if (first) { first = false; throw new Error("disk full"); }
    stored = p;
  });
  g.choose("light");
  await g.choose("dark");
  assert.equal(stored, "dark");
});
