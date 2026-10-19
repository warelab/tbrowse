import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineSlot, extendSource, staticSource } from './extend';
import { createLoader } from './loader';
import type { DataSlot, RootContext, RootResult, SlotContext, TreeDataSource } from './types';
import type { Tree } from '../types';

const treeOf = (geneId: string): Tree => ({
  rootId: 'r',
  nodes: { r: { id: 'r', parentId: null, distance: 0, isLeaf: true, geneId } },
});

interface BaseCtx {
  geneId: string;
}
interface WideCtx extends BaseCtx {
  flavour: 'sweet' | 'salty';
}
interface Meta {
  n: number;
}

const noopRc = (): RootContext<BaseCtx> => ({
  ctx: { geneId: 'g' },
  fetch: () => Promise.reject(new Error('no network in tests')),
  signal: new AbortController().signal,
});

const slot = (id: string, n: number): DataSlot<number, BaseCtx, Meta> => ({
  id,
  run: async () => n,
  toHostData: (v) => ({ hostData: { [id]: v } }),
});

const base: TreeDataSource<BaseCtx, Meta> = {
  id: 'base',
  label: 'Base source',
  loadRoot: async ({ ctx }) => ({ tree: treeOf(ctx.geneId), meta: { n: 1 } }),
  slots: [slot('a', 1), slot('b', 2), slot('c', 3)],
};

describe('defineSlot', () => {
  it('returns the slot unchanged and pins its generics', () => {
    const s = defineSlot<number, BaseCtx, Meta>({
      id: 'x',
      run: async (sc) => {
        expectTypeOf(sc).toEqualTypeOf<SlotContext<BaseCtx, Meta>>();
        return sc.root.meta.n;
      },
      toHostData: (v) => {
        expectTypeOf(v).toEqualTypeOf<number>();
        return { hostData: { x: v } };
      },
      failWhen: (v, ie) => {
        expectTypeOf(v).toEqualTypeOf<number>();
        expectTypeOf(ie).toEqualTypeOf<Record<string, string> | null>();
        return null;
      },
      patchMeta: (v, meta) => {
        expectTypeOf(meta).toEqualTypeOf<Meta>();
        return { n: meta.n + v };
      },
    });
    expect(s.id).toBe('x');
    expectTypeOf(s).toEqualTypeOf<DataSlot<number, BaseCtx, Meta>>();
    const same = { id: 'y', run: async () => 'str', toHostData: () => ({}) };
    expect(defineSlot<string, unknown, Record<string, unknown>>(same)).toBe(same);
  });
});

describe('extendSource', () => {
  it('keeps id, label, loadRoot behaviour and slots when the patch is empty', async () => {
    const out = extendSource(base, {});
    expect(out.id).toBe('base');
    expect(out.label).toBe('Base source');
    expect(out.slots).toEqual(base.slots);
    expect(out.slots).not.toBe(base.slots);
    const root = await out.loadRoot(noopRc());
    expect(root.tree.nodes['r']?.geneId).toBe('g');
    expect(root.meta).toEqual({ n: 1 });
  });

  it('omits label when the source has none', () => {
    const out = extendSource({ id: 's', loadRoot: base.loadRoot, slots: [] }, { id: 's2' });
    expect(out.id).toBe('s2');
    expect('label' in out).toBe(false);
  });

  it('replaces a slot with an existing id IN PLACE, appends new ones, and removes `without` ids', () => {
    const b2 = slot('b', 20);
    const d = slot('d', 4);
    const out = extendSource(base, { id: 'derived', slots: [d, b2], without: ['c'] });
    expect(out.id).toBe('derived');
    expect(out.slots.map((s) => s.id)).toEqual(['a', 'b', 'd']);
    expect(out.slots[1]).toBe(b2);
    expect(out.slots[2]).toBe(d);
    expect(out.slots[0]).toBe(base.slots[0]);
    // the original is untouched
    expect(base.slots.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('a slot named in `without` and also given in `slots` is re-added (appended)', () => {
    const c2 = slot('c', 30);
    const out = extendSource(base, { slots: [c2], without: ['c', 'a'] });
    expect(out.slots.map((s) => s.id)).toEqual(['b', 'c']);
    expect(out.slots[1]).toBe(c2);
  });

  it('Ctx2 extends Ctx: added slots may read the wider context, the result is typed on Ctx2', async () => {
    const flavour = defineSlot<string, WideCtx, Meta>({
      id: 'flavour',
      run: async ({ ctx }) => ctx.flavour,
      toHostData: (v) => ({ hostData: { flavour: v } }),
    });
    const out = extendSource<BaseCtx, Meta, WideCtx>(base, { slots: [flavour], without: ['a', 'b', 'c'] });
    expectTypeOf(out).toEqualTypeOf<TreeDataSource<WideCtx, Meta>>();
    expectTypeOf(out.loadRoot).parameter(0).toEqualTypeOf<RootContext<WideCtx>>();
    // Ctx2 is inferred from the given slots too.
    const inferred = extendSource(base, { slots: [flavour] });
    expectTypeOf(inferred).toEqualTypeOf<TreeDataSource<WideCtx, Meta>>();
    // A slot needing an unrelated ctx is rejected.
    const other = defineSlot<string, { unrelated: boolean }, Meta>({ id: 'o', run: async () => '', toHostData: () => ({}) });
    // @ts-expect-error { unrelated } does not extend BaseCtx
    extendSource<BaseCtx, Meta, { unrelated: boolean }>(base, { slots: [other] });

    // and it runs end to end through the loader with a WideCtx
    const loader = createLoader(out);
    const s = await loader.start({ geneId: 'g9', flavour: 'salty' });
    expect(s.tree?.nodes['r']?.geneId).toBe('g9');
    expect(s.data).toEqual({ hostData: { flavour: 'salty' } });
  });
});

describe('staticSource', () => {
  it('awaits rootOf(ctx) for sync and async functions; two ctx values yield two roots', async () => {
    const sync = staticSource<{ size: 'small' | 'large' }, Meta>((ctx) => ({
      tree: treeOf(ctx.size),
      meta: { n: ctx.size === 'small' ? 1 : 2 },
    }));
    expect(sync.id).toBe('static');
    expect(sync.slots).toEqual([]);
    const rc = (size: 'small' | 'large'): RootContext<{ size: 'small' | 'large' }> => ({ ...noopRc(), ctx: { size } });
    const small = await sync.loadRoot(rc('small'));
    const large = await sync.loadRoot(rc('large'));
    expect(small.tree.nodes['r']?.geneId).toBe('small');
    expect(small.meta).toEqual({ n: 1 });
    expect(large.tree.nodes['r']?.geneId).toBe('large');
    expect(large.meta).toEqual({ n: 2 });
    expect(small.tree).not.toBe(large.tree);

    const asyncSrc = staticSource<BaseCtx, Meta>(async (ctx) => ({ tree: treeOf(ctx.geneId), meta: { n: 3 } }), [slot('a', 1)]);
    expect(asyncSrc.slots.map((s) => s.id)).toEqual(['a']);
    const r = await asyncSrc.loadRoot(noopRc());
    expect(r.tree.nodes['r']?.geneId).toBe('g');
    expectTypeOf(asyncSrc).toEqualTypeOf<TreeDataSource<BaseCtx, Meta>>();
  });

  it('a rejecting rootOf surfaces through loadRoot (and as a loader error)', async () => {
    const src = staticSource<BaseCtx, Meta>(() => Promise.reject(new Error('nope')));
    await expect(src.loadRoot(noopRc())).rejects.toThrow('nope');
    const s = await createLoader(src).start({ geneId: 'g' });
    expect(s.status).toBe('error');
    expect(s.error).toBe('nope');
  });

  it('drives the loader with the playground "toggle tree size" shape', async () => {
    const src = staticSource<{ size: 'small' | 'large' }, Record<string, unknown>>((ctx) => ({
      tree: treeOf(ctx.size),
      nodeOfInterest: ctx.size,
      meta: {},
    }));
    const loader = createLoader(src);
    const s1 = await loader.start({ size: 'small' });
    expect(s1.pivot?.targetId).toBe('r');
    expect(s1.tree?.nodes['r']?.geneId).toBe('small');
    const s2 = await loader.start({ size: 'large' });
    expect(s2.generation).toBe(2);
    expect(s2.tree?.nodes['r']?.geneId).toBe('large');
    const root: RootResult<Record<string, unknown>> | null = s2.root;
    expect(root?.nodeOfInterest).toBe('large');
  });
});
