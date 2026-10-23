import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoader, hostPropsFrom, mergeHostData, zoneStatusOf } from './loader';
import type { DataSlot, LoaderOptions, RootResult, SlotState, TreeDataSource } from './types';
import type { HostDataPatch, Tree } from '../types';
import type { FanOutProgress } from '../fetch/fanOut';
import type { FetchLike } from '../fetch/retry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

//   n0
//   ├── n1 (leaf, geneId g1)
//   └── n2
//       ├── n3 (leaf, geneId g2)
//       └── n4 (leaf, geneId g3)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: true, geneId: 'g1' },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: false },
    n3: { id: 'n3', parentId: 'n2', distance: 1, isLeaf: true, geneId: 'g2' },
    n4: { id: 'n4', parentId: 'n2', distance: 1, isLeaf: true, geneId: 'g3' },
  },
};

const otherTree: Tree = {
  rootId: 'r',
  nodes: { r: { id: 'r', parentId: null, distance: 0, isLeaf: true, geneId: 'solo' } },
};

interface Meta {
  tag: string;
}
interface Ctx {
  geneId: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every pending microtask / `await` chain settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface StubSlotOptions<T> {
  mode?: 'eager' | 'lazy';
  enabled?: (ctx: Ctx, root: RootResult<Meta>) => boolean;
  toHostData?: (value: T, root: RootResult<Meta>) => HostDataPatch;
  itemErrorsOf?: (value: T) => Record<string, string> | null;
  failWhen?: (value: T, itemErrors: Record<string, string> | null) => string | null;
  patchMeta?: (value: T, meta: Meta, root: RootResult<Meta>) => Meta;
}

interface StubSlot<T> {
  slot: DataSlot<T, Ctx, Meta>;
  /** One deferred per `run` call, in call order. */
  runs: Deferred<T>[];
  contexts: Parameters<DataSlot<T, Ctx, Meta>['run']>[0][];
  resolve(value: T, n?: number): Promise<void>;
  reject(err: unknown, n?: number): Promise<void>;
}

/** A slot whose `run` returns a manually settled promise. */
function stubSlot<T>(id: string, opts: StubSlotOptions<T> = {}): StubSlot<T> {
  const runs: Deferred<T>[] = [];
  const contexts: Parameters<DataSlot<T, Ctx, Meta>['run']>[0][] = [];
  const slot: DataSlot<T, Ctx, Meta> = {
    id,
    ...(opts.mode ? { mode: opts.mode } : {}),
    ...(opts.enabled ? { enabled: opts.enabled } : {}),
    run: (sc) => {
      contexts.push(sc);
      const d = deferred<T>();
      runs.push(d);
      return d.promise;
    },
    toHostData: opts.toHostData ?? ((value) => ({ hostData: { [id]: value } })),
    ...(opts.itemErrorsOf ? { itemErrorsOf: opts.itemErrorsOf } : {}),
    ...(opts.failWhen ? { failWhen: opts.failWhen } : {}),
    ...(opts.patchMeta ? { patchMeta: opts.patchMeta } : {}),
  };
  const last = (n?: number): Deferred<T> => {
    const d = runs[n ?? runs.length - 1];
    if (!d) throw new Error(`slot ${id}: run #${n ?? runs.length - 1} never started`);
    return d;
  };
  return {
    slot,
    runs,
    contexts,
    resolve: async (value, n) => {
      last(n).resolve(value);
      await flush();
    },
    reject: async (err, n) => {
      last(n).reject(err);
      await flush();
    },
  };
}

interface StubSource {
  source: TreeDataSource<Ctx, Meta>;
  roots: Deferred<RootResult<Meta>>[];
  rootContexts: Parameters<TreeDataSource<Ctx, Meta>['loadRoot']>[0][];
  resolveRoot(root?: Partial<RootResult<Meta>>, n?: number): Promise<void>;
  rejectRoot(err: unknown, n?: number): Promise<void>;
}

function stubSource(slots: readonly DataSlot<unknown, Ctx, Meta>[]): StubSource {
  const roots: Deferred<RootResult<Meta>>[] = [];
  const rootContexts: Parameters<TreeDataSource<Ctx, Meta>['loadRoot']>[0][] = [];
  const source: TreeDataSource<Ctx, Meta> = {
    id: 'stub',
    loadRoot: (rc) => {
      rootContexts.push(rc);
      const d = deferred<RootResult<Meta>>();
      roots.push(d);
      return d.promise;
    },
    slots,
  };
  const last = (n?: number): Deferred<RootResult<Meta>> => {
    const d = roots[n ?? roots.length - 1];
    if (!d) throw new Error('loadRoot never called');
    return d;
  };
  return {
    source,
    roots,
    rootContexts,
    resolveRoot: async (root = {}, n) => {
      last(n).resolve({ tree, meta: { tag: 'm0' }, ...root });
      await flush();
    },
    rejectRoot: async (err, n) => {
      last(n).reject(err);
      await flush();
    },
  };
}

/** Loader + a listener that records every snapshot it is notified with. */
function setup(slots: readonly DataSlot<unknown, Ctx, Meta>[], options: LoaderOptions = {}) {
  const src = stubSource(slots);
  const loader = createLoader(src.source, options);
  const seen: ReturnType<typeof loader.getSnapshot>[] = [];
  const listener = vi.fn(() => {
    seen.push(loader.getSnapshot());
  });
  loader.subscribe(listener);
  return { ...src, loader, listener, seen };
}

const ctx: Ctx = { geneId: 'g2' };

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// start(): root load, pivot, eager / lazy / disabled slots
// ---------------------------------------------------------------------------

describe('createLoader start()', () => {
  it('begins idle with every declared slot idle and no zone status', () => {
    const a = stubSlot<number>('a');
    const { loader } = setup([a.slot], { zoneSlots: { z: ['a'] } });
    const s = loader.getSnapshot();
    expect(s.status).toBe('idle');
    expect(s.tree).toBeNull();
    expect(s.generation).toBe(0);
    expect(s.slots['a']).toEqual({ status: 'idle', value: undefined, error: null, progress: null, itemErrors: null });
    expect(s.zoneStatus).toEqual({});
  });

  it('loads the root, sets tree/root/data/pivot, then runs the enabled eager slots concurrently', async () => {
    const a = stubSlot<number>('a');
    const lazy = stubSlot<number>('lazy', { mode: 'lazy' });
    const off = stubSlot<number>('off', { enabled: (c) => c.geneId === 'nope' });
    const on = stubSlot<number>('on', { enabled: (c, root) => c.geneId === 'g2' && root.meta.tag === 'm0' });
    const { loader, resolveRoot, rootContexts } = setup([a.slot, lazy.slot, off.slot, on.slot]);

    const started = loader.start(ctx);
    expect(loader.getSnapshot().status).toBe('loading');
    expect(loader.getSnapshot().generation).toBe(1);
    expect(rootContexts[0]?.ctx).toBe(ctx);
    expect(rootContexts[0]?.signal).toBeInstanceOf(AbortSignal);

    await resolveRoot({ nodeOfInterest: 'g2', data: { msa: { alphabet: 'protein', length: 1, sequences: {} } } });
    const s = loader.getSnapshot();
    expect(s.status).toBe('ready');
    expect(s.tree).toBe(tree);
    expect(s.root?.meta).toEqual({ tag: 'm0' });
    expect(s.data.msa?.alphabet).toBe('protein');
    // path n0 → n2 → n3; n2 is n0's second child, so n0 is swapped; no off-path internal nodes
    expect(s.pivot).toEqual({ collapsedNodeIds: [], swappedNodeIds: ['n0'], targetId: 'n3' });

    // eager + enabled slots are loading; lazy + disabled stay idle
    expect(s.slots['a']?.status).toBe('loading');
    expect(s.slots['on']?.status).toBe('loading');
    expect(s.slots['lazy']?.status).toBe('idle');
    expect(s.slots['off']?.status).toBe('idle');
    expect(a.runs).toHaveLength(1);
    expect(on.runs).toHaveLength(1);
    expect(lazy.runs).toHaveLength(0);
    expect(off.runs).toHaveLength(0);
    // slot contexts carry the tree, root, ctx and a signal
    expect(a.contexts[0]?.tree).toBe(tree);
    expect(a.contexts[0]?.root).toBe(s.root);
    expect(a.contexts[0]?.ctx).toBe(ctx);
    expect(a.contexts[0]?.signal.aborted).toBe(false);

    await a.resolve(1);
    await on.resolve(2);
    const done = await started;
    expect(done).toBe(loader.getSnapshot());
    expect(done.slots['a']?.status).toBe('ready');
    expect(done.slots['on']?.status).toBe('ready');
    expect(done.data).toEqual({ msa: { alphabet: 'protein', length: 1, sequences: {} }, hostData: { a: 1, on: 2 } });
  });

  it('pivot is null without a nodeOfInterest', async () => {
    const { loader, resolveRoot } = setup([]);
    const p = loader.start(ctx);
    await resolveRoot();
    expect((await p).pivot).toBeNull();
  });

  it('a failing root load resolves (never rejects) with status error and a null tree', async () => {
    const a = stubSlot<number>('a');
    const { loader, rejectRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await rejectRoot(new Error('boom'));
    const s = await p;
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
    expect(s.tree).toBeNull();
    expect(s.slots['a']?.status).toBe('idle');
    expect(a.runs).toHaveLength(0);
  });

  it('(a) hands sources a retry-wrapped fetch built on options.fetch', async () => {
    const calls: string[] = [];
    let attempt = 0;
    const fake: FetchLike = async (url) => {
      calls.push(url);
      attempt++;
      return attempt === 1
        ? new Response('busy', { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const a = stubSlot<number>('a');
    const { loader, rootContexts, resolveRoot } = setup([a.slot], {
      fetch: fake,
      retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    });
    loader.start(ctx);
    const rc = rootContexts[0]!;
    const res = await rc.fetch('https://example.test/root');
    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://example.test/root', 'https://example.test/root']);
    await resolveRoot();
    expect(a.contexts[0]?.fetch).toBe(rc.fetch);
  });
});

// ---------------------------------------------------------------------------
// Slot outcomes: (b) throw, (c) itemErrors / failWhen, patchMeta, ordering
// ---------------------------------------------------------------------------

describe('slot settlement', () => {
  it('(b) a throwing run marks only that slot as error; other slots and data are untouched', async () => {
    const a = stubSlot<number>('a');
    const b = stubSlot<number>('b');
    const { loader, resolveRoot } = setup([a.slot, b.slot], { zoneSlots: { za: ['a'], zb: ['b'] } });
    const p = loader.start(ctx);
    await resolveRoot({ data: { geneMetadata: { g1: { x: 1 } } } });
    await b.resolve(2);
    const before = loader.getSnapshot();
    await a.reject(new Error('fan-out exploded'));
    const s = await p;
    expect(s.slots['a']).toEqual({ status: 'error', value: undefined, error: 'fan-out exploded', progress: null, itemErrors: null });
    expect(s.slots['b']).toBe(before.slots['b']);
    expect(s.data).toBe(before.data);
    expect(s.data).toEqual({ geneMetadata: { g1: { x: 1 } }, hostData: { b: 2 } });
    expect(s.zoneStatus).toEqual({ za: 'error', zb: 'ready' });
    expect(s.status).toBe('ready');
  });

  it('a non-Error throw is stringified', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.reject('plain string');
    expect((await p).slots['a']?.error).toBe('plain string');
  });

  it('(c) non-empty itemErrorsOf keeps the slot ready with itemErrors; empty maps become null', async () => {
    type V = { results: Record<string, number>; errors: Record<string, string> };
    const a = stubSlot<V>('a', {
      itemErrorsOf: (v) => v.errors,
      toHostData: (v) => ({ geneMetadata: Object.fromEntries(Object.entries(v.results).map(([k, n]) => [k, { n }])) }),
    });
    const b = stubSlot<V>('b', { itemErrorsOf: (v) => v.errors });
    const { loader, resolveRoot } = setup([a.slot, b.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.resolve({ results: { g1: 1 }, errors: { g2: 'HTTP 500' } });
    await b.resolve({ results: {}, errors: {} });
    const s = await p;
    expect(s.slots['a']?.status).toBe('ready');
    expect(s.slots['a']?.itemErrors).toEqual({ g2: 'HTTP 500' });
    expect(s.slots['b']?.status).toBe('ready');
    expect(s.slots['b']?.itemErrors).toBeNull();
    expect(s.data.geneMetadata).toEqual({ g1: { n: 1 } });
  });

  it('(c) failWhen turns a resolved value into a slot error, keeping value and itemErrors, and nothing is merged', async () => {
    type V = { results: Record<string, number>; errors: Record<string, string> };
    const failWhen = vi.fn((v: V, ie: Record<string, string> | null) =>
      Object.keys(v.results).length === 0 ? `All ${Object.keys(ie ?? {}).length} requests failed` : null,
    );
    const toHostData = vi.fn((): HostDataPatch => ({ hostData: { a: true } }));
    const a = stubSlot<V>('a', { itemErrorsOf: (v) => v.errors, failWhen, toHostData });
    const { loader, resolveRoot } = setup([a.slot], { zoneSlots: { z: ['a'] } });
    const p = loader.start(ctx);
    await resolveRoot();
    const value: V = { results: {}, errors: { g1: 'x', g2: 'y' } };
    await a.resolve(value);
    const s = await p;
    expect(failWhen).toHaveBeenCalledWith(value, { g1: 'x', g2: 'y' });
    expect(s.slots['a']).toEqual({ status: 'error', value, error: 'All 2 requests failed', progress: null, itemErrors: { g1: 'x', g2: 'y' } });
    expect(toHostData).not.toHaveBeenCalled();
    expect(s.data).toEqual({});
    expect(s.zoneStatus).toEqual({ z: 'error' });
  });

  it('failWhen returning null keeps the slot ready', async () => {
    const a = stubSlot<number>('a', { failWhen: () => null });
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.resolve(7);
    expect((await p).slots['a']?.status).toBe('ready');
  });

  it('merges toHostData in slot DECLARATION order regardless of completion order', async () => {
    const a = stubSlot<string>('a', { toHostData: (v) => ({ hostData: { shared: v, a: v }, geneStructureErrors: { g1: v } }) });
    const b = stubSlot<string>('b', { toHostData: (v) => ({ hostData: { shared: v, b: v }, geneStructureErrors: { g1: v } }) });
    const { loader, resolveRoot } = setup([a.slot, b.slot]);
    const p = loader.start(ctx);
    await resolveRoot({ data: { hostData: { shared: 'root', root: true } } });
    await b.resolve('B'); // b settles first …
    expect(loader.getSnapshot().data).toEqual({ hostData: { shared: 'B', root: true, b: 'B' }, geneStructureErrors: { g1: 'B' } });
    await a.resolve('A'); // … but a is declared first, so b still wins
    const s = await p;
    expect(s.data).toEqual({ hostData: { shared: 'B', root: true, a: 'A', b: 'B' }, geneStructureErrors: { g1: 'B' } });
  });

  it('toHostData of a slot is called once per settlement, not on every recompute', async () => {
    const toHostData = vi.fn((v: number): HostDataPatch => ({ hostData: { a: v } }));
    const a = stubSlot<number>('a', { toHostData });
    const b = stubSlot<number>('b');
    const c = stubSlot<number>('c');
    const { loader, resolveRoot } = setup([a.slot, b.slot, c.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.resolve(1);
    await b.resolve(2);
    await c.resolve(3);
    await p;
    expect(toHostData).toHaveBeenCalledTimes(1);
  });

  it('patchMeta returning a new object replaces snapshot.root (new reference) and leaves data untouched', async () => {
    const a = stubSlot<string>('a', {
      patchMeta: (v, meta) => ({ ...meta, tag: v }),
      toHostData: () => ({}),
    });
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot({ data: { exonJunctions: { g1: [3] } } });
    const before = loader.getSnapshot();
    await a.resolve('patched');
    const s = await p;
    expect(s.root).not.toBe(before.root);
    expect(s.root?.meta).toEqual({ tag: 'patched' });
    expect(s.root?.tree).toBe(tree);
    expect(before.root?.meta).toEqual({ tag: 'm0' });
    expect(s.data).toBe(before.data);
    expect(s.tree).toBe(before.tree);
  });

  it('patchMeta returning the same meta keeps snapshot.root', async () => {
    const a = stubSlot<string>('a', { patchMeta: (_v, meta) => meta, toHostData: () => ({}) });
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    const before = loader.getSnapshot();
    await a.resolve('same');
    expect((await p).root).toBe(before.root);
  });

  it('a later slot sees the root patched by an earlier one through toHostData', async () => {
    const a = stubSlot<string>('a', { patchMeta: (v, meta) => ({ ...meta, tag: v }), toHostData: () => ({}) });
    const b = stubSlot<string>('b', { toHostData: (_v, root) => ({ hostData: { tag: root.meta.tag } }) });
    const { loader, resolveRoot } = setup([a.slot, b.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.resolve('patched');
    await b.resolve('x');
    expect((await p).data).toEqual({ hostData: { tag: 'patched' } });
  });

  it('forwards onProgress into the slot state while loading, de-duplicating equal progress', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot, listener } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    const n = listener.mock.calls.length;
    const prog: FanOutProgress = { done: 1, total: 3, failed: 0 };
    a.contexts[0]!.onProgress(prog);
    const s1 = loader.getSnapshot();
    expect(s1.slots['a']?.progress).toEqual(prog);
    expect(s1.slots['a']?.progress).not.toBe(prog);
    expect(listener).toHaveBeenCalledTimes(n + 1);
    a.contexts[0]!.onProgress({ done: 1, total: 3, failed: 0 });
    expect(loader.getSnapshot()).toBe(s1);
    expect(listener).toHaveBeenCalledTimes(n + 1);
    a.contexts[0]!.onProgress({ done: 2, total: 3, failed: 1 });
    expect(loader.getSnapshot().slots['a']?.progress).toEqual({ done: 2, total: 3, failed: 1 });
    await a.resolve(1);
    const s = await p;
    expect(s.slots['a']?.progress).toBeNull();
    // progress after settlement is ignored
    a.contexts[0]!.onProgress({ done: 3, total: 3, failed: 1 });
    expect(loader.getSnapshot()).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// (d) mergeHostData
// ---------------------------------------------------------------------------

describe('mergeHostData', () => {
  it('top-level later-wins, hostData merged one level deep, undefined ignored, inputs untouched', () => {
    const base: HostDataPatch = {
      exonJunctions: { g1: [1] },
      hostData: { a: 1, shared: 'base', nested: { deep: 1 } },
    };
    const patch = {
      exonJunctions: { g2: [2] },
      hostData: { b: 2, shared: 'patch', nested: { deep: 2 } },
      geneMetadata: undefined,
    } as unknown as HostDataPatch;
    const out = mergeHostData(base, patch);
    expect(out).toEqual({
      exonJunctions: { g2: [2] },
      hostData: { a: 1, b: 2, shared: 'patch', nested: { deep: 2 } },
    });
    expect('geneMetadata' in out).toBe(false);
    expect(out).not.toBe(base);
    expect(base.hostData).toEqual({ a: 1, shared: 'base', nested: { deep: 1 } });
    expect(mergeHostData({}, { hostData: { x: 1 } })).toEqual({ hostData: { x: 1 } });
    expect(mergeHostData({ hostData: { x: 1 } }, {})).toEqual({ hostData: { x: 1 } });
  });

  it('warns on overwrite only when asked', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mergeHostData({ exonJunctions: {}, hostData: { k: 1 } }, { exonJunctions: {}, hostData: { k: 2, j: 3 } });
    expect(warn).not.toHaveBeenCalled();
    mergeHostData(
      { exonJunctions: {}, hostData: { k: 1 } },
      { exonJunctions: {}, hostData: { k: 2, j: 3 }, geneMetadata: {} },
      { warnOnOverwrite: true },
    );
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'tbrowse-core: host data "exonJunctions" overwritten by a later patch',
      'tbrowse-core: host data "hostData.k" overwritten by a later patch',
    ]);
  });

  it('the loader warns when a slot overwrites root data or an earlier slot with warnOnOverwrite', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = stubSlot<number>('a', { toHostData: () => ({ exonJunctions: { g1: [1] }, hostData: { a: 1 } }) });
    const b = stubSlot<number>('b', { toHostData: () => ({ exonJunctions: { g1: [2] } }) });
    const { loader, resolveRoot } = setup([a.slot, b.slot], { warnOnOverwrite: true });
    const p = loader.start(ctx);
    await resolveRoot({ data: { hostData: { a: 0 } } });
    await a.resolve(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith('tbrowse-core: host data "hostData.a" overwritten by a later patch');
    await b.resolve(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith('tbrowse-core: host data "exonJunctions" overwritten by a later patch');
    await p;
  });

  it('the loader is silent by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = stubSlot<number>('a', { toHostData: () => ({ hostData: { a: 1 } }) });
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot({ data: { hostData: { a: 0 } } });
    await a.resolve(1);
    await p;
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e) generations, abort, dispose
// ---------------------------------------------------------------------------

describe('generations and abort', () => {
  it('(e) a second start() aborts the first generation and drops its late root', async () => {
    const a = stubSlot<number>('a');
    const { loader, roots, rootContexts, resolveRoot } = setup([a.slot]);
    const p1 = loader.start({ geneId: 'first' });
    const p2 = loader.start({ geneId: 'second' });
    expect(roots).toHaveLength(2);
    expect(rootContexts[0]?.signal.aborted).toBe(true);
    expect(rootContexts[1]?.signal.aborted).toBe(false);
    expect(loader.getSnapshot().generation).toBe(2);

    // first generation's root arrives late: discarded, no slot run
    await resolveRoot({ tree: otherTree }, 0);
    expect(loader.getSnapshot().status).toBe('loading');
    expect(loader.getSnapshot().tree).toBeNull();
    expect(a.runs).toHaveLength(0);
    const s1 = await p1;
    expect(s1.generation).toBe(2);

    await resolveRoot({}, 1);
    expect(loader.getSnapshot().tree).toBe(tree);
    expect(a.runs).toHaveLength(1);
    expect(a.contexts[0]?.ctx).toEqual({ geneId: 'second' });
    await a.resolve(1);
    const s2 = await p2;
    expect(s2.status).toBe('ready');
    expect(s2.generation).toBe(2);
  });

  it('(e) a slot result from a stale generation is discarded', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot } = setup([a.slot]);
    const p1 = loader.start(ctx);
    await resolveRoot();
    expect(a.runs).toHaveLength(1);
    expect(a.contexts[0]?.signal.aborted).toBe(false);
    loader.start(ctx);
    expect(a.contexts[0]?.signal.aborted).toBe(true);
    await resolveRoot();
    expect(a.runs).toHaveLength(2);
    await a.resolve(111, 0); // stale
    expect(loader.getSnapshot().slots['a']?.status).toBe('loading');
    expect(loader.getSnapshot().data).toEqual({});
    await a.reject(new Error('stale error'), 0); // (already settled; no-op)
    await a.resolve(222, 1);
    expect(loader.getSnapshot().slots['a']?.value).toBe(222);
    await p1;
  });

  it('abort() during the root load → status error "aborted", late root discarded', async () => {
    const a = stubSlot<number>('a');
    const { loader, rootContexts, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    loader.abort();
    expect(rootContexts[0]?.signal.aborted).toBe(true);
    const s = loader.getSnapshot();
    expect(s.status).toBe('error');
    expect(s.error).toBe('aborted');
    await resolveRoot();
    expect(loader.getSnapshot()).toBe(s);
    expect(a.runs).toHaveLength(0);
    await p;
  });

  it('abort() marks in-flight slots as error "aborted" and drops their late results; load() still works after', async () => {
    const a = stubSlot<number>('a');
    const b = stubSlot<number>('b');
    const { loader, resolveRoot } = setup([a.slot, b.slot], { zoneSlots: { z: ['a', 'b'] } });
    const p = loader.start(ctx);
    await resolveRoot();
    await b.resolve(2);
    loader.abort();
    const s = loader.getSnapshot();
    expect(s.status).toBe('ready');
    expect(s.tree).toBe(tree);
    expect(s.slots['a']).toEqual({ status: 'error', value: undefined, error: 'aborted', progress: null, itemErrors: null });
    expect(s.slots['b']?.status).toBe('ready');
    expect(s.zoneStatus).toEqual({ z: 'error' });
    expect(a.contexts[0]?.signal.aborted).toBe(true);
    await a.resolve(1, 0);
    expect(loader.getSnapshot()).toBe(s);
    await p;
    // retry with a fresh signal
    const reload = loader.load('a');
    expect(a.runs).toHaveLength(2);
    expect(a.contexts[1]?.signal.aborted).toBe(false);
    await a.resolve(10, 1);
    await reload;
    expect(loader.getSnapshot().slots['a']?.value).toBe(10);
    expect(loader.getSnapshot().zoneStatus).toEqual({ z: 'ready' });
  });

  it('start() and load() settle on abort() even when the source ignores its signal', async () => {
    const a = stubSlot<number>('a');
    const lazy = stubSlot<number>('lazy', { mode: 'lazy' });
    const { loader, resolveRoot } = setup([a.slot, lazy.slot]);
    // root never resolves
    const p1 = loader.start(ctx);
    loader.abort();
    const s1 = await p1;
    expect(s1.status).toBe('error');
    expect(s1.error).toBe('aborted');
    // eager + lazy slot runs never resolve
    const p2 = loader.start(ctx);
    await resolveRoot({}, 1);
    const l = loader.load('lazy');
    loader.abort();
    const s2 = await p2;
    await expect(l).resolves.toBeUndefined();
    expect(s2.status).toBe('ready');
    expect(s2.slots['a']?.error).toBe('aborted');
    expect(s2.slots['lazy']?.error).toBe('aborted');
    // a source that already observed abort sees a rejected run too
    expect(a.contexts[0]?.signal.aborted).toBe(true);
  });

  it('abort() when nothing is in flight changes nothing', async () => {
    const { loader, resolveRoot } = setup([]);
    const p = loader.start(ctx);
    await resolveRoot();
    const s = await p;
    loader.abort();
    expect(loader.getSnapshot()).toBe(s);
  });

  it('dispose() aborts and drops listeners', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot, listener } = setup([a.slot]);
    loader.start(ctx);
    await resolveRoot();
    const n = listener.mock.calls.length;
    loader.dispose();
    expect(loader.getSnapshot().slots['a']?.error).toBe('aborted');
    expect(listener).toHaveBeenCalledTimes(n); // listeners are dropped before the abort transition
    const p = loader.start(ctx);
    await resolveRoot();
    expect(listener).toHaveBeenCalledTimes(n);
    expect(loader.getSnapshot().status).toBe('ready');
    loader.abort();
    await p;
  });

  it('subscribe returns an unsubscribe', async () => {
    const { loader, resolveRoot } = setup([]);
    const fn = vi.fn();
    const off = loader.subscribe(fn);
    const p = loader.start(ctx);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    await resolveRoot();
    await p;
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe('load()', () => {
  it('runs a lazy slot and resolves when it settles', async () => {
    const lazy = stubSlot<number>('lazy', { mode: 'lazy' });
    const { loader, resolveRoot } = setup([lazy.slot], { zoneSlots: { z: ['lazy'] } });
    const p = loader.start(ctx);
    await resolveRoot();
    await p;
    expect(loader.getSnapshot().zoneStatus).toEqual({});
    let settled = false;
    const l = loader.load('lazy').then(() => {
      settled = true;
    });
    expect(loader.getSnapshot().slots['lazy']?.status).toBe('loading');
    expect(loader.getSnapshot().zoneStatus).toEqual({ z: 'loading' });
    await flush();
    expect(settled).toBe(false);
    await lazy.resolve(5);
    await l;
    expect(settled).toBe(true);
    expect(loader.getSnapshot().slots['lazy']?.value).toBe(5);
    expect(loader.getSnapshot().data).toEqual({ hostData: { lazy: 5 } });
    expect(loader.getSnapshot().zoneStatus).toEqual({ z: 'ready' });
  });

  it('retries an errored slot and resolves even when the retry fails too', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.reject(new Error('first'));
    await p;
    const l = loader.load('a');
    expect(loader.getSnapshot().slots['a']).toEqual({ status: 'loading', value: undefined, error: null, progress: null, itemErrors: null });
    await a.reject(new Error('second'), 1);
    await expect(l).resolves.toBeUndefined();
    expect(loader.getSnapshot().slots['a']?.error).toBe('second');
    const l2 = loader.load('a');
    await a.resolve(3, 2);
    await l2;
    expect(loader.getSnapshot().slots['a']?.status).toBe('ready');
    expect(loader.getSnapshot().data).toEqual({ hostData: { a: 3 } });
  });

  it('is a no-op while that slot is loading', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await expect(loader.load('a')).resolves.toBeUndefined();
    expect(a.runs).toHaveLength(1);
    await a.resolve(1);
    await p;
  });

  it('rejects for unknown slot ids and before the root has loaded', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot } = setup([a.slot]);
    await expect(loader.load('nope')).rejects.toThrow('unknown slot "nope"');
    await expect(loader.load('a')).rejects.toThrow('before the root loaded');
    const p = loader.start(ctx);
    await expect(loader.load('a')).rejects.toThrow('before the root loaded');
    await resolveRoot();
    await a.resolve(1);
    await p;
    await expect(loader.load('nope')).rejects.toBeInstanceOf(Error);
  });

  it('re-running a ready slot drops its previous patch until the new value lands', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot } = setup([a.slot]);
    const p = loader.start(ctx);
    await resolveRoot();
    await a.resolve(1);
    await p;
    const l = loader.load('a');
    expect(loader.getSnapshot().data).toEqual({});
    await a.resolve(2, 1);
    await l;
    expect(loader.getSnapshot().data).toEqual({ hostData: { a: 2 } });
  });
});

// ---------------------------------------------------------------------------
// (f) referential stability
// ---------------------------------------------------------------------------

describe('(f) snapshot stability', () => {
  it('getSnapshot() returns the same reference until something changes, and a new one per change', async () => {
    const a = stubSlot<number>('a');
    const { loader, resolveRoot, seen, listener } = setup([a.slot]);
    const s0 = loader.getSnapshot();
    expect(loader.getSnapshot()).toBe(s0);

    const p = loader.start(ctx);
    const s1 = loader.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(loader.getSnapshot()).toBe(s1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBe(s1);

    await resolveRoot();
    // root ready (1 notify) + slot a loading (1 notify)
    expect(listener).toHaveBeenCalledTimes(3);
    const s2 = loader.getSnapshot();
    expect(seen[2]).toBe(s2);
    expect(loader.getSnapshot()).toBe(s2);

    await a.resolve(1);
    const s3 = await p;
    expect(listener).toHaveBeenCalledTimes(4);
    expect(s3).not.toBe(s2);
    expect(loader.getSnapshot()).toBe(s3);
    // unchanged fields keep their references
    expect(s3.tree).toBe(s2.tree);
    expect(s3.root).toBe(s2.root);
    expect(s3.pivot).toBe(s2.pivot);
    expect(s3.zoneStatus).toBe(s2.zoneStatus);
    expect(s3.slots).not.toBe(s2.slots);
    expect(s3.data).not.toBe(s2.data);
    // every notification carried a distinct snapshot
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps data and zoneStatus references when a transition leaves their contents unchanged', async () => {
    const a = stubSlot<number>('a', { toHostData: () => ({}) });
    const b = stubSlot<number>('b', { toHostData: () => ({}) });
    const { loader, resolveRoot } = setup([a.slot, b.slot], { zoneSlots: { z: ['a', 'b'] } });
    const p = loader.start(ctx);
    await resolveRoot();
    const s1 = loader.getSnapshot();
    expect(s1.zoneStatus).toEqual({ z: 'loading' });
    await a.resolve(1);
    const s2 = loader.getSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.data).toBe(s1.data);
    expect(s2.zoneStatus).toBe(s1.zoneStatus); // b still loading
    await b.resolve(2);
    const s3 = await p;
    expect(s3.data).toBe(s1.data);
    expect(s3.zoneStatus).not.toBe(s1.zoneStatus);
    expect(s3.zoneStatus).toEqual({ z: 'ready' });
  });
});

// ---------------------------------------------------------------------------
// (g) zoneStatus
// ---------------------------------------------------------------------------

describe('zoneStatusOf', () => {
  const st = (status: SlotState['status']): SlotState => ({ status, value: undefined, error: null, progress: null, itemErrors: null });

  it('precedence: loading > error > ready; idle-only and unmapped zones absent', () => {
    const slots = { l: st('loading'), e: st('error'), r: st('ready'), i: st('idle') };
    const out = zoneStatusOf(slots, {
      loadingWins: ['r', 'e', 'l'],
      errorWins: ['r', 'e', 'i'],
      ready: ['r', 'i'],
      allIdle: ['i'],
      empty: [],
      unknownSlot: ['missing'],
      mixedUnknown: ['missing', 'r'],
    });
    expect(out).toEqual({ loadingWins: 'loading', errorWins: 'error', ready: 'ready', mixedUnknown: 'ready' });
    expect('allIdle' in out).toBe(false);
    expect('empty' in out).toBe(false);
    expect('unknownSlot' in out).toBe(false);
    expect('unmapped' in out).toBe(false);
  });

  it('(g) is recomputed from zoneSlots on every slot transition', async () => {
    const a = stubSlot<number>('a');
    const b = stubSlot<number>('b');
    const lazy = stubSlot<number>('lazy', { mode: 'lazy' });
    const { loader, resolveRoot } = setup([a.slot, b.slot, lazy.slot], {
      zoneSlots: { ab: ['a', 'b'], onlyA: ['a'], lazyZone: ['lazy'], aLazy: ['a', 'lazy'] },
    });
    const p = loader.start(ctx);
    expect(loader.getSnapshot().zoneStatus).toEqual({});
    await resolveRoot();
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'loading', onlyA: 'loading', aLazy: 'loading' });
    await a.reject(new Error('x'));
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'loading', onlyA: 'error', aLazy: 'error' });
    await b.resolve(1);
    await p;
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'error', onlyA: 'error', aLazy: 'error' });
    const l = loader.load('a');
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'loading', onlyA: 'loading', aLazy: 'loading' });
    await a.resolve(2, 1);
    await l;
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'ready', onlyA: 'ready', aLazy: 'ready' });
    const l2 = loader.load('lazy');
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'ready', onlyA: 'ready', lazyZone: 'loading', aLazy: 'loading' });
    await lazy.resolve(3);
    await l2;
    expect(loader.getSnapshot().zoneStatus).toEqual({ ab: 'ready', onlyA: 'ready', lazyZone: 'ready', aLazy: 'ready' });
  });
});

// ---------------------------------------------------------------------------
// hostPropsFrom
// ---------------------------------------------------------------------------

describe('hostPropsFrom', () => {
  it('is null until the tree is set', () => {
    const { loader } = setup([]);
    expect(hostPropsFrom(loader.getSnapshot())).toBeNull();
    loader.start(ctx);
    expect(hostPropsFrom(loader.getSnapshot())).toBeNull();
  });

  it('spreads tree, taxonomy, nodeOfInterest, zoneStatus and the merged data (defined keys only)', async () => {
    const a = stubSlot<number>('a', {
      toHostData: () => ({ exonJunctions: { g1: [1] }, geneMetadata: undefined }) as unknown as HostDataPatch,
    });
    const { loader, resolveRoot } = setup([a.slot], { zoneSlots: { z: ['a'] } });
    const p = loader.start(ctx);
    await resolveRoot({ taxonomy: { 9606: { scientificName: 'Homo sapiens' } }, nodeOfInterest: 'g2' });
    await a.resolve(1);
    const s = await p;
    const props = hostPropsFrom(s);
    expect(props).toEqual({
      tree,
      taxonomy: { 9606: { scientificName: 'Homo sapiens' } },
      nodeOfInterest: 'g2',
      zoneStatus: { z: 'ready' },
      exonJunctions: { g1: [1] },
    });
    expect(props && 'geneMetadata' in props).toBe(false);
    expect(props?.zoneStatus).toBe(s.zoneStatus);
  });

  it('omits taxonomy and nodeOfInterest when the root has none', async () => {
    const { loader, resolveRoot } = setup([]);
    const p = loader.start(ctx);
    await resolveRoot();
    const props = hostPropsFrom(await p);
    expect(Object.keys(props ?? {})).toEqual(['tree', 'zoneStatus']);
  });
});

describe('review follow-ups: hook isolation, void ctx, concurrency, overwrite warnings', () => {
  const rootOf = (): RootResult<Record<string, unknown>> => ({ tree, meta: {} });
  const mk = (slots: DataSlot<unknown, unknown, Record<string, unknown>>[]): TreeDataSource<unknown, Record<string, unknown>> => ({
    id: 'stub',
    loadRoot: async () => rootOf(),
    slots,
  });

  it('a throwing toHostData / patchMeta / failWhen / itemErrorsOf is the slot error; start() still resolves', async () => {
    const bad = (hook: 'toHostData' | 'patchMeta' | 'failWhen' | 'itemErrorsOf') => {
      const slot: DataSlot<unknown, unknown, Record<string, unknown>> = {
        id: 'a',
        run: async () => 1,
        toHostData: () => ({ msa: { alphabet: 'protein', length: 0, sequences: {} } }),
      };
      (slot as unknown as Record<string, unknown>)[hook] = () => { throw new Error(`${hook} bug`); };
      return slot;
    };
    for (const hook of ['toHostData', 'patchMeta', 'failWhen', 'itemErrorsOf'] as const) {
      const ok: DataSlot<unknown, unknown, Record<string, unknown>> = { id: 'b', run: async () => 2, toHostData: () => ({ geneMetadata: { g: {} } }) };
      const loader = createLoader(mk([bad(hook), ok]), { zoneSlots: { z: ['a'] } });
      const snap = await loader.start({});
      expect(snap.status).toBe('ready');
      expect(snap.slots.a?.status).toBe('error');
      expect(snap.slots.a?.error).toBe(`${hook} bug`);
      expect(snap.zoneStatus.z).toBe('error');
      expect(snap.slots.b?.status).toBe('ready');
      expect(snap.data).toEqual({ geneMetadata: { g: {} } });
    }
  });

  it('a throwing enabled() is that slot\'s error and the other eager slots still run', async () => {
    const a: DataSlot<unknown, unknown, Record<string, unknown>> = { id: 'a', enabled: () => { throw new Error('enabled bug'); }, run: async () => 1, toHostData: () => ({}) };
    const b: DataSlot<unknown, unknown, Record<string, unknown>> = { id: 'b', run: async () => 2, toHostData: () => ({ geneMetadata: { g: {} } }) };
    const snap = await createLoader(mk([a, b])).start({});
    expect(snap.status).toBe('ready');
    expect(snap.slots.a).toMatchObject({ status: 'error', error: 'enabled bug' });
    expect(snap.slots.b?.status).toBe('ready');
  });

  it('a void / undefined ctx still runs eager slots and load()', async () => {
    let runs = 0;
    const a: DataSlot<unknown, void, Record<string, unknown>> = { id: 'a', run: async () => { runs++; return 1; }, toHostData: () => ({ geneMetadata: { g: {} } }) };
    const lazy: DataSlot<unknown, void, Record<string, unknown>> = { id: 'l', mode: 'lazy', run: async () => { runs++; return 2; }, toHostData: () => ({}) };
    const source: TreeDataSource<void, Record<string, unknown>> = { id: 'void', loadRoot: async () => rootOf(), slots: [a, lazy] };
    const loader = createLoader(source);
    const snap = await loader.start(undefined);
    expect(snap.slots.a?.status).toBe('ready');
    await loader.load('l');
    expect(loader.getSnapshot().slots.l?.status).toBe('ready');
    expect(runs).toBe(2);
  });

  it('LoaderOptions.concurrency reaches the slot context', async () => {
    let seen: number | undefined;
    const a: DataSlot<unknown, unknown, Record<string, unknown>> = { id: 'a', run: async (sc) => { seen = sc.concurrency; return 1; }, toHostData: () => ({}) };
    await createLoader(mk([a]), { concurrency: 2 }).start({});
    expect(seen).toBe(2);
    seen = -1;
    await createLoader(mk([a])).start({});
    expect(seen).toBeUndefined();
  });

  it('warnOnOverwrite reports a collision once whatever order the slots settle in', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let releaseA: (() => void) | null = null;
      const a: DataSlot<unknown, unknown, Record<string, unknown>> = { id: 'a', run: () => new Promise((r) => { releaseA = () => r(1); }), toHostData: () => ({ geneMetadata: { from: { a: 1 } } }) };
      const b: DataSlot<unknown, unknown, Record<string, unknown>> = { id: 'b', run: async () => 2, toHostData: () => ({ geneMetadata: { from: { b: 1 } } }) };
      const loader = createLoader(mk([a, b]), { warnOnOverwrite: true });
      const p = loader.start({});
      await new Promise((r) => setTimeout(r, 0));
      expect(loader.getSnapshot().slots.b?.status).toBe('ready'); // b settled first
      releaseA!();
      await p;
      const msgs = warn.mock.calls.map((c) => String(c[0]));
      expect(msgs.filter((m) => m.includes('"geneMetadata"'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
