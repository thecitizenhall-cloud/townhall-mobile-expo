import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { entryDeps, resolveEntry, signOutHere } from "./entryRoute.ts";

const user = async () => "u1";
const profileOf = (profile, error = null) => async () => ({ profile, error });
const never = () => new Promise(() => {});

test("no session goes to login", async () => {
  assert.equal(await resolveEntry({ getUserId: async () => null, getProfile: profileOf(null) }), "/auth/login");
});

test("an onboarded resident with a neighborhood goes to the feed", async () => {
  const r = await resolveEntry({ getUserId: user, getProfile: profileOf({ onboarded: true, neighborhood_id: "n1" }) });
  assert.equal(r, "/tabs/feed");
});

test("a missing profile row, or onboarded unset, starts onboarding", async () => {
  assert.equal(await resolveEntry({ getUserId: user, getProfile: profileOf(null) }), "/onboarding/account");
  assert.equal(await resolveEntry({ getUserId: user, getProfile: profileOf({ onboarded: false, neighborhood_id: "n1" }) }), "/onboarding/account");
});

test("onboarded without a neighborhood goes to the neighborhood step", async () => {
  const r = await resolveEntry({ getUserId: user, getProfile: profileOf({ onboarded: true, neighborhood_id: null }) });
  assert.equal(r, "/onboarding/neighborhood");
});

test("a failed profile read is unreachable, not onboarding", async () => {
  const r = await resolveEntry({ getUserId: user, getProfile: profileOf(null, { message: "TypeError: Network request failed" }) });
  assert.equal(r, "unreachable");
});

test("a throw anywhere is unreachable", async () => {
  const boom = async () => { throw new Error("offline"); };
  assert.equal(await resolveEntry({ getUserId: boom, getProfile: profileOf(null) }), "unreachable");
  assert.equal(await resolveEntry({ getUserId: user, getProfile: boom }), "unreachable");
});

test("a profile read that hangs times out into unreachable", async () => {
  const t0 = Date.now();
  const r = await resolveEntry({ getUserId: user, getProfile: never }, 50);
  assert.equal(r, "unreachable");
  assert.ok(Date.now() - t0 < 1000);
});

test("a session read that hangs times out too", async () => {
  assert.equal(await resolveEntry({ getUserId: never, getProfile: profileOf(null) }, 50), "unreachable");
});

// The real supabase client against a fake network, so the auth and PostgREST
// behaviour under test is the installed library's, not a stub's.
const KEY = "sb-test-auth-token";
const jwt = (exp) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b({ sub: "u1", exp })}.sig`;
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const offline = async () => { throw new TypeError("Network request failed"); };

// autoRefreshToken is on, as in lib/supabase.ts.
function clientWith(t, fetch, { expired }) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600);
  const mem = new Map([[KEY, JSON.stringify({ access_token: jwt(exp), refresh_token: "r1", expires_at: exp, expires_in: 3600, token_type: "bearer", user: { id: "u1" } })]]);
  const storage = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => { mem.set(k, v); }, removeItem: async (k) => { mem.delete(k); } };
  const client = createClient("https://example.supabase.co", "anon", {
    auth: { storage, storageKey: KEY, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    global: { fetch },
  });
  t.after(() => client.auth.stopAutoRefresh());
  return { client, stored: () => mem.has(KEY) };
}

// auth-js backs off for about 25s before giving up on a refresh. Run its timers
// 1000x faster and keep its retry logging out of the test output.
function fastTimers(t) {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => real(fn, (ms ?? 0) / 1000, ...a);
  t.mock.method(console, "error", () => {});
  t.after(() => { globalThis.setTimeout = real; });
}
const LONG = 30_000_000; // 30s once scaled: only the library's own answer can decide these

test("real client: expired token offline is unreachable, not login, and keeps the session", async (t) => {
  fastTimers(t);
  const { client, stored } = clientWith(t, offline, { expired: true });
  assert.equal(await resolveEntry(entryDeps(client), LONG), "unreachable");
  assert.equal(await resolveEntry(entryDeps(client), LONG), "unreachable", "the retry, answered from auth-js's failure cooldown");
  assert.equal(stored(), true);
});

test("real client: a revoked refresh token reaches login on the first attempt", async (t) => {
  fastTimers(t);
  const revoked = async () => json(400, { code: "refresh_token_not_found", message: "Invalid Refresh Token" });
  const { client, stored } = clientWith(t, revoked, { expired: true });
  assert.equal(await resolveEntry(entryDeps(client), LONG), "/auth/login");
  assert.equal(stored(), false);
});

test("real client: valid token offline is unreachable", async (t) => {
  fastTimers(t);
  const { client } = clientWith(t, offline, { expired: false });
  assert.equal(await resolveEntry(entryDeps(client), LONG), "unreachable");
});

test("real client: no profile row goes to onboarding, which single() would break", async (t) => {
  // PostgREST's answer to each: an object request for zero rows is a 406.
  const noRow = async (_url, init) => {
    const accept = new Headers(init?.headers).get("accept") ?? "";
    return accept.includes("vnd.pgrst.object")
      ? json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: "The result contains 0 rows", hint: null })
      : json(200, []);
  };
  const { client } = clientWith(t, noRow, { expired: false });
  assert.equal(await resolveEntry(entryDeps(client), 5000), "/onboarding/account");
});

test("sign out works when the server rejects the token, and refuses offline", async (t) => {
  const rejected = clientWith(t, async () => json(401, { message: "invalid JWT" }), { expired: false });
  assert.equal(await signOutHere(rejected.client), true);
  assert.equal(rejected.stored(), false);

  const noNet = clientWith(t, offline, { expired: false });
  assert.equal(await signOutHere(noNet.client), false);
  assert.equal(noNet.stored(), true);
});

test("sign out that hangs gives up and keeps the session", async (t) => {
  const hung = clientWith(t, never, { expired: false });
  assert.equal(await signOutHere(hung.client, 50), false);
  assert.equal(hung.stored(), true);
});
