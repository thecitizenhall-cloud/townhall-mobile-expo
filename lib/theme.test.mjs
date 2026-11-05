// Contrast rules for both palettes. Until now mobile's lived only in
// comments in lib/theme.ts; these are web's lib/theme.test.mjs rules, for the
// tokens mobile has. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { T, LIGHT, ROLE, byMode } from "./theme.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// WCAG relative luminance and contrast ratio.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const SURFACES = ["bg", "surface", "surfaceHi"];
const FAMILIES = ["amber", "teal", "blue", "purple", "coral", "red"];
const HEX = /^#[0-9A-F]{6}$/i;

test("dark and light have identical keys, every one has a role, and every value is a hex colour", () => {
  // A key missing from one palette would render as no colour at all under it.
  assert.deepEqual(Object.keys(LIGHT).sort(), Object.keys(T).sort());
  assert.deepEqual(Object.keys(ROLE).sort(), Object.keys(T).sort());
  for (const [k, v] of Object.entries(T)) assert.match(v, HEX, `dark ${k}`);
  for (const [k, v] of Object.entries(LIGHT)) assert.match(v, HEX, `light ${k}`);
});

const roleSweep = (name, palette) => {
  const fails = [];
  for (const [k, role] of Object.entries(ROLE)) {
    const min = role === "text" ? 4.5 : role === "control" ? 3 : null;
    if (min == null) continue;
    for (const s of SURFACES) {
      const r = contrast(palette[k], palette[s]);
      if (r < min) fails.push(`${name}: ${k} on ${s} ${r.toFixed(2)} < ${min}`);
    }
  }
  return fails;
};

// creamFaint on surfaceHi is the tightest dark pair: about 0.01 of headroom
// by design (see lib/theme.ts). Decide which token moved before changing either.
test("dark: text tokens clear 4.5:1 and control edges 3:1 on every surface", () => {
  assert.deepEqual(roleSweep("dark", T), []);
});

// Light needs three rules dark never did, because the families swap direction:
// the base passes as text, T.bg (the ink on a filled button) passes on each
// base, and body text plus the family's text colours pass on its Lo wash.
test("light: text 4.5:1, controls 3:1, fills legible as text, button ink and wash text legible", () => {
  const fails = roleSweep("light", LIGHT);
  const need = (fg, bg, min) => {
    const r = contrast(LIGHT[fg], LIGHT[bg]);
    if (r < min) fails.push(`light: ${fg} on ${bg} ${r.toFixed(2)} < ${min}`);
  };
  for (const f of FAMILIES) for (const s of SURFACES) need(f, s, 4.5);
  for (const f of FAMILIES) need("bg", f, 4.5);
  for (const f of FAMILIES) if (LIGHT[`${f}Lo`]) for (const t of ["cream", `${f}Hi`, f]) need(t, `${f}Lo`, 4.5);
  assert.deepEqual(fails, []);
});

test("the faint-text value fixed in August stays fixed", () => {
  // #4A4640 (1.74-2.06:1) was creamFaint until the 2026-08-20 sweep.
  assert.notEqual(T.creamFaint.toUpperCase(), "#4A4640");
  assert.ok(contrast(T.creamFaint, T.surfaceHi) >= 4.5);
});

test("byMode keeps the dark literal on dark and uses the light value on light", () => {
  assert.equal(byMode(T, "#141310", LIGHT.bg), "#141310");
  assert.equal(byMode(LIGHT, "#141310", LIGHT.bg), LIGHT.bg);
});

// A screen that imports the palette directly is frozen on dark: it never sees
// a theme change. Screens read it through lib/themeContext.tsx instead.
test("no screen or component imports the palette directly", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(f)) files.push(p);
    }
  };
  ["app", "components", "lib"].forEach((d) => walk(join(root, d)));
  const ALLOW = new Set(["lib/theme.ts", "lib/themeContext.tsx", "lib/theme.test.mjs"]);
  const hits = [];
  for (const f of files) {
    const rel = f.slice(root.length);
    if (ALLOW.has(rel)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["'][./]*(?:lib\/)?theme["']/g)) {
      const names = m[2].split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
      if (!m[1] && names.some((n) => n === "T" || n === "LIGHT")) hits.push(rel);
    }
  }
  assert.deepEqual(hits, []);
});
