import { describe, expect, it } from 'vitest';
import {
  ENSEMBL_DEFAULT_DOMAIN_SOURCES,
  ensemblGeneTreeSource,
  fetchEnsemblGeneTree,
  fetchEnsemblOverlap,
  fetchEnsemblProteinDomains,
  type EnsemblCtx,
  type EnsemblMeta,
} from '../../src/sources/ensembl';
import type { FanOutResult, FetchLike } from '../../src/fetch/index';
import type { RootResult, SlotContext } from '../../src/sources/types';
import type { ProteinDomain } from '../../src/types';
import { fromEnsemblGeneTree } from '../../src/adapters/ensembl';
import genetree from '../fixtures/sources/ensembl-genetree.json';
import proteinFeatures from '../fixtures/sources/ensembl-protein-features.json';
import overlap from '../fixtures/sources/ensembl-overlap.json';

/** A URL-keyed fake transport: `json` answers 200, `status` answers that code; unknown URLs reject. */
type Route = { json?: unknown; status?: number };
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (!r) throw new Error(`unexpected request: ${url}`);
    const status = r.status ?? 200;
    return new Response(status >= 400 ? 'nope' : JSON.stringify(r.json ?? null), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls, urls: () => calls.map((c) => c.url) };
}

const GENE = 'ENSG00000139618';
const SPECIES_URL = `https://rest.ensembl.org/genetree/member/id/homo_sapiens/${GENE}?aligned=1&sequence=protein`;
const BARE_URL = `https://dec2021.rest.ensembl.org/genetree/member/id/${GENE}?aligned=1&sequence=protein`;

describe('fetchEnsemblGeneTree', () => {
  it('uses the species route on the current mirror and sends Accept: application/json', async () => {
    const f = fakeFetch({ [SPECIES_URL]: { json: genetree } });
    const r = await fetchEnsemblGeneTree(GENE, { fetch: f.fetch });
    expect(f.urls()).toEqual([SPECIES_URL]);
    expect((f.calls[0]!.init!.headers as Record<string, string>).Accept).toBe('application/json');
    expect(Object.keys(r.tree.nodes)).toEqual(['n0', 'n1', 'n2']);
    expect(r.proteinIdByGeneId).toEqual({
      ENSG00000139618: 'ENSP00000369497',
      ENSPTRG00000001: 'ENSPTRP00000001',
    });
  });

  it('uses the bare route on a release <= 109 archive and honours species', async () => {
    const f = fakeFetch({
      [BARE_URL]: { json: genetree },
      [`https://rest.ensembl.org/genetree/member/id/mus_musculus/${GENE}?aligned=1&sequence=protein`]: { json: genetree },
    });
    await fetchEnsemblGeneTree(GENE, { host: 'dec2021.rest.ensembl.org', fetch: f.fetch });
    await fetchEnsemblGeneTree(GENE, { species: 'mus_musculus', fetch: f.fetch });
    expect(f.urls()).toEqual([
      BARE_URL,
      `https://rest.ensembl.org/genetree/member/id/mus_musculus/${GENE}?aligned=1&sequence=protein`,
    ]);
  });

  it('names the host and release on a 404 (route mismatch) and the status otherwise', async () => {
    const f = fakeFetch({ [BARE_URL]: { status: 404 }, [SPECIES_URL]: { status: 503 } });
    await expect(fetchEnsemblGeneTree(GENE, { host: 'dec2021.rest.ensembl.org', fetch: f.fetch })).rejects.toThrow(
      `HTTP 404 from dec2021.rest.ensembl.org (release 105) — no gene tree for ${GENE}`,
    );
    await expect(fetchEnsemblGeneTree(GENE, { fetch: f.fetch })).rejects.toThrow('HTTP 503 from rest.ensembl.org');
  });
});

describe('fetchEnsemblProteinDomains', () => {
  const MAP = { ENSG00000139618: 'ENSP00000369497', ENSPTRG00000001: 'ENSPTRP00000001' };
  const URL_A = 'https://rest.ensembl.org/overlap/translation/ENSP00000369497?feature=protein_feature';
  const URL_B = 'https://rest.ensembl.org/overlap/translation/ENSPTRP00000001?feature=protein_feature';

  it('fans out per protein id on the given host and keeps Pfam + Smart by default', async () => {
    const f = fakeFetch({
      ['https://may2024.rest.ensembl.org/overlap/translation/ENSP00000369497?feature=protein_feature']: { json: proteinFeatures },
      ['https://may2024.rest.ensembl.org/overlap/translation/ENSPTRP00000001?feature=protein_feature']: { json: [] },
    });
    const progress: number[] = [];
    const r = await fetchEnsemblProteinDomains(MAP, {
      host: 'may2024.rest.ensembl.org',
      fetch: f.fetch,
      onProgress: (p) => progress.push(p.done),
    });
    expect(f.urls().sort()).toEqual([
      'https://may2024.rest.ensembl.org/overlap/translation/ENSP00000369497?feature=protein_feature',
      'https://may2024.rest.ensembl.org/overlap/translation/ENSPTRP00000001?feature=protein_feature',
    ]);
    expect(ENSEMBL_DEFAULT_DOMAIN_SOURCES).toEqual(['Pfam', 'Smart']);
    expect(r.results.ENSG00000139618!.map((d) => d.id)).toEqual(['PF00634', 'SM00001']);
    expect(r.results.ENSPTRG00000001).toEqual([]);
    expect(r.errors).toEqual({});
    expect(progress).toEqual([1, 2]);
    expect(r.progress).toEqual({ done: 2, total: 2, failed: 0 });
  });

  it('honours a custom source list', async () => {
    const f = fakeFetch({ [URL_A]: { json: proteinFeatures } });
    const r = await fetchEnsemblProteinDomains({ ENSG00000139618: 'ENSP00000369497' }, { sources: ['Gene3D'], fetch: f.fetch });
    expect(r.results.ENSG00000139618!.map((d) => d.id)).toEqual(['G3DSA:1.10.10.10']);
  });

  it('records partial failures per gene without rejecting', async () => {
    const f = fakeFetch({ [URL_A]: { json: proteinFeatures }, [URL_B]: { status: 400 } });
    const r = await fetchEnsemblProteinDomains(MAP, { fetch: f.fetch });
    expect(Object.keys(r.results)).toEqual(['ENSG00000139618']);
    expect(r.errors).toEqual({ ENSPTRG00000001: `HTTP 400 for ${URL_B}` });
    expect(r.progress).toEqual({ done: 2, total: 2, failed: 1 });
  });
});

describe('fetchEnsemblOverlap', () => {
  const OVERLAP = (host: string, gene: string) =>
    `https://${host}/overlap/id/${gene}?feature=transcript;feature=exon;feature=cds;feature=regulatory;feature=motif`;

  it('splits one response into gene structure + genome features and records per-leaf errors as data', async () => {
    const f = fakeFetch({
      [OVERLAP('rest.ensembl.org', GENE)]: { json: overlap },
      [OVERLAP('rest.ensembl.org', 'ENSPTRG00000001')]: { status: 400 },
      [OVERLAP('rest.ensembl.org', 'ENSG_EMPTY')]: { json: [] },
    });
    const r = await fetchEnsemblOverlap([GENE, 'ENSPTRG00000001', 'ENSG_EMPTY'], { fetch: f.fetch });
    expect(f.urls().sort()).toEqual([
      OVERLAP('rest.ensembl.org', GENE),
      OVERLAP('rest.ensembl.org', 'ENSG_EMPTY'),
      OVERLAP('rest.ensembl.org', 'ENSPTRG00000001'),
    ]);
    expect(Object.keys(r.geneStructures)).toEqual([GENE]);
    expect(r.geneStructures[GENE]!.transcripts.map((t) => t.id)).toEqual(['ENST1']);
    expect(r.genomeFeatures[GENE]!.map((g) => g.id)).toEqual(['ENSR1']);
    expect(r.geneStructureErrors).toEqual({
      ENSPTRG00000001: `HTTP 400 for ${OVERLAP('rest.ensembl.org', 'ENSPTRG00000001')}`,
      ENSG_EMPTY: 'no gene structure in response',
    });
  });

  it('targets the requested host', async () => {
    const f = fakeFetch({ [OVERLAP('may2024.rest.ensembl.org', GENE)]: { json: overlap } });
    await fetchEnsemblOverlap([GENE], { host: 'may2024.rest.ensembl.org', fetch: f.fetch });
    expect(f.urls()).toEqual([OVERLAP('may2024.rest.ensembl.org', GENE)]);
  });
});

describe('ensemblGeneTreeSource', () => {
  const slotOf = (id: string) => ensemblGeneTreeSource.slots.find((s) => s.id === id)!;
  const rootCtx = (ctx: EnsemblCtx, fetch: FetchLike) => ({ ctx, fetch, signal: new AbortController().signal });
  const slotCtx = (ctx: EnsemblCtx, fetch: FetchLike, root: RootResult<EnsemblMeta>): SlotContext<EnsemblCtx, EnsemblMeta> => ({
    ...rootCtx(ctx, fetch),
    tree: root.tree,
    root,
    onProgress: () => {},
  });

  it('loads the root from the chosen mirror: tree, taxonomy, msa, metadata, nodeOfInterest and meta', async () => {
    const f = fakeFetch({ [BARE_URL]: { json: genetree } });
    const ctx: EnsemblCtx = { geneId: ` ${GENE} `, host: 'dec2021.rest.ensembl.org' };
    const root = await ensemblGeneTreeSource.loadRoot(rootCtx(ctx, f.fetch));
    expect(f.urls()).toEqual([BARE_URL]);
    expect(root.nodeOfInterest).toBe(GENE);
    expect(root.taxonomy![9606]!.scientificName).toBe('Homo sapiens');
    expect(root.data!.msa!.length).toBe(8);
    expect(root.data!.geneMetadata).toEqual(fromEnsemblGeneTree(genetree).geneMetadata);
    expect(root.meta).toEqual({
      proteinIdByGeneId: { ENSG00000139618: 'ENSP00000369497', ENSPTRG00000001: 'ENSPTRP00000001' },
      mirror: { host: 'dec2021.rest.ensembl.org', release: 105, route: 'bare' },
    });
    expect(ensemblGeneTreeSource.slots.map((s) => [s.id, s.mode])).toEqual([
      ['proteinDomains', 'lazy'],
      ['overlap', 'lazy'],
    ]);
  });

  it('proteinDomains: throws when the tree carried no protein ids', async () => {
    const f = fakeFetch({ [SPECIES_URL]: { json: genetree } });
    const ctx: EnsemblCtx = { geneId: GENE };
    const root = await ensemblGeneTreeSource.loadRoot(rootCtx(ctx, f.fetch));
    const bare: RootResult<EnsemblMeta> = { ...root, meta: { ...root.meta, proteinIdByGeneId: {} } };
    await expect(slotOf('proteinDomains').run(slotCtx(ctx, f.fetch, bare))).rejects.toThrow('No protein ids on this tree');
    expect(f.urls()).toEqual([SPECIES_URL]);
  });

  it('proteinDomains: fans out to the root mirror, honours domainSources, failWhen only when all fail', async () => {
    const H = 'may2024.rest.ensembl.org';
    const A = `https://${H}/overlap/translation/ENSP00000369497?feature=protein_feature`;
    const B = `https://${H}/overlap/translation/ENSPTRP00000001?feature=protein_feature`;
    const ROOT = `https://${H}/genetree/member/id/homo_sapiens/${GENE}?aligned=1&sequence=protein`;
    const ctx: EnsemblCtx = { geneId: GENE, host: H, domainSources: ['Gene3D'] };
    const slot = slotOf('proteinDomains');

    // Partial failure: ready with itemErrors.
    const f1 = fakeFetch({ [ROOT]: { json: genetree }, [A]: { json: proteinFeatures }, [B]: { status: 500 } });
    const root = await ensemblGeneTreeSource.loadRoot(rootCtx(ctx, f1.fetch));
    const v1 = (await slot.run(slotCtx(ctx, f1.fetch, root))) as FanOutResult<ProteinDomain[]>;
    expect(f1.urls().slice(1).sort()).toEqual([A, B]);
    expect(slot.toHostData(v1, root)).toEqual({
      proteinDomains: { ENSG00000139618: [{ id: 'G3DSA:1.10.10.10', name: 'Gene3D hit', start: 1, end: 8, source: 'Gene3D' }] },
    });
    const itemErrors = slot.itemErrorsOf!(v1);
    expect(itemErrors).toEqual({ ENSPTRG00000001: `HTTP 500 for ${B}` });
    expect(slot.failWhen!(v1, itemErrors)).toBeNull();

    // Total failure: failWhen names the count and the last error.
    const f2 = fakeFetch({ [A]: { status: 502 }, [B]: { status: 503 } });
    const v2 = (await slot.run(slotCtx(ctx, f2.fetch, root))) as FanOutResult<ProteinDomain[]>;
    expect(slot.failWhen!(v2, slot.itemErrorsOf!(v2))).toBe(`All 2 domain requests failed (${v2.lastError})`);
    expect(v2.lastError).toMatch(/^HTTP 50[23] for /);
  });

  it('overlap: per-leaf failures become geneStructureErrors data, never an error', async () => {
    const OV = (gene: string) =>
      `https://rest.ensembl.org/overlap/id/${gene}?feature=transcript;feature=exon;feature=cds;feature=regulatory;feature=motif`;
    const f = fakeFetch({ [SPECIES_URL]: { json: genetree }, [OV(GENE)]: { json: overlap }, [OV('ENSPTRG00000001')]: { status: 400 } });
    const ctx: EnsemblCtx = { geneId: GENE };
    const slot = slotOf('overlap');
    const root = await ensemblGeneTreeSource.loadRoot(rootCtx(ctx, f.fetch));
    const v = await slot.run(slotCtx(ctx, f.fetch, root));
    expect(f.urls().slice(1).sort()).toEqual([OV(GENE), OV('ENSPTRG00000001')]);
    expect(slot.itemErrorsOf).toBeUndefined();
    expect(slot.failWhen).toBeUndefined();
    const patch = slot.toHostData(v, root);
    expect(Object.keys(patch.geneStructures!)).toEqual([GENE]);
    expect(Object.keys(patch.genomeFeatures!)).toEqual([GENE]);
    expect(patch.geneStructureErrors).toEqual({ ENSPTRG00000001: `HTTP 400 for ${OV('ENSPTRG00000001')}` });
  });

  it('overlap: omits empty genomeFeatures / geneStructureErrors from the patch', async () => {
    const slot = slotOf('overlap');
    const root = await ensemblGeneTreeSource.loadRoot(rootCtx({ geneId: GENE }, fakeFetch({ [SPECIES_URL]: { json: genetree } }).fetch));
    expect(slot.toHostData({ geneStructures: {}, genomeFeatures: {}, geneStructureErrors: {} }, root)).toEqual({ geneStructures: {} });
  });
});
