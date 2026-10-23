import type { GeneId, Germplasm, GenotypeMatrix, NodeId, Tree, VariantSite } from '../types';
import { parseNewick, type ParseNewickOptions } from '../parsers/newick';
import { swapsForLeafOrder } from '../tree/swaps';

/**
 * Result of converting a BrAPI v2 `/allelematrix-search` response. The
 * genotype matrix is normalised onto TBrowse's `GenotypeMatrix` shape
 * (per-leaf row keyed by `geneId`, parallel to a list of variants), and
 * the response's optional Newick tree string is surfaced verbatim so
 * the host can parse it with whatever Newick parser it already owns —
 * the adapter intentionally stays out of tree parsing to avoid
 * doubling up with the host's existing tree pipeline.
 */
export interface FromBrAPIAlleleMatrixResult {
  /** Per-sample genotype calls + per-variant column metadata. */
  matrix: GenotypeMatrix;
  /** callSetDbIds in the order returned by the server. Useful when the
   *  host wants to render the matrix without a tree. */
  sampleIds: string[];
  /** First variantSetDbId on the response (most BrAPI servers return one). */
  variantSetDbId?: string;
  /** Optional Newick tree string. BrAPI servers return this only when
   *  the request includes a `tree=…` parameter. */
  newick?: string;
  /** Tree method label from the response (e.g. `"upgma"`). */
  treeMethod?: string;
  /** Tree distance metric label from the response. */
  treeMetric?: string;
  /** Server-supplied display order of leaves, when present. */
  leafOrder?: string[];
}

export interface FromBrAPIAlleleMatrixOptions {
  /** Optional human-readable region label for the zone header. Falls back
   *  to a label assembled from the response's `referenceName` / variant
   *  span when not supplied. */
  regionLabel?: string;
}

/**
 * Convert a BrAPI v2 `/allelematrix-search` response into a TBrowse
 * `GenotypeMatrix`. The matrix the server returns is variant-major
 * (`dataMatrix[v][s]`), but the zone consumes per-sample rows
 * (`callsByGeneId[sample] = string[]`), so the adapter transposes once
 * up-front — cheap relative to the cost of fetching the data and
 * lets the zone iterate cells in row-major order at paint time.
 *
 * Origin: stale worktree `stupefied-davinci-b87dec/src/adapters/brapi.ts:38-138`,
 * moved verbatim apart from the strict-mode spellings noted inline
 * (non-null assertions on indexed reads, conditional spreads instead of
 * `undefined`-valued optional properties).
 */
export function fromBrAPIAlleleMatrix(
  raw: unknown,
  opts: FromBrAPIAlleleMatrixOptions = {},
): FromBrAPIAlleleMatrixResult {
  const result = (raw as { result?: unknown })?.result ?? raw;
  if (!result || typeof result !== 'object') {
    throw new Error('BrAPI: response has no `result` object');
  }
  const r = result as Record<string, unknown>;

  const sampleIds = expectStringArray(r.callSetDbIds, 'callSetDbIds');
  const variantIds = expectStringArray(r.variantDbIds, 'variantDbIds');
  const dataMatrices = r.dataMatrices;
  if (!Array.isArray(dataMatrices) || dataMatrices.length === 0) {
    throw new Error('BrAPI: no `dataMatrices` in response');
  }
  // Prefer a "Genotype"-named matrix; fall back to the first entry. The
  // BrAPI spec allows multiple data matrices (e.g. genotype + dosage)
  // but allelematrix-search responses almost always carry just one.
  const firstMatrix =
    (dataMatrices as Array<Record<string, unknown>>).find(
      (m) =>
        typeof m.dataMatrixName === 'string' &&
        /genotype/i.test(m.dataMatrixName),
    ) ?? (dataMatrices[0] as Record<string, unknown>);
  const cells = firstMatrix.dataMatrix;
  if (!Array.isArray(cells)) {
    throw new Error('BrAPI: `dataMatrix` is missing or not an array');
  }
  if (cells.length !== variantIds.length) {
    throw new Error(
      `BrAPI: dataMatrix row count (${cells.length}) doesn't match variantDbIds (${variantIds.length})`,
    );
  }

  // Transpose variant-major → sample-major so the zone can iterate the
  // matrix one row (sample) at a time.
  const callsByGeneId: Record<string, string[]> = {};
  for (let s = 0; s < sampleIds.length; s++) {
    callsByGeneId[sampleIds[s]!] = new Array<string>(variantIds.length);
  }
  for (let v = 0; v < variantIds.length; v++) {
    const row = cells[v];
    if (!Array.isArray(row)) {
      throw new Error(`BrAPI: dataMatrix[${v}] is not an array`);
    }
    if (row.length !== sampleIds.length) {
      throw new Error(
        `BrAPI: dataMatrix[${v}] has ${row.length} cells but expected ${sampleIds.length}`,
      );
    }
    for (let s = 0; s < sampleIds.length; s++) {
      callsByGeneId[sampleIds[s]!]![v] = String(row[s] ?? '');
    }
  }

  const variants: VariantSite[] = variantIds.map((id) => parseVariantId(id));

  // Tree block — present only when the request asked for one. Captured
  // verbatim so the host can run it through its own Newick parser.
  let newick: string | undefined;
  let treeMethod: string | undefined;
  let treeMetric: string | undefined;
  let leafOrder: string[] | undefined;
  const tree = r.tree;
  if (tree && typeof tree === 'object') {
    const t = tree as Record<string, unknown>;
    if (typeof t.newick === 'string') newick = t.newick;
    if (typeof t.method === 'string') treeMethod = t.method;
    if (typeof t.metric === 'string') treeMetric = t.metric;
    if (Array.isArray(t.leafOrder)) {
      leafOrder = (t.leafOrder as unknown[]).map(String);
    }
  }

  const variantSetDbIds = Array.isArray(r.variantSetDbIds)
    ? (r.variantSetDbIds as unknown[]).map(String)
    : [];

  // Region label: prefer the caller's, otherwise synthesise from the
  // first/last variant positions when they share a chromosome.
  let regionLabel = opts.regionLabel;
  if (!regionLabel && variants.length > 0) {
    const first = variants[0]!;
    const last = variants[variants.length - 1]!;
    if (
      first.reference &&
      first.reference === last.reference &&
      first.position !== undefined &&
      last.position !== undefined
    ) {
      regionLabel = `${first.reference}:${first.position.toLocaleString()}–${last.position.toLocaleString()}`;
    }
  }

  const matrix: GenotypeMatrix = {
    variants,
    callsByGeneId,
    ...(typeof r.sepPhased === 'string' ? { sepPhased: r.sepPhased as string } : {}),
    ...(typeof r.sepUnphased === 'string' ? { sepUnphased: r.sepUnphased as string } : {}),
    ...(typeof r.unknownString === 'string' ? { unknownString: r.unknownString as string } : {}),
    ...(regionLabel !== undefined ? { regionLabel } : {}),
  };

  return {
    matrix,
    sampleIds,
    ...(variantSetDbIds[0] !== undefined ? { variantSetDbId: variantSetDbIds[0] } : {}),
    ...(newick !== undefined ? { newick } : {}),
    ...(treeMethod !== undefined ? { treeMethod } : {}),
    ...(treeMetric !== undefined ? { treeMetric } : {}),
    ...(leafOrder !== undefined ? { leafOrder } : {}),
  };
}

/** Variant ids on Gigwa / DeepVariant BrAPI servers come back as
 *  `"<chrom>:<position>"`. Parse out the parts so the zone can show
 *  formatted coords; fall back to the raw id when the format doesn't
 *  match (third-party servers emit rsIds, internal hashes, etc.). */
function parseVariantId(id: string): VariantSite {
  const m = id.match(/^([^:]+):(\d+)$/);
  if (!m) return { id };
  return { id, reference: m[1]!, position: Number(m[2]) };
}

/**
 * Convert a BrAPI v2 `/germplasm` (or `/search/germplasm`) response into
 * a `Record<GeneId, Germplasm>` map keyed by germplasmDbId AND
 * germplasmName, so a tree whose leaves carry either id can join the
 * map without the host having to choose up-front. The returned map is
 * suitable to drop straight into TBrowse's `germplasm` prop.
 *
 * Standard BrAPI columns are mapped onto the matching `Germplasm`
 * fields; anything else on the record (institute codes, donor info,
 * 1000 Genomes-style population labels, etc.) is preserved on the
 * `extras` field so a host can surface it via a custom label provider.
 *
 * Origin: stale worktree `stupefied-davinci-b87dec/src/adapters/brapi.ts:162-236`, verbatim.
 */
export function fromBrAPIGermplasm(raw: unknown): Record<GeneId, Germplasm> {
  const result = (raw as { result?: unknown })?.result ?? raw;
  if (!result || typeof result !== 'object') return {};
  const data = (result as { data?: unknown }).data ?? result;
  if (!Array.isArray(data)) return {};

  const STANDARD_KEYS = new Set([
    'germplasmDbId',
    'germplasmName',
    'accessionNumber',
    'defaultDisplayName',
    'commonCropName',
    'genus',
    'species',
    'subtaxa',
    'countryOfOriginCode',
    'pedigree',
    'synonyms',
    'extras',
  ]);

  const out: Record<GeneId, Germplasm> = {};
  for (const entry of data as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const g: Germplasm = {};
    for (const key of [
      'germplasmDbId',
      'germplasmName',
      'accessionNumber',
      'defaultDisplayName',
      'commonCropName',
      'genus',
      'species',
      'subtaxa',
      'countryOfOriginCode',
      'pedigree',
    ] as const) {
      const v = r[key];
      if (typeof v === 'string') g[key] = v;
    }
    if (Array.isArray(r.synonyms)) {
      g.synonyms = (r.synonyms as unknown[]).filter(
        (x) => typeof x === 'string',
      ) as string[];
    }
    // Preserve server-side extras so hosts can surface them via a
    // LabelProvider; merge top-level non-standard keys into extras as
    // well so single-flat-object responses behave like nested ones.
    const extras: Record<string, unknown> = {};
    if (r.extras && typeof r.extras === 'object') {
      Object.assign(extras, r.extras as Record<string, unknown>);
    }
    for (const k of Object.keys(r)) {
      if (!STANDARD_KEYS.has(k)) extras[k] = r[k];
    }
    if (Object.keys(extras).length > 0) g.extras = extras;

    // Index under both ids the leaf might carry. When both are present
    // and identical (the common case) the second write is a no-op.
    if (g.germplasmDbId) out[g.germplasmDbId] = g;
    if (g.germplasmName) out[g.germplasmName] = g;
  }
  return out;
}

function expectStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`BrAPI: \`${name}\` is missing or not an array`);
  }
  return (value as unknown[]).map(String);
}

export interface FromBrAPIVariantsOptions {
  /** Reference (chromosome) name the rows belong to; the long-form rows
   *  carry only `pos`, so this is what makes the synthesised id match the
   *  matrix's `<reference>:<pos>` variantDbIds. */
  reference?: string;
}

/**
 * Convert the long-form BrAPI `/variants` response of gramene-g2p — one row
 * per (sample, variant): `{ sample, pos, ref?, alleles, GT }`, wrapped in
 * `result.data` or given as a bare array — into one `VariantSite` per
 * position (first row per `pos` wins, in order of first appearance). `ref`
 * is the row's `ref`, `alt` is `alleles.slice(1)` (`alleles[0]` is REF),
 * and the id is synthesised as `${reference ?? ''}:${pos}` so it matches
 * the matrix's variantDbIds (g2p `brapi/genotyping.ts:426`). Rows without a
 * numeric `pos` are skipped.
 * Origin: stale worktree `examples/playground/main.tsx:679-700` (`loadBrapiVariants`).
 */
export function fromBrAPIVariants(raw: unknown, opts: FromBrAPIVariantsOptions = {}): VariantSite[] {
  const result = (raw as { result?: unknown })?.result ?? raw;
  const data = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as { data?: unknown }).data
    : result;
  if (!Array.isArray(data)) return [];
  const seen = new Set<number>();
  const out: VariantSite[] = [];
  for (const rec of data as unknown[]) {
    if (!rec || typeof rec !== 'object') continue;
    const row = rec as Record<string, unknown>;
    const pos = row.pos;
    if (typeof pos !== 'number' || !Number.isFinite(pos)) continue;
    if (seen.has(pos)) continue;
    seen.add(pos);
    const alt = Array.isArray(row.alleles)
      ? ((row.alleles as unknown[]).slice(1).filter((a) => typeof a === 'string') as string[])
      : [];
    const site: VariantSite = {
      id: `${opts.reference ?? ''}:${pos}`,
      position: pos,
      alt,
      ...(opts.reference !== undefined ? { reference: opts.reference } : {}),
      ...(typeof row.ref === 'string' ? { ref: row.ref } : {}),
    };
    out.push(site);
  }
  return out;
}

/**
 * Merge REF/ALT (and allele-frequency) detail from `sites` into the
 * matrix's variant columns. The join is by POSITION: a matrix variant with
 * a `position` takes the site at the same position; one without a position
 * matches a site by `id` only when that site also lacks a position. On a
 * hit, `ref`, `alt` and `alleleFrequency` are taken from the site when it
 * defines them and kept otherwise. Returns a new `GenotypeMatrix` (new
 * `variants` array) when at least one column changed, and the SAME object
 * when nothing matched, so a loader can tell a no-op from a change.
 * Origin: stale worktree `examples/playground/main.tsx:703-712`.
 */
export function mergeVariantSites(matrix: GenotypeMatrix, sites: VariantSite[]): GenotypeMatrix {
  const byPos = new Map<number, VariantSite>();
  const byId = new Map<string, VariantSite>();
  for (const s of sites) {
    if (s.position !== undefined) {
      if (!byPos.has(s.position)) byPos.set(s.position, s);
    } else if (!byId.has(s.id)) {
      byId.set(s.id, s);
    }
  }
  let changed = false;
  const variants = matrix.variants.map((v) => {
    const hit = v.position !== undefined ? byPos.get(v.position) : byId.get(v.id);
    if (!hit) return v;
    changed = true;
    return {
      ...v,
      ...(hit.ref !== undefined ? { ref: hit.ref } : {}),
      ...(hit.alt !== undefined ? { alt: hit.alt } : {}),
      ...(hit.alleleFrequency !== undefined ? { alleleFrequency: hit.alleleFrequency } : {}),
    };
  });
  return changed ? { ...matrix, variants } : matrix;
}

/**
 * Parse the tree block of a BrAPI allele-matrix response into a `Tree`
 * plus the `swappedNodeIds` that make `leafOrder(tree, { swappedNodeIds })`
 * reproduce the server's `leafOrder`. The Newick is parsed with
 * `labelsAsIds: false`, so every node id is synthetic and sample names
 * (which may be numeric strings) live on `geneId` only — that is what keeps
 * child order stable under `Object.keys` and lets `callsByGeneId[sample]`
 * join each leaf. Returns null when the response carries no `newick`;
 * `unmatched` lists leafOrder entries that name no leaf.
 */
export function fromBrAPITree(
  r: Pick<FromBrAPIAlleleMatrixResult, 'newick' | 'leafOrder'>,
  opts: ParseNewickOptions = {},
): { tree: Tree; swappedNodeIds: NodeId[]; unmatched: string[] } | null {
  if (r.newick === undefined || r.newick.trim() === '') return null;
  // Sample names must land on geneId (the join key for callsByGeneId), so
  // both parser switches are forced whatever the caller passed.
  const { tree } = parseNewick(r.newick, { ...opts, labelsAsIds: false, leafGeneId: true });
  if (!r.leafOrder || r.leafOrder.length === 0) return { tree, swappedNodeIds: [], unmatched: [] };
  const { swappedNodeIds, unmatched } = swapsForLeafOrder(
    tree,
    r.leafOrder,
    (leaf) => leaf.geneId ?? leaf.id,
  );
  return { tree, swappedNodeIds, unmatched };
}
