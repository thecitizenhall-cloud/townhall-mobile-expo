// Paging and stale-reply rules of the town-record client. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordSearch, buildRecordUrl, clampQuery, RECORD_QUERY_MAX } from "./recordSearchClient.ts";

// A fetch whose replies the test releases by hand, in any order.
function manual() {
  const calls = [];
  const fn = (url, init) => new Promise((resolve, reject) => {
    const c = { url, params: new URL(url).searchParams, init,
      reply: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }),
      fail: (e = new Error("net")) => reject(e) };
    calls.push(c);
  });
  return { fn, calls };
}
const page = (ids, more, next) => ({ items: ids.map((id) => ({ external_id: id })), has_more: more, next_offset: next });
const ids = (rs) => rs.getState().items.map((i) => i.external_id);
const make = (m) => new RecordSearch("jackson_nj", "https://x.test", m.fn, { pageSize: 2 });

test("buildRecordUrl sends town, q, offset and limit, and omits an empty q", () => {
  const u = new URL(buildRecordUrl("https://x.test", { town: "jackson_nj", q: "a&b=c", offset: 4, limit: 25 }));
  assert.equal(u.pathname, "/api/town-record");
  assert.equal(u.searchParams.get("q"), "a&b=c");
  assert.equal(u.searchParams.get("offset"), "4");
  assert.equal(new URL(buildRecordUrl("https://x.test", { town: "t_nj", q: "", offset: 0, limit: 5 })).searchParams.has("q"), false);
});

test("clampQuery trims, collapses whitespace and cuts at the cap", () => {
  assert.equal(clampQuery("  a   b "), "a b");
  assert.equal(clampQuery("x".repeat(RECORD_QUERY_MAX + 50)).length, RECORD_QUERY_MAX);
});

test("a slow reply for an old query never overwrites the newer query's results", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search("bennett");
  const p2 = rs.search("bennetts");
  assert.equal(m.calls.length, 2);
  m.calls[1].reply(page(["new"], false, null)); await p2;
  m.calls[0].reply(page(["old"], false, null)); await p1;   // arrives late
  assert.deepEqual(ids(rs), ["new"]);
  assert.equal(rs.getState().q, "bennetts");
});

test("a stale ERROR for an old query does not replace newer results", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search("a"); const p2 = rs.search("b");
  m.calls[1].reply(page(["b1"], false, null)); await p2;
  m.calls[0].reply({}, 500); await p1;
  assert.equal(rs.getState().status, "idle");
  assert.deepEqual(ids(rs), ["b1"]);
});

test("a late page 2 of the old query is dropped when the query changed", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search("a"); m.calls[0].reply(page(["a1", "a2"], true, 2)); await p1;
  const more = rs.loadMore();
  const p2 = rs.search("b");
  m.calls[2].reply(page(["b1"], false, null)); await p2;
  m.calls[1].reply(page(["a3"], false, null)); await more;
  assert.deepEqual(ids(rs), ["b1"]);
});

test("paging follows next_offset, appends, and stops when has_more is false", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search(""); m.calls[0].reply(page(["1", "2"], true, 2)); await p1;
  const p2 = rs.loadMore();
  assert.equal(m.calls[1].params.get("offset"), "2");
  m.calls[1].reply(page(["3"], false, null)); await p2;
  assert.deepEqual(ids(rs), ["1", "2", "3"]);
  assert.equal(rs.getState().hasMore, false);
  await rs.loadMore();
  assert.equal(m.calls.length, 2);
});

test("two loadMore calls before a render make one request", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search(""); m.calls[0].reply(page(["1", "2"], true, 2)); await p1;
  const a = rs.loadMore(); const b = rs.loadMore();
  assert.equal(m.calls.length, 2);
  m.calls[1].reply(page(["3", "4"], true, 4)); await a; await b;
  assert.deepEqual(ids(rs), ["1", "2", "3", "4"]);
});

test("a row repeated across pages is shown once", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search(""); m.calls[0].reply(page(["1", "2"], true, 2)); await p1;
  const p2 = rs.loadMore(); m.calls[1].reply(page(["2", "3"], false, null)); await p2;
  assert.deepEqual(ids(rs), ["1", "2", "3"]);
});

test("searching the query already shown does not refetch", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search(" x "); m.calls[0].reply(page(["1"], false, null)); await p1;
  await rs.search("x");
  assert.equal(m.calls.length, 1);
});

test("empty result is loaded with no items, distinct from an error", async () => {
  const m = manual(); const rs = make(m);
  const p = rs.search("zzz"); m.calls[0].reply(page([], false, null)); await p;
  const s = rs.getState();
  assert.equal(s.loaded, true); assert.equal(s.status, "idle"); assert.equal(s.items.length, 0);
});

test("a failed first page is an error (not 'no matches') and Retry repeats it", async () => {
  const m = manual(); const rs = make(m);
  const p = rs.search("q"); m.calls[0].reply({ error: "db secret" }, 500); await p;
  let s = rs.getState();
  assert.equal(s.status, "error"); assert.equal(s.loaded, false);
  assert.doesNotMatch(s.error, /secret/);
  const r = rs.retry(); assert.equal(m.calls[1].params.get("offset"), "0");
  m.calls[1].reply(page(["1"], false, null)); await r;
  assert.deepEqual(ids(rs), ["1"]); assert.equal(rs.getState().status, "idle");
});

test("a failed later page keeps the rows, and Retry asks for that same page", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search(""); m.calls[0].reply(page(["1", "2"], true, 2)); await p1;
  const p2 = rs.loadMore(); m.calls[1].fail(); await p2;
  assert.equal(rs.getState().status, "error"); assert.deepEqual(ids(rs), ["1", "2"]);
  const r = rs.retry(); assert.equal(m.calls[2].params.get("offset"), "2");
  m.calls[2].reply(page(["3"], false, null)); await r;
  assert.deepEqual(ids(rs), ["1", "2", "3"]);
});

test("a malformed body is an error, and disposed searches ignore replies", async () => {
  const m = manual(); const rs = make(m);
  const p = rs.search("a"); m.calls[0].reply({ items: "nope" }); await p;
  assert.equal(rs.getState().status, "error");
  const m2 = manual(); const r2 = make(m2);
  const p2 = r2.search("a"); r2.dispose(); m2.calls[0].reply(page(["1"], false, null)); await p2;
  assert.equal(r2.getState().items.length, 0);
});

test("loadMore is a no-op after a failed page: only retry() leaves the error state", async () => {
  const m = manual(); const rs = make(m);
  const p1 = rs.search(""); m.calls[0].reply(page(["1", "2"], true, 2)); await p1;
  const p2 = rs.loadMore(); m.calls[1].fail(); await p2;
  await rs.loadMore(); await rs.loadMore();
  assert.equal(m.calls.length, 2);
  assert.equal(rs.getState().status, "error");
});

test("starting a new request aborts the earlier one", async () => {
  const m = manual(); const rs = make(m);
  rs.search("a"); rs.search("b");
  assert.equal(m.calls[0].init.signal.aborted, true);
  assert.equal(m.calls[1].init.signal.aborted, false);
});

test("the abort signal is passed to fetch", async () => {
  const m = manual(); const rs = make(m);
  rs.search("a");
  assert.ok(m.calls[0].init.signal instanceof AbortSignal);
});

test("has_more with a null next_offset is not 'more'", async () => {
  const m = manual(); const rs = make(m);
  const p = rs.search(""); m.calls[0].reply(page(["1"], true, null)); await p;
  assert.equal(rs.getState().hasMore, false);
  await rs.loadMore();
  assert.equal(m.calls.length, 1);
});

test("dispose clears listeners", async () => {
  const m = manual(); const rs = make(m);
  let n = 0; rs.subscribe(() => { n++; });
  rs.dispose();
  rs.search("a");
  assert.equal(n, 0);
});

test("clampQuery stays within the cap and never leaves a lone surrogate", () => {
  const q = "x".repeat(RECORD_QUERY_MAX - 1) + "\u{1F600}";   // emoji straddles unit 100
  const c = clampQuery(q);
  assert.ok(c.length <= RECORD_QUERY_MAX);
  assert.equal(c, "x".repeat(RECORD_QUERY_MAX - 1));
  assert.equal(clampQuery("x".repeat(RECORD_QUERY_MAX - 2) + "\u{1F600}").length, RECORD_QUERY_MAX);
});
