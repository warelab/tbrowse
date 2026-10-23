/**
 * Bounded-concurrency fan-out with per-key failure accounting.
 *
 * Generalises the six-worker pool pattern of the playground's
 * `loadEnsemblDomains` / `loadEnsemblOverlap` (`main.tsx:512-651`): a
 * single leaf failing used to abort the whole fan-out, which made one
 * transient 5xx out of ~175 requests lose the entire batch. Here failures
 * are counted and recorded per key, never thrown. `chunk` /
 * `fanOutChunks` cover the batched variant (`main.tsx:727-753`,
 * `Homology.js:250-290`) where one request answers for many keys.
 */

/** Running tally reported to `onProgress` and returned in the result. */
export interface FanOutProgress {
  /** Keys settled so far (successes + failures). Monotone. */
  done: number;
  /** Total number of keys. Constant for the run. */
  total: number;
  /** Keys that failed so far. Monotone, `<= done`. */
  failed: number;
}

/** Options accepted by {@link fanOut} and {@link fanOutChunks}. */
export interface FanOutOptions {
  /** Maximum keys in flight at once (default 6; values below 1 are treated as 1). */
  concurrency?: number;
  /**
   * Aborting this signal aborts every in-flight worker's own signal and
   * marks every key not yet started as failed with the message
   * `'aborted'`. The returned promise still resolves.
   */
  signal?: AbortSignal;
  /** Called after each key settles; `done` only ever increases. */
  onProgress?: (p: FanOutProgress) => void;
}

/** What {@link fanOut} and {@link fanOutChunks} resolve to. */
export interface FanOutResult<V> {
  /** Successful values keyed by input key. */
  results: Record<string, V>;
  /** Failure messages keyed by input key (`'aborted'` for keys never started). */
  errors: Record<string, string>;
  /** Final tally; `done === total` on resolution. */
  progress: FanOutProgress;
  /** Message of the most recent failure, or `null` when nothing failed. */
  lastError: string | null;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Shared worker pool. Runs `settle` for every item with at most
 * `concurrency` in flight; `settle` receives a fresh per-item
 * `AbortSignal` chained to `outer`, or `null` when `outer` was already
 * aborted before the item started (the item is then expected to be
 * recorded as aborted without being run). Items are claimed in order via
 * a shared cursor, exactly like the origin's `cursor++` workers.
 */
async function runPool<K>(
  items: readonly K[],
  concurrency: number,
  outer: AbortSignal | undefined,
  settle: (item: K, signal: AbortSignal | null) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      if (outer?.aborted) {
        await settle(item, null);
        continue;
      }
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(outer?.reason);
      outer?.addEventListener('abort', onAbort, { once: true });
      try {
        await settle(item, ctrl.signal);
      } finally {
        outer?.removeEventListener('abort', onAbort);
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * Runs `worker(key, signal)` for every key with bounded concurrency
 * (default 6) and collects the outcomes. A rejecting worker is recorded
 * in `errors[key]` (its message) and counted in `progress.failed`; the
 * promise never rejects because of a worker. Each worker gets its own
 * `AbortSignal` derived from `opts.signal`. If `opts.signal` aborts
 * mid-run, in-flight workers see their signal abort and whatever they
 * then return or throw is recorded as usual, while keys not yet started
 * are recorded as `errors[key] = 'aborted'` without being run; the
 * promise still resolves once every key has settled, with
 * `progress.done === progress.total`. `onProgress` fires after each key
 * settles with a monotone `done`. Origin pattern: `main.tsx:512-651`.
 */
export async function fanOut<V>(
  keys: readonly string[],
  worker: (key: string, signal: AbortSignal) => Promise<V>,
  opts: FanOutOptions = {},
): Promise<FanOutResult<V>> {
  const total = keys.length;
  const results: Record<string, V> = {};
  const errors: Record<string, string> = {};
  let done = 0;
  let failed = 0;
  let lastError: string | null = null;
  const fail = (key: string, msg: string) => {
    errors[key] = msg;
    failed++;
    lastError = msg;
  };
  await runPool(keys, opts.concurrency ?? 6, opts.signal, async (key, signal) => {
    if (signal === null) {
      fail(key, 'aborted');
    } else {
      try {
        results[key] = await worker(key, signal);
      } catch (err) {
        fail(key, errorMessage(err));
      }
    }
    done++;
    opts.onProgress?.({ done, total, failed });
  });
  return { results, errors, progress: { done, total, failed }, lastError };
}

/**
 * Splits `items` into consecutive arrays of at most `size` elements
 * (the last may be shorter). `size` is floored and clamped to at least 1
 * so a bad value can never loop forever. An empty input yields no chunks.
 * Origin: the `i += CHUNK` slicing loop at `main.tsx:731-732`.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * Like {@link fanOut} but one worker call answers for a whole chunk of
 * keys: `keys` are split with {@link chunk} into groups of `size`, the
 * worker receives each group and returns a record of per-key values,
 * and every returned record is merged into `results` (later chunks win
 * on duplicate keys). A rejecting worker records its message under
 * every key of that chunk; chunks never started because `opts.signal`
 * aborted record `'aborted'` for their keys. `progress` and `onProgress`
 * count individual keys, not chunks, so a 400-gene tree fetched 200 at a
 * time reports `done` as 0, 200, 400. Origin pattern: `main.tsx:727-753`.
 */
export async function fanOutChunks<V>(
  keys: readonly string[],
  size: number,
  worker: (keys: string[], signal: AbortSignal) => Promise<Record<string, V>>,
  opts: FanOutOptions = {},
): Promise<FanOutResult<V>> {
  const total = keys.length;
  const chunks = chunk(keys, size);
  const results: Record<string, V> = {};
  const errors: Record<string, string> = {};
  let done = 0;
  let failed = 0;
  let lastError: string | null = null;
  const failChunk = (part: string[], msg: string) => {
    for (const key of part) errors[key] = msg;
    failed += part.length;
    lastError = msg;
  };
  await runPool(chunks, opts.concurrency ?? 6, opts.signal, async (part, signal) => {
    if (signal === null) {
      failChunk(part, 'aborted');
    } else {
      try {
        Object.assign(results, await worker(part, signal));
      } catch (err) {
        failChunk(part, errorMessage(err));
      }
    }
    done += part.length;
    opts.onProgress?.({ done, total, failed });
  });
  return { results, errors, progress: { done, total, failed }, lastError };
}

/**
 * Shallow-merges any number of records into a new object, skipping
 * `undefined` parts; later parts win on duplicate keys. Convenience for
 * combining the per-chunk records a batched endpoint returns
 * (`main.tsx:746`).
 */
export function mergeRecords<V>(
  ...parts: ReadonlyArray<Record<string, V> | undefined>
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const part of parts) {
    if (part !== undefined) Object.assign(out, part);
  }
  return out;
}
