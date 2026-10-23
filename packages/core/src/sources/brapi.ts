/**
 * BrAPI v2 genotyping endpoints and the `brapiAlleleMatrixSource` data
 * source: an allele-matrix response — a standard `/allelematrix` page or
 * gramene-g2p's `/allelematrix-search` window (with or without a
 * server-side tree) — becomes a tree + `GenotypeMatrix`, then `/germplasm`
 * and `/variants` fill in per-leaf metadata and REF/ALT alleles.
 *
 * Origin: the stale worktree's playground
 * (`stupefied-davinci-b87dec/examples/playground/main.tsx:679-830`:
 * `loadBrapiVariants`, `loadBrapiGermplasm`, `loadBrapi`), with the URL
 * arithmetic rewritten as pure string operations so relative `/brapi/v2/…`
 * URLs work without a `window`. `fetchBrapiVariantSetTree` mirrors
 * gramene-g2p's `GET /brapi/v2/variantsets/:id/tree`
 * (`apps/api/src/brapi/genotyping.ts:76-90`).
 */

import { buildUrl, getJson, HttpError, splitUrl, type FetchLike } from '../fetch/index';
import {
  fromBrAPIAlleleMatrix,
  fromBrAPIGermplasm,
  fromBrAPITree,
  fromBrAPIVariants,
  mergeVariantSites,
  type BrapiMatrixPagination,
  type FromBrAPIAlleleMatrixResult,
} from '../adapters/brapi';
import { DOSAGE_L1_MEAN, distanceMatrix, dosagesFromGenotypeMatrix, upgma } from '../cluster/upgma';
import type { GeneId, Germplasm, GenotypeMatrix, NodeId, Tree, TreeNode, VariantSite } from '../types';
import type { DataSlot, RootResult, TreeDataSource } from './types';

/** Transport options shared by every fetch helper here. */
export interface BrapiFetchOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
}

const transport = (opts: BrapiFetchOptions): { fetch?: FetchLike; signal?: AbortSignal } => ({
  ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
});

/** One page of a paged BrAPI list response (`result.data` + `metadata.pagination`). */
export interface BrapiPage<T> {
  data: T[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
}

/**
 * Iterate a paged BrAPI list endpoint: GET `url` with `pageSize` and
 * `page=0,1,…`, yielding each page's `result.data` with its pagination
 * block, and stopping once `currentPage >= totalPages - 1`, after `maxPages`
 * pages, or when a page carries no pagination block (treated as the only
 * page). Paging is new in tbrowse-core: the playground prototype issued a
 * single `pageSize=10000` request (`main.tsx:733-734`). Missing counts default to
 * the page index / 1 / `data.length`.
 */
export async function* brapiPages<T>(
  url: string,
  opts: BrapiFetchOptions & { pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<BrapiPage<T>> {
  const pageSize = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? Infinity;
  for (let page = 0; page < maxPages; page++) {
    const json = await getJson<unknown>(buildUrl(url, '', { pageSize, page }), transport(opts));
    const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const result = (body.result && typeof body.result === 'object' ? body.result : {}) as Record<string, unknown>;
    const data = (Array.isArray(result.data) ? result.data : []) as T[];
    const metadata = (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, unknown>;
    const pagination = (metadata.pagination && typeof metadata.pagination === 'object'
      ? metadata.pagination
      : null) as Record<string, unknown> | null;
    const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const currentPage = num(pagination?.currentPage, page);
    const totalPages = num(pagination?.totalPages, 1);
    const totalCount = num(pagination?.totalCount, data.length);
    yield { data, currentPage, totalPages, totalCount };
    if (pagination === null || currentPage >= totalPages - 1) return;
  }
}

/**
 * The BrAPI base of an endpoint URL: everything up to and including the
 * `/brapi/v<N>` segment (`/proxy/brapi/v2/allelematrix-search?x=1` →
 * `/proxy/brapi/v2`). When the path has no such segment, the
 * `/allelematrix-search…` tail is stripped as the prototype did
 * (`main.tsx:731-732`), and only when that tail is absent too is the last
 * path segment dropped. Pure string work: relative and absolute URLs both
 * work; the query string is discarded.
 */
export function brapiBaseOf(matrixUrl: string): string {
  const { path } = splitUrl(matrixUrl);
  const m = path.match(/^(.*\/brapi\/v\d+)(?:\/|$)/);
  if (m) return m[1]!;
  if (/\/allelematrix-search/.test(path)) return path.replace(/\/allelematrix-search.*$/, '');
  const noTrailing = path.replace(/\/+$/, '');
  const cut = noTrailing.lastIndexOf('/');
  return cut === -1 ? '' : noTrailing.slice(0, cut);
}

/** Query parameters a standard BrAPI v2 `/variants` call understands (besides paging). */
const STANDARD_VARIANTS_PARAMS: ReadonlySet<string> = new Set([
  'variantDbId', 'variantSetDbId', 'referenceDbId', 'referenceSetDbId', 'referenceName',
  'start', 'end', 'callSetDbId', 'germplasmDbId', 'germplasmName', 'germplasmPUI',
  'studyDbId', 'studyName', 'externalReferenceId', 'externalReferenceSource',
]);

/** `pageSize` put on a standard `/variants` URL (the servers' own defaults can be tiny). */
export const BRAPI_VARIANTS_PAGE_SIZE = 1000;

/**
 * The `/variants` URL for the window a matrix URL covers.
 *
 * - gramene-g2p style (`…/allelematrix-search?…`): the path tail becomes
 *   `/variants` and EVERY query parameter is kept except `tree` — the
 *   region, sample and allele-frequency filters must match the matrix
 *   exactly (`main.tsx:681-684`).
 * - standard BrAPI v2 (`…/allelematrix?…`, or any other path): `/variants`
 *   under `brapiBaseOf(matrixUrl)`, keeping only the parameters the
 *   standard `/variants` call accepts (variantSetDbId, referenceName,
 *   start, end, …) and adding `pageSize=${BRAPI_VARIANTS_PAGE_SIZE}`; the
 *   matrix-only dimension paging and display switches are dropped.
 */
export function brapiVariantsUrlFrom(matrixUrl: string): string {
  const { path, params } = splitUrl(matrixUrl);
  let variantsPath: string;
  if (/\/allelematrix-search/.test(path)) {
    variantsPath = path.replace(/\/allelematrix-search.*$/, '/variants');
    params.delete('tree');
  } else {
    variantsPath = `${brapiBaseOf(matrixUrl)}/variants`;
    for (const key of [...params.keys()]) if (!STANDARD_VARIANTS_PARAMS.has(key)) params.delete(key);
    params.set('pageSize', String(BRAPI_VARIANTS_PAGE_SIZE));
  }
  const qs = params.toString();
  return qs === '' ? variantsPath : `${variantsPath}?${qs}`;
}

/** Dimension page size put on a standard `/allelematrix` URL that names none. */
export const BRAPI_DIMENSION_PAGE_SIZE = 1000;

/**
 * A standard BrAPI `/allelematrix` call pages BOTH dimensions, with
 * server-chosen defaults that can be as small as a few rows; a matrix URL
 * whose path ends in `/allelematrix` and names neither
 * `dimensionVariantPageSize` nor `dimensionCallSetPageSize` gets
 * `BRAPI_DIMENSION_PAGE_SIZE` for each, so the first request returns a
 * usable window. URLs that name either, and g2p-style
 * `/allelematrix-search` URLs, are returned as they are.
 */
export function brapiMatrixUrlWithDefaults(matrixUrl: string): string {
  const { path, params } = splitUrl(matrixUrl);
  if (!/\/allelematrix\/?$/.test(path)) return matrixUrl;
  if (params.has('dimensionVariantPageSize') || params.has('dimensionCallSetPageSize')) return matrixUrl;
  params.set('dimensionVariantPageSize', String(BRAPI_DIMENSION_PAGE_SIZE));
  params.set('dimensionCallSetPageSize', String(BRAPI_DIMENSION_PAGE_SIZE));
  return `${path}?${params.toString()}`;
}

/**
 * GET an allele-matrix URL — a standard `/allelematrix` (dimension page
 * sizes defaulted by `brapiMatrixUrlWithDefaults`) or a g2p
 * `/allelematrix-search` — and normalise it with `fromBrAPIAlleleMatrix`.
 */
export async function fetchBrapiAlleleMatrix(
  url: string,
  opts: BrapiFetchOptions & { regionLabel?: string } = {},
): Promise<FromBrAPIAlleleMatrixResult> {
  const json = await getJson<unknown>(brapiMatrixUrlWithDefaults(url), transport(opts));
  return fromBrAPIAlleleMatrix(json, opts.regionLabel !== undefined ? { regionLabel: opts.regionLabel } : {});
}

/**
 * Page through `{base}/germplasm` (`pageSize` default 1000) and return the
 * records for `ids` only, keyed as `fromBrAPIGermplasm` keys them
 * (germplasmDbId and germplasmName), so the result joins the tree's leaf
 * `geneId`s directly. Servers often expose far more germplasm than ended
 * up in the matrix, hence the filter (`main.tsx:750-757`).
 */
export async function fetchBrapiGermplasm(
  base: string,
  ids: readonly string[],
  opts: BrapiFetchOptions & { pageSize?: number; maxPages?: number } = {},
): Promise<Record<GeneId, Germplasm>> {
  const wanted = new Set(ids);
  const out: Record<GeneId, Germplasm> = {};
  for await (const page of brapiPages<unknown>(`${base}/germplasm`, opts)) {
    const all = fromBrAPIGermplasm(page.data);
    for (const id of Object.keys(all)) {
      if (wanted.has(id)) out[id] = all[id]!;
    }
  }
  return out;
}

/**
 * GET a `/variants` URL (see `brapiVariantsUrlFrom`) exactly as given,
 * then — when the response carries a standard `metadata.pagination` block
 * announcing more pages — the remaining pages via `page=N` (at most
 * `maxPages` requests in all), and convert every row with
 * `fromBrAPIVariants`. g2p's unpaginated response is a single request.
 */
export async function fetchBrapiVariants(
  variantsUrl: string,
  opts: BrapiFetchOptions & { reference?: string; maxPages?: number } = {},
): Promise<VariantSite[]> {
  const maxPages = opts.maxPages ?? Infinity;
  const rows: unknown[] = [];
  let url = variantsUrl;
  for (let requests = 0; requests < maxPages; requests++) {
    const json = await getJson<unknown>(url, transport(opts));
    const body = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const result = (body.result && typeof body.result === 'object' ? body.result : null) as Record<string, unknown> | null;
    const data = result !== null && Array.isArray(result.data) ? result.data : Array.isArray(json) ? json : [];
    rows.push(...(data as unknown[]));
    const metadata = (body.metadata && typeof body.metadata === 'object' ? body.metadata : {}) as Record<string, unknown>;
    const pagination = (metadata.pagination && typeof metadata.pagination === 'object'
      ? metadata.pagination
      : null) as Record<string, unknown> | null;
    if (pagination === null) break;
    const currentPage = typeof pagination.currentPage === 'number' ? pagination.currentPage : requests;
    const totalPages = typeof pagination.totalPages === 'number' ? pagination.totalPages : 1;
    if (currentPage >= totalPages - 1 || data.length === 0) break;
    url = buildUrl(variantsUrl, '', { page: currentPage + 1 });
  }
  return fromBrAPIVariants(rows, opts.reference !== undefined ? { reference: opts.reference } : {});
}

/** A precomputed variant-set tree, as gramene-g2p serves it. */
export interface BrapiVariantSetTree {
  newick: string;
  leafOrder: string[];
  method?: string;
  metric?: string;
}

/**
 * GET `{base}/variantsets/{id}/tree` — gramene-g2p's precomputed,
 * dataset-wide sample tree (`{ newick, leafOrder, samples, variants,
 * method, metric }`, optionally wrapped in `result`). Resolves null on a
 * 404 (no build-tree run for that variant set); other HTTP errors throw.
 */
export async function fetchBrapiVariantSetTree(
  base: string,
  variantSetDbId: string,
  opts: BrapiFetchOptions = {},
): Promise<BrapiVariantSetTree | null> {
  let json: unknown;
  try {
    json = await getJson<unknown>(`${base}/variantsets/${encodeURIComponent(variantSetDbId)}/tree`, transport(opts));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
  const body = (json as { result?: unknown })?.result ?? json;
  if (!body || typeof body !== 'object') throw new Error('BrAPI: variantset tree response is not an object');
  const t = body as Record<string, unknown>;
  if (typeof t.newick !== 'string') throw new Error('BrAPI: variantset tree response has no `newick`');
  return {
    newick: t.newick,
    leafOrder: Array.isArray(t.leafOrder) ? (t.leafOrder as unknown[]).map(String) : [],
    ...(typeof t.method === 'string' ? { method: t.method } : {}),
    ...(typeof t.metric === 'string' ? { metric: t.metric } : {}),
  };
}

/** What `brapiAlleleMatrixSource.loadRoot` needs. */
export interface BrapiCtx {
  /**
   * Full allele-matrix URL (relative URLs are fine): a standard BrAPI v2
   * `/allelematrix?variantSetDbId=…` (dimension page sizes are defaulted
   * when absent) or a gramene-g2p `/allelematrix-search?…&tree=upgma`.
   */
  matrixUrl: string;
  /** BrAPI base for `/germplasm`; default `brapiBaseOf(matrixUrl)`. */
  base?: string;
  /** Overrides the matrix's synthesised region label. */
  regionLabel?: string;
  /** What to do when the response carries no tree (default `'upgma'`). */
  treeFallback?: 'upgma' | 'star' | 'none';
  /** Set false to skip the `germplasm` slot. */
  germplasm?: boolean;
  /** Set false to skip the `variants` slot. */
  variants?: boolean;
}

/** `RootResult.meta` of `brapiAlleleMatrixSource`. */
export interface BrapiMeta {
  /** The genotype matrix; the `variants` slot replaces it with a REF/ALT-enriched copy. */
  matrix: GenotypeMatrix;
  /** callSetDbIds in server order (= leaf geneIds). */
  sampleIds: string[];
  variantSetDbId?: string;
  /** Swaps that make the viewer reproduce the server's `leafOrder`. */
  swappedNodeIds: NodeId[];
  treeMethod?: string;
  treeMetric?: string;
  /** Matrix dimension paging as the server reported it (standard `/allelematrix` only). */
  pagination?: BrapiMatrixPagination[];
}

/** One root with every sample as a leaf at distance 1; leaf ids `l<i>`, geneId = sample. */
function starTree(samples: readonly string[]): Tree {
  const nodes: Record<NodeId, TreeNode> = { root: { id: 'root', parentId: null, distance: 0, isLeaf: false } };
  samples.forEach((s, i) => {
    const id = `l${i}`;
    nodes[id] = { id, parentId: 'root', distance: 1, isLeaf: true, geneId: s };
  });
  return { rootId: 'root', nodes };
}

const germplasmSlot: DataSlot<Record<GeneId, Germplasm>, BrapiCtx, BrapiMeta> = {
  id: 'germplasm',
  mode: 'eager',
  enabled: (ctx) => ctx.germplasm !== false,
  run: ({ ctx, fetch, signal, root }) =>
    fetchBrapiGermplasm(ctx.base ?? brapiBaseOf(ctx.matrixUrl), root.meta.sampleIds, { fetch, signal }),
  toHostData: (germplasm) => ({ germplasm }),
};

const variantsSlot: DataSlot<VariantSite[], BrapiCtx, BrapiMeta> = {
  id: 'variants',
  mode: 'eager',
  enabled: (ctx) => ctx.variants !== false,
  run: ({ ctx, fetch, signal, root }) => {
    const reference = root.meta.matrix.variants[0]?.reference;
    return fetchBrapiVariants(brapiVariantsUrlFrom(ctx.matrixUrl), {
      fetch,
      signal,
      ...(reference !== undefined ? { reference } : {}),
    });
  },
  toHostData: () => ({}),
  patchMeta: (sites, meta) => ({ ...meta, matrix: mergeVariantSites(meta.matrix, sites) }),
};

/**
 * `TreeDataSource` for a BrAPI `/allelematrix-search` window. The root
 * fetches the matrix and takes the server's tree when the response has one
 * (`fromBrAPITree`: synthetic node ids, sample names on `geneId`, swaps that
 * reproduce `leafOrder`); otherwise `ctx.treeFallback` decides: `'upgma'`
 * (default) clusters the matrix locally with the same metric gramene-g2p
 * uses, `'star'` hangs every sample off one root, `'none'` throws
 * `'BrAPI: response has no tree'`. Leaves are keyed so
 * `matrix.callsByGeneId[leaf.geneId]` joins; `root.data` is `{}` because
 * the genotype zone reads the matrix from `meta`. Slots: `germplasm`
 * (eager → `{ germplasm }`, filtered to the tree's samples) and `variants`
 * (eager; host data `{}`, `patchMeta` merges the REF/ALT sites into
 * `meta.matrix`).
 */
export const brapiAlleleMatrixSource: TreeDataSource<BrapiCtx, BrapiMeta> = {
  id: 'brapi-allelematrix',
  label: 'BrAPI allele matrix',
  async loadRoot({ ctx, fetch, signal }): Promise<RootResult<BrapiMeta>> {
    const r = await fetchBrapiAlleleMatrix(ctx.matrixUrl, {
      fetch,
      signal,
      ...(ctx.regionLabel !== undefined ? { regionLabel: ctx.regionLabel } : {}),
    });
    let tree: Tree;
    let swappedNodeIds: NodeId[] = [];
    let treeMethod = r.treeMethod;
    let treeMetric = r.treeMetric;
    const parsed = fromBrAPITree(r);
    if (parsed) {
      tree = parsed.tree;
      swappedNodeIds = parsed.swappedNodeIds;
    } else {
      const fallback = ctx.treeFallback ?? 'upgma';
      if (fallback === 'none') throw new Error('BrAPI: response has no tree');
      if (fallback === 'star') {
        tree = starTree(r.sampleIds);
        treeMethod = 'star';
        treeMetric = undefined;
      } else {
        const { dosages, samples, numVariants } = dosagesFromGenotypeMatrix(r.matrix, r.sampleIds);
        const result = upgma(samples, distanceMatrix(dosages, samples.length, numVariants));
        tree = result.tree;
        treeMethod = result.method;
        treeMetric = DOSAGE_L1_MEAN;
      }
    }
    return {
      tree,
      data: {},
      meta: {
        matrix: r.matrix,
        sampleIds: r.sampleIds,
        ...(r.variantSetDbId !== undefined ? { variantSetDbId: r.variantSetDbId } : {}),
        swappedNodeIds,
        ...(r.pagination !== undefined ? { pagination: r.pagination } : {}),
        ...(treeMethod !== undefined ? { treeMethod } : {}),
        ...(treeMetric !== undefined ? { treeMetric } : {}),
      },
    };
  },
  slots: [germplasmSlot, variantsSlot],
};
