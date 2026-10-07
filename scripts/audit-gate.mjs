#!/usr/bin/env node
// scripts/audit-gate.mjs — the dependency-audit gate for nightly maintenance.
//
// `npm audit --omit=dev` cannot tell the app from its toolchain: the Expo CLI,
// Metro and Babel are all reachable from the `expo` and `react-native`
// production dependencies, so their advisories count as "production" and the
// plain command never passes. A gate that is always red carries no
// information, and a real finding can sit in it unnoticed.
//
// This gate fails only on advisories in code that can reach the shipped app.
// An advisory is set aside only when BOTH hold:
//
//   1. the vulnerable package is listed by name in .github/audit-scope.json
//      (`buildTimeOnly`), with a reason; and
//   2. every dependency path from this project to that package passes through
//      a listed build-time owner (`buildTimeOwners`) — checked against
//      package-lock.json on every run, so the exclusion stops applying the
//      moment a runtime package starts depending on it.
//
// Anything else fails, including a vulnerable package nobody has classified
// yet. Unknown is loud, never excluded. Set-aside advisories are still printed
// so they stay visible. If the audit cannot be run or read, the gate fails.
//
// Usage: node scripts/audit-gate.mjs [audit.json]   (runs npm audit if omitted)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fail = (msg) => { console.log(`audit gate: ${msg}`); process.exit(1); };

let audit, scope, lock;
try {
  scope = JSON.parse(readFileSync(".github/audit-scope.json", "utf8"));
  lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  let raw;
  if (process.argv[2]) raw = readFileSync(process.argv[2], "utf8");
  else {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    try { raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] }); }
    catch (e) { raw = e.stdout; }
  }
  audit = JSON.parse(raw);
} catch (e) {
  fail(`could not read the audit, the lockfile or the scope file (${e.message}). Failing closed.`);
}
if (!audit?.vulnerabilities || !lock?.packages) fail("audit or lockfile is not in the expected shape. Failing closed.");

const owners = new Map(scope.buildTimeOwners.map((o) => [o.package, o.reason]));
const allowed = new Map(scope.buildTimeOnly.map((o) => [o.package, o.reason]));
for (const [name, reason] of [...owners, ...allowed]) {
  if (!reason || !String(reason).trim()) fail(`"${name}" in .github/audit-scope.json has no reason. Every entry must say why.`);
}

// ── Dependency graph from the lockfile, production side only ────────────────
const pkgs = lock.packages;
const nameOf = (path) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
// Node resolution: look in the dependent's own node_modules, then each parent's.
function resolve(fromPath, dep) {
  let base = fromPath;
  for (;;) {
    const candidate = (base ? base + "/" : "") + "node_modules/" + dep;
    if (pkgs[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
}
function edges(path) {
  const p = pkgs[path] || {};
  // Peer dependencies count as edges: more paths can only make the gate stricter.
  const deps = { ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies };
  return Object.keys(deps).map((d) => resolve(path, d)).filter((t) => t && !pkgs[t].dev);
}

// Is `target` reachable from the project without crossing a build-time owner?
// Returns one such path (as package names) or null.
function runtimePathTo(target) {
  const seen = new Set([""]);
  const queue = [{ path: "", trail: [] }];
  while (queue.length) {
    const { path, trail } = queue.shift();
    for (const next of edges(path)) {
      if (seen.has(next)) continue;
      seen.add(next);
      const name = nameOf(next);
      const here = [...trail, name];
      if (next === target) return here;
      if (owners.has(name)) continue;          // a wall: everything behind it is toolchain
      queue.push({ path: next, trail: here });
    }
  }
  return null;
}

// ── Partition ────────────────────────────────────────────────────────────────
// Only packages that carry an advisory themselves are judged. The other
// entries in the report ("expo", "metro", …) are there because they depend on
// one, and follow from it.
const failing = [], setAside = [];
for (const [name, v] of Object.entries(audit.vulnerabilities)) {
  const advisories = (v.via || []).filter((x) => typeof x === "object");
  if (!advisories.length) continue;
  const ids = [...new Set(advisories.map((a) => a.url?.split("/").pop() || a.title))].join(", ");
  const entry = { name, severity: v.severity, ids };
  if (!allowed.has(name)) {
    failing.push({ ...entry, why: "not classified in .github/audit-scope.json — decide whether it ships" });
    continue;
  }
  const nodes = v.nodes?.length ? v.nodes : [`node_modules/${name}`];
  const leak = nodes.map((n) => (pkgs[n] ? runtimePathTo(n) : ["(not in lockfile)"])).find(Boolean);
  if (leak) failing.push({ ...entry, why: `listed as build-time only, but reachable outside the toolchain: ${leak.join(" > ")}` });
  else setAside.push({ ...entry, why: allowed.get(name) });
}
const stale = [...allowed.keys()].filter((n) => !audit.vulnerabilities[n]);

const line = (e) => `  [${e.severity}] ${e.name} (${e.ids})\n      ${e.why}`;
const sev = audit.metadata?.vulnerabilities;
console.log(`npm audit --omit=dev reports ${sev?.total ?? "?"} affected packages (critical ${sev?.critical ?? "?"}, high ${sev?.high ?? "?"}, moderate ${sev?.moderate ?? "?"}, low ${sev?.low ?? "?"}).`);
console.log(`\nFAILING — can reach the shipped app, or not yet classified (${failing.length}):`);
console.log(failing.length ? failing.map(line).join("\n") : "  none");
console.log(`\nSet aside — build-time toolchain only, verified against package-lock.json (${setAside.length}). Informational:`);
console.log(setAside.length ? setAside.map(line).join("\n") : "  none");
if (stale.length) console.log(`\nNo longer reported; remove from .github/audit-scope.json: ${stale.join(", ")}`);

if (failing.length) { console.log("\naudit gate FAILED"); process.exit(1); }
console.log("\naudit gate passed");
