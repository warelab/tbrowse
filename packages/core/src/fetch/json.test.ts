import { describe, expect, it, vi } from 'vitest';
import { HttpError, buildUrl, getJson, splitUrl } from './json';
import type { FetchLike } from './retry';

describe('HttpError', () => {
  it('carries status, url and bodyText and is an Error', () => {
    const e = new HttpError(503, 'https://h/p', '{"error":"busy"}');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.name).toBe('HttpError');
    expect(e.status).toBe(503);
    expect(e.url).toBe('https://h/p');
    expect(e.bodyText).toBe('{"error":"busy"}');
    expect(e.message).toBe('HTTP 503 for https://h/p');
  });

  it('omits bodyText when none is given', () => {
    const e = new HttpError(404, 'u');
    expect('bodyText' in e).toBe(false);
    expect(e.bodyText).toBeUndefined();
  });
});

describe('getJson', () => {
  it('parses JSON and sends Accept: application/json with the signal', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetch: FetchLike = async (u, i) => {
      calls.push([u, i]);
      return new Response('{"a":1}', { status: 200 });
    };
    const ctrl = new AbortController();
    const v = await getJson<{ a: number }>('https://h/x', { fetch, signal: ctrl.signal });
    expect(v).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://h/x');
    expect(calls[0]?.[1]).toEqual({
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
  });

  it('does not set signal when none is given and merges extra headers', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('[]', { status: 200 }));
    await getJson('u', { fetch, headers: { 'X-Test': '1' } });
    const init = fetch.mock.calls[0]?.[1];
    expect(init).toEqual({ headers: { Accept: 'application/json', 'X-Test': '1' } });
    expect(init && 'signal' in init).toBe(false);
  });

  it('throws HttpError with the body text on a non-ok response', async () => {
    const fetch: FetchLike = async () =>
      new Response('not found: gene X', { status: 404 });
    const err = await getJson('https://h/genes/X', { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const he = err as HttpError;
    expect(he.status).toBe(404);
    expect(he.url).toBe('https://h/genes/X');
    expect(he.bodyText).toBe('not found: gene X');
  });

  it('still throws HttpError when the body cannot be read', async () => {
    const fetch: FetchLike = async () => {
      const r = new Response('x', { status: 500 });
      Object.defineProperty(r, 'text', { value: () => Promise.reject(new Error('gone')) });
      return r;
    };
    const err = await getJson('u', { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).bodyText).toBeUndefined();
  });

  it('propagates a transport rejection unchanged', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    await expect(getJson('u', { fetch })).rejects.toThrow('offline');
  });
});

describe('buildUrl', () => {
  it('works for a relative base', () => {
    expect(buildUrl('/brapi/v2', '/germplasm', { pageSize: 1000 })).toBe(
      '/brapi/v2/germplasm?pageSize=1000',
    );
    expect(buildUrl('/brapi/v2/', 'germplasm')).toBe('/brapi/v2/germplasm');
  });

  it('works for an absolute base', () => {
    expect(buildUrl('https://data.gramene.org/v67', '/genes', { rows: -1 })).toBe(
      'https://data.gramene.org/v67/genes?rows=-1',
    );
  });

  it('repeats keys for array params (Solr fq) and skips undefined', () => {
    const u = buildUrl('https://h/search', '', {
      q: '*:*',
      fq: ['gene_tree:T1', 'capabilities:expression_attributes'],
      fl: 'id,expr_*',
      rows: undefined,
    });
    expect(u).toBe(
      'https://h/search?q=*%3A*&fq=gene_tree%3AT1&fq=capabilities%3Aexpression_attributes&fl=id%2Cexpr_*',
    );
    expect(u).not.toContain('rows');
  });

  it('returns the joined url without ? when there are no params', () => {
    expect(buildUrl('https://h', '/p')).toBe('https://h/p');
    expect(buildUrl('https://h', '/p', { a: undefined })).toBe('https://h/p');
    expect(buildUrl('https://h/p', '')).toBe('https://h/p');
  });

  it('appends with & when the base already carries a query', () => {
    expect(buildUrl('https://h/p?x=1', '', { y: 2 })).toBe('https://h/p?x=1&y=2');
  });

  it('never uses the URL constructor on the base', () => {
    // A base that `new URL()` would reject must still work.
    expect(buildUrl('api', 'genes', { idList: 'a,b' })).toBe('api/genes?idList=a%2Cb');
  });
});

describe('splitUrl', () => {
  it('splits path and params, round-tripping buildUrl', () => {
    const built = buildUrl('/brapi/v2', '/variants', {
      variantSetDbId: 'vs1',
      fq: ['a', 'b'],
      page: 0,
    });
    const { path, params } = splitUrl(built);
    expect(path).toBe('/brapi/v2/variants');
    expect(params.get('variantSetDbId')).toBe('vs1');
    expect(params.getAll('fq')).toEqual(['a', 'b']);
    expect(params.get('page')).toBe('0');
    const record: Record<string, string[]> = {};
    for (const [k, v] of params) (record[k] ??= []).push(v);
    expect(buildUrl(path, '', record)).toBe(built);
  });

  it('yields empty params for a url without a query', () => {
    const { path, params } = splitUrl('https://h/p');
    expect(path).toBe('https://h/p');
    expect([...params]).toEqual([]);
  });

  it('splits at the first ? only', () => {
    const { path, params } = splitUrl('/p?a=1?b');
    expect(path).toBe('/p');
    expect(params.get('a')).toBe('1?b');
  });
});
