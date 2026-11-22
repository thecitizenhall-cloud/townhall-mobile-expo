import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEntry } from "./entryRoute.ts";

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

test("an answer that arrives after the timeout is dropped", async () => {
  let release;
  const late = () => new Promise((res) => { release = () => res({ profile: { onboarded: true, neighborhood_id: "n1" }, error: null }); });
  const r = await resolveEntry({ getUserId: user, getProfile: late }, 30);
  assert.equal(r, "unreachable");
  release();
  await new Promise((res) => setTimeout(res, 10));
  // resolveEntry has already settled; nothing else is observable, and it must not throw.
});
