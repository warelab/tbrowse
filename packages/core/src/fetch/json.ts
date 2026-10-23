/**
 * JSON convenience layer over {@link FetchLike}: a typed `HttpError`,
 * `getJson`, and pure-string URL helpers that work for relative bases
 * such as `/brapi/v2` (the WHATWG `URL` constructor rejects those).
 * New in `tbrowse-core`; no origin file.
 */

import { defaultFetch, type FetchLike } from './retry';

/**
 * Thrown by {@link getJson} when the response is not `ok`. Carries the
 * status, the requested URL and, when it could be read, the response body
 * text so callers can surface the server's own message (Solr and BrAPI
 * both put useful detail there).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodyText?: string;

  constructor(status: number, url: string, bodyText?: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    if (bodyText !== undefined) this.bodyText = bodyText;
  }
}

/**
 * GET `url` with `Accept: application/json` and parse the body. Throws
 * {@link HttpError} (with the body text when readable) on any non-2xx
 * status; the `signal` is passed straight to the transport so callers can
 * cancel. Extra `headers` are merged after `Accept`, so they may override
 * it.
 */
export async function getJson<T = unknown>(
  url: string,
  opts: { fetch?: FetchLike; signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<T> {
  const fetch = opts.fetch ?? defaultFetch;
  const init: RequestInit = {
    headers: { Accept: 'application/json', ...opts.headers },
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  const res = await fetch(url, init);
  if (!res.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      bodyText = undefined;
    }
    throw new HttpError(res.status, url, bodyText);
  }
  return (await res.json()) as T;
}

/** Query-parameter value accepted by {@link buildUrl}. */
export type UrlParamValue = string | number | readonly (string | number)[] | undefined;

/**
 * Joins `base` and `path` with exactly one `/` between them and appends
 * `params` as a query string. Array values are repeated under the same
 * key (`fq=a&fq=b`, as Solr expects); `undefined` values are skipped. If
 * the joined URL already carries a `?`, the new parameters are appended
 * with `&`. Pure string work, so a relative base such as `/brapi/v2` is
 * fine. Values are encoded by `URLSearchParams` (space becomes `+`).
 */
export function buildUrl(
  base: string,
  path: string,
  params: Record<string, UrlParamValue> = {},
): string {
  let joined: string;
  if (path === '') {
    joined = base;
  } else {
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    const p = path.startsWith('/') ? path : `/${path}`;
    joined = b + p;
  }
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value as readonly (string | number)[]) qs.append(key, String(v));
    } else {
      qs.append(key, String(value));
    }
  }
  const query = qs.toString();
  if (query === '') return joined;
  return joined + (joined.includes('?') ? '&' : '?') + query;
}

/**
 * Inverse of {@link buildUrl}: splits a URL at its first `?` into the
 * path (everything before it, which may be a relative or absolute URL)
 * and a `URLSearchParams` of the query string. A URL without `?` yields
 * empty params. Fragments are not treated specially.
 */
export function splitUrl(url: string): { path: string; params: URLSearchParams } {
  const q = url.indexOf('?');
  if (q === -1) return { path: url, params: new URLSearchParams() };
  return { path: url.slice(0, q), params: new URLSearchParams(url.slice(q + 1)) };
}
