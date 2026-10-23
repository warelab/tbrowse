import { describe, expect, it, vi } from 'vitest';
import {
  chunk,
  fanOut,
  fanOutChunks,
  mergeRecords,
  type FanOutProgress,
} from './fanOut';

/** A manually resolvable promise, so tests control when workers settle. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function assertMonotone(seen: FanOutProgress[], total: number) {
  let prev = { done: 0, failed: 0 };
  for (const p of seen) {
    expect(p.total).toBe(total);
    expect(p.done).toBeGreaterThanOrEqual(prev.done);
    expect(p.failed).toBeGreaterThanOrEqual(prev.failed);
    expect(p.failed).toBeLessThanOrEqual(p.done);
    prev = p;
  }
}

describe('fanOut', () => {
  it('never exceeds the concurrency limit (2)', async () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    let inFlight = 0;
    let maxInFlight = 0;
    const pending: Array<ReturnType<typeof deferred<string>>> = [];
    let started = 0;
    const worker = (key: string) => {
      inFlight++;
      started++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const d = deferred<string>();
      pending.push(d);
      return d.promise.then((v) => {
        inFlight--;
        return `${key}:${v}`;
      });
    };
    const p = fanOut(keys, worker, { concurrency: 2 });
    await tick();
    expect(inFlight).toBe(2);
    expect(started).toBe(2);
    // Release workers one at a time; the pool refills to at most 2.
    while (started < keys.length) {
      pending.shift()!.resolve('ok');
      await tick();
      expect(inFlight).toBeLessThanOrEqual(2);
    }
    for (const d of pending) d.resolve('ok');
    const r = await p;
    expect(maxInFlight).toBe(2);
    expect(r.results).toEqual({ a: 'a:ok', b: 'b:ok', c: 'c:ok', d: 'd:ok', e: 'e:ok' });
    expect(r.errors).toEqual({});
    expect(r.lastError).toBeNull();
    expect(r.progress).toEqual({ done: 5, total: 5, failed: 0 });
  });

  it('records partial failures in errors, counts them and keeps lastError', async () => {
    const seen: FanOutProgress[] = [];
    const r = await fanOut(
      ['a', 'b', 'c', 'd'],
      async (key) => {
        if (key === 'b') throw new Error('HTTP 500 for b');
        if (key === 'd') throw 'plain string';
        return key.toUpperCase();
      },
      { concurrency: 1, onProgress: (p) => seen.push({ ...p }) },
    );
    expect(r.results).toEqual({ a: 'A', c: 'C' });
    expect(r.errors).toEqual({ b: 'HTTP 500 for b', d: 'plain string' });
    expect(r.lastError).toBe('plain string');
    expect(r.progress).toEqual({ done: 4, total: 4, failed: 2 });
    assertMonotone(seen, 4);
    expect(seen.at(-1)).toEqual(r.progress);
  });

  it('onProgress is monotone and ends equal to the totals under concurrency', async () => {
    const seen: FanOutProgress[] = [];
    const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
    const r = await fanOut(
      keys,
      async (key) => {
        await new Promise((res) => setTimeout(res, Math.random() * 3));
        if (key.endsWith('3')) throw new Error(`bad ${key}`);
        return key;
      },
      { concurrency: 4, onProgress: (p) => seen.push({ ...p }) },
    );
    expect(seen).toHaveLength(20);
    assertMonotone(seen, 20);
    expect(seen.at(-1)).toEqual({ done: 20, total: 20, failed: 2 });
    expect(r.progress).toEqual({ done: 20, total: 20, failed: 2 });
    expect(Object.keys(r.results)).toHaveLength(18);
  });

  it('aborting mid-run resolves with in-flight keys settled and pending keys "aborted"', async () => {
    const ctrl = new AbortController();
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const started: string[] = [];
    const worker = (key: string, signal: AbortSignal) => {
      started.push(key);
      expect(signal.aborted).toBe(false);
      return new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error(`cancelled ${key}`)));
        if (key === 'a') resolve('A');
      });
    };
    const seen: FanOutProgress[] = [];
    const p = fanOut(keys, worker, {
      concurrency: 2,
      signal: ctrl.signal,
      onProgress: (pr) => seen.push({ ...pr }),
    });
    await tick();
    // a finished, b and c in flight.
    expect(started).toEqual(['a', 'b', 'c']);
    ctrl.abort();
    const r = await p;
    expect(started).toEqual(['a', 'b', 'c']);
    expect(r.results).toEqual({ a: 'A' });
    expect(r.errors).toEqual({
      b: 'cancelled b',
      c: 'cancelled c',
      d: 'aborted',
      e: 'aborted',
    });
    expect(r.progress).toEqual({ done: 5, total: 5, failed: 4 });
    expect(r.lastError).toBe('aborted');
    assertMonotone(seen, 5);
    expect(seen.at(-1)).toEqual(r.progress);
  });

  it('an already-aborted signal runs no worker at all', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const worker = vi.fn(async () => 1);
    const r = await fanOut(['a', 'b'], worker, { signal: ctrl.signal });
    expect(worker).not.toHaveBeenCalled();
    expect(r.errors).toEqual({ a: 'aborted', b: 'aborted' });
    expect(r.progress).toEqual({ done: 2, total: 2, failed: 2 });
  });

  it('gives each key its own signal, aborted when the outer one is', async () => {
    const ctrl = new AbortController();
    const signals: AbortSignal[] = [];
    const p = fanOut(
      ['a', 'b'],
      (_key, signal) => {
        signals.push(signal);
        return new Promise<number>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('x'))),
        );
      },
      { signal: ctrl.signal },
    );
    await tick();
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]).not.toBe(ctrl.signal);
    ctrl.abort();
    await p;
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('handles an empty key list', async () => {
    const onProgress = vi.fn();
    const r = await fanOut([], async () => 1, { onProgress });
    expect(r).toEqual({
      results: {},
      errors: {},
      progress: { done: 0, total: 0, failed: 0 },
      lastError: null,
    });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('defaults to 6 workers', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const r = await fanOut(
      Array.from({ length: 20 }, (_, i) => String(i)),
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight--;
        return 1;
      },
    );
    expect(maxInFlight).toBe(6);
    expect(r.progress.done).toBe(20);
  });
});

describe('chunk', () => {
  it('splits at size with a shorter tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('clamps a size below 1 to 1', () => {
    expect(chunk(['a', 'b'], 0)).toEqual([['a'], ['b']]);
    expect(chunk(['a', 'b'], -3)).toEqual([['a'], ['b']]);
  });
});

describe('fanOutChunks', () => {
  it('splits keys into chunks of size and merges each returned record', async () => {
    const calls: string[][] = [];
    const seen: FanOutProgress[] = [];
    const keys = ['g1', 'g2', 'g3', 'g4', 'g5'];
    const r = await fanOutChunks(
      keys,
      2,
      async (part) => {
        calls.push(part);
        const out: Record<string, number> = {};
        for (const k of part) out[k] = Number(k.slice(1));
        return out;
      },
      { concurrency: 1, onProgress: (p) => seen.push({ ...p }) },
    );
    expect(calls).toEqual([['g1', 'g2'], ['g3', 'g4'], ['g5']]);
    expect(r.results).toEqual({ g1: 1, g2: 2, g3: 3, g4: 4, g5: 5 });
    expect(r.errors).toEqual({});
    expect(r.lastError).toBeNull();
    expect(r.progress).toEqual({ done: 5, total: 5, failed: 0 });
    expect(seen.map((p) => p.done)).toEqual([2, 4, 5]);
    assertMonotone(seen, 5);
  });

  it('records a failing chunk under every key of that chunk', async () => {
    const r = await fanOutChunks(
      ['a', 'b', 'c'],
      2,
      async (part) => {
        if (part.includes('a')) throw new Error('HTTP 502 on /genes');
        return Object.fromEntries(part.map((k) => [k, k]));
      },
      { concurrency: 1 },
    );
    expect(r.results).toEqual({ c: 'c' });
    expect(r.errors).toEqual({ a: 'HTTP 502 on /genes', b: 'HTTP 502 on /genes' });
    expect(r.lastError).toBe('HTTP 502 on /genes');
    expect(r.progress).toEqual({ done: 3, total: 3, failed: 2 });
  });

  it('marks chunks never started as aborted when the signal fires', async () => {
    const ctrl = new AbortController();
    const p = fanOutChunks(
      ['a', 'b', 'c', 'd'],
      2,
      (part, signal) =>
        new Promise<Record<string, number>>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')));
          if (part.includes('a')) resolve({ a: 1, b: 2 });
        }),
      { concurrency: 1, signal: ctrl.signal },
    );
    await tick();
    ctrl.abort();
    const r = await p;
    expect(r.results).toEqual({ a: 1, b: 2 });
    expect(r.errors).toEqual({ c: 'cancelled', d: 'cancelled' });
    expect(r.progress).toEqual({ done: 4, total: 4, failed: 2 });
  });

  it('passes the chunk through unchanged and lets later chunks win', async () => {
    const r = await fanOutChunks(
      ['x', 'y'],
      1,
      async (part) => ({ shared: part[0]!, [part[0]!]: part[0]! }),
      { concurrency: 1 },
    );
    expect(r.results).toEqual({ x: 'x', y: 'y', shared: 'y' });
  });
});

describe('mergeRecords', () => {
  it('merges later-wins and skips undefined parts', () => {
    expect(mergeRecords({ a: 1, b: 1 }, undefined, { b: 2, c: 3 })).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
    expect(mergeRecords()).toEqual({});
  });

  it('returns a new object, never a part', () => {
    const a = { x: 1 };
    const out = mergeRecords(a);
    expect(out).toEqual(a);
    expect(out).not.toBe(a);
  });
});
