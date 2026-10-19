import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETRYABLE_STATUS,
  backoffMs,
  fetchWithRetry,
  withRetry,
  type FetchLike,
} from './retry';

/** Builds a FetchLike that replays a scripted list of outcomes in order. */
function scripted(steps: Array<Response | Error>): FetchLike & { readonly calls: number } {
  let i = 0;
  const f: FetchLike = async () => {
    const step = steps[i++];
    if (step === undefined) throw new Error('script exhausted');
    if (step instanceof Error) throw step;
    return step;
  };
  return Object.defineProperty(f, 'calls', { get: () => i }) as FetchLike & {
    readonly calls: number;
  };
}

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : 'body', { status, headers });

describe('RETRYABLE_STATUS', () => {
  it('lists the transient statuses from the playground', () => {
    expect([...RETRYABLE_STATUS].sort((a, b) => a - b)).toEqual([
      429, 500, 502, 503, 504, 520, 522, 524,
    ]);
    expect(RETRYABLE_STATUS.has(404)).toBe(false);
  });
});

describe('backoffMs', () => {
  let random: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    random = vi.spyOn(Math, 'random');
  });
  afterEach(() => {
    random.mockRestore();
  });

  it('grows exponentially with jitter in [0.5, 1) of the capped value', () => {
    random.mockReturnValue(0);
    expect(backoffMs(0, 500, null)).toBe(250);
    expect(backoffMs(1, 500, null)).toBe(500);
    expect(backoffMs(2, 500, null)).toBe(1000);
    random.mockReturnValue(0.999999);
    expect(backoffMs(0, 500, null)).toBe(500);
  });

  it('is bounded by maxDelayMs (default 8000)', () => {
    random.mockReturnValue(0.999999);
    expect(backoffMs(10, 500, null)).toBe(8000);
    expect(backoffMs(10, 500, null, 1000)).toBe(1000);
    random.mockReturnValue(0);
    expect(backoffMs(10, 500, null, 1000)).toBe(500);
  });

  it('honours a numeric Retry-After (seconds), capped at 30s, without jitter', () => {
    random.mockReturnValue(0);
    expect(backoffMs(0, 500, '2')).toBe(2000);
    expect(backoffMs(0, 500, '0')).toBe(0);
    expect(backoffMs(0, 500, '120')).toBe(30_000);
  });

  it('ignores a non-numeric or negative Retry-After', () => {
    random.mockReturnValue(0);
    expect(backoffMs(1, 500, 'Wed, 21 Oct 2015 07:28:00 GMT')).toBe(500);
    expect(backoffMs(1, 500, '-5')).toBe(500);
  });
});

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a 429 after the Retry-After delay and returns the 200', async () => {
    const fetch = scripted([res(429, { 'Retry-After': '3' }), res(200)]);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const p = fetchWithRetry('u', undefined, { fetch });
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.status).toBe(200);
    expect(fetch.calls).toBe(2);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0]?.[1]).toBe(3000);
  });

  it('retries 503 three times then returns the 200 on the fourth attempt', async () => {
    const fetch = scripted([res(503), res(503), res(503), res(200)]);
    const p = fetchWithRetry('u', undefined, { fetch });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(fetch.calls).toBe(4);
  });

  it('never retries a 404: returns it, does not throw', async () => {
    const fetch = scripted([res(404), res(200)]);
    const p = fetchWithRetry('u', undefined, { fetch });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(404);
    expect(fetch.calls).toBe(1);
  });

  it('throws the last network error once attempts are exhausted', async () => {
    const fetch = scripted([
      new Error('ECONNRESET 1'),
      new Error('ECONNRESET 2'),
      new Error('ECONNRESET 3'),
    ]);
    const p = fetchWithRetry('u', undefined, { fetch, attempts: 3 });
    const caught = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('ECONNRESET 3');
    expect(fetch.calls).toBe(3);
  });

  it('wraps a non-Error rejection in an Error naming the url', async () => {
    const fetch: FetchLike = () => Promise.reject('boom');
    const p = fetchWithRetry('https://x/y', undefined, { fetch, attempts: 2 });
    const caught = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect((await caught) as Error).toMatchObject({
      message: 'Network error fetching https://x/y',
    });
  });

  it('returns (not throws) the final failing response after attempts', async () => {
    const fetch = scripted([res(502), res(502), res(502), res(502), res(200)]);
    const p = fetchWithRetry('u', undefined, { fetch });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(502);
    expect(fetch.calls).toBe(4);
  });

  it('bounds the sleep by maxDelayMs and uses baseDelayMs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const fetch = scripted([res(500), res(500), res(500), res(200)]);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const p = fetchWithRetry('u', undefined, {
      fetch,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
    });
    await vi.runAllTimersAsync();
    await p;
    expect(timeout.mock.calls.map((c) => c[1])).toEqual([1000, 1500, 1500]);
  });

  it('honours a retryable override', async () => {
    const fetch = scripted([res(418), res(200)]);
    const p = fetchWithRetry('u', undefined, { fetch, retryable: new Set([418]) });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(fetch.calls).toBe(2);
  });

  it('passes url and init through to the transport', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const fetch: FetchLike = async (u, i) => {
      seen.push([u, i]);
      return res(200);
    };
    const init = { headers: { Accept: 'application/json' } };
    await fetchWithRetry('https://h/p', init, { fetch });
    expect(seen).toEqual([['https://h/p', init]]);
  });

  it('defaults to globalThis.fetch when no transport is given', async () => {
    const stub = vi.fn(async () => res(200));
    vi.stubGlobal('fetch', stub);
    try {
      expect((await fetchWithRetry('u')).status).toBe(200);
      expect(stub).toHaveBeenCalledWith('u', {});
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a FetchLike that retries with the given options', async () => {
    const inner = scripted([res(503), res(200)]);
    const fetch = withRetry(inner, { attempts: 2, baseDelayMs: 1 });
    const p = fetch('u', { method: 'GET' });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(inner.calls).toBe(2);
  });
});
