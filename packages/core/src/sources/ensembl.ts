/**
 * Ensembl REST endpoint knowledge.
 *
 * Origin: tbrowse/examples/playground/main.tsx:70-136 (the mirror table,
 * `mirrorFor` and `ensemblUrlFor`), lifted so every host builds the same
 * release-aware URLs. The fetch helpers and the `ensemblGeneTreeSource`
 * data source are added in tbrowse-core 0.2.
 */

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
