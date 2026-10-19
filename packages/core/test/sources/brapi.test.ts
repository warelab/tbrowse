import { describe, expect, it } from 'vitest';
import {
  brapiAlleleMatrixSource,
  brapiBaseOf,
  brapiPages,
  brapiVariantsUrlFrom,
  fetchBrapiAlleleMatrix,
  fetchBrapiGermplasm,
  fetchBrapiVariants,
  fetchBrapiVariantSetTree,
  type BrapiCtx,
  type BrapiMeta,
} from '../../src/sources/brapi';
import { createLoader } from '../../src/sources/loader';
import type { RootContext, SlotContext } from '../../src/sources/types';
import { leafOrder } from '../../src/tree/walk';
import { toNewick } from '../../src/tree/newick';
import type { FetchLike } from '../../src/fetch/retry';

// ---------------------------------------------------------------------------
// URL-keyed fake fetch: every test asserts the EXACT URLs requested.
// ---------------------------------------------------------------------------

const jsonResponse = (json: unknown, status = 200): Response =>
  new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(routes: Record<string, unknown | ((url: string) => Response)>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (url: string): Promise<Response> => {
    calls.push(url);
    if (!(url in routes)) return new Response('not found', { status: 404 });
    const r = routes[url];
    return typeof r === 'function' ? (r as (u: string) => Response)(url) : jsonResponse(r);
  }) as FetchLike & { calls: string[] };
  fetch.calls = calls;
  return fetch;
}

const MATRIX_URL = '/brapi/v2/allelematrix-search?variantSetDbId=a&minAF=0.05&tree=upgma';
const VARIANTS_URL = '/brapi/v2/variants?variantSetDbId=a&minAF=0.05';

const matrixBody = (withTree: boolean) => ({
  result: {
    callSetDbIds: ['1001', '7', '42'],
    variantDbIds: ['1:100', '1:200'],
    variantSetDbIds: ['a'],
    dataMatrices: [
      {
        dataMatrixName: 'Genotype',
        dataMatrix: [
          ['0/0', '0/1', '1/1'],
          ['0/0', '0/0', '1/1'],
        ],
      },
    ],
    ...(withTree
      ? {
          tree: {
            method: 'upgma',
            metric: 'dosage_l1_mean',
            newick: '((1001:0.125,7:0.125):0.25,42:0.375);',
            leafOrder: ['42', '7', '1001'],
            maxBranchHeight: 0.375,
          },
        }
      : {}),
  },
});

const variantsBody = {
  result: {
    data: [
      { sample: '1001', pos: 100, ref: 'A', alleles: ['A', 'T'], GT: [0, 0] },
      { sample: '7', pos: 100, ref: 'A', alleles: ['A', 'T'], GT: [0, 1] },
      { sample: '1001', pos: 200, ref: 'C', alleles: ['C', 'G'], GT: [0, 0] },
    ],
  },
};

const germplasmPage = (page: number) => ({
  metadata: { pagination: { currentPage: page, totalPages: 2, totalCount: 4, pageSize: 1000 } },
  result: {
    data:
      page === 0
        ? [
            { germplasmDbId: '1001', germplasmName: 'Alpha', species: 'S. bicolor' },
            { germplasmDbId: '9999', germplasmName: 'NotInTree' },
          ]
        : [
            { germplasmDbId: '42', germplasmName: 'Beta' },
            { germplasmDbId: '7', species: 'S. propinquum' },
          ],
  },
});

const GERMPLASM_P0 = '/brapi/v2/germplasm?pageSize=1000&page=0';
const GERMPLASM_P1 = '/brapi/v2/germplasm?pageSize=1000&page=1';

const fullRoutes = (withTree: boolean) => ({
  [MATRIX_URL]: matrixBody(withTree),
  [VARIANTS_URL]: variantsBody,
  [GERMPLASM_P0]: germplasmPage(0),
  [GERMPLASM_P1]: germplasmPage(1),
});

const controller = (): AbortController => new AbortController();

// ---------------------------------------------------------------------------
// Pure URL helpers
// ---------------------------------------------------------------------------

describe('brapiBaseOf / brapiVariantsUrlFrom', () => {
  it('derives the base up to /brapi/vN from relative and absolute URLs', () => {
    expect(brapiBaseOf(MATRIX_URL)).toBe('/brapi/v2');
    expect(brapiBaseOf('https://host.example/x/brapi/v2/allelematrix-search?a=1')).toBe('https://host.example/x/brapi/v2');
    expect(brapiBaseOf('https://host.example/brapi/v2')).toBe('https://host.example/brapi/v2');
    expect(brapiBaseOf('https://host.example/brapi/v2/')).toBe('https://host.example/brapi/v2');
    // No /brapi/vN segment: drop the last path segment (the playground's rule).
    expect(brapiBaseOf('/api/allelematrix-search?x=1')).toBe('/api');
    expect(brapiBaseOf('allelematrix-search')).toBe('');
  });

  it('turns the matrix URL into the /variants URL keeping every param except tree', () => {
    expect(brapiVariantsUrlFrom(MATRIX_URL)).toBe(VARIANTS_URL);
    expect(brapiVariantsUrlFrom('/brapi/v2/allelematrix-search?tree=upgma&maxAF=0.9&variantSetDbId=a&tree=nj')).toBe(
      '/brapi/v2/variants?maxAF=0.9&variantSetDbId=a',
    );
    expect(brapiVariantsUrlFrom('https://h/brapi/v2/allelematrix-search/?samples=x,y&start=1&end=2')).toBe(
      'https://h/brapi/v2/variants?samples=x%2Cy&start=1&end=2',
    );
    expect(brapiVariantsUrlFrom('/brapi/v2/allelematrix-search')).toBe('/brapi/v2/variants');
    // No allelematrix-search tail: append /variants to the base.
    expect(brapiVariantsUrlFrom('/brapi/v2/allelematrix?variantSetDbId=a&tree=upgma')).toBe(
      '/brapi/v2/variants?variantSetDbId=a',
    );
  });
});

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

describe('brapiPages / fetchBrapiGermplasm', () => {
  it('pages until currentPage >= totalPages - 1 and keeps only the requested ids', async () => {
    const fetch = fakeFetch({ [GERMPLASM_P0]: germplasmPage(0), [GERMPLASM_P1]: germplasmPage(1) });
    const out = await fetchBrapiGermplasm('/brapi/v2', ['1001', '7', '42', 'Beta'], { fetch });
    expect(fetch.calls).toEqual([GERMPLASM_P0, GERMPLASM_P1]);
    expect(Object.keys(out).sort()).toEqual(['1001', '42', '7', 'Beta']);
    expect(out['1001']).toEqual({ germplasmDbId: '1001', germplasmName: 'Alpha', species: 'S. bicolor' });
    expect(out['42']).toBe(out['Beta']);
    expect(out['9999']).toBeUndefined();
    expect(out['NotInTree']).toBeUndefined();
  });

  it('honours pageSize / maxPages and treats a response without pagination as the only page', async () => {
    const fetch = fakeFetch({
      '/b/germplasm?pageSize=2&page=0': {
        metadata: { pagination: { currentPage: 0, totalPages: 3, totalCount: 6 } },
        result: { data: [{ germplasmDbId: 'x' }] },
      },
      '/b/germplasm?pageSize=2&page=1': {
        metadata: { pagination: { currentPage: 1, totalPages: 3, totalCount: 6 } },
        result: { data: [{ germplasmDbId: 'y' }] },
      },
      '/b/germplasm?pageSize=2&page=2': {
        metadata: { pagination: { currentPage: 2, totalPages: 3, totalCount: 6 } },
        result: { data: [{ germplasmDbId: 'z' }] },
      },
      '/c/things?pageSize=1000&page=0': { result: { data: [1, 2, 3] } },
    });
    const pages: number[] = [];
    for await (const p of brapiPages<{ germplasmDbId: string }>('/b/germplasm', { fetch, pageSize: 2, maxPages: 2 })) {
      pages.push(p.currentPage);
      expect(p.totalPages).toBe(3);
      expect(p.totalCount).toBe(6);
    }
    expect(pages).toEqual([0, 1]);
    expect(fetch.calls).toEqual(['/b/germplasm?pageSize=2&page=0', '/b/germplasm?pageSize=2&page=1']);

    const single: Array<{ data: number[]; totalPages: number }> = [];
    for await (const p of brapiPages<number>('/c/things', { fetch })) single.push(p);
    expect(single).toEqual([{ data: [1, 2, 3], currentPage: 0, totalPages: 1, totalCount: 3 }]);
  });

  it('propagates HTTP errors', async () => {
    const fetch = fakeFetch({});
    await expect(fetchBrapiGermplasm('/nowhere', ['a'], { fetch })).rejects.toThrow('HTTP 404');
  });
});

describe('fetchBrapiAlleleMatrix / fetchBrapiVariants', () => {
  it('GET the given URLs and run the adapters', async () => {
    const fetch = fakeFetch(fullRoutes(true));
    const r = await fetchBrapiAlleleMatrix(MATRIX_URL, { fetch, regionLabel: 'chr1 window' });
    expect(r.sampleIds).toEqual(['1001', '7', '42']);
    expect(r.matrix.regionLabel).toBe('chr1 window');
    expect(r.newick).toBe('((1001:0.125,7:0.125):0.25,42:0.375);');
    const sites = await fetchBrapiVariants(VARIANTS_URL, { fetch, reference: '1' });
    expect(sites).toEqual([
      { id: '1:100', reference: '1', position: 100, ref: 'A', alt: ['T'] },
      { id: '1:200', reference: '1', position: 200, ref: 'C', alt: ['G'] },
    ]);
    expect(fetch.calls).toEqual([MATRIX_URL, VARIANTS_URL]);
  });
});

describe('fetchBrapiVariantSetTree', () => {
  it('returns the tree block, null on 404, and throws on other errors', async () => {
    const fetch = fakeFetch({
      '/brapi/v2/variantsets/vs1/tree': {
        newick: '(a,b);',
        leafOrder: ['b', 'a'],
        samples: 2,
        variants: 10,
        method: 'upgma',
        metric: 'dosage_l1_mean',
      },
      '/brapi/v2/variantsets/wrapped/tree': { result: { newick: '(c,d);' } },
      '/brapi/v2/variantsets/broken/tree': () => new Response('boom', { status: 500 }),
    });
    expect(await fetchBrapiVariantSetTree('/brapi/v2', 'vs1', { fetch })).toEqual({
      newick: '(a,b);',
      leafOrder: ['b', 'a'],
      method: 'upgma',
      metric: 'dosage_l1_mean',
    });
    expect(await fetchBrapiVariantSetTree('/brapi/v2', 'wrapped', { fetch })).toEqual({ newick: '(c,d);', leafOrder: [] });
    expect(await fetchBrapiVariantSetTree('/brapi/v2', 'missing', { fetch })).toBeNull();
    await expect(fetchBrapiVariantSetTree('/brapi/v2', 'broken', { fetch })).rejects.toThrow('HTTP 500');
    expect(fetch.calls).toEqual([
      '/brapi/v2/variantsets/vs1/tree',
      '/brapi/v2/variantsets/wrapped/tree',
      '/brapi/v2/variantsets/missing/tree',
      '/brapi/v2/variantsets/broken/tree',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The source: loadRoot + slots driven directly, then through the real loader
// ---------------------------------------------------------------------------

const rootContext = (ctx: BrapiCtx, fetch: FetchLike): RootContext<BrapiCtx> => ({
  ctx,
  fetch,
  signal: controller().signal,
});

describe('brapiAlleleMatrixSource.loadRoot', () => {
  it('uses the server tree when present: synthetic ids, geneId = sample, swaps reproduce leafOrder', async () => {
    const fetch = fakeFetch(fullRoutes(true));
    const root = await brapiAlleleMatrixSource.loadRoot(rootContext({ matrixUrl: MATRIX_URL }, fetch));
    expect(fetch.calls).toEqual([MATRIX_URL]);
    expect(root.data).toEqual({});
    expect(root.meta.sampleIds).toEqual(['1001', '7', '42']);
    expect(root.meta.variantSetDbId).toBe('a');
    expect(root.meta.treeMethod).toBe('upgma');
    expect(root.meta.treeMetric).toBe('dosage_l1_mean');
    expect(root.meta.matrix.callsByGeneId['42']).toEqual(['1/1', '1/1']);
    const { tree } = root;
    expect(Object.keys(tree.nodes).every((id) => /^n\d+$/.test(id))).toBe(true);
    const names = (ids: string[]) => ids.map((id) => tree.nodes[id]!.geneId!);
    expect(names(leafOrder(tree))).toEqual(['1001', '7', '42']);
    expect(names(leafOrder(tree, { swappedNodeIds: new Set(root.meta.swappedNodeIds) }))).toEqual(['42', '7', '1001']);
    // Every leaf joins the matrix.
    for (const n of Object.values(tree.nodes)) if (n.isLeaf) expect(root.meta.matrix.callsByGeneId[n.geneId!]).toBeDefined();
  });

  it("treeFallback 'upgma' (default) clusters the matrix locally with the g2p metric", async () => {
    const fetch = fakeFetch(fullRoutes(false));
    const root = await brapiAlleleMatrixSource.loadRoot(rootContext({ matrixUrl: MATRIX_URL }, fetch));
    expect(root.meta.treeMethod).toBe('upgma');
    expect(root.meta.treeMetric).toBe('dosage_l1_mean');
    expect(root.meta.swappedNodeIds).toEqual([]);
    // dosages: v1 = [0, .5, 1], v2 = [0, 0, 1] → d(1001,7)=.25, d(1001,42)=1, d(7,42)=.75
    // → merge (1001,7) at .125, then 42 at (1+.75)/2/2 = .4375.
    expect(toNewick(root.tree)).toBe('((1001:0.125000,7:0.125000):0.312500,42:0.437500);');
    expect(Object.keys(root.tree.nodes)).toEqual(['c1', 'c0', 'l0', 'l1', 'l2']);
    expect(root.tree.nodes['l2']!.geneId).toBe('42');
  });

  it("treeFallback 'star' hangs every sample off one root at distance 1", async () => {
    const fetch = fakeFetch(fullRoutes(false));
    const root = await brapiAlleleMatrixSource.loadRoot(
      rootContext({ matrixUrl: MATRIX_URL, treeFallback: 'star' }, fetch),
    );
    expect(root.meta.treeMethod).toBe('star');
    expect(root.meta).not.toHaveProperty('treeMetric');
    expect(root.tree.rootId).toBe('root');
    expect(leafOrder(root.tree)).toEqual(['l0', 'l1', 'l2']);
    expect(root.tree.nodes['l1']).toEqual({ id: 'l1', parentId: 'root', distance: 1, isLeaf: true, geneId: '7' });
  });

  it("treeFallback 'none' throws", async () => {
    const fetch = fakeFetch(fullRoutes(false));
    await expect(
      brapiAlleleMatrixSource.loadRoot(rootContext({ matrixUrl: MATRIX_URL, treeFallback: 'none' }, fetch)),
    ).rejects.toThrow('BrAPI: response has no tree');
  });

  it('forwards regionLabel and propagates HTTP errors', async () => {
    const fetch = fakeFetch(fullRoutes(true));
    const root = await brapiAlleleMatrixSource.loadRoot(
      rootContext({ matrixUrl: MATRIX_URL, regionLabel: 'my window' }, fetch),
    );
    expect(root.meta.matrix.regionLabel).toBe('my window');
    await expect(brapiAlleleMatrixSource.loadRoot(rootContext({ matrixUrl: '/nope' }, fetch))).rejects.toThrow(
      'HTTP 404 for /nope',
    );
  });
});

describe('brapiAlleleMatrixSource slots (driven directly)', () => {
  const slotContext = async (fetch: FetchLike, ctx: BrapiCtx): Promise<SlotContext<BrapiCtx, BrapiMeta>> => {
    const rc = rootContext(ctx, fetch);
    const root = await brapiAlleleMatrixSource.loadRoot(rc);
    return { ...rc, tree: root.tree, root, onProgress: () => undefined };
  };
  const slot = (id: string) => brapiAlleleMatrixSource.slots.find((s) => s.id === id)!;

  it('declares two eager slots gated by ctx.germplasm / ctx.variants', () => {
    expect(brapiAlleleMatrixSource.slots.map((s) => s.id)).toEqual(['germplasm', 'variants']);
    expect(brapiAlleleMatrixSource.slots.every((s) => s.mode === 'eager')).toBe(true);
    const fakeRoot = { tree: { rootId: 'r', nodes: {} }, meta: {} as BrapiMeta };
    expect(slot('germplasm').enabled!({ matrixUrl: 'x' }, fakeRoot)).toBe(true);
    expect(slot('germplasm').enabled!({ matrixUrl: 'x', germplasm: false }, fakeRoot)).toBe(false);
    expect(slot('variants').enabled!({ matrixUrl: 'x', variants: false }, fakeRoot)).toBe(false);
  });

  it('germplasm: pages {base}/germplasm, keeps tree samples only, host data { germplasm }', async () => {
    const fetch = fakeFetch(fullRoutes(true));
    const sc = await slotContext(fetch, { matrixUrl: MATRIX_URL });
    const value = await slot('germplasm').run(sc);
    expect(fetch.calls).toEqual([MATRIX_URL, GERMPLASM_P0, GERMPLASM_P1]);
    expect(Object.keys(value).sort()).toEqual(['1001', '42', '7']);
    expect(slot('germplasm').toHostData(value, sc.root)).toEqual({ germplasm: value });
    // ctx.base overrides the derived base.
    const other = fakeFetch({
      [MATRIX_URL]: matrixBody(true),
      '/elsewhere/germplasm?pageSize=1000&page=0': { result: { data: [{ germplasmDbId: '7' }] } },
    });
    const sc2 = await slotContext(other, { matrixUrl: MATRIX_URL, base: '/elsewhere' });
    expect(await slot('germplasm').run(sc2)).toEqual({ '7': { germplasmDbId: '7' } });
  });

  it('variants: GETs the derived /variants URL, host data {}, patchMeta returns a new meta with merged ref/alt', async () => {
    const fetch = fakeFetch(fullRoutes(true));
    const sc = await slotContext(fetch, { matrixUrl: MATRIX_URL });
    const sites = await slot('variants').run(sc);
    expect(fetch.calls).toEqual([MATRIX_URL, VARIANTS_URL]);
    expect(sites.map((s: { id: string }) => s.id)).toEqual(['1:100', '1:200']);
    expect(slot('variants').toHostData(sites, sc.root)).toEqual({});
    const meta = slot('variants').patchMeta!(sites, sc.root.meta, sc.root);
    expect(meta).not.toBe(sc.root.meta);
    expect(meta.matrix).not.toBe(sc.root.meta.matrix);
    expect(meta.matrix.variants).toEqual([
      { id: '1:100', reference: '1', position: 100, ref: 'A', alt: ['T'] },
      { id: '1:200', reference: '1', position: 200, ref: 'C', alt: ['G'] },
    ]);
    expect(meta.sampleIds).toBe(sc.root.meta.sampleIds);
    // The original is untouched.
    expect(sc.root.meta.matrix.variants[0]).toEqual({ id: '1:100', reference: '1', position: 100 });
  });
});

describe('brapiAlleleMatrixSource through createLoader', () => {
  it('loads the root, runs both eager slots, merges germplasm into data and the sites into root.meta', async () => {
    const fetch = fakeFetch(fullRoutes(true));
    const loader = createLoader(brapiAlleleMatrixSource, { fetch, zoneSlots: { labels: ['germplasm'], genotype: ['variants'] } });
    const snap = await loader.start({ matrixUrl: MATRIX_URL });
    expect(snap.status).toBe('ready');
    expect(snap.error).toBeNull();
    expect(fetch.calls.slice().sort()).toEqual([MATRIX_URL, GERMPLASM_P0, GERMPLASM_P1, VARIANTS_URL].sort());
    expect(fetch.calls[0]).toBe(MATRIX_URL);
    expect(snap.slots['germplasm']!.status).toBe('ready');
    expect(snap.slots['variants']!.status).toBe('ready');
    expect(snap.zoneStatus).toEqual({ labels: 'ready', genotype: 'ready' });
    expect(Object.keys(snap.data.germplasm ?? {}).sort()).toEqual(['1001', '42', '7']);
    expect(snap.root!.meta.matrix.variants[0]).toEqual({ id: '1:100', reference: '1', position: 100, ref: 'A', alt: ['T'] });
    expect(snap.root!.meta.swappedNodeIds.length).toBeGreaterThan(0);
    expect(snap.tree).toBe(snap.root!.tree);
    loader.dispose();
  });

  it('a failing variants fetch errors only that slot; germplasm can be switched off', async () => {
    const fetch = fakeFetch({ [MATRIX_URL]: matrixBody(true), [GERMPLASM_P0]: germplasmPage(0), [GERMPLASM_P1]: germplasmPage(1) });
    const loader = createLoader(brapiAlleleMatrixSource, { fetch, retry: { attempts: 1 } });
    const snap = await loader.start({ matrixUrl: MATRIX_URL, germplasm: false });
    expect(snap.status).toBe('ready');
    expect(snap.slots['germplasm']!.status).toBe('idle');
    expect(snap.slots['variants']!.status).toBe('error');
    expect(snap.slots['variants']!.error).toContain('HTTP 404');
    expect(snap.data).toEqual({});
    expect(fetch.calls).toEqual([MATRIX_URL, VARIANTS_URL]);
    loader.dispose();
  });
});
