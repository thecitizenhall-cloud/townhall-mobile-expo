// lib/recordSearchClient.ts — the client half of the searchable town record.
//
// The SEARCH and the FILTERING live on the server (GET /api/town-record in the
// web app, which runs the web record's own query). Nothing here matches,
// escapes or filters text; this file only builds the request, pages through the
// answer and decides which answer is allowed to land.
//
// No imports on purpose: the unit tests load this file directly under node, so
// the fetch function and the base URL are passed in.

// The server trims, collapses whitespace and cuts the query at this length
// (web lib/recordSearch.mjs RECORD_SEARCH_MAX). It is the search box's
// maxLength so a resident never types past what is sent. If the server's cap
// changes, change this with it; the server's cut is still the one that counts.
export const RECORD_QUERY_MAX = 100;
export const RECORD_PAGE_SIZE = 25;

export type RecordItem = { external_id: string; [k: string]: any };

export type RecordState = {
  q: string;
  items: RecordItem[];
  hasMore: boolean;
  nextOffset: number | null;
  // "loading" is a first page (the list is empty or about to be replaced);
  // "loadingMore" is a later page appended below what is already shown.
  status: "idle" | "loading" | "loadingMore" | "error";
  // Which request failed, so Retry repeats that one and not another.
  errorOf: "first" | "more" | null;
  error: string | null;
  // False until the first page for the current query has landed: tells "no
  // matches" apart from "nothing asked yet".
  loaded: boolean;
};

export type RecordFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

export function buildRecordUrl(
  base: string,
  p: { town: string; q: string; offset: number; limit: number },
): string {
  const qs = new URLSearchParams();
  qs.set("town", p.town);
  if (p.q) qs.set("q", p.q);
  qs.set("offset", String(p.offset));
  qs.set("limit", String(p.limit));
  return `${base}/api/town-record?${qs.toString()}`;
}

// Caps the length for the "is this the same query" check and the request. Not a
// filter: the server's normalisation is the real one.
export function clampQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim().slice(0, RECORD_QUERY_MAX);
}

// What a resident is told. The server's own error text is never shown: it is
// not written for them and the body is not trusted to be what we expect.
export function errorMessage(status: number | null): string {
  if (status === 404) return "We couldn't find this town's record.";
  if (status === 429) return "Too many searches just now. Wait a moment and try again.";
  return "Couldn't load the town record. Check your connection and try again.";
}

class HttpError extends Error {
  status: number | null;
  constructor(status: number | null) { super(`http ${status}`); this.status = status; }
}

const INITIAL: RecordState = {
  q: "", items: [], hasMore: false, nextOffset: null,
  status: "idle", errorOf: null, error: null, loaded: false,
};

export class RecordSearch {
  private state: RecordState = INITIAL;
  private listeners = new Set<() => void>();
  // Every request takes a number from here. A reply applies only if its number
  // is still the latest for its kind: a slow answer for "bennett" must not
  // overwrite the answer for "bennetts" that a resident has since asked for.
  private gen = 0;
  private abort: AbortController | null = null;
  private pageSize: number;
  private town: string;
  private base: string;
  private doFetch: RecordFetch;

  // Fields are assigned by hand: the tests run this file under node's type
  // stripping, which does not support constructor parameter properties.
  constructor(town: string, base: string, doFetch: RecordFetch, opts: { pageSize?: number } = {}) {
    this.town = town;
    this.base = base;
    this.doFetch = doFetch;
    this.pageSize = opts.pageSize ?? RECORD_PAGE_SIZE;
  }

  getState = (): RecordState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  // Stop: any reply still in flight is ignored from here on (screen unmount).
  dispose(): void {
    this.gen++;
    this.abort?.abort();
    this.listeners.clear();
  }

  private set(patch: Partial<RecordState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // A new query replaces the list. Asking for the query already shown is a no-op
  // unless its last attempt failed.
  search(raw: string): Promise<void> {
    const q = clampQuery(raw);
    const s = this.state;
    if (s.loaded && s.q === q && s.status !== "error") return Promise.resolve();
    if (s.status === "loading" && s.q === q) return Promise.resolve();
    const mine = ++this.gen;
    this.abort?.abort();
    this.abort = new AbortController();
    this.set({ q, items: [], hasMore: false, nextOffset: null, status: "loading", errorOf: null, error: null, loaded: false });
    return this.run(mine, q, 0, "first");
  }

  loadMore(): Promise<void> {
    const s = this.state;
    if (!s.loaded || !s.hasMore || s.nextOffset === null) return Promise.resolve();
    // onEndReached can fire twice before a render: one page, one request.
    if (s.status === "loading" || s.status === "loadingMore") return Promise.resolve();
    const mine = ++this.gen;
    this.abort?.abort();
    this.abort = new AbortController();
    this.set({ status: "loadingMore", errorOf: null, error: null });
    return this.run(mine, s.q, s.nextOffset, "more");
  }

  retry(): Promise<void> {
    const s = this.state;
    if (s.status !== "error") return Promise.resolve();
    if (s.errorOf === "more") {
      this.set({ status: "idle" });
      return this.loadMore();
    }
    this.set({ loaded: false });
    return this.search(s.q);
  }

  private async run(mine: number, q: string, offset: number, kind: "first" | "more"): Promise<void> {
    const signal = this.abort?.signal;
    try {
      const res = await this.doFetch(
        buildRecordUrl(this.base, { town: this.town, q, offset, limit: this.pageSize }),
        { signal },
      );
      if (!res.ok) throw new HttpError(res.status);
      const body = await res.json();
      if (mine !== this.gen) return;
      if (!body || !Array.isArray(body.items) || typeof body.has_more !== "boolean") throw new HttpError(null);
      const have = new Set(kind === "more" ? this.state.items.map((i) => i.external_id) : []);
      // Offset paging can repeat a row when the record changes between pages
      // (web #252, same class); a repeated card is dropped, not shown twice.
      const fresh = (body.items as RecordItem[]).filter((i) => {
        if (have.has(i.external_id)) return false;
        have.add(i.external_id);
        return true;
      });
      const next = typeof body.next_offset === "number" ? body.next_offset : null;
      this.set({
        items: kind === "more" ? [...this.state.items, ...fresh] : fresh,
        hasMore: body.has_more && next !== null,
        nextOffset: next,
        status: "idle", errorOf: null, error: null, loaded: true,
      });
    } catch (e: any) {
      // A superseded request fails by being aborted or by being stale; either
      // way it says nothing about the current one.
      if (mine !== this.gen) return;
      this.set({
        status: "error", errorOf: kind,
        error: errorMessage(e instanceof HttpError ? e.status : null),
        // A failed first page is not "no matches".
        loaded: kind === "more" ? this.state.loaded : false,
      });
    }
  }
}
