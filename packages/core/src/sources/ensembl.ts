/**
 * Ensembl REST endpoint knowledge.
 *
 * Origin: tbrowse/examples/playground/main.tsx:70-136 (the mirror table,
 * `mirrorFor` and `ensemblUrlFor`), lifted so every host builds the same
 * release-aware URLs. The fetch helpers and the `ensemblGeneTreeSource`
 * data source are added in tbrowse-core 0.2.
 */

import { fanOut, getJson, HttpError, type FanOutProgress, type FanOutResult, type FetchLike } from '../fetch/index';
import {
  fromEnsemblGeneStructure,
  fromEnsemblGeneTree,
  fromEnsemblGenomeFeatures,
  fromEnsemblProteinFeatures,
  type FromEnsemblOptions,
  type FromEnsemblResult,
} from '../adapters/ensembl';
import { leafGeneIds } from '../tree/index';
import type { GeneId, GeneStructure, GenomeFeature, HostDataPatch, ProteinDomain } from '../types';
import type { DataSlot, TreeDataSource } from './types';

/**
 * One Ensembl REST host. Archive hosts pin a single release and run on
 * infrastructure separate from the main `rest.ensembl.org` endpoint, which
 * intermittently sheds load with 5xx when traffic spikes; picking an
 * archive trades currency for consistency.
 *
 * `route` is not cosmetic: the gene-tree member endpoint changed shape
 * mid-history. Releases <= 109 answer only `/genetree/member/id/{gene}`;
 * releases >= 112 answer only `/genetree/member/id/{species}/{gene}`; 110
 * and 111 accept both. Sending the wrong form gets a 404.
 */
export interface EnsemblMirror {
  /** Hostname, and the stable id a host persists in its URL state. */
  host: string;
  /** Ensembl release served by this host. */
  release: number;
  /** Gene-tree member route shape this release understands. */
  route: 'bare' | 'species';
}

/**
 * Known Ensembl REST hosts, newest release first. Release 106 (apr2022) is
 * deliberately absent: that host accepts TCP connections but never
 * responds. Expect one maintenance edit per Ensembl release.
 */
export const ENSEMBL_MIRRORS: readonly EnsemblMirror[] = [
  { host: 'rest.ensembl.org', release: 116, route: 'species' },
  // sep2025 takes the archive overflow traffic and measures several
  // times slower than its neighbours; prefer a lower release if the
  // per-leaf fan-outs feel sluggish.
  { host: 'sep2025.rest.ensembl.org', release: 115, route: 'species' },
  { host: 'may2025.rest.ensembl.org', release: 114, route: 'species' },
  { host: 'oct2024.rest.ensembl.org', release: 113, route: 'species' },
  { host: 'may2024.rest.ensembl.org', release: 112, route: 'species' },
  { host: 'jan2024.rest.ensembl.org', release: 111, route: 'species' },
  { host: 'jul2023.rest.ensembl.org', release: 110, route: 'species' },
  { host: 'feb2023.rest.ensembl.org', release: 109, route: 'bare' },
  { host: 'oct2022.rest.ensembl.org', release: 108, route: 'bare' },
  { host: 'jul2022.rest.ensembl.org', release: 107, route: 'bare' },
  { host: 'dec2021.rest.ensembl.org', release: 105, route: 'bare' },
];

/** The current (load-sensitive) endpoint; the default when a host names none. */
export const ENSEMBL_DEFAULT_MIRROR = 'rest.ensembl.org';

/**
 * Resolve a host name to its mirror record. An unknown host is assumed to
 * serve `release` (default: the current release) and gets the route that
 * release implies (`'species'` for >= 112, `'bare'` below 110, either in
 * between — we pick `'species'`), so a new archive works before the table
 * is updated.
 */
export function mirrorFor(host: string, release?: number): EnsemblMirror {
  const known = ENSEMBL_MIRRORS.find((m) => m.host === host);
  if (known) return known;
  const rel = release ?? (ENSEMBL_MIRRORS[0]?.release ?? 112);
  return { host, release: rel, route: rel >= 110 ? 'species' : 'bare' };
}

export interface EnsemblGeneTreeUrlOptions {
  /** REST host; default `ENSEMBL_DEFAULT_MIRROR`. */
  host?: string;
  /** Species segment for the >= 112 route; default `homo_sapiens`. */
  species?: string;
  /** `sequence=` query value; default `'protein'`. */
  sequence?: 'protein' | 'cdna' | 'none';
  /** `aligned=1` (default true) returns the aligned member sequences. */
  aligned?: boolean;
}

/**
 * URL of the gene-tree-by-member endpoint for `geneId`, switching the route
 * on the host's release (see `EnsemblMirror.route`).
 */
export function ensemblGeneTreeUrl(geneId: string, opts: EnsemblGeneTreeUrlOptions = {}): string {
  const m = mirrorFor(opts.host ?? ENSEMBL_DEFAULT_MIRROR);
  const species = opts.species ?? 'homo_sapiens';
  const member = m.route === 'species' ? `${species}/${encodeURIComponent(geneId)}` : encodeURIComponent(geneId);
  const params = [`aligned=${opts.aligned === false ? 0 : 1}`, `sequence=${opts.sequence ?? 'protein'}`];
  return `https://${m.host}/genetree/member/id/${member}?${params.join('&')}`;
}

// ─── Fetch helpers (tbrowse-core 0.2) ────────────────────────────────────────

/** Options accepted by {@link fetchEnsemblGeneTree}. */
export interface FetchEnsemblGeneTreeOptions extends FromEnsemblOptions {
  /** REST host; default `ENSEMBL_DEFAULT_MIRROR`. */
  host?: string;
  /** Species segment for the `'species'` route; default `homo_sapiens`. */
  species?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

/**
 * GET the gene tree that contains `geneId` (via {@link ensemblGeneTreeUrl},
 * so the route follows the host's release) and convert it with
 * `fromEnsemblGeneTree`. A 404 is reported as "no gene tree for <gene>"
 * naming the host and release, because on Ensembl it is almost always a
 * route-shape mismatch rather than a missing gene; every other non-2xx
 * status surfaces as `HTTP <status> from <host>`. Origin: the playground's
 * `loadEnsembl`, `examples/playground/main.tsx:345-380`.
 */
export async function fetchEnsemblGeneTree(
  geneId: string,
  opts: FetchEnsemblGeneTreeOptions = {},
): Promise<FromEnsemblResult> {
  const host = opts.host ?? ENSEMBL_DEFAULT_MIRROR;
  const url = ensemblGeneTreeUrl(geneId, {
    host,
    ...(opts.species !== undefined ? { species: opts.species } : {}),
  });
  let json: unknown;
  try {
    json = await getJson(url, {
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      const m = mirrorFor(host);
      throw new Error(
        err.status === 404
          ? `HTTP 404 from ${m.host} (release ${m.release}) — no gene tree for ${geneId}`
          : `HTTP ${err.status} from ${m.host}`,
      );
    }
    throw err;
  }
  return fromEnsemblGeneTree(json, {
    ...(opts.alphabet !== undefined ? { alphabet: opts.alphabet } : {}),
  });
}

/** Protein-feature sources kept by default (`type` field of each row). */
export const ENSEMBL_DEFAULT_DOMAIN_SOURCES: readonly string[] = ['Pfam', 'Smart'];

/** Options accepted by {@link fetchEnsemblProteinDomains}. */
export interface FetchEnsemblProteinDomainsOptions {
  /** REST host; default `ENSEMBL_DEFAULT_MIRROR`. */
  host?: string;
  /** Feature sources to keep; default {@link ENSEMBL_DEFAULT_DOMAIN_SOURCES}. */
  sources?: readonly string[];
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Requests in flight at once; default 6 (Ensembl rate-limits at 15 req/s). */
  concurrency?: number;
  onProgress?: (p: FanOutProgress) => void;
}

/**
 * Fan out to `/overlap/translation/{ENSP}?feature=protein_feature` for
 * every gene in `proteinIdByGeneId` (as `fromEnsemblGeneTree` reports it)
 * and convert each response with `fromEnsemblProteinFeatures`, keeping
 * only the `sources` given (Pfam + Smart by default). Per-gene failures
 * are recorded in `errors` rather than aborting the batch; the caller
 * decides whether an all-failed result is an error. Origin: the
 * playground's `loadEnsemblDomains`, `examples/playground/main.tsx:390-465`.
 */
export function fetchEnsemblProteinDomains(
  proteinIdByGeneId: Record<GeneId, string>,
  opts: FetchEnsemblProteinDomainsOptions = {},
): Promise<FanOutResult<ProteinDomain[]>> {
  const host = opts.host ?? ENSEMBL_DEFAULT_MIRROR;
  const sources = opts.sources ?? ENSEMBL_DEFAULT_DOMAIN_SOURCES;
  const keys = Object.keys(proteinIdByGeneId);
  return fanOut(
    keys,
    async (geneId, signal) => {
      const ensp = proteinIdByGeneId[geneId]!;
      const url = `https://${host}/overlap/translation/${encodeURIComponent(ensp)}?feature=protein_feature`;
      const json = await getJson(url, {
        ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
        signal,
      });
      return fromEnsemblProteinFeatures(json, { sources });
    },
    {
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    },
  );
}

/** What {@link fetchEnsemblOverlap} resolves to: three `HostData`-shaped maps. */
export interface EnsemblOverlapResult {
  geneStructures: Record<GeneId, GeneStructure>;
  genomeFeatures: Record<GeneId, GenomeFeature[]>;
  /** Per-gene failures (HTTP status, parse error, or no gene model in the response). */
  geneStructureErrors: Record<GeneId, string>;
}

/** Options accepted by {@link fetchEnsemblOverlap}. */
export interface FetchEnsemblOverlapOptions {
  /** REST host; default `ENSEMBL_DEFAULT_MIRROR`. */
  host?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Requests in flight at once; default 6. */
  concurrency?: number;
  onProgress?: (p: FanOutProgress) => void;
}

/** The feature list the overlap endpoint is asked for, in Ensembl's `;`-joined form. */
const OVERLAP_FEATURES = 'feature=transcript;feature=exon;feature=cds;feature=regulatory;feature=motif';

/**
 * Fan out to `/overlap/id/{gene}?feature=transcript;feature=exon;feature=cds;
 * feature=regulatory;feature=motif` for every gene id and split each
 * response into a `GeneStructure` (`fromEnsemblGeneStructure`) and
 * `GenomeFeature[]` (`fromEnsemblGenomeFeatures`). A gene whose request
 * fails, or whose response holds no gene model, lands in
 * `geneStructureErrors` with a message; the rest of the tree still gets
 * its data. Genes without regulatory/motif hits are simply absent from
 * `genomeFeatures`. Origin: the playground's `loadEnsemblOverlap`,
 * `examples/playground/main.tsx:480-545`.
 */
export async function fetchEnsemblOverlap(
  geneIds: readonly GeneId[],
  opts: FetchEnsemblOverlapOptions = {},
): Promise<EnsemblOverlapResult> {
  const host = opts.host ?? ENSEMBL_DEFAULT_MIRROR;
  const r = await fanOut(
    geneIds,
    async (geneId, signal) => {
      const url = `https://${host}/overlap/id/${encodeURIComponent(geneId)}?${OVERLAP_FEATURES}`;
      const json = await getJson(url, {
        ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
        signal,
      });
      return {
        structure: fromEnsemblGeneStructure(json, geneId),
        features: fromEnsemblGenomeFeatures(json),
      };
    },
    {
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    },
  );
  const geneStructures: Record<GeneId, GeneStructure> = {};
  const genomeFeatures: Record<GeneId, GenomeFeature[]> = {};
  const geneStructureErrors: Record<GeneId, string> = { ...r.errors };
  for (const geneId of geneIds) {
    const hit = r.results[geneId];
    if (!hit) continue;
    if (hit.structure) geneStructures[geneId] = hit.structure;
    else geneStructureErrors[geneId] = 'no gene structure in response';
    if (hit.features.length > 0) genomeFeatures[geneId] = hit.features;
  }
  return { geneStructures, genomeFeatures, geneStructureErrors };
}

// ─── Data source ─────────────────────────────────────────────────────────────

/** Context for {@link ensemblGeneTreeSource}. */
export interface EnsemblCtx {
  /** Member gene id, e.g. `ENSG00000139618`. */
  geneId: string;
  /** REST host; default `ENSEMBL_DEFAULT_MIRROR`. */
  host?: string;
  /** Species segment for the `'species'` route; default `homo_sapiens`. */
  species?: string;
  /** Protein-feature sources for the `proteinDomains` slot; default Pfam + Smart. */
  domainSources?: readonly string[];
}

/** Root metadata of {@link ensemblGeneTreeSource}. */
export interface EnsemblMeta {
  /** Gene id → translation (ENSP) accession, as the gene-tree response carried it. */
  proteinIdByGeneId: Record<GeneId, string>;
  /** The mirror the tree was loaded from; slots fan out to the same host. */
  mirror: EnsemblMirror;
}

const proteinDomainsSlot: DataSlot<FanOutResult<ProteinDomain[]>, EnsemblCtx, EnsemblMeta> = {
  id: 'proteinDomains',
  mode: 'lazy',
  async run({ ctx, fetch, signal, root, onProgress, concurrency }) {
    const map = root.meta.proteinIdByGeneId;
    if (Object.keys(map).length === 0) throw new Error('No protein ids on this tree');
    return fetchEnsemblProteinDomains(map, {
      host: root.meta.mirror.host,
      ...(ctx.domainSources !== undefined ? { sources: ctx.domainSources } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
      fetch,
      signal,
      onProgress,
    });
  },
  toHostData: (v) => ({ proteinDomains: v.results }),
  itemErrorsOf: (v) => (Object.keys(v.errors).length > 0 ? v.errors : null),
  failWhen: (v) =>
    Object.keys(v.results).length === 0
      ? `All ${v.progress.total} domain requests failed (${v.lastError})`
      : null,
};

const overlapSlot: DataSlot<EnsemblOverlapResult, EnsemblCtx, EnsemblMeta> = {
  id: 'overlap',
  mode: 'lazy',
  async run({ fetch, signal, tree, root, onProgress, concurrency }) {
    const leaves = leafGeneIds(tree);
    if (leaves.length === 0) throw new Error('No leaves on this tree');
    return fetchEnsemblOverlap(leaves, {
      host: root.meta.mirror.host,
      ...(concurrency !== undefined ? { concurrency } : {}),
      fetch,
      signal,
      onProgress,
    });
  },
  toHostData: (v) => {
    const patch: HostDataPatch = { geneStructures: v.geneStructures };
    if (Object.keys(v.genomeFeatures).length > 0) patch.genomeFeatures = v.genomeFeatures;
    if (Object.keys(v.geneStructureErrors).length > 0) patch.geneStructureErrors = v.geneStructureErrors;
    return patch;
  },
};

/**
 * The Ensembl gene-tree data source: the root is the gene tree containing
 * `ctx.geneId` ({@link fetchEnsemblGeneTree}: tree, taxonomy, aligned MSA,
 * gene metadata), pivoted on that gene. Two lazy slots fan out to the
 * same mirror on demand: `proteinDomains` ({@link fetchEnsemblProteinDomains};
 * errors with 'No protein ids on this tree' when the tree carried no
 * translation ids and with `All N domain requests failed (…)` when nothing
 * came back, otherwise ready with per-gene `itemErrors`) and `overlap`
 * ({@link fetchEnsemblOverlap}; per-leaf failures are delivered as
 * `geneStructureErrors` data, never as a slot error). Origin: the
 * playground's Ensembl path, `examples/playground/main.tsx:88-137, 458-655`.
 */
export const ensemblGeneTreeSource: TreeDataSource<EnsemblCtx, EnsemblMeta> = {
  id: 'ensembl-genetree',
  label: 'Ensembl gene tree',
  async loadRoot({ ctx, fetch, signal }) {
    const geneId = ctx.geneId.trim();
    const host = ctx.host ?? ENSEMBL_DEFAULT_MIRROR;
    const r = await fetchEnsemblGeneTree(geneId, {
      host,
      ...(ctx.species !== undefined ? { species: ctx.species } : {}),
      fetch,
      signal,
    });
    const data: HostDataPatch = { geneMetadata: r.geneMetadata };
    if (r.msa !== undefined) data.msa = r.msa;
    return {
      tree: r.tree,
      taxonomy: r.taxonomy,
      nodeOfInterest: geneId,
      data,
      meta: { proteinIdByGeneId: r.proteinIdByGeneId, mirror: mirrorFor(host) },
    };
  },
  slots: [proteinDomainsSlot, overlapSlot],
};
