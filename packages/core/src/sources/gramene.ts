/**
 * Gramene REST / Solr endpoint knowledge and the `grameneGeneTreeSource`
 * data source.
 *
 * Origin: the playground's Gramene path (`examples/playground/main.tsx:167,
 * 560-705`: `loadGramene`, `loadGrameneNeighborhood`,
 * `loadGrameneGeneStructures`) and gramene-search's Homology panel
 * (`src/components/results/details/Homology.js:217-331`: the same two
 * fetches at chunk size 50 without `fl`, plus `fetchExprAttrs`). The
 * facet helper comes from `taxTree/countsZone.js:24-28`.
 */

import { buildUrl, fanOutChunks, getJson, type FanOutProgress, type FanOutResult, type FetchLike } from '../fetch/index';
import {
  fromGrameneGene,
  fromGrameneGeneStructures,
  fromGrameneGenetree,
  fromGrameneNeighborhood,
  type FromGrameneGeneResult,
  type FromGrameneGenetreeOptions,
  type FromGrameneGenetreeResult,
} from '../adapters/gramene';
import { leafGeneIds } from '../tree/index';
import type { GeneId, GeneStructure, HostDataPatch, Neighborhood } from '../types';
import type { DataSlot, TreeDataSource } from './types';

/** The Gramene REST base the playground uses (`main.tsx:167`). */
export const GRAMENE_DEFAULT_BASE = 'https://data.gramene.org/v69';

/** Transport options shared by every fetch helper here. */
export interface GrameneFetchOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
}

const transport = (opts: GrameneFetchOptions): { fetch?: FetchLike; signal?: AbortSignal } => ({
  ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
});

/** `fl` the neighbourhood query asks for (`main.tsx:578`, `Homology.js:223`). */
const NEIGHBORHOOD_FL =
  'id,name,gene_tree,gene_idx,region,start,end,strand,biotype,system_name,description';

/**
 * Query parameters of the Solr graph query that returns every leaf of a
 * gene tree plus its ±10 flanking genes, in the order the origins set
 * them: `fl`, `fq='{!graph from=compara_neighbors_10 to=compara_idx_multi
 * maxDepth=1}gene_tree:<treeId>'`, `rows=100000`, `start=0`. Origin:
 * `main.tsx:576-586`, `Homology.js:222-226`.
 */
export function grameneNeighborhoodQuery(treeId: string): Record<string, string> {
  return {
    fl: NEIGHBORHOOD_FL,
    fq: `{!graph from=compara_neighbors_10 to=compara_idx_multi maxDepth=1}gene_tree:${treeId}`,
    rows: '100000',
    start: '0',
  };
}

/**
 * GET `{base}/genes?idList=<geneId>` and convert with `fromGrameneGene`,
 * which yields the gene's tree id (or `null` when it has none). Origin:
 * `main.tsx:655-663`.
 */
export async function fetchGrameneGene(
  base: string,
  geneId: string,
  opts: GrameneFetchOptions = {},
): Promise<FromGrameneGeneResult> {
  const json = await getJson(buildUrl(base, '/genes', { idList: geneId }), transport(opts));
  return fromGrameneGene(json);
}

/**
 * GET `{base}/genetrees?idList=<treeId>` and convert the response array
 * with `fromGrameneGenetree` (tree, taxonomy, MSA, per-leaf domains and
 * exon junctions). Origin: `main.tsx:666-672`.
 */
export async function fetchGrameneGenetree(
  base: string,
  treeId: string,
  opts: GrameneFetchOptions & FromGrameneGenetreeOptions = {},
): Promise<FromGrameneGenetreeResult> {
  const json = await getJson(buildUrl(base, '/genetrees', { idList: treeId }), transport(opts));
  return fromGrameneGenetree(json, {
    ...(opts.alphabet !== undefined ? { alphabet: opts.alphabet } : {}),
  });
}

/**
 * GET `{base}/search` with {@link grameneNeighborhoodQuery} and convert
 * with `fromGrameneNeighborhood` into per-gene ±10 neighbourhoods. One
 * request answers for the whole tree. Origin: `main.tsx:574-600`,
 * `Homology.js:217-247`.
 */
export async function fetchGrameneNeighborhood(
  base: string,
  treeId: string,
  opts: GrameneFetchOptions = {},
): Promise<Record<GeneId, Neighborhood>> {
  const json = await getJson(buildUrl(base, '/search', grameneNeighborhoodQuery(treeId)), transport(opts));
  return fromGrameneNeighborhood(json);
}

/** The narrow field list the playground requests for gene structures (`main.tsx:618`). */
export const GRAMENE_GENE_STRUCTURE_FL = '_id,name,location,gene_structure,canonical_transcript';

/** Options accepted by {@link fetchGrameneGeneStructures}. */
export interface FetchGrameneGeneStructuresOptions extends GrameneFetchOptions {
  /** Gene ids per `/genes` request; default 200 (gramene-search passes 50). */
  chunkSize?: number;
  /** `fl` sent with each request; default {@link GRAMENE_GENE_STRUCTURE_FL}; `null` omits it (full docs, as Homology.js does). */
  fl?: string | null;
  onProgress?: (p: FanOutProgress) => void;
}

/**
 * Fetch `gene_structure` (+ `location`, `name`, `canonical_transcript`)
 * for every gene id in chunks — `GET {base}/genes?idList=<ids>&rows=-1
 * &fl=…` — so the URL stays under proxy limits, and convert each chunk
 * with `fromGrameneGeneStructures`. Always sends `rows=-1`. A failing
 * chunk records its message under each of its ids in `errors`; genes
 * whose docs carry no `gene_structure` are simply absent from `results`.
 * Origin: `main.tsx:608-636` (chunk 200, narrow `fl`) and
 * `Homology.js:248-290` (chunk 50, no `fl`).
 */
export function fetchGrameneGeneStructures(
  base: string,
  geneIds: readonly GeneId[],
  opts: FetchGrameneGeneStructuresOptions = {},
): Promise<FanOutResult<GeneStructure>> {
  const chunkSize = opts.chunkSize ?? 200;
  const fl = opts.fl === undefined ? GRAMENE_GENE_STRUCTURE_FL : opts.fl;
  return fanOutChunks(
    geneIds,
    chunkSize,
    async (ids, signal) => {
      const url = buildUrl(base, '/genes', {
        idList: ids.join(','),
        rows: -1,
        ...(fl !== null ? { fl } : {}),
      });
      const json = await getJson(url, {
        ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
        signal,
      });
      return fromGrameneGeneStructures(Array.isArray(json) ? json : []);
    },
    {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    },
  );
}

/** Parameters of {@link fetchGrameneSearchDocs}. */
export interface GrameneSearchParams {
  /** Solr `q`; default `'*:*'`. */
  q?: string;
  /** Solr `fq` filters, sent as repeated `fq=` parameters. */
  fq: readonly string[];
  /** Solr `fl` field list (globs allowed). */
  fl: string;
  /** Solr `rows`; omitted when undefined (the server default applies). */
  rows?: number;
}

/**
 * GET `{base}/search?q=…&fq=…&fq=…&fl=…&rows=…` and return
 * `response.docs` (an empty array when the body has none). The generic
 * shape behind {@link fetchGrameneExprAttrDocs}; `/search` is used rather
 * than `/genes` because the latter trims docs to a fixed field set.
 * Origin: `Homology.js:301-312`.
 */
export async function fetchGrameneSearchDocs<T = Record<string, unknown>>(
  base: string,
  params: GrameneSearchParams,
  opts: GrameneFetchOptions = {},
): Promise<T[]> {
  const url = buildUrl(base, '/search', {
    q: params.q ?? '*:*',
    fq: params.fq,
    fl: params.fl,
    ...(params.rows !== undefined ? { rows: params.rows } : {}),
  });
  const json = (await getJson(url, transport(opts))) as { response?: { docs?: unknown } } | null;
  const docs = json?.response?.docs;
  return Array.isArray(docs) ? (docs as T[]) : [];
}

/** Options accepted by {@link fetchGrameneExprAttrDocs}. */
export interface FetchGrameneExprAttrDocsOptions extends GrameneFetchOptions {
  /** Solr `rows`; default 10000 (high enough to cover any one tree). */
  rows?: number;
}

/**
 * Fetch the expression-attribute docs (`id` + every `expr_*__attr_*`
 * field) for the genes of one tree in a single query: `q=*:*`,
 * `fq=gene_tree:<treeId>`, `fq=capabilities:expression_attributes`,
 * `fl=id,expr_*__attr_*`, `rows=10000`. Scoping by the capability means
 * only genes that actually carry the data come back; the glob `fl` lets
 * the columns be discovered from the data. Origin: `Homology.js:293-331`.
 */
export function fetchGrameneExprAttrDocs(
  base: string,
  treeId: string,
  opts: FetchGrameneExprAttrDocsOptions = {},
): Promise<Array<Record<string, unknown>>> {
  return fetchGrameneSearchDocs<Record<string, unknown>>(
    base,
    {
      q: '*:*',
      fq: [`gene_tree:${treeId}`, 'capabilities:expression_attributes'],
      fl: 'id,expr_*__attr_*',
      rows: opts.rows ?? 10000,
    },
    transport(opts),
  );
}

/**
 * Turn a Solr flat facet array (`[value, count, value, count, …]`) into
 * `{ [String(value)]: count }`. Missing or non-numeric counts become 0
 * (the origin's unary `+` would yield `NaN`). Origin:
 * gramene-search `taxTree/countsZone.js:24-28`.
 */
export function facetPairsToCounts(
  facet: ReadonlyArray<string | number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(facet)) return out;
  for (let i = 0; i < facet.length; i += 2) {
    const key = facet[i];
    if (key === undefined) continue;
    const n = Number(facet[i + 1]);
    out[String(key)] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

// ─── Data source ─────────────────────────────────────────────────────────────

/** Context for {@link grameneGeneTreeSource}. */
export interface GrameneCtx {
  /** REST base; default {@link GRAMENE_DEFAULT_BASE}. */
  base?: string;
  /** Gene whose tree to load (resolved through `/genes` unless `treeId` is given); also the node of interest. */
  geneId?: string;
  /** Tree id, when already known: skips the `/genes` lookup. */
  treeId?: string;
  /**
   * An already-fetched `/genetrees` response (the bare root doc or the
   * one-element array), normalised with `Array.isArray(x) ? x : [x]`.
   * Together with `treeId` the root load makes no request at all.
   */
  rawGenetree?: unknown;
  /** Set `false` to skip the `neighborhood` slot. */
  neighborhood?: boolean;
  /** Set `false` to skip the `geneStructures` slot. */
  geneStructures?: boolean;
  /** Gene ids per `/genes` request for the `geneStructures` slot; default 200 (gramene-search passes 50). */
  geneStructureChunkSize?: number;
  /** `fl` for the `geneStructures` slot; default the narrow list, `null` omits it. */
  geneStructureFl?: string | null;
}

/** Root metadata of {@link grameneGeneTreeSource}. */
export interface GrameneMeta {
  treeId: string;
  /** The `/genes` lookup result, when the root had to resolve `geneId` to a tree. */
  gene?: FromGrameneGeneResult;
  /** Gene id → translation accession (parity with the Ensembl source). */
  proteinIdByGeneId: Record<GeneId, string>;
}

const neighborhoodSlot: DataSlot<Record<GeneId, Neighborhood>, GrameneCtx, GrameneMeta> = {
  id: 'neighborhood',
  mode: 'eager',
  enabled: (ctx) => ctx.neighborhood !== false,
  run: ({ ctx, fetch, signal, root }) =>
    fetchGrameneNeighborhood(ctx.base ?? GRAMENE_DEFAULT_BASE, root.meta.treeId, { fetch, signal }),
  toHostData: (v) => ({ neighborhood: v }),
};

const geneStructuresSlot: DataSlot<FanOutResult<GeneStructure>, GrameneCtx, GrameneMeta> = {
  id: 'geneStructures',
  mode: 'eager',
  enabled: (ctx) => ctx.geneStructures !== false,
  run: ({ ctx, fetch, signal, tree, onProgress }) =>
    fetchGrameneGeneStructures(ctx.base ?? GRAMENE_DEFAULT_BASE, leafGeneIds(tree), {
      ...(ctx.geneStructureChunkSize !== undefined ? { chunkSize: ctx.geneStructureChunkSize } : {}),
      ...(ctx.geneStructureFl !== undefined ? { fl: ctx.geneStructureFl } : {}),
      fetch,
      signal,
      onProgress,
    }),
  toHostData: (v) => ({ geneStructures: v.results }),
  itemErrorsOf: (v) => (Object.keys(v.errors).length > 0 ? v.errors : null),
  failWhen: (v) =>
    v.progress.total > 0 && v.progress.failed === v.progress.total
      ? `All ${v.progress.total} gene-structure requests failed (${v.lastError})`
      : null,
};

/**
 * The Gramene gene-tree data source. Root: when `ctx.treeId` is absent,
 * `GET /genes?idList=<geneId>` resolves the tree id (error when the gene
 * has none); then the tree comes from `ctx.rawGenetree` when given (so a
 * host that already holds the `/genetrees` doc makes no request) or from
 * `GET /genetrees?idList=<treeId>`. The root carries the MSA, gene
 * metadata, per-leaf protein domains and exon junctions that the genetree
 * response already contains, pivoted on `ctx.geneId`. Two eager slots
 * follow: `neighborhood` (one Solr graph query, {@link fetchGrameneNeighborhood})
 * and `geneStructures` (chunked `/genes`, {@link fetchGrameneGeneStructures};
 * ready with per-gene `itemErrors` on partial failure, an error only when
 * every chunk failed). Origin: `main.tsx:645-705`, `Homology.js:217-290`.
 */
export const grameneGeneTreeSource: TreeDataSource<GrameneCtx, GrameneMeta> = {
  id: 'gramene-genetree',
  label: 'Gramene gene tree',
  async loadRoot({ ctx, fetch, signal }) {
    const base = ctx.base ?? GRAMENE_DEFAULT_BASE;
    let treeId = ctx.treeId;
    let gene: FromGrameneGeneResult | undefined;
    if (treeId === undefined) {
      if (ctx.geneId === undefined) {
        throw new Error('grameneGeneTreeSource: ctx.geneId or ctx.treeId is required');
      }
      gene = await fetchGrameneGene(base, ctx.geneId, { fetch, signal });
      if (!gene.geneTreeId) throw new Error(`Gene ${gene.geneId} has no gene tree assigned`);
      treeId = gene.geneTreeId;
    }
    const r =
      ctx.rawGenetree !== undefined
        ? fromGrameneGenetree(Array.isArray(ctx.rawGenetree) ? ctx.rawGenetree : [ctx.rawGenetree])
        : await fetchGrameneGenetree(base, treeId, { fetch, signal });
    const data: HostDataPatch = {
      geneMetadata: r.geneMetadata,
      proteinDomains: r.proteinDomains,
      exonJunctions: r.exonJunctions,
    };
    if (r.msa !== undefined) data.msa = r.msa;
    const meta: GrameneMeta = { treeId, proteinIdByGeneId: r.proteinIdByGeneId };
    if (gene !== undefined) meta.gene = gene;
    return {
      tree: r.tree,
      taxonomy: r.taxonomy,
      ...(ctx.geneId !== undefined ? { nodeOfInterest: ctx.geneId } : {}),
      data,
      meta,
    };
  },
  slots: [neighborhoodSlot, geneStructuresSlot],
};
