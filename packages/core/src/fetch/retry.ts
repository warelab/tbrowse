/**
 * Retrying `fetch` for flaky REST backends (Ensembl, Gramene, BrAPI).
 *
 * Lifted from `examples/playground/main.tsx:138-191`. The bodies are kept
 * intact; the only additions are an injectable `fetch` (so Node callers
 * and tests can supply their own), a configurable `maxDelayMs` (was the
 * hard-coded 8 000 ms) and an overridable set of retryable statuses.
 *
 * Nothing here touches browser globals; it runs unchanged in Node 18+
 * and in browsers.
 */

/**
 * The structural subset of WHATWG `fetch` that this library needs: a
 * string URL plus an optional `RequestInit`, resolving to a `Response`.
 * Every network-facing helper in `tbrowse-core` takes one of these so
 * callers can wrap, record, stub or rate-limit it.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Transient statuses worth another attempt. Ensembl sheds load with 5xx
 * and rate-limits with 429; every other 4xx is a real client error
 * (deprecated accession, unknown id) that retrying cannot fix. 520/522/524
 * are Cloudflare's origin-unreachable codes, seen on mirrors fronted by it.
 * Origin: `main.tsx:141`.
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504, 520, 522, 524,
]);

/** Options accepted by {@link fetchWithRetry} and {@link withRetry}. */
export interface RetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number;
  /** Base of the exponential backoff in milliseconds (default 500). */
  baseDelayMs?: number;
  /** Cap on the exponential backoff in milliseconds (default 8000). */
  maxDelayMs?: number;
  /** Statuses that trigger a retry (default {@link RETRYABLE_STATUS}). */
  retryable?: ReadonlySet<number>;
  /** Transport to use (default `globalThis.fetch`). */
  fetch?: FetchLike;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves the transport lazily at call time so a test that stubs
 * `globalThis.fetch` after module load still takes effect, and so the
 * global is invoked as a method (some browsers throw "Illegal invocation"
 * when `fetch` is called detached from `globalThis`).
 */
export function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  const f = globalThis.fetch;
  if (typeof f !== 'function') {
    return Promise.reject(
      new Error('No global fetch available; pass `fetch` in the options'),
    );
  }
  return globalThis.fetch(input, init);
}

/**
 * Exponential backoff with jitter, capped at `maxDelayMs`. Honours a
 * numeric `Retry-After` header when the server sends one (capped at 30 s,
 * independent of `maxDelayMs`, exactly as the origin did). The jitter
 * matters for the per-leaf fan-outs: without it, six workers that fail
 * together retry together forever. Origin: `main.tsx:146-162`.
 */
export function backoffMs(
  attempt: number,
  baseDelayMs: number,
  retryAfter: string | null,
  maxDelayMs = 8_000,
): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(secs * 1000, 30_000);
    }
  }
  const capped = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

/**
 * `fetch` with bounded retries for the failure modes Ensembl REST shows
 * under load: 429, 5xx, and dropped connections. Returns the final
 * response even when it is still a failure, so callers keep their
 * existing `res.ok` handling; only a network-level error (the transport
 * rejecting on every attempt) throws. Non-retryable statuses such as 404
 * are returned immediately without a retry. Origin: `main.tsx:164-191`.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    attempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    retryable = RETRYABLE_STATUS,
    fetch = defaultFetch,
  } = opts;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || !retryable.has(res.status)) return res;
      if (attempt === attempts - 1) return res;
      await sleep(
        backoffMs(attempt, baseDelayMs, res.headers.get('Retry-After'), maxDelayMs),
      );
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1) break;
      await sleep(backoffMs(attempt, baseDelayMs, null, maxDelayMs));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Network error fetching ${url}`);
}

/**
 * Wraps a transport so every call goes through {@link fetchWithRetry}
 * with the given options. This is what the data-source loader hands to
 * sources as their `fetch`, so individual sources never think about
 * retries.
 */
export function withRetry(
  fetch: FetchLike,
  opts: Omit<RetryOptions, 'fetch'> = {},
): FetchLike {
  return (input, init) => fetchWithRetry(input, init, { ...opts, fetch });
}
