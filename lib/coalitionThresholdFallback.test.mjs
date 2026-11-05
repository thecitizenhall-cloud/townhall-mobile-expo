// The coalition bar must never show a made-up line. Until 2026-11 the issue
// screen rendered `threshold={coalThreshold ?? 8}`, so every issue read
// "25 of 8" until the RPC answered, and forever if it failed (web #219): a
// wrong civic number stated with confidence.
//
// tsc cannot catch this: `x ?? 8` is a number, and a number satisfies
// `number | null`. So this reads the syntax instead.
//
// WHAT IT CHECKS, with the TypeScript compiler's parser (not a regex):
// CoalitionBar's `threshold` has no default other than null, and no JSX
// `threshold={...}` prop in app/ or components/ contains a number literal
// ANYWHERE in its expression (`??`, `||`, ternaries, nested calls). The same
// goes for a `threshold:` key inside a JSX spread (`{...{ threshold: x ?? 8 }}`).
//
// WHAT IT DOES NOT SEE: a number reached through a variable or helper
// (`threshold={line}` where `line = x ?? 8`, or a spread of a named object),
// a number built from a string (`Number("8")`), or code outside app/ and
// components/.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Any numeric literal inside a node.
function hasNumber(n) {
  if (ts.isNumericLiteral(n)) return true;
  return ts.forEachChild(n, (c) => (hasNumber(c) ? true : undefined)) === true;
}

const isThreshold = (name) => name && ts.isIdentifier(name) && name.text === "threshold";

export function fallbacks(src, filename = "x.tsx") {
  const sf = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (sf.parseDiagnostics.length) {
    const d = sf.parseDiagnostics[0];
    throw new Error(`${filename}:${sf.getLineAndCharacterOfPosition(d.start).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  const hits = [];
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n) => {
    if (ts.isJsxAttribute(n) && isThreshold(n.name) && n.initializer && hasNumber(n.initializer)) {
      hits.push(`${line(n)} prop`);
    }
    if (ts.isJsxSpreadAttribute(n)) {
      const inSpread = (m) => {
        if (ts.isPropertyAssignment(m) && isThreshold(m.name) && hasNumber(m.initializer)) hits.push(`${line(m)} spread`);
        ts.forEachChild(m, inSpread);
      };
      inSpread(n.expression);
    }
    if ((ts.isBindingElement(n) || ts.isParameter(n)) && isThreshold(n.name) && n.initializer
        && n.initializer.kind !== ts.SyntaxKind.NullKeyword) {
      hits.push(`${line(n)} default`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("every fallback form is caught, and the honest props pass", () => {
  const src = [
    "const a = <B threshold={x ?? 8} />;",
    "const b = <B threshold={x || 8} />;",
    "const c = <B threshold={t ? t : 8} />;",
    "const d = <B threshold={getLine({ nbhd }) ?? 8} />;",
    "const e = <B threshold={\n  x ?? 8\n} />;",
    "const f = <B threshold={coalThreshold} />; const g = <B threshold={s.threshold} />;",
    "function H({ count = 0, threshold = 8 }: { count?: number; threshold?: number }) {}",
    "function I({ count = 0, threshold = null }: { count?: number; threshold: number | null }) {}",
    "function J({ threshold = fallback }) {}",
    "const k = <B {...{ threshold: x ?? 8 }} />;",
    "const l = <B {...{ count: 3, threshold: line }} />;",
  ].join("\n");
  assert.deepEqual(fallbacks(src), ["1 prop", "2 prop", "3 prop", "4 prop", "5 prop", "9 default", "11 default", "12 spread"]);
});

test("coalition thresholds have no numeric fallback", () => {
  const hits = [];
  for (const directory of ["app", "components"]) {
    for (const path of sourceFiles(join(root, directory))) {
      for (const h of fallbacks(readFileSync(path, "utf8"), path)) hits.push(`${relative(root, path)}:${h}`);
    }
  }
  assert.deepEqual(hits, []);
});
