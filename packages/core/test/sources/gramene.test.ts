import { describe, expect, it } from 'vitest';
import {
  GRAMENE_DEFAULT_BASE,
  GRAMENE_GENE_STRUCTURE_FL,
  facetPairsToCounts,
  fetchGrameneExprAttrDocs,
  fetchGrameneGene,
  fetchGrameneGeneStructures,
  fetchGrameneGenetree,
  fetchGrameneNeighborhood,
  fetchGrameneSearchDocs,
  grameneGeneTreeSource,
  grameneNeighborhoodQuery,
  type GrameneCtx,
  type GrameneMeta,
} from '../../src/sources/gramene';
import { splitUrl, type FanOutResult, type FetchLike } from '../../src/fetch/index';
import type { RootResult, SlotContext } from '../../src/sources/types';
import type { GeneStructure } from '../../src/types';
import geneDoc from '../fixtures/sources/gramene-gene.json';
import genetreeDoc from '../fixtures/sources/gramene-genetree.json';
import neighborhoodDoc from '../fixtures/sources/gramene-neighborhood.json';
import geneStructuresDoc from '../fixtures/sources/gramene-gene-structures.json';

/** A URL-keyed fake transport: `json` answers 200, `status` answers that code; unknown URLs reject. */
type Route = { json?: unknown; status?: number };
function fakeFetch(routes: Record<string, Route> | ((url: string) => Route | undefined)) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = typeof routes === 'function' ? routes(url) : routes[url];
    if (!r) throw new Error(`unexpected request: ${url}`);
    const status = r.status ?? 200;
    return new Response(status >= 400 ? 'nope' : JSON.stringify(r.json ?? null), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls, urls: () => calls.map((c) => c.url) };
}

const BASE = GRAMENE_DEFAULT_BASE;
const TREE = 'EPlGT00940000166940';
const GENE_URL = `${BASE}/genes?idList=AT1G01040`;
const TREE_URL = `${BASE}/genetrees?idList=${TREE}`;
const NEIGHBORHOOD_URL =
  `${BASE}/search?fl=id%2Cname%2Cgene_tree%2Cgene_idx%2Cregion%2Cstart%2Cend%2Cstrand%2Cbiotype%2Csystem_name%2Cdescription` +
  `&fq=%7B%21graph+from%3Dcompara_neighbors_10+to%3Dcompara_idx_multi+maxDepth%3D1+cache%3Dfalse%7Dgene_tree%3A${TREE}&rows=100000&start=0`;
const STRUCTURES_URL =
  `${BASE}/genes?idList=AT1G01040%2CZm00001eb000010&rows=-1&fl=_id%2Cname%2Clocation%2Cgene_structure%2Ccanonical_transcript`;

describe('GRAMENE_DEFAULT_BASE / grameneNeighborhoodQuery', () => {
  it('matches the playground base and the Solr graph query verbatim', () => {
    expect(BASE).toBe('https://data.gramene.org/v69');
    expect(grameneNeighborhoodQuery('T1')).toEqual({
      fl: 'id,name,gene_tree,gene_idx,region,start,end,strand,biotype,system_name,description',
      fq: '{!graph from=compara_neighbors_10 to=compara_idx_multi maxDepth=1 cache=false}gene_tree:T1',
      rows: '100000',
      start: '0',
    });
  });
});

describe('grameneNeighborhoodQuery with a clade tree set', () => {
  it('scopes the graph query by the set and adds it to fl', () => {
    const q = grameneNeighborhoodQuery('W1', 'wheat');
    expect(q.fq).toBe('{!graph from=compara_neighbors_10 to=compara_idx_multi maxDepth=1 cache=false}wheat:W1');
    expect(q.fl).toBe('id,name,gene_tree,gene_idx,region,start,end,strand,biotype,system_name,description,wheat');
    expect(grameneNeighborhoodQuery('T1', 'gene_tree')).toEqual(grameneNeighborhoodQuery('T1'));
  });
});

describe('fetchGrameneGene / fetchGrameneGenetree', () => {
  it('hits /genes?idList=<gene> and reads the tree id', async () => {
    const f = fakeFetch({ [GENE_URL]: { json: geneDoc } });
    const g = await fetchGrameneGene(BASE, 'AT1G01040', { fetch: f.fetch });
    expect(f.urls()).toEqual([GENE_URL]);
    expect((f.calls[0]!.init!.headers as Record<string, string>).Accept).toBe('application/json');
    expect(g.geneId).toBe('AT1G01040');
    expect(g.geneTreeId).toBe(TREE);
  });

  it('hits /genetrees?idList=<tree> and converts the array', async () => {
    const f = fakeFetch({ [TREE_URL]: { json: [genetreeDoc] } });
    const r = await fetchGrameneGenetree(BASE, TREE, { fetch: f.fetch });
    expect(f.urls()).toEqual([TREE_URL]);
    expect(Object.keys(r.tree.nodes)).toEqual(['n0', 'n1', 'n2']);
    expect(r.proteinIdByGeneId).toEqual({ AT1G01040: 'AT1G01040.1', Zm00001eb000010: 'Zm00001eb000010_T001' });
  });

  it('surfaces HTTP failures', async () => {
    const f = fakeFetch({ [GENE_URL]: { status: 500 } });
    await expect(fetchGrameneGene(BASE, 'AT1G01040', { fetch: f.fetch })).rejects.toThrow(`HTTP 500 for ${GENE_URL}`);
  });
});

describe('fetchGrameneNeighborhood', () => {
  it('sends the exact Solr graph query (fl, fq, rows=100000, start=0)', async () => {
    const f = fakeFetch({ [NEIGHBORHOOD_URL]: { json: neighborhoodDoc } });
    const n = await fetchGrameneNeighborhood(BASE, TREE, { fetch: f.fetch });
    expect(f.urls()).toEqual([NEIGHBORHOOD_URL]);
    const { path, params } = splitUrl(f.urls()[0]!);
    expect(path).toBe(`${BASE}/search`);
    expect(params.get('fq')).toBe(`{!graph from=compara_neighbors_10 to=compara_idx_multi maxDepth=1 cache=false}gene_tree:${TREE}`);
    expect(n.AT1G01040!.upstream.map((g) => g.id)).toEqual(['AT1G01030']);
    expect(n.AT1G01040!.downstream.map((g) => g.id)).toEqual(['AT1G01050']);
  });
});

describe('fetchGrameneGeneStructures', () => {
  const ids = (n: number, prefix = 'G') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const docsFor = (idList: string) =>
    idList.split(',').map((id) => ({
      _id: id,
      location: { region: '1', start: 1, end: 100, strand: 1 },
      gene_structure: { exons: [{ id: `${id}.e1`, start: 1, end: 100 }], transcripts: [{ exons: [`${id}.e1`] }] },
    }));
  const byIdList = (expectFl: string | null) => (url: string): Route | undefined => {
    const { path, params } = splitUrl(url);
    if (path !== `${BASE}/genes` || params.get('rows') !== '-1') return undefined;
    if (params.get('fl') !== expectFl) return undefined;
    return { json: docsFor(params.get('idList')!) };
  };

  it('always sends rows=-1 with the narrow default fl, converting the docs', async () => {
    const f = fakeFetch({ [STRUCTURES_URL]: { json: geneStructuresDoc } });
    const r = await fetchGrameneGeneStructures(BASE, ['AT1G01040', 'Zm00001eb000010'], { fetch: f.fetch });
    expect(f.urls()).toEqual([STRUCTURES_URL]);
    expect(GRAMENE_GENE_STRUCTURE_FL).toBe('_id,name,location,gene_structure,canonical_transcript');
    expect(Object.keys(r.results).sort()).toEqual(['AT1G01040', 'Zm00001eb000010']);
    expect(r.results.Zm00001eb000010!.strand).toBe(-1);
    expect(r.errors).toEqual({});
    expect(r.progress).toEqual({ done: 2, total: 2, failed: 0 });
  });

  it('chunks 200 per request by default', async () => {
    const f = fakeFetch(byIdList(GRAMENE_GENE_STRUCTURE_FL));
    const progress: number[] = [];
    const r = await fetchGrameneGeneStructures(BASE, ids(250), { fetch: f.fetch, onProgress: (p) => progress.push(p.done) });
    const sizes = f.urls().map((u) => splitUrl(u).params.get('idList')!.split(',').length);
    expect(sizes.sort((a, b) => a - b)).toEqual([50, 200]);
    expect(Object.keys(r.results)).toHaveLength(250);
    // Two chunks settle in either order; `done` counts keys, not chunks.
    expect(progress).toHaveLength(2);
    expect(progress[1]).toBe(250);
    expect(r.progress).toEqual({ done: 250, total: 250, failed: 0 });
  });

  it('honours chunkSize 50 and fl: null (gramene-search Homology)', async () => {
    const f = fakeFetch(byIdList(null));
    const r = await fetchGrameneGeneStructures(BASE, ids(120), { fetch: f.fetch, chunkSize: 50, fl: null });
    const sizes = f.urls().map((u) => splitUrl(u).params.get('idList')!.split(',').length);
    expect(sizes.sort((a, b) => a - b)).toEqual([20, 50, 50]);
    for (const u of f.urls()) {
      const { params } = splitUrl(u);
      expect(params.has('fl')).toBe(false);
      expect(params.get('rows')).toBe('-1');
    }
    expect(f.urls()[0]).toBe(`${BASE}/genes?idList=${ids(50).join('%2C')}&rows=-1`);
    expect(Object.keys(r.results)).toHaveLength(120);
  });

  it('honours a custom fl string', async () => {
    const f = fakeFetch(byIdList('_id,location,gene_structure'));
    await fetchGrameneGeneStructures(BASE, ['A'], { fetch: f.fetch, fl: '_id,location,gene_structure' });
    expect(f.urls()).toEqual([`${BASE}/genes?idList=A&rows=-1&fl=_id%2Clocation%2Cgene_structure`]);
  });

  it('records a failed chunk under each of its ids', async () => {
    const f = fakeFetch((url) => (url.includes('idList=B') ? { status: 502 } : byIdList(GRAMENE_GENE_STRUCTURE_FL)(url)));
    const r = await fetchGrameneGeneStructures(BASE, ['A', 'B', 'C'], { fetch: f.fetch, chunkSize: 1 });
    expect(Object.keys(r.results).sort()).toEqual(['A', 'C']);
    expect(r.errors).toEqual({ B: `HTTP 502 for ${BASE}/genes?idList=B&rows=-1&fl=_id%2Cname%2Clocation%2Cgene_structure%2Ccanonical_transcript` });
    expect(r.progress).toEqual({ done: 3, total: 3, failed: 1 });
  });
});

describe('fetchGrameneSearchDocs / fetchGrameneExprAttrDocs', () => {
  const EXPR_URL = `${BASE}/search?q=*%3A*&fq=gene_tree%3AT1&fq=capabilities%3Aexpression_attributes&fl=id%2Cexpr_*__attr_*&rows=10000`;

  it('expr attrs: q=*:*, both fq, the fl glob and rows=10000, returning response.docs', async () => {
    const docs = [{ id: 'A', expr_tissue__attr_leaf: 1.5 }];
    const f = fakeFetch({ [EXPR_URL]: { json: { response: { numFound: 1, docs } } } });
    const r = await fetchGrameneExprAttrDocs(BASE, 'T1', { fetch: f.fetch });
    expect(f.urls()).toEqual([EXPR_URL]);
    expect(r).toEqual(docs);
  });

  it('expr attrs: rows override; empty body → []', async () => {
    const url = `${BASE}/search?q=*%3A*&fq=gene_tree%3AT1&fq=capabilities%3Aexpression_attributes&fl=id%2Cexpr_*__attr_*&rows=50`;
    const f = fakeFetch({ [url]: { json: {} } });
    expect(await fetchGrameneExprAttrDocs(BASE, 'T1', { rows: 50, fetch: f.fetch })).toEqual([]);
    expect(f.urls()).toEqual([url]);
  });

  it('expr attrs: treeField scopes the query by a clade tree set', async () => {
    const url = `${BASE}/search?q=*%3A*&fq=wheat%3AW1&fq=capabilities%3Aexpression_attributes&fl=id%2Cexpr_*__attr_*&rows=10000`;
    const f = fakeFetch({ [url]: { json: { response: { docs: [] } } } });
    expect(await fetchGrameneExprAttrDocs(BASE, 'W1', { treeField: 'wheat', fetch: f.fetch })).toEqual([]);
    expect(f.urls()).toEqual([url]);
  });

  it('search docs: q defaults to *:*, rows omitted when undefined, fq repeated', async () => {
    const url = `${BASE}/search?q=*%3A*&fq=a%3A1&fq=b%3A2&fl=id`;
    const f = fakeFetch({ [url]: { json: { response: { docs: [{ id: 'x' }] } } } });
    expect(await fetchGrameneSearchDocs<{ id: string }>(BASE, { fq: ['a:1', 'b:2'], fl: 'id' }, { fetch: f.fetch })).toEqual([{ id: 'x' }]);
    expect(f.urls()).toEqual([url]);
  });
});

describe('facetPairsToCounts', () => {
  it('turns the flat [value, count, …] array into a map (countsZone.js:24-28)', () => {
    expect(facetPairsToCounts(['3702', 12, 4577, '7', 'odd'])).toEqual({ '3702': 12, '4577': 7, odd: 0 });
    expect(facetPairsToCounts(undefined)).toEqual({});
    expect(facetPairsToCounts([])).toEqual({});
  });
});

describe('grameneGeneTreeSource', () => {
  const slotOf = (id: string) => grameneGeneTreeSource.slots.find((s) => s.id === id)!;
  const rootCtx = (ctx: GrameneCtx, fetch: FetchLike) => ({ ctx, fetch, signal: new AbortController().signal });
  const slotCtx = (ctx: GrameneCtx, fetch: FetchLike, root: RootResult<GrameneMeta>): SlotContext<GrameneCtx, GrameneMeta> => ({
    ...rootCtx(ctx, fetch),
    tree: root.tree,
    root,
    onProgress: () => {},
  });
  const noFetch = fakeFetch({});

  it('geneId only: /genes then /genetrees; root carries msa, metadata, domains, junctions, meta', async () => {
    const f = fakeFetch({ [GENE_URL]: { json: geneDoc }, [TREE_URL]: { json: [genetreeDoc] } });
    const root = await grameneGeneTreeSource.loadRoot(rootCtx({ geneId: 'AT1G01040' }, f.fetch));
    expect(f.urls()).toEqual([GENE_URL, TREE_URL]);
    expect(root.nodeOfInterest).toBe('AT1G01040');
    expect(root.meta.treeId).toBe(TREE);
    expect(root.meta.gene?.geneTreeId).toBe(TREE);
    expect(root.meta.proteinIdByGeneId).toEqual({ AT1G01040: 'AT1G01040.1', Zm00001eb000010: 'Zm00001eb000010_T001' });
    expect(Object.keys(root.data!)).toEqual(['geneMetadata', 'proteinDomains', 'exonJunctions', 'msa']);
    expect(root.data!.msa!.sequences.AT1G01040).toBe('MK-LV');
    expect(root.data!.proteinDomains!.AT1G01040!.map((d) => d.id)).toEqual(['IPR000999']);
    expect(root.data!.exonJunctions).toEqual({ AT1G01040: [2] });
    expect(root.taxonomy![33090]!.scientificName).toBe('Viridiplantae');
    expect(grameneGeneTreeSource.slots.map((s) => [s.id, s.mode])).toEqual([
      ['neighborhood', 'eager'],
      ['geneStructures', 'eager'],
    ]);
  });

  it('treeId only: /genetrees alone, no nodeOfInterest, no meta.gene', async () => {
    const f = fakeFetch({ [TREE_URL]: { json: [genetreeDoc] } });
    const root = await grameneGeneTreeSource.loadRoot(rootCtx({ treeId: TREE }, f.fetch));
    expect(f.urls()).toEqual([TREE_URL]);
    expect(root.nodeOfInterest).toBeUndefined();
    expect(root.meta).toEqual({
      treeId: TREE,
      treeField: 'gene_tree',
      proteinIdByGeneId: { AT1G01040: 'AT1G01040.1', Zm00001eb000010: 'Zm00001eb000010_T001' },
    });
  });

  it('treeId + rawGenetree makes zero fetches, as a bare doc and as an array', async () => {
    const bare = await grameneGeneTreeSource.loadRoot(rootCtx({ treeId: TREE, rawGenetree: genetreeDoc, geneId: 'AT1G01040' }, noFetch.fetch));
    const arr = await grameneGeneTreeSource.loadRoot(rootCtx({ treeId: TREE, rawGenetree: [genetreeDoc] }, noFetch.fetch));
    expect(noFetch.urls()).toEqual([]);
    expect(bare.tree).toEqual(arr.tree);
    expect(bare.nodeOfInterest).toBe('AT1G01040');
    expect(arr.meta.treeId).toBe(TREE);
  });

  it('errors when neither geneId nor treeId is given, or the gene has no tree', async () => {
    await expect(grameneGeneTreeSource.loadRoot(rootCtx({}, noFetch.fetch))).rejects.toThrow('ctx.geneId or ctx.treeId is required');
    const f = fakeFetch({ [GENE_URL]: { json: [{ _id: 'AT1G01040' }] } });
    await expect(grameneGeneTreeSource.loadRoot(rootCtx({ geneId: 'AT1G01040' }, f.fetch))).rejects.toThrow(
      'Gene AT1G01040 has no gene tree assigned',
    );
  });

  it('neighborhood slot: eager, uses meta.treeId and ctx.base', async () => {
    const base = 'https://example.test/api';
    const url = NEIGHBORHOOD_URL.replace(BASE, base);
    const f = fakeFetch({ [url]: { json: neighborhoodDoc } });
    const ctx: GrameneCtx = { base, treeId: TREE, rawGenetree: genetreeDoc };
    const root = await grameneGeneTreeSource.loadRoot(rootCtx(ctx, f.fetch));
    const slot = slotOf('neighborhood');
    expect(slot.enabled!(ctx, root)).toBe(true);
    expect(slot.enabled!({ ...ctx, neighborhood: false }, root)).toBe(false);
    const v = await slot.run(slotCtx(ctx, f.fetch, root));
    expect(f.urls()).toEqual([url]);
    expect(Object.keys(slot.toHostData(v, root))).toEqual(['neighborhood']);
    expect(Object.keys(v)).toContain('AT1G01040');
  });

  it('clade tree: meta.treeField from the tree doc tree_set scopes the neighborhood slot', async () => {
    const wheatTree = { ...genetreeDoc, tree_set: 'wheat' };
    const ctx: GrameneCtx = { treeId: 'W1', rawGenetree: wheatTree };
    const root = await grameneGeneTreeSource.loadRoot(rootCtx(ctx, noFetch.fetch));
    expect(root.meta.treeField).toBe('wheat');
    const url = `${BASE}/search?${new URLSearchParams(grameneNeighborhoodQuery('W1', 'wheat')).toString()}`;
    const docs = { response: { docs: [{ id: 'G', gene_idx: 1, region: '1', system_name: 's', wheat: 'W1' }] } };
    const f = fakeFetch({ [url]: { json: docs } });
    const v = await slotOf('neighborhood').run(slotCtx(ctx, f.fetch, root));
    expect(f.urls()).toEqual([url]);
    expect(v['G']!.center.geneTree).toBe('W1');
  });

  it('clade tree: a tree doc without tree_set takes the field from the gene lookup, else ctx', async () => {
    const wheatGene = [{ _id: 'AT1G01040', homology: { wheat: { id: TREE } } }];
    const f = fakeFetch({ [GENE_URL]: { json: wheatGene }, [TREE_URL]: { json: [genetreeDoc] } });
    const root = await grameneGeneTreeSource.loadRoot(rootCtx({ geneId: 'AT1G01040' }, f.fetch));
    expect(root.meta.treeField).toBe('wheat');
    const viaCtx = await grameneGeneTreeSource.loadRoot(
      rootCtx({ treeId: TREE, treeField: 'oat', rawGenetree: genetreeDoc }, noFetch.fetch),
    );
    expect(viaCtx.meta.treeField).toBe('oat');
  });

  it('geneStructures slot: enabled unless ctx.geneStructures === false; chunk size and fl from ctx', async () => {
    const ctx: GrameneCtx = { treeId: TREE, rawGenetree: genetreeDoc, geneStructureChunkSize: 1, geneStructureFl: null };
    const root = await grameneGeneTreeSource.loadRoot(rootCtx(ctx, noFetch.fetch));
    const slot = slotOf('geneStructures');
    expect(slot.enabled!(ctx, root)).toBe(true);
    expect(slot.enabled!({ ...ctx, geneStructures: false }, root)).toBe(false);

    const f = fakeFetch({
      [`${BASE}/genes?idList=AT1G01040&rows=-1`]: { json: [geneStructuresDoc[0]] },
      [`${BASE}/genes?idList=Zm00001eb000010&rows=-1`]: { status: 503 },
    });
    const v = (await slot.run(slotCtx(ctx, f.fetch, root))) as FanOutResult<GeneStructure>;
    expect(f.urls().sort()).toEqual([`${BASE}/genes?idList=AT1G01040&rows=-1`, `${BASE}/genes?idList=Zm00001eb000010&rows=-1`]);
    expect(Object.keys(slot.toHostData(v, root).geneStructures!)).toEqual(['AT1G01040']);
    const itemErrors = slot.itemErrorsOf!(v);
    expect(itemErrors).toEqual({ Zm00001eb000010: `HTTP 503 for ${BASE}/genes?idList=Zm00001eb000010&rows=-1` });
    expect(slot.failWhen!(v, itemErrors)).toBeNull();

    const all = fakeFetch(() => ({ status: 503 }));
    const v2 = (await slot.run(slotCtx(ctx, all.fetch, root))) as FanOutResult<GeneStructure>;
    expect(slot.failWhen!(v2, slot.itemErrorsOf!(v2))).toBe(`All 2 gene-structure requests failed (${v2.lastError})`);
  });

  it('geneStructures slot: default chunking uses the narrow fl on one request for a small tree', async () => {
    const ctx: GrameneCtx = { treeId: TREE, rawGenetree: genetreeDoc };
    const root = await grameneGeneTreeSource.loadRoot(rootCtx(ctx, noFetch.fetch));
    const f = fakeFetch({ [STRUCTURES_URL]: { json: geneStructuresDoc } });
    const slot = slotOf('geneStructures');
    const v = (await slot.run(slotCtx(ctx, f.fetch, root))) as FanOutResult<GeneStructure>;
    expect(f.urls()).toEqual([STRUCTURES_URL]);
    expect(slot.itemErrorsOf!(v)).toBeNull();
  });
});
